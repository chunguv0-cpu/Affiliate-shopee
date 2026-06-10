"use server";

import { revalidatePath } from "next/cache";

import {
  generateWeeklyCampaignPlan,
  type CampaignGoal,
  type PlannerProduct,
} from "@/lib/ai/campaign-planner";
import { toNumberSafe } from "@/lib/analytics";
import { insertPostingLog } from "@/lib/posts/log";
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
};

const GEN_ACTION = "GENERATE_AI_WEEKLY_CAMPAIGN_PLAN";
const APPROVE_ACTION = "APPROVE_AI_CAMPAIGN_PLAN";
const REJECT_ACTION = "REJECT_AI_CAMPAIGN_PLAN";
const VALID_GOALS: CampaignGoal[] = ["clicks", "orders", "commission", "engagement", "balanced"];

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
