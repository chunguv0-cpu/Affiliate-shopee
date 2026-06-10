"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateAffiliateCaption,
  type GeneratedCaptionResult,
  type ProductInput,
} from "@/lib/ai/client";
import { buildCreativeFields } from "@/lib/posts/creative";
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
const SCHEDULE_ACTION = "SCHEDULE_POST";
const CLEAR_SCHEDULE_ACTION = "CLEAR_SCHEDULE";
const RETRY_ACTION = "RETRY_FAILED_POST";

/** Trạng thái được phép lên lịch. */
const SCHEDULABLE_STATUSES: GeneratedPostStatus[] = ["READY", "SKIPPED", "FAILED"];

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

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/posts");

    return { ok: true, postId, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo bài AI thất bại: ${message}` };
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

    return { ok: true, posts: (data ?? []) as GeneratedPost[] };
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

    return { ok: true, posts: (data ?? []) as GeneratedPost[] };
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
