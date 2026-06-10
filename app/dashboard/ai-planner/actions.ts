"use server";

import { revalidatePath } from "next/cache";

import {
  generateWeeklyCampaignPlan,
  type CampaignGoal,
  type PlannerProduct,
} from "@/lib/ai/campaign-planner";
import { toNumberSafe } from "@/lib/analytics";
import { insertPostingLog } from "@/lib/posts/log";
import { generateResearchQueries } from "@/lib/research/query-generator";
import {
  summarizeMarketResearch,
  type MarketResearchInsights,
} from "@/lib/research/research-summarizer";
import { getSearchProvider, searchWeb, type SearchResult } from "@/lib/research/search-client";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AICampaignRecommendation, RecommendationStatus } from "@/lib/types";

export type GenerateRecResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type RecListItem = {
  id: string;
  title: string;
  goal: string | null;
  week_start: string | null;
  week_end: string | null;
  status: RecommendationStatus;
  created_at: string;
};
export type RecListResult =
  | { ok: true; items: RecListItem[] }
  | { ok: false; error: string };

export type GenerateRecInput = {
  week_start: string;
  week_end: string;
  goal: CampaignGoal;
  target_customer?: string;
  notes?: string;
  use_market_research?: boolean;
  research_run_id?: string;
};

const GEN_ACTION = "GENERATE_AI_WEEKLY_CAMPAIGN_PLAN";
const APPROVE_ACTION = "APPROVE_AI_CAMPAIGN_PLAN";
const REJECT_ACTION = "REJECT_AI_CAMPAIGN_PLAN";
const RESEARCH_ACTION = "RUN_MARKET_RESEARCH";
const VALID_GOALS: CampaignGoal[] = ["clicks", "orders", "commission", "engagement", "balanced"];
const MAX_QUERIES = 15;

export type RunResearchResult =
  | { ok: true; research_run_id: string }
  | { ok: false; error: string };

export type ResearchInput = {
  week_start: string;
  week_end: string;
  goal: CampaignGoal;
  target_customer?: string;
  notes?: string;
};

/**
 * Chạy nghiên cứu thị trường (Phase 13.1): sinh query -> search -> lưu nguồn -> AI tóm tắt.
 * Nguồn công khai, không scrape/login. Lỗi 1 query không làm chết cả run.
 */
export async function runMarketResearchForWeeklyPlan(
  input: ResearchInput,
): Promise<RunResearchResult> {
  const goal = VALID_GOALS.includes(input?.goal) ? input.goal : "balanced";

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }

  // Sản phẩm ACTIVE + READY (kèm target_customer/angle để sinh query).
  const { data: productsData, error: prodErr } = await supabase
    .from("products")
    .select("product_name, target_customer, product_angle, status, link_status")
    .eq("status", "ACTIVE")
    .eq("link_status", "READY");
  if (prodErr) {
    return { ok: false, error: `Không tải được sản phẩm: ${prodErr.message}` };
  }
  const products = (productsData ?? []) as {
    product_name: string;
    target_customer: string | null;
    product_angle: string | null;
  }[];
  if (products.length === 0) {
    return { ok: false, error: "Chưa có sản phẩm READY. Hãy import link affiliate trước." };
  }

  const provider = getSearchProvider();

  // Tạo run RUNNING.
  const { data: run, error: runErr } = await supabase
    .from("market_research_runs")
    .insert({
      goal,
      target_customer: input.target_customer?.trim() || null,
      week_start: input.week_start || null,
      week_end: input.week_end || null,
      status: "RUNNING",
      provider,
    })
    .select("id")
    .single();
  if (runErr || !run) {
    return { ok: false, error: `Tạo research run thất bại: ${runErr?.message ?? "không rõ"}` };
  }
  const runId = run.id as string;

  try {
    const queries = generateResearchQueries({
      products,
      goal,
      target_customer: input.target_customer?.trim() || null,
      notes: input.notes?.trim() || null,
    }).slice(0, MAX_QUERIES);

    await supabase.from("market_research_runs").update({ queries }).eq("id", runId);

    // Search song song, mỗi query tối đa 5 kết quả.
    const perQuery = await Promise.all(
      queries.map(async (q) => {
        try {
          const res = await searchWeb(q, { maxResults: 5 });
          return res.map((r) => ({ query: q, ...r }));
        } catch {
          return [] as (SearchResult & { query: string })[];
        }
      }),
    );
    const flat = perQuery.flat();

    if (flat.length > 0) {
      await supabase.from("market_research_sources").insert(
        flat.map((r) => ({
          research_run_id: runId,
          query: r.query,
          title: r.title,
          url: r.url,
          snippet: r.snippet ?? null,
          content: r.content ?? null,
          source_type: r.source_type ?? provider,
          relevance_score: r.relevance_score ?? null,
        })),
      );
    }

    const insights = await summarizeMarketResearch({
      queries,
      results: flat,
      productNames: products.map((p) => p.product_name),
      goal,
      target_customer: input.target_customer?.trim() || null,
    });

    await supabase
      .from("market_research_runs")
      .update({
        status: "SUCCESS",
        summary: insights.market_summary,
        insights,
        raw_response: { provider, query_count: queries.length, source_count: flat.length },
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await insertPostingLog(
      supabase,
      null,
      RESEARCH_ACTION,
      "SUCCESS",
      `Đã chạy research: ${queries.length} query, ${flat.length} nguồn (provider: ${provider}).`,
      { research_run_id: runId },
    );

    revalidatePath("/dashboard/ai-planner");
    return { ok: true, research_run_id: runId };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    await supabase
      .from("market_research_runs")
      .update({ status: "FAILED", error_message: m, updated_at: new Date().toISOString() })
      .eq("id", runId);
    await insertPostingLog(supabase, null, RESEARCH_ACTION, "FAILED", `Research thất bại: ${m}`, {
      research_run_id: runId,
    });
    return { ok: false, error: `Research thất bại: ${m}` };
  }
}

export async function generateWeeklyCampaignRecommendation(
  input: GenerateRecInput,
): Promise<GenerateRecResult> {
  const goal = VALID_GOALS.includes(input?.goal) ? input.goal : "balanced";
  const weekStart = (input?.week_start ?? "").trim();
  const weekEnd = (input?.week_end ?? "").trim();
  if (!weekStart || !weekEnd) {
    return { ok: false, error: "Vui lòng chọn tuần bắt đầu và kết thúc." };
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }

  try {
    // Sản phẩm ACTIVE + READY.
    const { data: productsData, error: productsErr } = await supabase
      .from("products")
      .select("id, product_name, sub_id, affiliate_link, status, link_status")
      .eq("status", "ACTIVE")
      .eq("link_status", "READY");

    if (productsErr) {
      return { ok: false, error: `Không tải được sản phẩm: ${productsErr.message}` };
    }
    const products = (productsData ?? []) as {
      id: string;
      product_name: string;
      sub_id: string | null;
      affiliate_link: string | null;
    }[];
    if (products.length === 0) {
      return { ok: false, error: "Chưa có sản phẩm READY. Hãy import link affiliate trước." };
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [reportsRes, postsRes] = await Promise.all([
      supabase
        .from("affiliate_reports")
        .select("sub_id, affiliate_link, clicks, orders, commission")
        .gte("created_at", since),
      supabase
        .from("generated_posts")
        .select("product_id, content_angle_variant, scheduled_at")
        .gte("created_at", since),
    ]);

    const reports = (reportsRes.data ?? []) as {
      sub_id: string | null;
      affiliate_link: string | null;
      clicks: unknown;
      orders: unknown;
      commission: unknown;
    }[];
    const posts = (postsRes.data ?? []) as {
      product_id: string | null;
      content_angle_variant: string | null;
      scheduled_at: string | null;
    }[];

    const sumFor = (subId: string | null, link: string | null) => {
      const acc = { clicks: 0, orders: 0, commission: 0 };
      for (const r of reports) {
        if ((subId && r.sub_id === subId) || (link && r.affiliate_link === link)) {
          acc.clicks += toNumberSafe(r.clicks as string);
          acc.orders += toNumberSafe(r.orders as string);
          acc.commission += toNumberSafe(r.commission as string);
        }
      }
      return acc;
    };

    const plannerProducts: PlannerProduct[] = products.map((p) => {
      const agg = sumFor(p.sub_id, p.affiliate_link);
      return {
        product_id: p.id,
        product_name: p.product_name,
        sub_id: p.sub_id,
        clicks: agg.clicks,
        orders: agg.orders,
        commission: agg.commission,
        has_data: agg.clicks > 0 || agg.orders > 0 || agg.commission > 0,
      };
    });

    // Tổng quan.
    let totalClicks = 0;
    let totalOrders = 0;
    let totalCommission = 0;
    for (const r of reports) {
      totalClicks += toNumberSafe(r.clicks as string);
      totalOrders += toNumberSafe(r.orders as string);
      totalCommission += toNumberSafe(r.commission as string);
    }
    const summary = {
      total_clicks: totalClicks,
      total_orders: totalOrders,
      total_commission: totalCommission,
      conversion_rate: totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0,
      epc: totalClicks > 0 ? totalCommission / totalClicks : 0,
      has_report_data: reports.length > 0,
    };

    // Angle hiệu quả (gần đúng): gộp metric các sản phẩm (distinct) theo angle.
    const productById = new Map(plannerProducts.map((p) => [p.product_id, p]));
    const angleAgg = new Map<string, { products: Set<string>; clicks: number; orders: number; commission: number }>();
    for (const post of posts) {
      const angle = post.content_angle_variant;
      if (!angle || !post.product_id) continue;
      const prod = productById.get(post.product_id);
      if (!prod) continue;
      const a = angleAgg.get(angle) ?? { products: new Set<string>(), clicks: 0, orders: 0, commission: 0 };
      if (!a.products.has(prod.product_id)) {
        a.products.add(prod.product_id);
        a.clicks += prod.clicks;
        a.orders += prod.orders;
        a.commission += prod.commission;
      }
      angleAgg.set(angle, a);
    }
    const topAngles = [...angleAgg.entries()]
      .map(([angle, a]) => ({ angle, clicks: a.clicks, orders: a.orders, commission: a.commission }))
      .sort((x, y) => y.commission - x.commission)
      .slice(0, 6);

    // Khung giờ đã dùng.
    const timeAgg = new Map<string, number>();
    for (const post of posts) {
      if (!post.scheduled_at) continue;
      const d = new Date(post.scheduled_at);
      if (Number.isNaN(d.getTime())) continue;
      const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      timeAgg.set(t, (timeAgg.get(t) ?? 0) + 1);
    }
    const topTimes = [...timeAgg.entries()]
      .map(([time, postsCount]) => ({ time, posts: postsCount }))
      .sort((a, b) => b.posts - a.posts)
      .slice(0, 6);

    // Nghiên cứu thị trường (tùy chọn).
    let research: MarketResearchInsights | null = null;
    let researchRunId: string | null = null;
    if (input.use_market_research) {
      let rid = input.research_run_id || null;
      if (!rid) {
        const rr = await runMarketResearchForWeeklyPlan({
          week_start: weekStart,
          week_end: weekEnd,
          goal,
          target_customer: input.target_customer,
          notes: input.notes,
        });
        if (rr.ok) rid = rr.research_run_id;
      }
      if (rid) {
        const { data: runRow } = await supabase
          .from("market_research_runs")
          .select("insights")
          .eq("id", rid)
          .single();
        if (runRow?.insights) {
          research = runRow.insights as MarketResearchInsights;
          researchRunId = rid;
        }
      }
    }

    // Gọi AI.
    let plan;
    try {
      plan = await generateWeeklyCampaignPlan({
        goal,
        week_start: weekStart,
        week_end: weekEnd,
        target_customer: input.target_customer?.trim() || null,
        notes: input.notes?.trim() || null,
        products: plannerProducts,
        summary,
        topAngles,
        topTimes,
        research,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : "Lỗi không xác định.";
      await insertPostingLog(supabase, null, GEN_ACTION, "FAILED", `Tạo gợi ý AI thất bại: ${m}`, { goal });
      return { ok: false, error: `Tạo gợi ý AI thất bại: ${m}` };
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("ai_campaign_recommendations")
      .insert({
        title: plan.title,
        goal: plan.goal,
        week_start: weekStart,
        week_end: weekEnd,
        status: "DRAFT",
        summary: plan.summary,
        strategy: plan.strategy,
        recommended_products: plan.recommended_products,
        recommended_schedule: plan.recommended_schedule,
        content_angles: plan.content_angles,
        engagement_hooks: plan.engagement_hooks,
        risks: plan.risks,
        ai_reasoning_summary: plan.ai_reasoning_summary,
        raw_ai_response: plan.raw_ai_response,
        research_run_id: researchRunId,
        campaign_concept: plan.campaign_concept,
        interaction_plan: plan.interaction_plan,
        creative_directions: plan.creative_directions,
        market_research: research,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      const m = insertErr?.message ?? "không rõ nguyên nhân";
      await insertPostingLog(supabase, null, GEN_ACTION, "FAILED", `Lưu gợi ý thất bại: ${m}`, { goal });
      return { ok: false, error: `Lưu gợi ý thất bại: ${m}` };
    }

    await insertPostingLog(
      supabase,
      null,
      GEN_ACTION,
      "SUCCESS",
      `Đã tạo gợi ý chiến dịch tuần (mục tiêu: ${goal}).`,
      { recommendation_id: inserted.id, goal },
    );

    revalidatePath("/dashboard/ai-planner");
    return { ok: true, id: inserted.id as string };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo gợi ý thất bại: ${m}` };
  }
}

export type PlannerPrereqs = { canGenerate: boolean; hasReports: boolean };

/** Kiểm tra điều kiện tạo gợi ý: có sản phẩm READY? có dữ liệu báo cáo? */
export async function getPlannerPrereqs(): Promise<PlannerPrereqs> {
  let canGenerate = false;
  let hasReports = false;
  try {
    const supabase = createSupabaseAdminClient();
    try {
      const prodRes = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("status", "ACTIVE")
        .eq("link_status", "READY");
      canGenerate = (prodRes.count ?? 0) > 0;
    } catch {
      /* ignore */
    }
    try {
      const repRes = await supabase
        .from("affiliate_reports")
        .select("id", { count: "exact", head: true });
      hasReports = (repRes.count ?? 0) > 0;
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
  return { canGenerate, hasReports };
}

export async function getCampaignRecommendations(): Promise<RecListResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("ai_campaign_recommendations")
      .select("id, title, goal, week_start, week_end, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return { ok: false, error: `Không tải được danh sách gợi ý: ${error.message}` };
    return { ok: true, items: (data ?? []) as RecListItem[] };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }
}

export async function getCampaignRecommendationById(
  id: string,
): Promise<AICampaignRecommendation | null> {
  try {
    if (!id) return null;
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("ai_campaign_recommendations")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data as AICampaignRecommendation;
  } catch {
    return null;
  }
}

export type ResearchSource = {
  query: string | null;
  title: string | null;
  url: string | null;
  snippet: string | null;
};

/** Lấy danh sách nguồn tham khảo của một research run (rút gọn). */
export async function getResearchSources(runId: string): Promise<ResearchSource[]> {
  try {
    if (!runId) return [];
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("market_research_sources")
      .select("query, title, url, snippet")
      .eq("research_run_id", runId)
      .limit(15);
    return (data ?? []) as ResearchSource[];
  } catch {
    return [];
  }
}

export type ResearchRunMeta = {
  provider: string | null;
  status: string | null;
  query_count: number;
};

/** Lấy meta của research run (provider/status/số query) cho badge. */
export async function getResearchRun(runId: string): Promise<ResearchRunMeta | null> {
  try {
    if (!runId) return null;
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("market_research_runs")
      .select("provider, status, queries")
      .eq("id", runId)
      .single();
    if (!data) return null;
    return {
      provider: (data.provider as string | null) ?? null,
      status: (data.status as string | null) ?? null,
      query_count: Array.isArray(data.queries) ? data.queries.length : 0,
    };
  } catch {
    return null;
  }
}

export type StatusActionResult = { ok: true } | { ok: false; error: string };

export async function updateRecommendationStatus(
  id: string,
  status: "APPROVED" | "REJECTED",
): Promise<StatusActionResult> {
  if (!id) return { ok: false, error: "Thiếu mã gợi ý." };
  if (status !== "APPROVED" && status !== "REJECTED") {
    return { ok: false, error: "Trạng thái không hợp lệ." };
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("ai_campaign_recommendations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: `Cập nhật thất bại: ${error.message}` };

    await insertPostingLog(
      supabase,
      null,
      status === "APPROVED" ? APPROVE_ACTION : REJECT_ACTION,
      "SUCCESS",
      `Gợi ý ${id} -> ${status}.`,
      null,
    );

    revalidatePath("/dashboard/ai-planner");
    revalidatePath(`/dashboard/ai-planner/${id}`);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
  }
}
