"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateAffiliateCaption,
  generateAffiliatePostBundle,
  summarizeProductVisualIdentity,
  type GeneratedCaptionResult,
  type ProductInput,
} from "@/lib/ai/client";
import {
  generateAndStoreImageAsset,
  generatePostCreativePack,
  materializeImages,
  storeSourceProductImage,
} from "@/lib/creative/generate-post-images";
import { buildCreativeFields } from "@/lib/posts/creative";
import { extractShopeeProductData } from "@/lib/shopee/enrich";

const MISSING_SOURCE_MSG =
  "Không lấy được ảnh sản phẩm từ link Shopee nên chưa thể tạo ảnh AI bám đúng sản phẩm.";
import { insertPostingLog } from "@/lib/posts/log";
import { publishGeneratedPostById } from "@/lib/posts/publish";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isDue } from "@/lib/utils/date";
import type {
  GeneratedPost,
  GeneratedPostStatus,
  Product,
} from "@/lib/types";

/** Kết quả của generatePostFromProduct. */
export type GenerateResult =
  | { ok: true; postId: string; status: GeneratedPostStatus }
  | { ok: false; error: string };

/** Kết quả của getGeneratedPosts. */
export type GeneratedPostsResult =
  | { ok: true; posts: GeneratedPost[] }
  | { ok: false; error: string };

/** Thống kê tổng quan cho trang /dashboard. */
export type OverviewStats = {
  totalProducts: number;
  ready: number;
  publishing: number;
  published: number;
  failed: number;
  scheduled: number; // READY và đã có scheduled_at
  waitingSchedule: number; // READY nhưng chưa có scheduled_at
  due: number; // READY và scheduled_at <= bây giờ
};

/** Kết quả cho action lịch đăng (đặt/xóa). */
export type ScheduleActionResult = { ok: true } | { ok: false; error: string };

/** Kết quả cho action đăng Facebook. */
export type PublishResult =
  | { ok: true; facebookPostId: string; facebookPostUrl: string | null }
  | { ok: false; error: string };

/** Kết quả cho action thử lại bài lỗi. */
export type RetryResult = { ok: true } | { ok: false; error: string };

const GENERATE_ACTION = "GENERATE_CAPTION";
// Phase 17.2 — one-step AI post.
const ONE_STEP_STARTED = "ONE_STEP_AI_POST_STARTED";
const ONE_STEP_TEXT_DONE = "ONE_STEP_AI_TEXT_DONE";
const ONE_STEP_IMAGES_STARTED = "ONE_STEP_AI_IMAGES_STARTED";
const ONE_STEP_IMAGES_DONE = "ONE_STEP_AI_IMAGES_DONE";
const ONE_STEP_READY = "ONE_STEP_AI_POST_READY";
const ONE_STEP_FAILED = "ONE_STEP_AI_POST_FAILED";
const SCHEDULE_ACTION = "SCHEDULE_POST";
const CLEAR_SCHEDULE_ACTION = "CLEAR_SCHEDULE";
const RETRY_ACTION = "RETRY_FAILED_POST";

/** Trạng thái được phép lên lịch. */
const SCHEDULABLE_STATUSES: GeneratedPostStatus[] = ["READY", "SKIPPED", "FAILED"];

/** Đính kèm creative_assets (rút gọn) vào danh sách bài (Phase 17 V2). Không throw. */
async function attachCreativeAssets(
  supabase: SupabaseClient,
  posts: GeneratedPost[],
): Promise<void> {
  const ids = posts.map((p) => p.id);
  if (ids.length === 0) return;
  try {
    const { data } = await supabase
      .from("post_creative_assets")
      .select("generated_post_id, image_url, source_type, sort_order, status")
      .in("generated_post_id", ids)
      .order("sort_order", { ascending: true });
    const byPost = new Map<string, GeneratedPost["creative_assets"]>();
    for (const a of (data ?? []) as Array<Record<string, unknown>>) {
      const pid = String(a.generated_post_id);
      const list = byPost.get(pid) ?? [];
      list!.push({
        image_url: (a.image_url as string | null) ?? null,
        source_type: (a.source_type as "PRODUCT" | "FOUND" | "AI_GENERATED") ?? "AI_GENERATED",
        sort_order: typeof a.sort_order === "number" ? a.sort_order : 0,
        status: String(a.status ?? "READY"),
      });
      byPost.set(pid, list);
    }
    for (const p of posts) p.creative_assets = byPost.get(p.id) ?? [];
  } catch {
    /* bảng chưa tồn tại / lỗi -> bỏ qua */
  }

  // Gắn job AI đang chạy (nếu có) để UI link tới trang tiến trình.
  try {
    const { data: jobs } = await supabase
      .from("ai_jobs")
      .select("id, related_post_id, status")
      .in("related_post_id", ids)
      .in("status", ["PENDING", "RUNNING", "WAITING_RETRY"]);
    const jobByPost = new Map<string, string>();
    for (const j of (jobs ?? []) as Array<{ id: string; related_post_id: string | null }>) {
      if (j.related_post_id && !jobByPost.has(j.related_post_id)) jobByPost.set(j.related_post_id, j.id);
    }
    for (const p of posts) p.active_job_id = jobByPost.get(p.id) ?? null;
  } catch {
    /* bỏ qua */
  }
}

/**
 * Tạo bài AI từ một sản phẩm đã lưu, lưu vào generated_posts và ghi log.
 */
export async function generatePostFromProduct(
  productId: string,
): Promise<GenerateResult> {
  if (!productId || typeof productId !== "string") {
    return { ok: false, error: "Thiếu mã sản phẩm." };
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }

  try {
    // 1) Lấy sản phẩm.
    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (productError || !productData) {
      return { ok: false, error: "Không tìm thấy sản phẩm cần tạo bài." };
    }

    const product = productData as Product;

    // Phase 11: chỉ tạo bài khi link affiliate hợp lệ (link_status = READY).
    if (product.link_status !== "READY" || !product.affiliate_link) {
      return {
        ok: false,
        error:
          "Sản phẩm chưa có link Affiliate hợp lệ. Vui lòng chuyển link trước khi tạo bài.",
      };
    }

    const input: ProductInput = {
      id: product.id,
      product_name: product.product_name,
      affiliate_link: product.affiliate_link,
      price_note: product.price_note,
      target_customer: product.target_customer,
      product_angle: product.product_angle,
      image_url: product.image_url,
    };

    // 2) Gọi AI sinh caption.
    let result: GeneratedCaptionResult;
    try {
      result = await generateAffiliateCaption(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi không xác định.";
      await insertPostingLog(supabase, null, GENERATE_ACTION, "FAILED", `Tạo caption thất bại: ${message}`, {
        product_id: productId,
        error: message,
      });
      return { ok: false, error: `Tạo caption thất bại: ${message}` };
    }

    // 3) Quyết định trạng thái.
    const status: GeneratedPostStatus =
      result.score >= 80 && result.should_publish === true ? "READY" : "REJECTED";

    // 4) Lưu vào generated_posts (kèm trường creative — Phase 17).
    const creative = buildCreativeFields(product.image_url, result);
    const { data: inserted, error: insertError } = await supabase
      .from("generated_posts")
      .insert({
        product_id: productId,
        caption: result.caption,
        hook: result.hook,
        ai_score: result.score,
        safety_notes: result.safety_notes,
        should_publish: result.should_publish,
        status,
        ...creative,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      const message = insertError?.message ?? "không rõ nguyên nhân";
      await insertPostingLog(supabase, null, GENERATE_ACTION, "FAILED", `Lưu bài thất bại: ${message}`, {
        product_id: productId,
      });
      return { ok: false, error: `Lưu bài thất bại: ${message}` };
    }

    const postId = inserted.id as string;

    // 5) Ghi log thành công.
    await insertPostingLog(
      supabase,
      postId,
      GENERATE_ACTION,
      "SUCCESS",
      `Tạo caption thành công (trạng thái: ${status}, điểm: ${result.score}).`,
      result,
    );

    // 6) Phase 17 — dựng pack 4 ảnh AI thật cho bài READY.
    if (status === "READY") {
      await generatePostCreativePack(supabase, postId, {
        product_name: product.product_name,
        target_customer: product.target_customer,
        product_angle: product.product_angle,
        hook: result.visual_hook || result.hook,
        caption_summary: result.caption,
        affiliate_link: product.affiliate_link,
      });
    }

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/posts");

    return { ok: true, postId, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo bài AI thất bại: ${message}` };
  }
}

/** Kết quả regenerate creative pack. */
export type RegenerateResult = { ok: true; status: string; total: number } | { ok: false; error: string };

/**
 * Phase 17 — dựng lại pack 4 ảnh AI cho một bài (xóa pack cũ, sinh mới).
 */
export async function regeneratePostCreativeAssets(postId: string): Promise<RegenerateResult> {
  if (!postId || typeof postId !== "string") return { ok: false, error: "Thiếu mã bài đăng." };
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }
  try {
    type ProdEmbed = {
      product_name?: string;
      target_customer?: string | null;
      product_angle?: string | null;
      affiliate_link?: string | null;
      source_product_images?: unknown;
    };
    const { data, error } = await supabase
      .from("generated_posts")
      .select(
        "id, products(product_name, target_customer, product_angle, affiliate_link, source_product_images)",
      )
      .eq("id", postId)
      .single();
    if (error || !data) return { ok: false, error: "Không tìm thấy bài đăng." };
    const row = data as { products: ProdEmbed | ProdEmbed[] | null };
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const productName = product?.product_name ?? "Sản phẩm";

    // 1) Ảnh nguồn THẬT — ưu tiên đã lưu, nếu trống thì thử lấy lại từ link Shopee.
    let sources = Array.isArray(product?.source_product_images)
      ? (product!.source_product_images as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u))
      : [];
    if (sources.length === 0 && product?.affiliate_link) {
      const ex = await extractShopeeProductData(product.affiliate_link);
      if (ex.ok) sources = ex.image_urls;
    }
    if (sources.length === 0) {
      await supabase
        .from("generated_posts")
        .update({ creative_pack_status: "MISSING_PRODUCT_IMAGE", creative_error: MISSING_SOURCE_MSG, publish_mode: "FEED", updated_at: new Date().toISOString() })
        .eq("id", postId);
      revalidatePath("/dashboard/posts");
      return { ok: false, error: MISSING_SOURCE_MSG };
    }

    // 2) Reset assets + thêm 1 ảnh nguồn thật.
    await supabase.from("post_creative_assets").delete().eq("generated_post_id", postId);
    await storeSourceProductImage(supabase, postId, 1, sources[0]);

    // 3) Grounding: tóm tắt nhận diện thị giác + sinh 3 ảnh AI bám sản phẩm.
    const vi = await summarizeProductVisualIdentity(sources, productName);
    const bundle = await generateAffiliatePostBundle(
      {
        product_name: productName,
        affiliate_link: product?.affiliate_link ?? "",
        target_customer: product?.target_customer ?? null,
        product_angle: product?.product_angle ?? null,
      },
      { visualIdentity: vi },
    );
    const prompts = bundle.image_prompts.slice(0, 3);
    for (let i = 0; i < prompts.length; i += 1) {
      await generateAndStoreImageAsset(supabase, postId, i + 2, prompts[i]);
    }

    // 4) Tính trạng thái.
    const { data: assetRows } = await supabase
      .from("post_creative_assets")
      .select("status, image_url, source_type, metadata")
      .eq("generated_post_id", postId)
      .eq("status", "READY");
    const list = (assetRows ?? []) as Array<{ image_url: string | null; source_type: string | null; metadata: unknown }>;
    const real = list.filter((a) => {
      const m = a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
      return !!a.image_url && m.mock !== true;
    });
    const productCount = real.filter((a) => a.source_type === "PRODUCT").length;
    const total = real.length;
    const packStatus = total >= 4 && productCount >= 1 ? "READY" : productCount === 0 ? "MISSING_PRODUCT_IMAGE" : total >= 1 ? "PARTIAL" : "FAILED";
    await supabase
      .from("generated_posts")
      .update({
        creative_pack_status: packStatus,
        creative_pack_mode: "MIXED",
        publish_mode: packStatus === "READY" ? "PHOTO_ALBUM" : "FEED",
        creative_summary: `${total} ảnh (nguồn Shopee: ${productCount}, AI bám SP: ${total - productCount}).`,
        creative_error: packStatus === "READY" ? null : `Chưa đủ ảnh bám sản phẩm: ${total}/4 (nguồn ${productCount}).`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    revalidatePath("/dashboard/posts");
    revalidatePath("/dashboard/calendar");
    return packStatus === "READY"
      ? { ok: true, status: packStatus, total }
      : { ok: false, error: `Chưa đủ ảnh bám sản phẩm: ${total}/4 (nguồn ${productCount}).` };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Dựng lại ảnh thất bại: ${m}` };
  }
}

export type OneStepResult =
  | { ok: true; postId: string; imageCount: number; status: GeneratedPostStatus }
  | { ok: false; postId?: string; error: string };

/**
 * Phase 17.2 — MỘT bước: caption + hook + 4 image prompt (1 call text) -> 4 ảnh thật.
 * Chỉ ok=true khi đủ 4 ảnh thật (READY, không mock) -> PHOTO_ALBUM.
 */
export async function createAiPostWithCreatives(productId: string): Promise<OneStepResult> {
  if (!productId || typeof productId !== "string") return { ok: false, error: "Thiếu mã sản phẩm." };

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }

  try {
    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();
    if (productError || !productData) return { ok: false, error: "Không tìm thấy sản phẩm." };
    const product = productData as Product;
    if (product.link_status !== "READY" || !product.affiliate_link) {
      return { ok: false, error: "Sản phẩm chưa có link Affiliate hợp lệ. Vui lòng chuyển link trước." };
    }

    const input: ProductInput = {
      id: product.id,
      product_name: product.product_name,
      affiliate_link: product.affiliate_link,
      price_note: product.price_note,
      target_customer: product.target_customer,
      product_angle: product.product_angle,
      image_url: product.image_url,
    };

    await insertPostingLog(supabase, null, ONE_STEP_STARTED, "SUCCESS", `Bắt đầu tạo bài AI 1 bước: ${product.product_name}.`, {
      product_id: productId,
    });

    // 1) MỘT call text: caption + hook + 4 image prompts.
    const bundle = await generateAffiliatePostBundle(input);
    await insertPostingLog(supabase, null, ONE_STEP_TEXT_DONE, "SUCCESS", `Đã có caption + ${bundle.image_prompts.length} prompt ảnh.`, {
      product_id: productId,
    });

    const status: GeneratedPostStatus =
      bundle.score >= 80 && bundle.should_publish === true ? "READY" : "REJECTED";
    const creative = buildCreativeFields(null, { visual_hook: bundle.hook, creative_brief: "" });

    const { data: inserted, error: insertError } = await supabase
      .from("generated_posts")
      .insert({
        product_id: productId,
        caption: bundle.caption,
        hook: bundle.hook,
        ai_score: bundle.score,
        safety_notes: bundle.safety_notes,
        should_publish: bundle.should_publish,
        status,
        ...creative,
        creative_pack_status: "PENDING",
        creative_min_assets: 4,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      const m = insertError?.message ?? "không rõ";
      await insertPostingLog(supabase, null, ONE_STEP_FAILED, "FAILED", `Lưu bài thất bại: ${m}`, { product_id: productId });
      return { ok: false, error: `Lưu bài thất bại: ${m}` };
    }
    const postId = inserted.id as string;

    // 2) Sinh 4 ảnh thật từ prompts (song song, có timeout).
    await insertPostingLog(supabase, null, ONE_STEP_IMAGES_STARTED, "SUCCESS", "Bắt đầu sinh 4 ảnh.", {
      generated_post_id: postId,
    });
    const packRes = await materializeImages(supabase, postId, bundle.image_prompts);
    await insertPostingLog(supabase, postId, ONE_STEP_IMAGES_DONE, packRes.status === "READY" ? "SUCCESS" : "FAILED", `Ảnh thật: ${packRes.total}/4 (${packRes.status}).`, {
      generated_post_id: postId,
    });

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/posts");
    revalidatePath("/dashboard/calendar");

    if (packRes.status === "READY") {
      await insertPostingLog(supabase, postId, ONE_STEP_READY, "SUCCESS", `Bài AI sẵn sàng album 4 ảnh.`, {
        generated_post_id: postId,
      });
      return { ok: true, postId, imageCount: packRes.total, status };
    }

    const error =
      packRes.error ??
      (packRes.status === "PARTIAL"
        ? `Chưa đủ 4 ảnh thật (${packRes.total}/4).`
        : "Không tạo được ảnh thật cho bài viết.");
    await insertPostingLog(supabase, postId, ONE_STEP_FAILED, "FAILED", error, { generated_post_id: postId });
    return { ok: false, postId, error };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo bài AI thất bại: ${m}` };
  }
}

/**
 * Lấy danh sách bài AI kèm thông tin sản phẩm, mới nhất trước.
 */
export async function getGeneratedPosts(): Promise<GeneratedPostsResult> {
  try {
    const supabase = createSupabaseAdminClient();

    // Thử kèm tên chiến dịch; nếu chưa chạy migration campaigns thì fallback.
    let { data, error } = await supabase
      .from("generated_posts")
      .select("*, products(product_name, affiliate_link), campaigns(name)")
      .order("created_at", { ascending: false });

    if (error) {
      ({ data, error } = await supabase
        .from("generated_posts")
        .select("*, products(product_name, affiliate_link)")
        .order("created_at", { ascending: false }));
    }

    if (error) {
      return { ok: false, error: `Không tải được danh sách bài AI: ${error.message}` };
    }

    const posts = (data ?? []) as GeneratedPost[];
    await attachCreativeAssets(supabase, posts);
    return { ok: true, posts };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }
}

/**
 * Thống kê tổng quan cho dashboard. Không ném lỗi (fallback 0).
 */
export async function getOverviewStats(): Promise<OverviewStats> {
  const empty: OverviewStats = {
    totalProducts: 0,
    ready: 0,
    publishing: 0,
    published: 0,
    failed: 0,
    scheduled: 0,
    waitingSchedule: 0,
    due: 0,
  };

  try {
    const supabase = createSupabaseAdminClient();

    const [productsRes, postsRes] = await Promise.all([
      supabase.from("products").select("*", { count: "exact", head: true }),
      supabase.from("generated_posts").select("status, scheduled_at"),
    ]);

    const stats: OverviewStats = {
      ...empty,
      totalProducts: productsRes.count ?? 0,
    };

    if (postsRes.data) {
      for (const row of postsRes.data) {
        if (row.status === "READY") {
          stats.ready += 1;
          if (row.scheduled_at) {
            stats.scheduled += 1;
            if (isDue(row.scheduled_at as string)) stats.due += 1;
          } else {
            stats.waitingSchedule += 1;
          }
        } else if (row.status === "PUBLISHING") {
          stats.publishing += 1;
        } else if (row.status === "PUBLISHED") {
          stats.published += 1;
        } else if (row.status === "FAILED") {
          stats.failed += 1;
        }
      }
    }

    return stats;
  } catch {
    return empty;
  }
}

/**
 * Đặt/đổi lịch đăng cho một bài AI.
 * Chỉ cho phép với bài READY / SKIPPED / FAILED (không cho PUBLISHED).
 */
export async function scheduleGeneratedPost(
  postId: string,
  scheduledAt: string,
): Promise<ScheduleActionResult> {
  if (!postId || typeof postId !== "string") {
    return { ok: false, error: "Thiếu mã bài đăng." };
  }
  if (!scheduledAt || typeof scheduledAt !== "string") {
    return { ok: false, error: "Thiếu thời gian lên lịch." };
  }

  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: "Thời gian lên lịch không hợp lệ." };
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }

  try {
    const { data: post, error: fetchError } = await supabase
      .from("generated_posts")
      .select("status")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      return { ok: false, error: "Không tìm thấy bài đăng." };
    }

    const current = post.status as GeneratedPostStatus;
    if (current === "PUBLISHED") {
      return { ok: false, error: "Bài đã đăng, không thể đổi lịch." };
    }
    if (!SCHEDULABLE_STATUSES.includes(current)) {
      return {
        ok: false,
        error: "Chỉ có thể lên lịch cho bài ở trạng thái Sẵn sàng, Bỏ qua hoặc Lỗi.",
      };
    }

    // SKIPPED/FAILED -> chuyển lại READY khi đặt lịch.
    const newStatus: GeneratedPostStatus =
      current === "SKIPPED" || current === "FAILED" ? "READY" : current;

    const { error: updateError } = await supabase
      .from("generated_posts")
      .update({
        scheduled_at: when.toISOString(),
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    if (updateError) {
      return { ok: false, error: `Lên lịch thất bại: ${updateError.message}` };
    }

    await insertPostingLog(
      supabase,
      postId,
      SCHEDULE_ACTION,
      "SUCCESS",
      "Đã lên lịch bài đăng.",
      { scheduled_at: when.toISOString() },
    );

    revalidatePath("/dashboard/posts");
    revalidatePath("/dashboard/calendar");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Lên lịch thất bại: ${message}` };
  }
}

/**
 * Xóa lịch đăng của một bài AI (không cho phép với bài đã PUBLISHED).
 */
export async function clearPostSchedule(
  postId: string,
): Promise<ScheduleActionResult> {
  if (!postId || typeof postId !== "string") {
    return { ok: false, error: "Thiếu mã bài đăng." };
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }

  try {
    const { data: post, error: fetchError } = await supabase
      .from("generated_posts")
      .select("status")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      return { ok: false, error: "Không tìm thấy bài đăng." };
    }
    if ((post.status as GeneratedPostStatus) === "PUBLISHED") {
      return { ok: false, error: "Bài đã đăng, không thể xóa lịch." };
    }

    const { error: updateError } = await supabase
      .from("generated_posts")
      .update({ scheduled_at: null, updated_at: new Date().toISOString() })
      .eq("id", postId);

    if (updateError) {
      return { ok: false, error: `Xóa lịch thất bại: ${updateError.message}` };
    }

    await insertPostingLog(
      supabase,
      postId,
      CLEAR_SCHEDULE_ACTION,
      "SUCCESS",
      "Đã xóa lịch đăng.",
      null,
    );

    revalidatePath("/dashboard/posts");
    revalidatePath("/dashboard/calendar");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Xóa lịch thất bại: ${message}` };
  }
}

/**
 * Lấy danh sách bài AI đã có lịch đăng (scheduled_at not null), sắp xếp tăng dần.
 */
export async function getScheduledPosts(): Promise<GeneratedPostsResult> {
  try {
    const supabase = createSupabaseAdminClient();

    // Thử kèm tên chiến dịch; nếu chưa chạy migration campaigns thì fallback.
    let { data, error } = await supabase
      .from("generated_posts")
      .select("*, products(product_name, affiliate_link), campaigns(name)")
      .not("scheduled_at", "is", null)
      .order("scheduled_at", { ascending: true });

    if (error) {
      ({ data, error } = await supabase
        .from("generated_posts")
        .select("*, products(product_name, affiliate_link)")
        .not("scheduled_at", "is", null)
        .order("scheduled_at", { ascending: true }));
    }

    if (error) {
      return { ok: false, error: `Không tải được lịch đăng: ${error.message}` };
    }

    const posts = (data ?? []) as GeneratedPost[];
    await attachCreativeAssets(supabase, posts);
    return { ok: true, posts };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }
}

/**
 * Đăng thủ công một bài AI lên Facebook Page.
 * Dùng chung logic với cron qua publishGeneratedPostById (source = "MANUAL").
 */
export async function publishGeneratedPost(
  postId: string,
): Promise<PublishResult> {
  const result = await publishGeneratedPostById(postId, "MANUAL");

  // Làm mới dữ liệu các trang liên quan (dù thành công hay thất bại).
  revalidatePath("/dashboard/posts");
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/logs");

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    facebookPostId: result.facebookPostId,
    facebookPostUrl: result.facebookPostUrl,
  };
}

/**
 * Đưa một bài đang ở trạng thái FAILED trở lại READY để có thể đăng lại.
 * Không tự động đăng lại — chỉ reset trạng thái.
 */
export async function retryFailedPost(postId: string): Promise<RetryResult> {
  if (!postId || typeof postId !== "string") {
    return { ok: false, error: "Thiếu mã bài đăng." };
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }

  try {
    const { data, error } = await supabase
      .from("generated_posts")
      .select("status, caption, should_publish, ai_score")
      .eq("id", postId)
      .single();

    if (error || !data) {
      return { ok: false, error: "Không tìm thấy bài đăng." };
    }

    const row = data as {
      status: GeneratedPostStatus;
      caption: string | null;
      should_publish: boolean;
      ai_score: number | null;
    };

    if (row.status !== "FAILED") {
      return {
        ok: false,
        error: "Chỉ có thể thử lại bài ở trạng thái Lỗi (FAILED).",
      };
    }
    if (row.should_publish !== true) {
      return { ok: false, error: "Bài chưa được AI duyệt để đăng." };
    }
    if ((row.ai_score ?? 0) < 80) {
      return { ok: false, error: "Điểm AI dưới 80, không thể đăng." };
    }
    if (!(row.caption ?? "").trim()) {
      return { ok: false, error: "Caption rỗng, không thể đăng." };
    }

    const { error: updateError } = await supabase
      .from("generated_posts")
      .update({
        status: "READY",
        error_log: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("status", "FAILED");

    if (updateError) {
      return { ok: false, error: `Thử lại thất bại: ${updateError.message}` };
    }

    await insertPostingLog(
      supabase,
      postId,
      RETRY_ACTION,
      "SUCCESS",
      "Đã đưa bài lỗi về trạng thái READY.",
      null,
    );

    revalidatePath("/dashboard/posts");
    revalidatePath("/dashboard/calendar");
    revalidatePath("/dashboard/logs");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Thử lại thất bại: ${message}` };
  }
}
