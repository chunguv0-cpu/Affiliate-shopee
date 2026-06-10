"use server";

import { revalidatePath } from "next/cache";

import type { CampaignGoal, PlannerProduct } from "@/lib/ai/campaign-planner";
import { normalizeCampaignPlan } from "@/lib/ai/normalize-campaign-plan";
import { validateCampaignPlanQuality } from "@/lib/ai/plan-quality-checker";
import {
  generateProductDiscovery,
  generateStrategicWeeklyPlan,
  type DetailLevel,
  type ResearchStatus,
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
import type {
  AICampaignRecommendation,
  PlannerMode,
  RecommendationStatus,
} from "@/lib/types";

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
  planner_mode?: PlannerMode;
};

const JOB_STARTED = "AI_PLANNER_JOB_STARTED";
const JOB_SUCCESS = "AI_PLANNER_JOB_SUCCESS";
const JOB_FAILED = "AI_PLANNER_JOB_FAILED";
const QUALITY_ACTION = "AI_PLANNER_QUALITY_WARNING";
const DISCOVERY_STARTED = "AI_PRODUCT_DISCOVERY_STARTED";
const DISCOVERY_SUCCESS = "AI_PRODUCT_DISCOVERY_SUCCESS";
const DISCOVERY_WARNING = "AI_PRODUCT_DISCOVERY_WARNING";
// Phase 13.3.1 — log fast-discovery (ngắn gọn).
const DISC_STARTED = "AI_DISCOVERY_STARTED";
const DISC_RESEARCH_DONE = "AI_DISCOVERY_RESEARCH_DONE";
const DISC_TAVILY_TIMEOUT = "AI_DISCOVERY_TAVILY_TIMEOUT";
const DISC_FALLBACK = "AI_DISCOVERY_FALLBACK_USED";
const DISC_SUCCESS = "AI_DISCOVERY_SUCCESS";
const DISC_FAILED = "AI_DISCOVERY_FAILED";

// Phase 13.3.1 — toàn bộ quá trình lập kế hoạch fail an toàn sau 45s.
const PLAN_TIMEOUT_MS = 45_000;
const TIMEOUT_MSG = "AI discovery timed out. Try again with fewer research sources.";

// Summary rỗng cho fast discovery (không dùng dữ liệu nội bộ).
const EMPTY_SUMMARY = {
  total_clicks: 0,
  total_orders: 0,
  total_commission: 0,
  conversion_rate: 0,
  epc: 0,
  has_report_data: false,
};

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
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
  planner_mode?: PlannerMode;
};

/**
 * Chạy nghiên cứu thị trường (Phase 13.1): sinh query -> search -> lưu nguồn -> AI tóm tắt.
 * Nguồn công khai, không scrape/login. Lỗi 1 query không làm chết cả run.
 */
export async function runMarketResearchForWeeklyPlan(
  input: ResearchInput,
  opts?: { maxQueries?: number; maxResults?: number; maxSources?: number },
): Promise<RunResearchResult> {
  const goal = VALID_GOALS.includes(input?.goal) ? input.goal : "balanced";
  const maxQueries = Math.max(1, Math.min(10, opts?.maxQueries ?? DEFAULT_RESEARCH_MAX_QUERIES));
  const maxResults = Math.max(1, Math.min(5, opts?.maxResults ?? DEFAULT_RESEARCH_MAX_RESULTS_PER_QUERY));
  const maxSources = Math.max(1, Math.min(MAX_RESEARCH_SOURCES, opts?.maxSources ?? MAX_RESEARCH_SOURCES));

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
  const plannerMode: PlannerMode = input.planner_mode ?? "HYBRID";
  // DISCOVERY_ONLY/HYBRID có thể nghiên cứu mà không cần sản phẩm READY.
  if (products.length === 0 && plannerMode === "EXISTING_ONLY") {
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
      planner_mode: plannerMode,
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
    const flat = perQuery.flat().slice(0, maxSources);

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
    const readyCount = count ?? 0;

    // Phase 13.3 — chọn chế độ. Không có sản phẩm READY => tự chuyển DISCOVERY_ONLY.
    let plannerMode: PlannerMode = input.planner_mode ?? "HYBRID";
    if (readyCount === 0) plannerMode = "DISCOVERY_ONLY";
    // EXISTING_ONLY mà không có sản phẩm READY thì vô nghĩa => đã ép DISCOVERY_ONLY ở trên.

    const { data: inserted, error } = await supabase
      .from("ai_campaign_recommendations")
      .insert({
        title:
          plannerMode === "DISCOVERY_ONLY"
            ? `Đang tìm sản phẩm — ${weekStart} → ${weekEnd}`
            : `Đang lập kế hoạch — ${weekStart} → ${weekEnd}`,
        goal,
        week_start: weekStart,
        week_end: weekEnd,
        status: "RUNNING",
        planner_mode: plannerMode,
        job_input: { ...input, goal, planner_mode: plannerMode },
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
      `Bắt đầu lập kế hoạch (mục tiêu: ${goal}, chế độ: ${plannerMode}).`,
      { recommendation_id: inserted.id },
    );
    if (plannerMode !== "EXISTING_ONLY") {
      await insertPostingLog(
        supabase,
        null,
        DISCOVERY_STARTED,
        "SUCCESS",
        `Bắt đầu khám phá sản phẩm mới (chế độ: ${plannerMode}).`,
        { recommendation_id: inserted.id },
      );
    }

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

  let supabase: ReturnType<typeof createSupabaseAdminClient>;
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
  const plannerMode: PlannerMode = input.planner_mode ?? "HYBRID";
  const weekStart = (input.week_start ?? "").trim();
  const weekEnd = (input.week_end ?? "").trim();

  // ---------------------------------------------------------------------------
  // FAST DISCOVERY (DISCOVERY_ONLY): research nhẹ (4 query × 2, ≤8 nguồn) + 1 AI call.
  // Không tạo kế hoạch 7 ngày đầy đủ. Có fallback seed nếu research/AI yếu.
  // ---------------------------------------------------------------------------
  async function runDiscovery(): Promise<void> {
    await insertPostingLog(supabase, null, DISC_STARTED, "SUCCESS", `Bắt đầu khám phá sản phẩm (mục tiêu: ${goal}).`, {
      recommendation_id: id,
    });

    // Tavily NHẸ & TÙY CHỌN: 3 query × 2 kết quả, ≤6 nguồn, 5s/query, tổng ngân sách 10s.
    let researchStatus: ResearchStatus = "FALLBACK_ONLY";
    let researchRunId: string | null = null;
    let snippets: { title: string; snippet: string }[] = [];

    if (input.use_market_research) {
      const queries = generateResearchQueries({
        products: [],
        goal,
        target_customer: input.target_customer?.trim() || null,
        notes: input.notes?.trim() || null,
        planner_mode: "DISCOVERY_ONLY",
      }).slice(0, 3);

      const provider = getSearchProvider();
      const { data: run } = await supabase
        .from("market_research_runs")
        .insert({
          goal,
          target_customer: input.target_customer?.trim() || null,
          week_start: weekStart || null,
          week_end: weekEnd || null,
          status: "RUNNING",
          provider,
          queries,
        })
        .select("id")
        .single();
      researchRunId = (run?.id as string) ?? null;

      const collected: (SearchResult & { query: string })[] = [];
      let completed = false;
      const searchAll = Promise.all(
        queries.map(async (q) => {
          try {
            const r = await searchWeb(q, { maxResults: 2, timeoutMs: 5000 });
            for (const x of r) collected.push({ query: q, ...x });
          } catch {
            /* bỏ qua 1 query lỗi */
          }
        }),
      ).then(() => {
        completed = true;
      });
      // Tổng ngân sách 10s cho toàn bộ research.
      await Promise.race([searchAll, new Promise((res) => setTimeout(res, 10_000))]);

      const flat = collected.slice(0, 6);
      const timedOut = !completed;
      if (timedOut) {
        await insertPostingLog(supabase, null, DISC_TAVILY_TIMEOUT, "FAILED", "Tavily vượt ngân sách 10s — tiếp tục bằng fallback.", {
          recommendation_id: id,
        });
      }
      researchStatus = flat.length === 0 ? "FALLBACK_ONLY" : timedOut ? "PARTIAL_RESEARCH" : "USED_TAVILY";
      snippets = flat.map((r) => ({ title: r.title || "", snippet: r.snippet || "" }));

      if (researchRunId) {
        if (flat.length > 0) {
          await supabase.from("market_research_sources").insert(
            flat.map((r) => ({
              research_run_id: researchRunId,
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
        await supabase
          .from("market_research_runs")
          .update({
            status: flat.length > 0 ? "SUCCESS" : "FAILED",
            raw_response: { provider, query_count: queries.length, source_count: flat.length, research_status: researchStatus },
            updated_at: new Date().toISOString(),
          })
          .eq("id", researchRunId);
        if (flat.length === 0) researchRunId = null; // không có nguồn -> không gắn vào kế hoạch
      }

      await insertPostingLog(supabase, null, DISC_RESEARCH_DONE, "SUCCESS", `Nghiên cứu: ${flat.length} nguồn, status=${researchStatus}.`, {
        recommendation_id: id,
      });
    }

    const { plan: rawPlan, fallback } = await generateProductDiscovery(
      {
        goal,
        week_start: weekStart,
        week_end: weekEnd,
        target_customer: input.target_customer?.trim() || null,
        priority_notes: input.priority_notes?.trim() || null,
        strategy_mode: input.strategy_mode ?? null,
        detail_level: input.detail_level ?? "detailed",
        planner_mode: "DISCOVERY_ONLY",
        products: [],
        summary: EMPTY_SUMMARY,
        research: null,
      },
      { researchStatus, sources: snippets },
    );
    if (fallback || researchStatus === "FALLBACK_ONLY") {
      await insertPostingLog(supabase, null, DISC_FALLBACK, "SUCCESS", "Dùng nhóm hạt giống để tạo/bổ sung sản phẩm.", {
        recommendation_id: id,
      });
    }

    const plan = normalizeCampaignPlan(rawPlan);
    const qualityWarnings = validateCampaignPlanQuality(plan, goal, "DISCOVERY_ONLY");
    if (researchStatus === "FALLBACK_ONLY") qualityWarnings.push("Research fallback used.");

    const { error: updErr } = await supabase
      .from("ai_campaign_recommendations")
      .update({
        title: plan.title,
        goal: plan.goal || goal,
        status: "DRAFT",
        summary: plan.executive_summary,
        ai_reasoning_summary: plan.executive_summary,
        research_run_id: researchRunId,
        market_research: null,
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
        planner_mode: "DISCOVERY_ONLY",
        product_discovery_strategy: plan.product_discovery_strategy,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updErr) throw new Error(updErr.message);

    const oppCount = plan.product_discovery_strategy.new_product_opportunities.length;
    await insertPostingLog(supabase, null, DISC_SUCCESS, "SUCCESS", `Khám phá ${oppCount} sản phẩm mới (research_status=${researchStatus}).`, {
      recommendation_id: id,
    });
    if (qualityWarnings.length > 0) {
      await insertPostingLog(supabase, null, QUALITY_ACTION, "FAILED", `Cần kiểm tra: ${qualityWarnings.join("; ")}`.slice(0, 2000), {
        recommendation_id: id,
      });
    }
    revalidatePath(`/dashboard/ai-planner/${id}`);
    revalidatePath("/dashboard/ai-planner");
  }

  // ---------------------------------------------------------------------------
  // FULL PLAN (HYBRID / EXISTING_ONLY): kế hoạch chiến lược đầy đủ.
  // ---------------------------------------------------------------------------
  async function runFull(): Promise<void> {
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
    // Chỉ EXISTING_ONLY mới bắt buộc có sản phẩm READY.
    if (products.length === 0 && plannerMode === "EXISTING_ONLY") {
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
      // Phase 13.3.1 — HYBRID chỉ thêm 3 query khám phá; EXISTING_ONLY: detailed=6, còn lại 4.
      const detailed = input.detail_level === "detailed" || input.detail_level === "very_detailed";
      const maxQueries = plannerMode === "HYBRID" ? 3 : detailed ? 6 : 4;
      const rr = await runMarketResearchForWeeklyPlan(
        {
          week_start: weekStart,
          week_end: weekEnd,
          goal,
          target_customer: input.target_customer,
          notes: input.notes,
          planner_mode: plannerMode,
        },
        { maxQueries, maxResults: 2, maxSources: 8 },
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
      planner_mode: plannerMode,
      products: plannerProducts,
      summary,
      research,
    });

    const plan = normalizeCampaignPlan(rawPlan);
    const qualityWarnings = validateCampaignPlanQuality(plan, goal, plannerMode);

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
        planner_mode: plannerMode,
        product_discovery_strategy: plan.product_discovery_strategy,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updErr) throw new Error(updErr.message);

    const oppCount = plan.product_discovery_strategy.new_product_opportunities.length;
    await insertPostingLog(supabase, null, JOB_SUCCESS, "SUCCESS", `Đã lập kế hoạch (mục tiêu: ${goal}, chế độ: ${plannerMode}).`, {
      recommendation_id: id,
    });
    if (plannerMode !== "EXISTING_ONLY") {
      await insertPostingLog(
        supabase,
        null,
        DISCOVERY_SUCCESS,
        "SUCCESS",
        `Khám phá ${oppCount} sản phẩm mới nên tìm link (chế độ: ${plannerMode}).`,
        { recommendation_id: id },
      );
    }
    if (qualityWarnings.length > 0) {
      await insertPostingLog(
        supabase,
        null,
        QUALITY_ACTION,
        "FAILED",
        `Kế hoạch còn thiếu chiều sâu: ${qualityWarnings.join("; ")}`.slice(0, 5000),
        { recommendation_id: id },
      );
      // Cảnh báo riêng cho phần khám phá sản phẩm.
      const discoveryWarn = qualityWarnings.filter((x) => /sản phẩm mới|sourcing|DISCOVERY|HYBRID|từ khóa/i.test(x));
      if (discoveryWarn.length > 0) {
        await insertPostingLog(
          supabase,
          null,
          DISCOVERY_WARNING,
          "FAILED",
          `Khám phá sản phẩm cần kiểm tra: ${discoveryWarn.join("; ")}`.slice(0, 2000),
          { recommendation_id: id },
        );
      }
    }

    revalidatePath(`/dashboard/ai-planner/${id}`);
    revalidatePath("/dashboard/ai-planner");
  }

  // Dispatch + timeout 45s. KHÔNG bao giờ để trạng thái RUNNING treo.
  try {
    const work = plannerMode === "DISCOVERY_ONLY" ? runDiscovery() : runFull();
    await withTimeout(work, PLAN_TIMEOUT_MS, TIMEOUT_MSG);
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
    if (plannerMode === "DISCOVERY_ONLY") {
      await insertPostingLog(supabase, null, DISC_FAILED, "FAILED", `Khám phá thất bại: ${m}`.slice(0, 2000), {
        recommendation_id: id,
      });
    }
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

/**
 * Đánh dấu một job bị treo thành FAILED (chỉ khi đang RUNNING).
 * Dùng cho nút "Đánh dấu thất bại" trên trang RUNNING.
 */
export async function markStuckRecommendationFailed(
  id: string,
): Promise<StatusActionResult> {
  if (!id) return { ok: false, error: "Thiếu mã gợi ý." };
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("ai_campaign_recommendations")
      .update({
        status: "FAILED",
        error_message: "Manually marked as failed because the job was stuck.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "RUNNING");
    if (error) return { ok: false, error: `Cập nhật thất bại: ${error.message}` };

    await insertPostingLog(
      supabase,
      null,
      JOB_FAILED,
      "FAILED",
      "Job bị đánh dấu thất bại thủ công (treo quá lâu).",
      { recommendation_id: id },
    );

    revalidatePath(`/dashboard/ai-planner/${id}`);
    revalidatePath("/dashboard/ai-planner");
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
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
