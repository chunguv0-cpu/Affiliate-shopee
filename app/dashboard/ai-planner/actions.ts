"use server";

import { revalidatePath } from "next/cache";

import type { CampaignGoal, PlannerProduct } from "@/lib/ai/campaign-planner";
import { normalizeCampaignPlan } from "@/lib/ai/normalize-campaign-plan";
import { validateCampaignPlanQuality } from "@/lib/ai/plan-quality-checker";
import {
  generateStrategicWeeklyPlan,
  type DetailLevel,
  type StrategyMode,
} from "@/lib/ai/strategic-planner";
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
  priority_notes?: string;
  strategy_mode?: StrategyMode;
  detail_level?: DetailLevel;
};

const JOB_STARTED = "AI_PLANNER_JOB_STARTED";
const JOB_SUCCESS = "AI_PLANNER_JOB_SUCCESS";
const JOB_FAILED = "AI_PLANNER_JOB_FAILED";
const QUALITY_ACTION = "AI_PLANNER_QUALITY_WARNING";
const APPROVE_ACTION = "APPROVE_AI_CAMPAIGN_PLAN";
const REJECT_ACTION = "REJECT_AI_CAMPAIGN_PLAN";
const RESEARCH_ACTION = "RUN_MARKET_RESEARCH";
const VALID_GOALS: CampaignGoal[] = ["clicks", "orders", "commission", "engagement", "balanced"];

// Phần 9 — giới hạn research (giảm tải để tránh request quá lâu / crash).
const DEFAULT_RESEARCH_MAX_QUERIES = Number(process.env.DEFAULT_RESEARCH_MAX_QUERIES) || 6;
const DEFAULT_RESEARCH_MAX_RESULTS_PER_QUERY =
  Number(process.env.DEFAULT_RESEARCH_MAX_RESULTS_PER_QUERY) || 3;
const MAX_RESEARCH_SOURCES = Number(process.env.MAX_RESEARCH_SOURCES) || 24;

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
  opts?: { maxQueries?: number; maxResults?: number },
): Promise<RunResearchResult> {
  const goal = VALID_GOALS.includes(input?.goal) ? input.goal : "balanced";
  const maxQueries = Math.max(1, Math.min(10, opts?.maxQueries ?? DEFAULT_RESEARCH_MAX_QUERIES));
  const maxResults = Math.max(1, Math.min(5, opts?.maxResults ?? DEFAULT_RESEARCH_MAX_RESULTS_PER_QUERY));

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
    }).slice(0, maxQueries);

    await supabase.from("market_research_runs").update({ queries }).eq("id", runId);

    // Search song song; giảm tải theo cấu hình.
    const perQuery = await Promise.all(
      queries.map(async (q) => {
        try {
          const res = await searchWeb(q, { maxResults });
          return res.map((r) => ({ query: q, ...r }));
        } catch {
          return [] as (SearchResult & { query: string })[];
        }
      }),
    );
    const flat = perQuery.flat().slice(0, MAX_RESEARCH_SOURCES);

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

export type RunJobResult =
  | { ok: true; id: string }
  | { ok: false; id?: string; error: string };

/** Áp mục tiêu cuối cùng (chế độ chiến lược có thể ép goal). */
function computeGoal(input: GenerateRecInput): CampaignGoal {
  let goal: CampaignGoal = VALID_GOALS.includes(input?.goal) ? input.goal : "balanced";
  if (input?.strategy_mode === "boost_orders") goal = "orders";
  else if (input?.strategy_mode === "boost_commission") goal = "commission";
  else if (input?.strategy_mode === "boost_engagement") goal = "engagement";
  return goal;
}

/**
 * Bước 1: tạo job RUNNING nhanh, trả id ngay (không chờ research/AI).
 */
export async function createRecommendationJob(
  input: GenerateRecInput,
): Promise<GenerateRecResult> {
  const goal = computeGoal(input);
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
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE")
      .eq("link_status", "READY");
    if (!count || count === 0) {
      return { ok: false, error: "Chưa có sản phẩm READY. Hãy import link affiliate trước." };
    }

    const { data: inserted, error } = await supabase
      .from("ai_campaign_recommendations")
      .insert({
        title: `Đang lập kế hoạch — ${weekStart} → ${weekEnd}`,
        goal,
        week_start: weekStart,
        week_end: weekEnd,
        status: "RUNNING",
        job_input: { ...input, goal },
      })
      .select("id")
      .single();

    if (error || !inserted) {
      return { ok: false, error: `Tạo job thất bại: ${error?.message ?? "không rõ"}` };
    }

    await insertPostingLog(
      supabase,
      null,
      JOB_STARTED,
      "SUCCESS",
      `Bắt đầu lập kế hoạch chiến lược (mục tiêu: ${goal}).`,
      { recommendation_id: inserted.id },
    );

    revalidatePath("/dashboard/ai-planner");
    return { ok: true, id: inserted.id as string };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo job thất bại: ${m}` };
  }
}

/**
 * Bước 2: chạy job (research + AI + chuẩn hóa + quality) và cập nhật SUCCESS/FAILED.
 * KHÔNG bao giờ throw ra client. Idempotent nhẹ: chỉ chạy khi status = RUNNING.
 */
export async function runRecommendationJob(id: string): Promise<RunJobResult> {
  if (!id || typeof id !== "string") return { ok: false, error: "Thiếu mã gợi ý." };

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, id, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }

  const { data: rec, error: recErr } = await supabase
    .from("ai_campaign_recommendations")
    .select("id, status, job_input")
    .eq("id", id)
    .single();
  if (recErr || !rec) return { ok: false, id, error: "Không tìm thấy gợi ý." };
  if (rec.status !== "RUNNING") return { ok: true, id }; // đã xử lý xong

  const input = (rec.job_input ?? {}) as GenerateRecInput;
  const goal = computeGoal(input);
  const weekStart = (input.week_start ?? "").trim();
  const weekEnd = (input.week_end ?? "").trim();

  try {
    const { data: productsData } = await supabase
      .from("products")
      .select("id, product_name, sub_id, affiliate_link")
      .eq("status", "ACTIVE")
      .eq("link_status", "READY");
    const products = (productsData ?? []) as {
      id: string;
      product_name: string;
      sub_id: string | null;
      affiliate_link: string | null;
    }[];
    if (products.length === 0) {
      throw new Error("Không còn sản phẩm READY.");
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const reportsRes = await supabase
      .from("affiliate_reports")
      .select("sub_id, affiliate_link, clicks, orders, commission")
      .gte("created_at", since);
    const reports = (reportsRes.data ?? []) as {
      sub_id: string | null;
      affiliate_link: string | null;
      clicks: unknown;
      orders: unknown;
      commission: unknown;
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

    // Research (giảm tải): very_detailed -> 8 query, còn lại 6.
    let research: MarketResearchInsights | null = null;
    let researchRunId: string | null = null;
    if (input.use_market_research) {
      const maxQueries = input.detail_level === "very_detailed" ? 8 : DEFAULT_RESEARCH_MAX_QUERIES;
      const rr = await runMarketResearchForWeeklyPlan(
        {
          week_start: weekStart,
          week_end: weekEnd,
          goal,
          target_customer: input.target_customer,
          notes: input.notes,
        },
        { maxQueries, maxResults: DEFAULT_RESEARCH_MAX_RESULTS_PER_QUERY },
      );
      if (rr.ok) {
        const { data: runRow } = await supabase
          .from("market_research_runs")
          .select("insights")
          .eq("id", rr.research_run_id)
          .single();
        if (runRow?.insights) {
          research = runRow.insights as MarketResearchInsights;
          researchRunId = rr.research_run_id;
        }
      }
    }

    // AI chiến lược (parsePlan tự fallback mock nếu JSON lỗi -> không crash).
    const rawPlan = await generateStrategicWeeklyPlan({
      goal,
      week_start: weekStart,
      week_end: weekEnd,
      target_customer: input.target_customer?.trim() || null,
      priority_notes: input.priority_notes?.trim() || null,
      strategy_mode: input.strategy_mode ?? null,
      detail_level: input.detail_level ?? "very_detailed",
      products: plannerProducts,
      summary,
      research,
    });

    const plan = normalizeCampaignPlan(rawPlan);
    const qualityWarnings = validateCampaignPlanQuality(plan, goal);

    const { error: updErr } = await supabase
      .from("ai_campaign_recommendations")
      .update({
        title: plan.title,
        goal: plan.goal || goal,
        status: "DRAFT",
        summary: plan.executive_summary,
        strategy: plan.goal_strategy?.main_strategy ?? null,
        ai_reasoning_summary: plan.executive_summary,
        research_run_id: researchRunId,
        market_research: research,
        executive_summary: plan.executive_summary,
        market_diagnosis: plan.market_diagnosis,
        internal_data_diagnosis: plan.internal_data_diagnosis,
        goal_strategy: plan.goal_strategy,
        product_decision_table: plan.product_decision_table,
        products_to_source: plan.products_to_source,
        weekly_execution_plan: plan.weekly_execution_plan,
        engagement_system: plan.engagement_system,
        creative_brief: plan.creative_brief,
        measurement_plan: plan.measurement_plan,
        risks: plan.risks_and_controls,
        next_actions: plan.next_actions,
        quality_warnings: qualityWarnings,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updErr) throw new Error(updErr.message);

    await insertPostingLog(supabase, null, JOB_SUCCESS, "SUCCESS", `Đã lập kế hoạch (mục tiêu: ${goal}).`, {
      recommendation_id: id,
    });
    if (qualityWarnings.length > 0) {
      await insertPostingLog(
        supabase,
        null,
        QUALITY_ACTION,
        "FAILED",
        `Kế hoạch còn thiếu chiều sâu: ${qualityWarnings.join("; ")}`.slice(0, 5000),
        { recommendation_id: id },
      );
    }

    revalidatePath(`/dashboard/ai-planner/${id}`);
    revalidatePath("/dashboard/ai-planner");
    return { ok: true, id };
  } catch (err) {
    const m = (err instanceof Error ? err.message : "Lỗi không xác định.").slice(0, 2000);
    await supabase
      .from("ai_campaign_recommendations")
      .update({ status: "FAILED", error_message: m, updated_at: new Date().toISOString() })
      .eq("id", id);
    await insertPostingLog(supabase, null, JOB_FAILED, "FAILED", `Job lỗi: ${m}`.slice(0, 5000), {
      recommendation_id: id,
    });
    revalidatePath(`/dashboard/ai-planner/${id}`);
    return { ok: false, id, error: m };
  }
}

/** Backward-compat: tạo + chạy đồng bộ (trả về sau khi xong). */
export async function generateWeeklyCampaignRecommendation(
  input: GenerateRecInput,
): Promise<GenerateRecResult> {
  const created = await createRecommendationJob(input);
  if (!created.ok) return created;
  await runRecommendationJob(created.id);
  return { ok: true, id: created.id };
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
