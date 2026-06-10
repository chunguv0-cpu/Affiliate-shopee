import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateCreativeImagesForPost } from "@/lib/creative/image-provider";
import { insertPostingLog } from "@/lib/posts/log";
import type { CreativePackMode, CreativePackStatus, PublishMode } from "@/lib/types";

const MIN_ASSETS = 4;

const PACK_STARTED = "CREATIVE_PACK_BUILD_STARTED";
const PACK_SUCCESS = "CREATIVE_PACK_BUILD_SUCCESS";
const PACK_FAILED = "CREATIVE_PACK_BUILD_FAILED";
const IMAGE_FOUND = "CREATIVE_PACK_IMAGE_FOUND";
const IMAGE_GENERATED = "CREATIVE_PACK_IMAGE_GENERATED";

export type PackProductInput = {
  product_name: string;
  image_url?: string | null;
  target_customer?: string | null;
  product_angle?: string | null;
  category?: string | null;
};
export type PackAiInput = {
  hook?: string | null;
  visual_hook?: string | null;
  caption?: string | null;
};

export type BuildPackResult = {
  status: CreativePackStatus;
  mode: CreativePackMode;
  total: number;
  publish_mode: PublishMode;
};

type AssetRow = {
  generated_post_id: string;
  source_type: "PRODUCT" | "FOUND" | "AI_GENERATED";
  image_url: string | null;
  prompt: string | null;
  caption_overlay: string | null;
  sort_order: number;
  status: "READY" | "FAILED";
  metadata: Record<string, unknown>;
};

/**
 * Dựng creative pack (>= 4 ảnh) cho một bài: ảnh sản phẩm + tìm + sinh AI.
 * KHÔNG throw. Luôn cập nhật generated_posts với trạng thái pack.
 */
export async function buildCreativePackForPost(
  supabase: SupabaseClient,
  postId: string,
  product: PackProductInput,
  ai: PackAiInput,
): Promise<BuildPackResult> {
  await insertPostingLog(supabase, postId, PACK_STARTED, "SUCCESS", `Bắt đầu dựng pack ảnh (mục tiêu ${MIN_ASSETS}).`, {
    generated_post_id: postId,
  });

  const assets: AssetRow[] = [];
  let foundCount = 0;
  let generatedCount = 0;

  // A) Ảnh sản phẩm (PRODUCT) — ảnh thật ưu tiên.
  const productImg = (product.image_url ?? "").trim();
  if (productImg) {
    assets.push({
      generated_post_id: postId,
      source_type: "PRODUCT",
      image_url: productImg,
      prompt: null,
      caption_overlay: "Ảnh sản phẩm",
      sort_order: 0,
      status: "READY",
      metadata: {},
    });
    foundCount += 1;
  }

  // B) "Find image" V1: chỉ dùng ảnh đã có (không scrape). Không có thêm nguồn an toàn -> bỏ qua.

  // C) Sinh ảnh AI cho phần còn thiếu để đạt >= 4.
  const need = Math.max(0, MIN_ASSETS - assets.filter((a) => a.status === "READY").length);
  if (need > 0) {
    const generated = await generateCreativeImagesForPost(
      {
        product_name: product.product_name,
        target_customer: product.target_customer,
        content_angle: product.product_angle,
        hook: ai.visual_hook || ai.hook,
        caption_summary: (ai.caption ?? "").slice(0, 200),
        category: product.category,
        product_image_ref: productImg || null,
      },
      need,
    );
    let order = assets.length;
    for (const g of generated) {
      const ok = g.status === "READY" && !!g.image_url;
      assets.push({
        generated_post_id: postId,
        source_type: "AI_GENERATED",
        image_url: g.image_url,
        prompt: g.prompt,
        caption_overlay: g.caption_overlay,
        sort_order: order,
        status: ok ? "READY" : "FAILED",
        metadata: { style: g.caption_overlay, mock: g.mock },
      });
      order += 1;
      if (ok) generatedCount += 1;
    }
  }

  // Lưu assets (xóa pack cũ của bài trước để tránh nhân đôi khi build lại).
  try {
    await supabase.from("post_creative_assets").delete().eq("generated_post_id", postId);
    if (assets.length > 0) {
      await supabase.from("post_creative_assets").insert(assets);
    }
  } catch {
    /* lỗi lưu asset không làm hỏng bài */
  }

  if (foundCount > 0) {
    await insertPostingLog(supabase, postId, IMAGE_FOUND, "SUCCESS", `Dùng ${foundCount} ảnh thật (sản phẩm).`, {
      generated_post_id: postId,
    });
  }
  if (generatedCount > 0) {
    await insertPostingLog(supabase, postId, IMAGE_GENERATED, "SUCCESS", `Sinh ${generatedCount} ảnh AI.`, {
      generated_post_id: postId,
    });
  }

  const readyTotal = assets.filter((a) => a.status === "READY" && a.image_url).length;
  // Ảnh THẬT sản phẩm = source PRODUCT, READY, có url (mock không tính).
  const productReady = assets.filter(
    (a) => a.source_type === "PRODUCT" && a.status === "READY" && a.image_url,
  ).length;

  let mode: CreativePackMode = "AUTO";
  if (foundCount > 0 && generatedCount > 0) mode = "MIXED";
  else if (foundCount > 0) mode = "FOUND_ONLY";
  else if (generatedCount > 0) mode = "GENERATED_ONLY";

  // Guardrail (Hotfix 17.1): KHÔNG album nếu thiếu ảnh thật sản phẩm.
  let status: CreativePackStatus;
  let creativeError: string | null = null;
  if (productReady === 0) {
    status = "MISSING_PRODUCT_IMAGE";
    creativeError =
      "Thiếu ảnh thật sản phẩm — không thể đăng album chỉ gồm ảnh AI. Hãy bổ sung image_url thật hoặc import lại link có ảnh.";
  } else if (readyTotal >= MIN_ASSETS) {
    status = "READY";
  } else if (readyTotal >= 1) {
    status = "PARTIAL";
  } else {
    status = "FAILED";
    creativeError = "Không dựng được ảnh nào (find + generate đều thất bại).";
  }

  // Chỉ album khi đủ ảnh + có ảnh thật sản phẩm.
  const publish_mode: PublishMode = status === "READY" ? "PHOTO_ALBUM" : "FEED";
  const summary = `${readyTotal} ảnh (${productReady} thật sản phẩm + ${generatedCount} AI).`;

  try {
    await supabase
      .from("generated_posts")
      .update({
        creative_pack_status: status,
        creative_pack_mode: mode,
        creative_min_assets: MIN_ASSETS,
        publish_mode,
        creative_summary: summary,
        creative_error: creativeError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);
  } catch {
    /* bỏ qua */
  }

  const isBad = status === "FAILED" || status === "MISSING_PRODUCT_IMAGE";
  await insertPostingLog(
    supabase,
    postId,
    isBad ? PACK_FAILED : PACK_SUCCESS,
    isBad ? "FAILED" : "SUCCESS",
    `Pack: ${status} · ${summary} · publish=${publish_mode}.`,
    { generated_post_id: postId },
  );

  return { status, mode, total: readyTotal, publish_mode };
}
