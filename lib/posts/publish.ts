import "server-only";

import { publishPhotoToFacebookPage, publishToFacebookPage } from "@/lib/facebook/client";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { FacebookPublishType, GeneratedPostStatus } from "@/lib/types";

/** Nguồn gọi publish: thủ công (nút) hay tự động (cron). */
export type PublishSource = "MANUAL" | "CRON";

/** Kết quả publish dùng chung. */
export type PublishGeneratedPostResult =
  | {
      ok: true;
      postId: string;
      facebookPostId: string;
      facebookPostUrl: string | null;
    }
  | { ok: false; error: string };

/**
 * Logic publish DÙNG CHUNG cho cả đăng thủ công và cron.
 *
 * Lưu ý: hàm này KHÔNG gọi revalidatePath — việc đó để caller (server action /
 * route handler) thực hiện, vì revalidate phụ thuộc ngữ cảnh request.
 */
export async function publishGeneratedPostById(
  postId: string,
  source: PublishSource = "MANUAL",
): Promise<PublishGeneratedPostResult> {
  if (!postId || typeof postId !== "string") {
    return { ok: false, error: "Thiếu mã bài đăng." };
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }

  try {
    // 1) Lấy bài + link affiliate của sản phẩm + trường creative (Phase 17).
    const { data, error } = await supabase
      .from("generated_posts")
      .select(
        "id, caption, status, should_publish, ai_score, creative_status, creative_image_url, facebook_publish_type, products(affiliate_link)",
      )
      .eq("id", postId)
      .single();

    if (error || !data) {
      return { ok: false, error: "Không tìm thấy bài đăng." };
    }

    const row = data as {
      id: string;
      caption: string | null;
      status: GeneratedPostStatus;
      should_publish: boolean;
      ai_score: number | null;
      creative_status: string | null;
      creative_image_url: string | null;
      facebook_publish_type: string | null;
      products:
        | { affiliate_link: string | null }
        | { affiliate_link: string | null }[]
        | null;
    };
    // Bài cũ không có trường này -> mặc định FEED (text-only) để tương thích ngược.
    const publishType = (row.facebook_publish_type ?? "FEED") as FacebookPublishType;
    const logAction =
      publishType === "PHOTO"
        ? source === "CRON"
          ? "PUBLISH_FACEBOOK_PHOTO_CRON"
          : "PUBLISH_FACEBOOK_PHOTO_MANUAL"
        : source === "CRON"
          ? "PUBLISH_FACEBOOK_FEED_CRON"
          : "PUBLISH_FACEBOOK_FEED_MANUAL";

    // 2) Kiểm tra điều kiện được phép đăng.
    if (row.status !== "READY") {
      return {
        ok: false,
        error: "Chỉ bài ở trạng thái Sẵn sàng (READY) mới có thể đăng.",
      };
    }
    if (row.should_publish !== true) {
      return { ok: false, error: "Bài chưa được AI duyệt để đăng." };
    }
    if ((row.ai_score ?? 0) < 80) {
      return { ok: false, error: "Điểm AI dưới 80, không thể đăng." };
    }
    const caption = (row.caption ?? "").trim();
    if (!caption) {
      return { ok: false, error: "Caption rỗng, không thể đăng." };
    }

    const productRel = Array.isArray(row.products)
      ? row.products[0]
      : row.products;
    const affiliateLink = productRel?.affiliate_link ?? null;

    // 3) CLAIM chống đăng trùng: chỉ chuyển READY -> PUBLISHING một cách atomic.
    //    Nếu không có row nào được cập nhật => bài đã/đang được xử lý bởi luồng khác.
    const { data: claimed, error: claimError } = await supabase
      .from("generated_posts")
      .update({ status: "PUBLISHING", updated_at: new Date().toISOString() })
      .eq("id", postId)
      .eq("status", "READY")
      .select("id");

    if (claimError) {
      return {
        ok: false,
        error: `Không khóa được bài để đăng: ${claimError.message}`,
      };
    }
    if (!claimed || claimed.length === 0) {
      return {
        ok: false,
        error: "Bài không còn ở trạng thái READY hoặc đang được xử lý.",
      };
    }

    // 3b) Kiểm tra điều kiện theo loại đăng (Phase 17). KHÔNG fallback ảnh -> text.
    if (publishType === "VIDEO") {
      const msg = "Phase 17 chưa hỗ trợ đăng VIDEO.";
      await supabase
        .from("generated_posts")
        .update({ status: "FAILED", error_log: msg, updated_at: new Date().toISOString() })
        .eq("id", postId);
      await insertPostingLog(supabase, postId, logAction, "FAILED", msg, null);
      return { ok: false, error: msg };
    }
    if (publishType === "PHOTO" && (row.creative_status !== "READY" || !row.creative_image_url)) {
      const msg = "Bài ảnh thiếu asset (creative_status != READY hoặc không có ảnh).";
      await supabase
        .from("generated_posts")
        .update({ status: "FAILED", error_log: msg, updated_at: new Date().toISOString() })
        .eq("id", postId);
      await insertPostingLog(supabase, postId, "CREATIVE_MISSING_ASSET", "FAILED", msg, null);
      return { ok: false, error: msg };
    }

    // 4) Gọi Facebook Graph API (PHOTO hoặc FEED).
    try {
      const result =
        publishType === "PHOTO"
          ? await publishPhotoToFacebookPage({
              imageUrl: row.creative_image_url as string,
              caption,
              affiliateLink,
            })
          : await publishToFacebookPage({ caption, affiliateLink });

      await supabase
        .from("generated_posts")
        .update({
          status: "PUBLISHED",
          facebook_post_id: result.postId,
          facebook_post_url: result.postUrl ?? null,
          published_at: new Date().toISOString(),
          error_log: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId);

      await insertPostingLog(
        supabase,
        postId,
        logAction,
        "SUCCESS",
        "Đăng Facebook thành công.",
        result.rawResponse,
      );

      return {
        ok: true,
        postId,
        facebookPostId: result.postId,
        facebookPostUrl: result.postUrl ?? null,
      };
    } catch (publishErr) {
      const message =
        publishErr instanceof Error ? publishErr.message : "Lỗi không xác định.";

      await supabase
        .from("generated_posts")
        .update({
          status: "FAILED",
          error_log: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId);

      await insertPostingLog(
        supabase,
        postId,
        publishType === "PHOTO" ? "PUBLISH_FACEBOOK_PHOTO_FAILED" : logAction,
        "FAILED",
        message,
        { error: message },
      );

      return { ok: false, error: message };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Đăng bài thất bại: ${message}` };
  }
}
