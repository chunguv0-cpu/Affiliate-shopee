import "server-only";

import type { GeneratedCaptionResult } from "@/lib/ai/client";
import type { CreativeStatus, CreativeType, FacebookPublishType } from "@/lib/types";

/** Các trường creative ghi vào generated_posts (Phase 17). */
export type CreativeFields = {
  creative_type: CreativeType;
  creative_image_url: string | null;
  creative_hook: string | null;
  creative_brief: string | null;
  creative_status: CreativeStatus;
  facebook_publish_type: FacebookPublishType;
};

/**
 * Suy ra trường creative cho bài đăng từ ảnh sản phẩm + kết quả AI.
 * - Có ảnh  -> IMAGE / PHOTO / READY.
 * - Thiếu ảnh -> TEXT_ONLY / FEED / MISSING_ASSET (không làm hỏng việc tạo bài).
 */
export function buildCreativeFields(
  imageUrl: string | null | undefined,
  ai: Pick<GeneratedCaptionResult, "visual_hook" | "creative_brief">,
): CreativeFields {
  const img = (imageUrl ?? "").trim();
  const hook = (ai.visual_hook ?? "").trim() || null;
  const brief = (ai.creative_brief ?? "").trim() || null;

  if (img) {
    return {
      creative_type: "IMAGE",
      creative_image_url: img,
      creative_hook: hook,
      creative_brief: brief,
      creative_status: "READY",
      facebook_publish_type: "PHOTO",
    };
  }
  return {
    creative_type: "TEXT_ONLY",
    creative_image_url: null,
    creative_hook: hook,
    creative_brief: brief,
    creative_status: "MISSING_ASSET",
    facebook_publish_type: "FEED",
  };
}
