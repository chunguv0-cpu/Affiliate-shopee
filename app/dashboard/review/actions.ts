"use server";

import { revalidatePath } from "next/cache";

import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PATH = "/dashboard/review";

export type SimpleResult = { ok: true } | { ok: false; error: string };

export type ReviewAsset = {
  image_url: string | null;
  sort_order: number;
  source_type: string;
  caption_overlay: string | null;
};

export type ReviewPost = {
  id: string;
  caption: string | null;
  ai_score: number | null;
  creative_pack_status: string | null;
  creative_summary: string | null;
  review_status: string | null;
  scheduled_at: string | null;
  product_name: string | null;
  affiliate_link: string | null;
  campaign_title: string | null;
  assets: ReviewAsset[];
  v98_calls: number;
  creative_score: number | null;
};

function isMock(m: unknown): boolean {
  return !!m && typeof m === "object" && (m as Record<string, unknown>).mock === true;
}

/** Hàng đợi duyệt bài: PENDING_REVIEW + NEEDS_EDIT. */
export async function getReviewQueue(): Promise<ReviewPost[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data: postRows } = await supabase
      .from("generated_posts")
      .select(
        "id, caption, ai_score, creative_pack_status, creative_summary, review_status, scheduled_at, ai_campaign_run_id, products(product_name, affiliate_link)",
      )
      .in("review_status", ["PENDING_REVIEW", "NEEDS_EDIT"])
      .order("created_at", { ascending: true })
      .limit(100);
    const posts = (postRows ?? []) as Array<Record<string, unknown>>;
    if (posts.length === 0) return [];

    const ids = posts.map((p) => String(p.id));
    const { data: assetRows } = await supabase
      .from("post_creative_assets")
      .select("generated_post_id, image_url, sort_order, source_type, status, caption_overlay, metadata")
      .in("generated_post_id", ids)
      .eq("status", "READY")
      .order("sort_order", { ascending: true });
    const assetsByPost = new Map<string, Array<Record<string, unknown>>>();
    for (const a of (assetRows ?? []) as Array<Record<string, unknown>>) {
      const pid = String(a.generated_post_id);
      const list = assetsByPost.get(pid) ?? [];
      list.push(a);
      assetsByPost.set(pid, list);
    }

    // Tên chiến dịch.
    const runIds = Array.from(new Set(posts.map((p) => p.ai_campaign_run_id).filter((x): x is string => typeof x === "string")));
    const titleByRun = new Map<string, string>();
    if (runIds.length > 0) {
      const { data: runRows } = await supabase.from("ai_campaign_runs").select("id, title").in("id", runIds);
      for (const r of (runRows ?? []) as Array<{ id: string; title: string | null }>) {
        titleByRun.set(String(r.id), r.title ?? "");
      }
    }

    return posts.map((p) => {
      const pid = String(p.id);
      const rawAssets = assetsByPost.get(pid) ?? [];
      const assets: ReviewAsset[] = rawAssets.map((a) => ({
        image_url: (a.image_url as string | null) ?? null,
        sort_order: typeof a.sort_order === "number" ? a.sort_order : 0,
        source_type: (a.source_type as string) ?? "AI_GENERATED",
        caption_overlay: (a.caption_overlay as string | null) ?? null,
      }));
      const v98_calls = rawAssets.filter((a) => a.source_type === "AI_GENERATED" && !isMock(a.metadata)).length;
      const scores = rawAssets
        .map((a) => {
          const m = a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
          return typeof m.asset_quality_score === "number" ? m.asset_quality_score : null;
        })
        .filter((x): x is number => x !== null);
      const creative_score = scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
      const product = Array.isArray(p.products) ? (p.products[0] as Record<string, unknown> | undefined) : (p.products as Record<string, unknown> | null);
      const runId = typeof p.ai_campaign_run_id === "string" ? p.ai_campaign_run_id : null;
      return {
        id: pid,
        caption: (p.caption as string | null) ?? null,
        ai_score: (p.ai_score as number | null) ?? null,
        creative_pack_status: (p.creative_pack_status as string | null) ?? null,
        creative_summary: (p.creative_summary as string | null) ?? null,
        review_status: (p.review_status as string | null) ?? null,
        scheduled_at: (p.scheduled_at as string | null) ?? null,
        product_name: (product?.product_name as string | null) ?? null,
        affiliate_link: (product?.affiliate_link as string | null) ?? null,
        campaign_title: runId ? titleByRun.get(runId) ?? null : null,
        assets,
        v98_calls,
        creative_score,
      };
    });
  } catch {
    return [];
  }
}

/** Duyệt bài: cho phép cron đăng (should_publish + ai_score>=80 + review APPROVED). */
export async function approvePost(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã bài." };
  try {
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("generated_posts")
      .select("id, ai_score, creative_pack_status")
      .eq("id", id)
      .single();
    if (!row) return { ok: false, error: "Không tìm thấy bài." };
    if ((row as { creative_pack_status: string | null }).creative_pack_status !== "READY") {
      return { ok: false, error: "Pack ảnh chưa READY, chưa thể duyệt." };
    }
    const currentScore = (row as { ai_score: number | null }).ai_score ?? 0;
    const { error } = await supabase
      .from("generated_posts")
      .update({
        review_status: "APPROVED",
        automation_status: "APPROVED_FOR_SCHEDULE",
        review_approved_at: new Date().toISOString(),
        should_publish: true,
        // Duyệt của người dùng ưu tiên hơn điểm AI -> đảm bảo đủ điều kiện đăng.
        ai_score: Math.max(currentScore, 80),
        status: "READY",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: `Duyệt thất bại: ${error.message}` };
    await insertPostingLog(supabase, id, "POST_APPROVED", "SUCCESS", "Người dùng duyệt bài (chờ xếp lịch).", null);
    revalidatePath(PATH);
    revalidatePath("/dashboard/ai-autopilot");
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Duyệt thất bại: ${m}` };
  }
}

/** Duyệt tất cả bài đạt chuẩn (pack READY, đang PENDING_REVIEW). */
export async function approveAllEligible(): Promise<{ ok: boolean; approved: number; error?: string }> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("generated_posts")
      .select("id, ai_score")
      .eq("review_status", "PENDING_REVIEW")
      .eq("creative_pack_status", "READY")
      .limit(200);
    const rows = (data ?? []) as Array<{ id: string; ai_score: number | null }>;
    let approved = 0;
    for (const r of rows) {
      const { error } = await supabase
        .from("generated_posts")
        .update({
          review_status: "APPROVED",
          automation_status: "APPROVED_FOR_SCHEDULE",
          review_approved_at: new Date().toISOString(),
          should_publish: true,
          ai_score: Math.max(r.ai_score ?? 0, 80),
          status: "READY",
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id)
        .eq("review_status", "PENDING_REVIEW");
      if (!error) {
        approved += 1;
        await insertPostingLog(supabase, r.id, "POST_APPROVED", "SUCCESS", "Duyệt hàng loạt (đạt chuẩn).", null);
      }
    }
    revalidatePath(PATH);
    revalidatePath("/dashboard/ai-autopilot");
    return { ok: true, approved };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, approved: 0, error: m };
  }
}

export async function rejectPost(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã bài." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("generated_posts")
      .update({ review_status: "REJECTED", status: "REJECTED", should_publish: false, automation_status: "REJECTED", updated_at: new Date().toISOString() })
      .eq("id", id);
    await insertPostingLog(supabase, id, "POST_REVIEW_REJECTED", "SUCCESS", "Người dùng từ chối bài.", null);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Từ chối thất bại: ${m}` };
  }
}

export async function markPostNeedsEdit(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã bài." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("generated_posts")
      .update({ review_status: "NEEDS_EDIT", should_publish: false, automation_status: "NEEDS_EDIT", updated_at: new Date().toISOString() })
      .eq("id", id);
    await insertPostingLog(supabase, id, "POST_REVIEW_NEEDS_EDIT", "SUCCESS", "Đánh dấu bài cần sửa.", null);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
  }
}

export async function updatePostCaption(id: string, caption: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã bài." };
  const text = (caption ?? "").trim();
  if (!text) return { ok: false, error: "Caption rỗng." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("generated_posts")
      .update({ caption: text, review_status: "PENDING_REVIEW", updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Lưu caption thất bại: ${m}` };
  }
}
