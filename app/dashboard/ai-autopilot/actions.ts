"use server";

import { revalidatePath } from "next/cache";

import { generateCampaignPlan } from "@/lib/autopilot/campaign-planner";
import {
  getCampaignRunCounters,
  parseCampaignRunRow,
  runCampaignAutopilotStep,
} from "@/lib/autopilot/campaign-autopilot-orchestrator";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AiCampaignRun, CampaignRunCounters } from "@/lib/types";

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
    });
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
        product_opportunities: plan.product_opportunities,
        posting_plan: plan.posting_plan,
        creative_direction: plan.creative_direction,
        budget_note: preferredPriceRange,
        current_step: "WAITING_APPROVAL",
        progress_total: plan.product_opportunities.length,
        progress_current: 0,
        is_autopilot_enabled: false,
        next_auto_run_at: null,
        automation_error: null,
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
    const summary = await runCampaignAutopilotStep({ campaignRunId: id, trigger: "manual" });
    revalidatePath(PATH);
    revalidatePath("/dashboard/review");
    return { ok: summary.ok, message: summary.message || "Đã chạy một bước." };
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
