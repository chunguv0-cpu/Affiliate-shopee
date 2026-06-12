import "server-only";

import {
  publishPhotoAlbumToFacebookPage,
  publishPhotoToFacebookPage,
  publishToFacebookPage,
} from "@/lib/facebook/client";
import { resolveFacebookPage } from "@/lib/facebook/page-resolver";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { FacebookPublishType, GeneratedPostStatus, PublishMode } from "@/lib/types";

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
        "id, caption, status, should_publish, ai_score, review_status, ai_campaign_run_id, facebook_page_id, creative_status, creative_image_url, facebook_publish_type, publish_mode, creative_pack_status, products(affiliate_link)",
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
      review_status: string | null;
      ai_campaign_run_id: string | null;
      facebook_page_id: string | null;
      creative_status: string | null;
      creative_image_url: string | null;
      facebook_publish_type: string | null;
      publish_mode: string | null;
      creative_pack_status: string | null;
      products:
        | { affiliate_link: string | null }
        | { affiliate_link: string | null }[]
        | null;
    };
    // Bài cũ không có trường này -> mặc định FEED (text-only) để tương thích ngược.
    const publishType = (row.facebook_publish_type ?? "FEED") as FacebookPublishType;
    const publishMode = (row.publish_mode ?? "FEED") as PublishMode;
    // Loại đăng hiệu lực: ưu tiên PHOTO_ALBUM (V2) > PHOTO đơn (V1) > FEED.
    const effective: "ALBUM" | "PHOTO" | "FEED" | "VIDEO" =
      publishMode === "VIDEO" || publishType === "VIDEO"
        ? "VIDEO"
        : publishMode === "PHOTO_ALBUM"
          ? "ALBUM"
          : publishType === "PHOTO"
            ? "PHOTO"
            : "FEED";
    const suffix = source === "CRON" ? "CRON" : "MANUAL";
    const logAction =
      effective === "ALBUM"
        ? `PUBLISH_FACEBOOK_PHOTO_ALBUM_${suffix}`
        : effective === "PHOTO"
          ? `PUBLISH_FACEBOOK_PHOTO_${suffix}`
          : `PUBLISH_FACEBOOK_FEED_${suffix}`;

    // 2) Kiểm tra điều kiện được phép đăng.
    if (row.status !== "READY") {
      return {
        ok: false,
        error: "Chỉ bài ở trạng thái Sẵn sàng (READY) mới có thể đăng.",
      };
    }
    if (row.review_status !== "APPROVED") {
      return { ok: false, error: "Bài chưa được duyệt trong mục Chờ duyệt bài." };
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

    // 2b) Phase 21 — phân giải Facebook Page: post -> campaign -> default -> env.
    let campaignPageId: string | null = null;
    if (row.ai_campaign_run_id) {
      const { data: runRow } = await supabase
        .from("ai_campaign_runs")
        .select("facebook_page_id")
        .eq("id", row.ai_campaign_run_id)
        .maybeSingle();
      campaignPageId = (runRow?.facebook_page_id as string | null) ?? null;
    }
    const resolvedPage = await resolveFacebookPage(supabase, {
      postPageId: row.facebook_page_id,
      campaignPageId,
    });
    if (!resolvedPage.credential) {
      const msg = "Chưa có Facebook Page để đăng (chưa chọn Page, chưa có Page mặc định và thiếu env fallback).";
      await insertPostingLog(supabase, postId, "FACEBOOK_PAGE_TOKEN_MISSING", "FAILED", msg, {
        facebook_page_id: row.facebook_page_id,
        ai_campaign_run_id: row.ai_campaign_run_id,
      });
      return { ok: false, error: msg };
    }

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

    // 3b) Kiểm tra điều kiện theo loại đăng. KHÔNG fallback ảnh -> text.
    const failPost = async (msg: string, action: string) => {
      await supabase
        .from("generated_posts")
        .update({ status: "FAILED", error_log: msg, creative_error: msg, updated_at: new Date().toISOString() })
        .eq("id", postId);
      await insertPostingLog(supabase, postId, action, "FAILED", msg, null);
    };

    if (effective === "VIDEO") {
      const msg = "Phase 17 chưa hỗ trợ đăng VIDEO.";
      await failPost(msg, logAction);
      return { ok: false, error: msg };
    }

    // Chuẩn bị ảnh cho ALBUM (Hotfix 17.1 — guardrail ảnh thật sản phẩm).
    let albumUrls: string[] = [];
    if (effective === "ALBUM") {
      if (row.creative_pack_status !== "READY") {
        const msg = "Pack ảnh chưa READY — không đủ điều kiện đăng album.";
        await failPost(msg, "PUBLISH_FACEBOOK_PHOTO_ALBUM_FAILED");
        return { ok: false, error: msg };
      }
      const { data: assetRows } = await supabase
        .from("post_creative_assets")
        .select("image_url, sort_order, status, source_type, metadata")
        .eq("generated_post_id", postId)
        .eq("status", "READY")
        .order("sort_order", { ascending: true });
      const rows = (assetRows ?? []) as Array<{
        image_url: string | null;
        source_type: string | null;
        metadata: unknown;
      }>;
      const isMock = (m: unknown) =>
        !!m && typeof m === "object" && (m as Record<string, unknown>).mock === true;
      // Chỉ ảnh URL hợp lệ; LUÔN loại ảnh mock (không production-ready). Ảnh AI thật được phép.
      const usable = rows.filter((a) => {
        const url = (a.image_url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) return false;
        if (isMock(a.metadata)) return false;
        return true;
      });
      albumUrls = usable.map((a) => (a.image_url as string).trim());
      if (albumUrls.length < 4) {
        const msg = `Album cần >= 4 ảnh thật (đã loại ảnh mock) nhưng chỉ có ${albumUrls.length}.`;
        await failPost(msg, "PUBLISH_FACEBOOK_PHOTO_ALBUM_FAILED");
        return { ok: false, error: msg };
      }
    }

    if (effective === "PHOTO" && (row.creative_status !== "READY" || !row.creative_image_url)) {
      const msg = "Bài ảnh thiếu asset (creative_status != READY hoặc không có ảnh).";
      await failPost(msg, "CREATIVE_MISSING_ASSET");
      return { ok: false, error: msg };
    }

    // 4) Gọi Facebook Graph API (ALBUM / PHOTO / FEED).
    try {
      const page = resolvedPage.credential;
      const result =
        effective === "ALBUM"
          ? await publishPhotoAlbumToFacebookPage({ imageUrls: albumUrls, caption, affiliateLink, page })
          : effective === "PHOTO"
            ? await publishPhotoToFacebookPage({
                imageUrl: row.creative_image_url as string,
                caption,
                affiliateLink,
                page,
              })
            : await publishToFacebookPage({ caption, affiliateLink, page });

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
      if (row.ai_campaign_run_id) {
        await supabase
          .from("ai_campaign_runs")
          .update({
            status: "RUNNING",
            current_step: "RUNNING",
            is_autopilot_enabled: true,
            next_auto_run_at: new Date().toISOString(),
            automation_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.ai_campaign_run_id)
          .in("status", ["SCHEDULED", "RUNNING"]);
      }

      await insertPostingLog(
        supabase,
        postId,
        logAction,
        "SUCCESS",
        `Đăng Facebook thành công lên Page ${resolvedPage.page_name ?? resolvedPage.page_id ?? "?"} (nguồn: ${resolvedPage.source}).`,
        {
          facebook_page_id: resolvedPage.facebook_page_id,
          page_id: resolvedPage.page_id,
          page_name: resolvedPage.page_name,
          page_source: resolvedPage.source,
          facebook_post_id: result.postId,
        },
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

      const failAction =
        effective === "ALBUM"
          ? "PUBLISH_FACEBOOK_PHOTO_ALBUM_FAILED"
          : effective === "PHOTO"
            ? "PUBLISH_FACEBOOK_PHOTO_FAILED"
            : logAction;
      await insertPostingLog(supabase, postId, failAction, "FAILED", message, { error: message });

      return { ok: false, error: message };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Đăng bài thất bại: ${message}` };
  }
}
