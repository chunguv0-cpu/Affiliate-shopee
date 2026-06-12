"use server";

import { revalidatePath } from "next/cache";

import { generateCampaignPlan } from "@/lib/autopilot/campaign-planner";
import {
  getCampaignRunCounters,
  parseCampaignRunRow,
  runCampaignAutopilotUntilBlocked,
} from "@/lib/autopilot/campaign-autopilot-orchestrator";
import {
  VERTICAL_LABELS,
  VERTICAL_PROFILES,
  classifyVertical,
  profileFor,
  type Vertical,
} from "@/lib/autopilot/campaign-vertical";
import { validateOpportunitiesForVertical, verticalFallbackOpportunities } from "@/lib/autopilot/opportunity-validator";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AiCampaignRun, CampaignRunCounters } from "@/lib/types";

const ALL_VERTICAL_KEYS = Object.keys(VERTICAL_PROFILES) as Vertical[];

/** Xác định ngành: ưu tiên người dùng chọn (hint = key ngành), nếu không thì phân loại. */
function resolveCampaignVertical(objective: string, hint: string | null): { vertical: Vertical; confidence: number } {
  if (hint && ALL_VERTICAL_KEYS.includes(hint as Vertical)) {
    return { vertical: hint as Vertical, confidence: 1 };
  }
  const c = classifyVertical(`${objective} ${hint ?? ""}`);
  return { vertical: c.vertical, confidence: c.confidence };
}

const PATH = "/dashboard/ai-autopilot";

export type SimpleResult = { ok: true; message?: string } | { ok: false; error: string };
export type CreatePlanResult = { ok: true; id: string } | { ok: false; error: string };

function text(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function intField(fd: FormData, key: string, fallback: number, min: number, max: number): number {
  const raw = text(fd, key);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Thu thập sản phẩm/nhóm đã dùng gần đây để AI tránh lặp lại (Phase 20). */
async function gatherNoveltyContext(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<{ excluded: string[]; usedCategories: string[] }> {
  const windowRaw = process.env.PRODUCT_NOVELTY_WINDOW_DAYS?.trim();
  const windowDays = Number.isFinite(Number.parseInt(windowRaw ?? "", 10)) ? Math.max(1, Number.parseInt(windowRaw as string, 10)) : 30;
  const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const excluded = new Set<string>();
  const usedCategories = new Set<string>();
  try {
    const { data: prods } = await supabase
      .from("products")
      .select("product_name, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(60);
    for (const p of (prods ?? []) as Array<{ product_name: string | null }>) {
      if (p.product_name) excluded.add(p.product_name);
    }
    const { data: runs } = await supabase
      .from("ai_campaign_runs")
      .select("product_opportunities, created_at")
      .gte("created_at", sinceIso)
      .limit(40);
    for (const r of (runs ?? []) as Array<{ product_opportunities: unknown }>) {
      const list = Array.isArray(r.product_opportunities) ? (r.product_opportunities as Array<{ product_keyword?: string; category?: string }>) : [];
      for (const o of list) {
        if (o?.product_keyword) excluded.add(o.product_keyword);
        if (o?.category) usedCategories.add(o.category);
      }
    }
  } catch {
    // không chặn việc tạo gợi ý nếu thu thập lỗi
  }
  return { excluded: Array.from(excluded).slice(0, 60), usedCategories: Array.from(usedCategories).slice(0, 20) };
}

export type CampaignFormOptions = {
  shopeeAccounts: Array<{ id: string; label: string; is_default: boolean }>;
  facebookPages: Array<{ id: string; label: string; is_default: boolean }>;
  verticals: Array<{ key: string; label: string }>;
};

/** Tùy chọn cho form tạo chiến dịch: tài khoản Shopee, Page, ngành hàng. */
export async function getCampaignFormOptions(): Promise<CampaignFormOptions> {
  const verticals = ALL_VERTICAL_KEYS.filter((k) => k !== "UNKNOWN").map((k) => ({ key: k, label: VERTICAL_LABELS[k] }));
  try {
    const supabase = createSupabaseAdminClient();
    const { data: accs } = await supabase
      .from("shopee_accounts")
      .select("id, label, name, is_default, status")
      .eq("status", "ACTIVE")
      .order("is_default", { ascending: false })
      .limit(50);
    const shopeeAccounts = ((accs ?? []) as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id),
      label: String(a.name ?? a.label ?? "Tài khoản Shopee"),
      is_default: Boolean(a.is_default),
    }));
    let facebookPages: CampaignFormOptions["facebookPages"] = [];
    try {
      const { data: pages } = await supabase
        .from("facebook_pages")
        .select("id, name, page_name, is_default, status")
        .eq("status", "ACTIVE")
        .order("is_default", { ascending: false })
        .limit(50);
      facebookPages = ((pages ?? []) as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id),
        label: String(p.name ?? p.page_name ?? "Facebook Page"),
        is_default: Boolean(p.is_default),
      }));
    } catch {
      // bảng facebook_pages có thể chưa migrate -> bỏ qua, dùng env fallback.
    }
    return { shopeeAccounts, facebookPages, verticals };
  } catch {
    return { shopeeAccounts: [], facebookPages: [], verticals };
  }
}

/** Tạo gợi ý chiến dịch AI (chưa tạo sản phẩm) -> WAITING_APPROVAL. */
export async function createCampaignPlanAction(fd: FormData): Promise<CreatePlanResult> {
  const objective = text(fd, "objective");
  if (!objective) return { ok: false, error: "Nhập mục tiêu chiến dịch." };
  const days = intField(fd, "days", 7, 1, 60);
  const postsPerDay = intField(fd, "posts_per_day", 2, 1, 10);
  const priorityGroup = text(fd, "priority_group");
  const targetCustomer = text(fd, "target_customer");
  const preferredPriceRange = text(fd, "preferred_price_range");
  const avoidProducts = text(fd, "avoid_products");
  const shopeeAccountId = text(fd, "shopee_account_id");
  const facebookPageId = text(fd, "facebook_page_id");
  const categoryHint = text(fd, "category_vertical"); // người dùng chọn ngành (tùy chọn)

  // Phase 21 — khóa ngành từ keyword/objective (+ hint nếu user chọn).
  const { vertical, confidence } = resolveCampaignVertical(objective, categoryHint);
  const profile = profileFor(vertical);
  const lockedLabel = vertical === "UNKNOWN" ? null : VERTICAL_LABELS[vertical];
  const needsClarification = vertical === "UNKNOWN" || confidence < 0.6;
  const clarificationQuestion = needsClarification
    ? "Chưa xác định rõ ngành hàng từ từ khóa. Hãy chọn ngành sản phẩm cho chiến dịch (ô 'Ngành hàng') rồi tạo lại để hệ thống tìm đúng sản phẩm."
    : null;

  try {
    const supabase = createSupabaseAdminClient();

    // PART E #18 — chống tạo trùng do bấm nhiều lần.
    const recentIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const objNorm = objective.toLowerCase().replace(/\s+/g, " ").trim();
    const { data: recentRuns } = await supabase
      .from("ai_campaign_runs")
      .select("objective, created_at")
      .gte("created_at", recentIso)
      .limit(10);
    const dup = (recentRuns ?? []).some(
      (r) => typeof r.objective === "string" && r.objective.toLowerCase().replace(/\s+/g, " ").trim() === objNorm,
    );
    if (dup) {
      return { ok: false, error: "Bạn vừa tạo một chiến dịch với mục tiêu này cách đây ít phút. Hãy kiểm tra danh sách bên dưới trước khi tạo lại." };
    }

    const novelty = await gatherNoveltyContext(supabase);
    const plan = await generateCampaignPlan({
      objective,
      days,
      posts_per_day: postsPerDay,
      priority_group: priorityGroup,
      target_customer: targetCustomer,
      preferred_price_range: preferredPriceRange,
      avoid_products: avoidProducts,
      excluded_recent_products: novelty.excluded,
      already_used_categories: novelty.usedCategories,
      vertical_label: lockedLabel,
      vertical_seeds: profile?.seeds ?? [],
    });

    // Phase 21 — KHÓA NGÀNH: loại cơ hội lệch ngành; bù seed ngành nếu thiếu.
    let opportunities = plan.product_opportunities;
    if (vertical !== "UNKNOWN") {
      const { valid } = validateOpportunitiesForVertical(opportunities, vertical);
      opportunities = valid;
      if (opportunities.length < 4) {
        const fallback = verticalFallbackOpportunities(vertical);
        const seen = new Set(opportunities.map((o) => o.product_keyword.toLowerCase()));
        for (const f of fallback) {
          if (opportunities.length >= 8) break;
          if (!seen.has(f.product_keyword.toLowerCase())) {
            opportunities.push(f);
            seen.add(f.product_keyword.toLowerCase());
          }
        }
      }
    }

    const { data, error } = await supabase
      .from("ai_campaign_runs")
      .insert({
        title: plan.campaign_title,
        objective: plan.campaign_goal || objective,
        status: "WAITING_APPROVAL",
        mode: "WEEKLY",
        target_customer: plan.target_customers || targetCustomer,
        ai_strategy: {
          campaign_goal: plan.campaign_goal,
          target_customers: plan.target_customers,
          content_angles: plan.content_angles,
          preferred_price_range: preferredPriceRange,
          avoid_products: avoidProducts,
        },
        product_opportunities: opportunities,
        posting_plan: plan.posting_plan,
        creative_direction: plan.creative_direction,
        budget_note: preferredPriceRange,
        current_step: "WAITING_APPROVAL",
        progress_total: opportunities.length,
        progress_current: 0,
        is_autopilot_enabled: false,
        next_auto_run_at: null,
        automation_error: null,
        // Phase 21 — account/page + keyword lock.
        shopee_account_id: shopeeAccountId,
        facebook_page_id: facebookPageId,
        user_keyword: objective,
        user_objective: objective,
        user_category_hint: categoryHint,
        locked_vertical: vertical,
        vertical_confidence: confidence,
        keyword_lock_enabled: true,
        allowed_terms: profile?.allowed ?? [],
        negative_terms: profile?.negative ?? [],
        allowed_categories: lockedLabel ? [lockedLabel] : [],
        blocked_categories: [],
        suggested_specific_queries: profile?.seeds ?? [],
        needs_clarification: needsClarification,
        clarification_question: clarificationQuestion,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: `Tạo gợi ý thất bại: ${error?.message ?? "?"}` };
    await insertPostingLog(supabase, null, "AI_CAMPAIGN_CREATED", "SUCCESS", `Tạo gợi ý chiến dịch: ${plan.campaign_title}.`, {
      ai_campaign_run_id: data.id,
      opportunities: plan.product_opportunities.length,
    });
    revalidatePath(PATH);
    return { ok: true, id: String(data.id) };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo gợi ý thất bại: ${m}` };
  }
}

/** Chạy lại gợi ý AI cho 1 run đang WAITING_APPROVAL. */
export async function regenerateCampaignPlan(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã chiến dịch." };
  try {
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase.from("ai_campaign_runs").select("*").eq("id", id).single();
    if (!row) return { ok: false, error: "Không tìm thấy chiến dịch." };
    const run = parseCampaignRunRow(row as Record<string, unknown>);
    if (run.status !== "WAITING_APPROVAL" && run.status !== "DRAFT" && run.status !== "FAILED") {
      return { ok: false, error: "Chỉ chạy lại gợi ý khi chiến dịch chưa được duyệt." };
    }
    const novelty = await gatherNoveltyContext(supabase);
    const plan = await generateCampaignPlan({
      objective: run.objective ?? "Tăng đơn hàng",
      days: run.posting_plan?.days ?? 7,
      posts_per_day: run.posting_plan?.posts_per_day ?? 2,
      priority_group: null,
      target_customer: run.target_customer,
      excluded_recent_products: novelty.excluded,
      already_used_categories: novelty.usedCategories,
    });
    await supabase
      .from("ai_campaign_runs")
      .update({
        title: plan.campaign_title,
        objective: plan.campaign_goal || run.objective,
        status: "WAITING_APPROVAL",
        target_customer: plan.target_customers,
        ai_strategy: {
          campaign_goal: plan.campaign_goal,
          target_customers: plan.target_customers,
          content_angles: plan.content_angles,
        },
        product_opportunities: plan.product_opportunities,
        posting_plan: plan.posting_plan,
        creative_direction: plan.creative_direction,
        progress_total: plan.product_opportunities.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Chạy lại gợi ý thất bại: ${m}` };
  }
}

/** Sửa mục tiêu / tệp khách hàng. */
export async function updateCampaignObjective(id: string, fd: FormData): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã chiến dịch." };
  const objective = text(fd, "objective");
  if (!objective) return { ok: false, error: "Nhập mục tiêu." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("ai_campaign_runs")
      .update({ objective, target_customer: text(fd, "target_customer"), updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
  }
}

/** Duyệt chiến dịch -> APPROVED + current_step SOURCING_PRODUCTS. */
export async function approveCampaignRun(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã chiến dịch." };
  try {
    const supabase = createSupabaseAdminClient();
    const now = new Date().toISOString();

    // Phase 21 — chặn duyệt khi chưa rõ ngành hoặc chưa chọn tài khoản Shopee.
    const { data: pre } = await supabase
      .from("ai_campaign_runs")
      .select("needs_clarification, locked_vertical, shopee_account_id")
      .eq("id", id)
      .maybeSingle();
    if (pre) {
      if (pre.needs_clarification || !pre.locked_vertical || pre.locked_vertical === "UNKNOWN") {
        return { ok: false, error: "Chưa xác định ngành hàng. Hãy tạo lại chiến dịch và chọn 'Ngành hàng' trước khi duyệt." };
      }
      if (!pre.shopee_account_id) {
        // Cho duyệt nếu có tài khoản mặc định ACTIVE; nếu không thì chặn.
        const { data: acc } = await supabase.from("shopee_accounts").select("id").eq("status", "ACTIVE").limit(1);
        if (!acc || acc.length === 0) {
          return { ok: false, error: "Chưa có tài khoản Shopee ACTIVE. Hãy thêm/chọn tài khoản ở 'Tài khoản & Page' trước khi duyệt." };
        }
      }
    }

    const { error } = await supabase
      .from("ai_campaign_runs")
      .update({
        status: "APPROVED",
        approved_at: now,
        current_step: "SOURCING_PRODUCTS",
        is_autopilot_enabled: true,
        auto_started_at: now,
        next_auto_run_at: now,
        automation_error: null,
        automation_attempts: 0,
        paused: false,
        error_message: null,
        updated_at: now,
      })
      .eq("id", id)
      .eq("status", "WAITING_APPROVAL");
    if (error) return { ok: false, error: `Duyệt thất bại: ${error.message}` };
    await insertPostingLog(supabase, null, "AI_CAMPAIGN_APPROVED", "SUCCESS", "Duyệt chiến dịch autopilot.", { ai_campaign_run_id: id });
    revalidatePath(PATH);
    return { ok: true, message: "Autopilot đã bật. Hệ thống sẽ tự chạy theo batch nhỏ qua cron. Bạn không cần bấm từng bước." };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Duyệt thất bại: ${m}` };
  }
}

/** Từ chối chiến dịch. */
export async function rejectCampaignRun(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã chiến dịch." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("ai_campaign_runs")
      .update({ status: "FAILED", error_message: "Người dùng từ chối chiến dịch.", updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Từ chối thất bại: ${m}` };
  }
}

/** Chạy bước tiếp theo / batch nhỏ. */
export async function runAutopilotStepAction(id: string): Promise<{ ok: boolean; message: string }> {
  if (!id) return { ok: false, message: "Thiếu mã chiến dịch." };
  try {
    const summary = await runCampaignAutopilotUntilBlocked({ campaignRunId: id, trigger: "manual" });
    revalidatePath(PATH);
    revalidatePath("/dashboard/review");
    return { ok: summary.ok, message: summary.message || `Đã chạy ${summary.micro_steps} micro-step.` };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, message: `Chạy bước thất bại: ${m}` };
  }
}

export async function pauseCampaignRun(id: string): Promise<SimpleResult> {
  return setPaused(id, true);
}
export async function resumeCampaignRun(id: string): Promise<SimpleResult> {
  return setPaused(id, false);
}
async function setPaused(id: string, paused: boolean): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã chiến dịch." };
  try {
    const supabase = createSupabaseAdminClient();
    const now = new Date().toISOString();
    await supabase
      .from("ai_campaign_runs")
      .update({
        paused,
        is_autopilot_enabled: !paused,
        next_auto_run_at: paused ? null : now,
        automation_error: null,
        updated_at: now,
      })
      .eq("id", id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
  }
}

export type CampaignRunWithCounters = { run: AiCampaignRun; counters: CampaignRunCounters };

export async function getCampaignRuns(limit = 30): Promise<CampaignRunWithCounters[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("ai_campaign_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const out: CampaignRunWithCounters[] = [];
    for (const row of rows) {
      const run = parseCampaignRunRow(row);
      const counters = await getCampaignRunCounters(supabase, run);
      out.push({ run, counters });
    }
    return out;
  } catch {
    return [];
  }
}
