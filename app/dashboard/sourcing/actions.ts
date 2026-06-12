"use server";

import { revalidatePath } from "next/cache";

import { deriveLinkStatus, generateSubId, getAllowedShopeeHost } from "@/lib/affiliate";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { SourcingCandidate, SourcingStatus } from "@/lib/types";

// Phase 20: trang Tìm link / Affiliate links đã gộp vào "Công cụ thủ công".
const SOURCING_PATH = "/dashboard/manual-tools";
const PRODUCTS_PATH = "/dashboard/products";
const LINKS_PATH = "/dashboard/manual-tools";
const CONVERT_ACTION = "CONVERT_SOURCING_TO_PRODUCT";

export type SimpleResult = { ok: true } | { ok: false; error: string };
export type SaveCandidateResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string };
export type SaveAllResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };
export type CandidatesResult =
  | { ok: true; items: SourcingCandidate[] }
  | { ok: false; error: string };

/** Một cơ hội sản phẩm từ AI Planner (dữ liệu đã chuẩn hóa). */
export type OpportunityInput = {
  recommendation_id: string | null;
  suggested_product: string;
  category?: string | null;
  reason?: string | null;
  target_customer?: string | null;
  pain_point?: string | null;
  suggested_search_keywords?: string[];
  content_angle?: string | null;
  first_post_hook?: string | null;
  cta?: string | null;
  priority?: string | null;
  confidence?: string | null;
};

const VALID_STATUSES: SourcingStatus[] = [
  "NEW",
  "NEEDS_LINK",
  "SOURCING",
  "PROVIDER_MISSING",
  "LINK_CONVERSION_FAILED",
  "MANUAL_REQUIRED",
  "LINK_READY",
  "IMPORTED",
  "REJECTED",
];

function rowFromOpportunity(input: OpportunityInput) {
  return {
    recommendation_id: input.recommendation_id ?? null,
    suggested_product: (input.suggested_product ?? "").trim(),
    category: input.category ?? null,
    reason: input.reason ?? null,
    target_customer: input.target_customer ?? null,
    pain_point: input.pain_point ?? null,
    suggested_search_keywords: Array.isArray(input.suggested_search_keywords)
      ? input.suggested_search_keywords
      : [],
    content_angle: input.content_angle ?? null,
    first_post_hook: input.first_post_hook ?? null,
    cta: input.cta ?? null,
    priority: input.priority ?? null,
    confidence: input.confidence ?? null,
    status: "NEW" as SourcingStatus,
  };
}

/** Kiểm tra trùng theo recommendation_id + suggested_product. */
async function existsDuplicate(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  recommendationId: string | null,
  product: string,
): Promise<boolean> {
  let q = supabase
    .from("sourcing_candidates")
    .select("id", { count: "exact", head: true })
    .eq("suggested_product", product);
  q = recommendationId ? q.eq("recommendation_id", recommendationId) : q.is("recommendation_id", null);
  const { count } = await q;
  return (count ?? 0) > 0;
}

/** Lưu MỘT cơ hội sản phẩm vào danh sách tìm link. Chống trùng. */
export async function saveSourcingCandidate(
  input: OpportunityInput,
): Promise<SaveCandidateResult> {
  const product = (input?.suggested_product ?? "").trim();
  if (!product) return { ok: false, error: "Thiếu tên sản phẩm." };

  try {
    const supabase = createSupabaseAdminClient();
    if (await existsDuplicate(supabase, input.recommendation_id ?? null, product)) {
      return { ok: false, error: "Sản phẩm này đã có trong danh sách tìm link." };
    }
    const { error } = await supabase.from("sourcing_candidates").insert(rowFromOpportunity(input));
    if (error) return { ok: false, error: `Lưu thất bại: ${error.message}` };

    revalidatePath(SOURCING_PATH);
    return { ok: true, created: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Lưu thất bại: ${m}` };
  }
}

/** Lưu TẤT CẢ cơ hội sản phẩm của một recommendation. Bỏ qua trùng. */
export async function saveAllSourcingCandidates(
  recommendationId: string | null,
  opportunities: OpportunityInput[],
): Promise<SaveAllResult> {
  if (!Array.isArray(opportunities) || opportunities.length === 0) {
    return { ok: false, error: "Không có sản phẩm gợi ý để lưu." };
  }
  try {
    const supabase = createSupabaseAdminClient();

    // Lấy danh sách đã có của recommendation để chống trùng theo tên.
    let existing = new Set<string>();
    if (recommendationId) {
      const { data } = await supabase
        .from("sourcing_candidates")
        .select("suggested_product")
        .eq("recommendation_id", recommendationId);
      existing = new Set((data ?? []).map((r) => String(r.suggested_product).toLowerCase()));
    }

    const rows: ReturnType<typeof rowFromOpportunity>[] = [];
    let skipped = 0;
    const seen = new Set<string>();
    for (const op of opportunities) {
      const name = (op?.suggested_product ?? "").trim();
      if (!name) {
        skipped += 1;
        continue;
      }
      const key = name.toLowerCase();
      if (existing.has(key) || seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      rows.push(rowFromOpportunity({ ...op, recommendation_id: recommendationId }));
    }

    if (rows.length === 0) {
      return { ok: true, created: 0, skipped };
    }

    const { error } = await supabase.from("sourcing_candidates").insert(rows);
    if (error) return { ok: false, error: `Lưu thất bại: ${error.message}` };

    revalidatePath(SOURCING_PATH);
    return { ok: true, created: rows.length, skipped };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Lưu thất bại: ${m}` };
  }
}

/** Lấy danh sách candidate (lọc theo status nếu có). */
export async function getSourcingCandidates(
  status?: SourcingStatus,
): Promise<CandidatesResult> {
  try {
    const supabase = createSupabaseAdminClient();
    let q = supabase
      .from("sourcing_candidates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (status && VALID_STATUSES.includes(status)) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { ok: false, error: `Không tải được danh sách: ${error.message}` };
    return { ok: true, items: (data ?? []) as SourcingCandidate[] };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }
}

/** Đổi trạng thái candidate (SOURCING / REJECTED / NEW). */
export async function updateSourcingStatus(
  id: string,
  status: SourcingStatus,
): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã candidate." };
  if (!VALID_STATUSES.includes(status)) return { ok: false, error: "Trạng thái không hợp lệ." };
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("sourcing_candidates")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: `Cập nhật thất bại: ${error.message}` };
    revalidatePath(SOURCING_PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
  }
}

/** Lưu affiliate link (+ sub_id, notes) cho candidate. Hợp lệ -> LINK_READY. */
export async function saveSourcingLink(
  id: string,
  affiliateLink: string,
  subId?: string,
  notes?: string,
): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã candidate." };
  const link = (affiliateLink ?? "").trim();
  if (!/^https?:\/\//i.test(link)) {
    return { ok: false, error: "Link affiliate phải bắt đầu bằng http:// hoặc https://" };
  }
  if (!getAllowedShopeeHost(link)) {
    return { ok: false, error: "Nên dùng link Shopee (s.shopee.vn, shope.ee, shopee.vn)." };
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("sourcing_candidates")
      .update({
        affiliate_link: link,
        sub_id: (subId ?? "").trim() || null,
        notes: (notes ?? "").trim() || null,
        status: "LINK_READY" as SourcingStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: `Lưu link thất bại: ${error.message}` };
    revalidatePath(SOURCING_PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Lưu link thất bại: ${m}` };
  }
}

/**
 * Chuyển candidate (đã có link) thành sản phẩm READY. KHÔNG gọi AI.
 */
export async function convertSourcingCandidateToProduct(
  id: string,
): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã candidate." };
  try {
    const supabase = createSupabaseAdminClient();
    const { data: cand, error: readErr } = await supabase
      .from("sourcing_candidates")
      .select("*")
      .eq("id", id)
      .single();
    if (readErr || !cand) return { ok: false, error: "Không tìm thấy candidate." };

    const c = cand as SourcingCandidate;
    const link = (c.affiliate_link ?? "").trim();
    if (!link) return { ok: false, error: "Candidate chưa có affiliate link." };
    if (!/^https?:\/\//i.test(link)) {
      return { ok: false, error: "Link affiliate không hợp lệ (cần http:// hoặc https://)." };
    }

    const subId = (c.sub_id ?? "").trim() || generateSubId(c.suggested_product);
    const linkStatus = deriveLinkStatus(link);

    const { data: product, error: insErr } = await supabase
      .from("products")
      .insert({
        product_name: c.suggested_product,
        affiliate_link: link,
        original_url: null,
        sub_id: subId,
        price_note: "giá có thể thay đổi theo thời điểm",
        target_customer: c.target_customer,
        product_angle: c.content_angle,
        status: "ACTIVE",
        link_status: linkStatus === "INVALID" ? "READY" : linkStatus,
        link_note: "Imported from AI sourcing candidate.",
      })
      .select("id")
      .single();
    if (insErr || !product) {
      return { ok: false, error: `Tạo sản phẩm thất bại: ${insErr?.message ?? "không rõ"}` };
    }

    const { error: updErr } = await supabase
      .from("sourcing_candidates")
      .update({
        status: "IMPORTED" as SourcingStatus,
        product_id: product.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updErr) {
      return { ok: false, error: `Cập nhật candidate thất bại: ${updErr.message}` };
    }

    await insertPostingLog(
      supabase,
      null,
      CONVERT_ACTION,
      "SUCCESS",
      `Chuyển "${c.suggested_product}" thành sản phẩm READY.`,
      { sourcing_candidate_id: id, product_id: product.id },
    );

    revalidatePath(SOURCING_PATH);
    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Chuyển sản phẩm thất bại: ${m}` };
  }
}
