import "server-only";

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAIProvider, resolveProviderConfig } from "@/lib/ai/client";
import { generateImageFromPrompt, getImageProvider } from "@/lib/creative/image-provider";
import { insertPostingLog } from "@/lib/posts/log";
import type { CreativePackStatus, PublishMode } from "@/lib/types";

const MIN_ASSETS = 4;
const CREATIVE_BUCKET = process.env.CREATIVE_BUCKET?.trim() || "post-creative";

// Logs (Phase 17 — fully AI).
const PROMPTS_CREATED = "POST_IMAGE_PROMPTS_CREATED";
const GEN_STARTED = "POST_IMAGE_GENERATION_STARTED";
const GEN_SUCCESS = "POST_IMAGE_GENERATION_SUCCESS";
const GEN_FAILED = "POST_IMAGE_GENERATION_FAILED";
const PACK_READY = "POST_CREATIVE_PACK_READY";
const PACK_PARTIAL = "POST_CREATIVE_PACK_PARTIAL";
const PACK_FAILED = "POST_CREATIVE_PACK_FAILED";

export type PostImageContext = {
  product_name: string;
  description?: string | null;
  target_customer?: string | null;
  product_angle?: string | null;
  hook?: string | null;
  caption_summary?: string | null;
  category?: string | null;
  affiliate_link?: string | null;
};

export type ImagePrompt = {
  image_title: string;
  prompt: string;
  visual_angle: string;
  caption_overlay: string;
  negative_prompt: string;
};

export type GeneratePackResult = {
  status: CreativePackStatus;
  total: number; // số ảnh thật READY (không mock)
  publish_mode: PublishMode;
};

// 4 góc ảnh cố định theo chiến lược.
const ANGLES = [
  { title: "Hero product scene", angle: "hero", overlay: "Sản phẩm nổi bật" },
  { title: "Product in use / lifestyle", angle: "lifestyle", overlay: "Đang sử dụng" },
  { title: "Detail / problem-solution", angle: "detail", overlay: "Điểm nổi bật" },
  { title: "Benefit / shopping trigger", angle: "benefit", overlay: "Lý do nên mua" },
];

const NEGATIVE =
  "no fake brand logos, no fake packaging text, no invented prices, no fake screenshots, no fake reviews/badges, no medical claims, no text overlay, no watermark, photorealistic, clean";

const PROMPT_SYSTEM = `Bạn là giám đốc sáng tạo ảnh quảng cáo affiliate Shopee. Tạo bộ 4 prompt sinh ảnh (tiếng Anh, cho mô hình ảnh) bám SÁT sản phẩm trong link.
Chiến lược 4 ảnh: (1) Hero product scene, (2) Product in use / lifestyle, (3) Detail / problem-solution / feature, (4) Benefit / shopping trigger.
RULE: bám đúng sản phẩm & nhóm hàng; KHÔNG bịa logo/nhãn hiệu/giá; KHÔNG screenshot giả; KHÔNG ảnh stock vô nghĩa; KHÔNG card trắng/placeholder; nếu sản phẩm phổ thông thì tạo cảnh dùng hằng ngày thực tế; nếu dữ liệu yếu thì suy luận thận trọng từ tên/nhóm hàng.
CHỈ trả JSON: {"prompts":[{"image_title":"","prompt":"","visual_angle":"","caption_overlay":"","negative_prompt":""}]} đúng 4 phần tử.`;

function buildPromptUser(ctx: PostImageContext): string {
  return [
    `product_name: ${ctx.product_name}`,
    `category: ${ctx.category ?? "(suy luận từ tên)"}`,
    `target_customer: ${ctx.target_customer ?? "(không rõ)"}`,
    `product_angle: ${ctx.product_angle ?? "(không rõ)"}`,
    `hook: ${ctx.hook ?? "(không rõ)"}`,
    `caption_summary: ${(ctx.caption_summary ?? "").slice(0, 200)}`,
    `description: ${(ctx.description ?? "").slice(0, 200)}`,
    "",
    "Hãy tạo đúng 4 prompt ảnh theo chiến lược, bám sát sản phẩm. CHỈ trả JSON.",
  ].join("\n");
}

function mockPromptPack(ctx: PostImageContext): ImagePrompt[] {
  return ANGLES.map((a) => ({
    image_title: a.title,
    prompt: `Photorealistic ${a.angle} image clearly related to "${ctx.product_name}"${
      ctx.category ? ` (${ctx.category})` : ""
    }, ${a.angle === "hero" ? "clean spotlight" : a.angle === "lifestyle" ? "natural home use scene" : a.angle === "detail" ? "close-up emphasizing a useful feature" : "showing the practical benefit"}. ${NEGATIVE}.`,
    visual_angle: a.angle,
    caption_overlay: a.overlay,
    negative_prompt: NEGATIVE,
  }));
}

/** Sinh bộ 4 prompt ảnh cho bài (text AI; fallback mock). KHÔNG throw. */
export async function generateImagePromptPackForPost(ctx: PostImageContext): Promise<ImagePrompt[]> {
  const provider = getAIProvider();
  if (provider === "mock") return mockPromptPack(ctx);
  try {
    const { apiKey, baseURL, model } = resolveProviderConfig(provider);
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT_SYSTEM },
        { role: "user", content: buildPromptUser(ctx) },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return mockPromptPack(ctx);
    const obj = JSON.parse(raw.slice(start, end + 1)) as { prompts?: unknown };
    const arr = Array.isArray(obj.prompts) ? obj.prompts : [];
    const parsed: ImagePrompt[] = arr
      .map((x, i) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const s = (v: unknown, fb = "") => (typeof v === "string" && v.trim() ? v.trim() : fb);
        return {
          image_title: s(o.image_title, ANGLES[i % 4].title),
          prompt: s(o.prompt),
          visual_angle: s(o.visual_angle, ANGLES[i % 4].angle),
          caption_overlay: s(o.caption_overlay, ANGLES[i % 4].overlay),
          negative_prompt: s(o.negative_prompt, NEGATIVE),
        };
      })
      .filter((p) => p.prompt);
    // Đảm bảo đủ 4 prompt.
    const pack = parsed.slice(0, 4);
    if (pack.length < 4) {
      const fill = mockPromptPack(ctx).slice(pack.length, 4);
      return [...pack, ...fill];
    }
    return pack;
  } catch {
    return mockPromptPack(ctx);
  }
}

/** Upload ảnh base64 lên Supabase Storage, trả public URL (hoặc null). */
async function uploadImage(
  supabase: SupabaseClient,
  postId: string,
  index: number,
  b64: string,
): Promise<string | null> {
  try {
    const buffer = Buffer.from(b64, "base64");
    const path = `posts/${postId}/${index}.png`;
    const { error } = await supabase.storage
      .from(CREATIVE_BUCKET)
      .upload(path, buffer, { contentType: "image/png", upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(CREATIVE_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * PIPELINE: prompt pack -> sinh 4 ảnh thật -> lưu storage -> post_creative_assets -> cập nhật pack.
 * KHÔNG throw. Mock KHÔNG được tính là ảnh thật (không production-ready).
 */
export async function generatePostCreativePack(
  supabase: SupabaseClient,
  postId: string,
  ctx: PostImageContext,
): Promise<GeneratePackResult> {
  const provider = getImageProvider();

  // 1) Prompt pack.
  const prompts = await generateImagePromptPackForPost(ctx);
  await insertPostingLog(supabase, postId, PROMPTS_CREATED, "SUCCESS", `Đã tạo ${prompts.length} prompt ảnh.`, {
    generated_post_id: postId,
  });

  // 2) Sinh ảnh (song song 4 ảnh).
  await insertPostingLog(supabase, postId, GEN_STARTED, "SUCCESS", `Bắt đầu sinh ảnh (provider: ${provider}).`, {
    generated_post_id: postId,
  });

  const results = await Promise.all(prompts.map((p) => generateImageFromPrompt(p.prompt)));

  // 3) Upload + dựng asset rows.
  type Row = {
    generated_post_id: string;
    asset_type: string;
    source_type: "AI_GENERATED";
    image_url: string | null;
    prompt: string;
    caption_overlay: string;
    sort_order: number;
    status: "READY" | "FAILED";
    metadata: Record<string, unknown>;
  };
  const rows: Row[] = [];
  for (let i = 0; i < prompts.length; i += 1) {
    const p = prompts[i];
    const r = results[i];
    let imageUrl: string | null = null;
    if (r.status === "READY") {
      if (r.b64) imageUrl = await uploadImage(supabase, postId, i + 1, r.b64);
      else if (r.url) imageUrl = r.url;
    }
    const ok = !!imageUrl;
    rows.push({
      generated_post_id: postId,
      asset_type: "IMAGE",
      source_type: "AI_GENERATED",
      image_url: imageUrl,
      prompt: p.prompt,
      caption_overlay: p.caption_overlay,
      sort_order: i + 1,
      status: ok ? "READY" : "FAILED",
      metadata: {
        visual_angle: p.visual_angle,
        provider: r.provider,
        model: r.model,
        generated_from: "AI_PROMPT",
        mock: r.mock,
      },
    });
  }

  // 4) Lưu (regenerate-safe: xóa pack cũ trước).
  try {
    await supabase.from("post_creative_assets").delete().eq("generated_post_id", postId);
    if (rows.length > 0) await supabase.from("post_creative_assets").insert(rows);
  } catch {
    /* bỏ qua lỗi lưu */
  }

  // 5) Tính trạng thái — CHỈ ảnh thật (không mock) mới tính publish-ready.
  const realReady = rows.filter((r) => r.status === "READY" && r.image_url && r.metadata.mock !== true).length;
  const anyReady = rows.filter((r) => r.status === "READY" && r.image_url).length;

  let status: CreativePackStatus;
  let creativeError: string | null = null;
  if (realReady >= MIN_ASSETS) {
    status = "READY";
  } else if (anyReady >= 1) {
    status = "PARTIAL";
    creativeError =
      realReady === 0
        ? "Chỉ có ảnh mock — chưa đủ ảnh thật để đăng album. Hãy cấu hình IMAGE_PROVIDER=openai."
        : `Chỉ có ${realReady} ảnh thật, chưa đủ ${MIN_ASSETS}.`;
  } else {
    status = "FAILED";
    creativeError = "Chưa tạo được ảnh thật cho bài viết.";
  }

  const publish_mode: PublishMode = status === "READY" ? "PHOTO_ALBUM" : "FEED";
  const summary = `${anyReady}/${MIN_ASSETS} ảnh (thật: ${realReady}).`;

  try {
    await supabase
      .from("generated_posts")
      .update({
        creative_pack_status: status,
        creative_pack_mode: "GENERATED_ONLY",
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

  const genAction = anyReady > 0 ? GEN_SUCCESS : GEN_FAILED;
  await insertPostingLog(supabase, postId, genAction, anyReady > 0 ? "SUCCESS" : "FAILED", summary, {
    generated_post_id: postId,
  });
  const packAction = status === "READY" ? PACK_READY : status === "PARTIAL" ? PACK_PARTIAL : PACK_FAILED;
  await insertPostingLog(
    supabase,
    postId,
    packAction,
    status === "READY" ? "SUCCESS" : "FAILED",
    `Pack: ${status} · ${summary} · publish=${publish_mode}.`,
    { generated_post_id: postId },
  );

  return { status, total: realReady, publish_mode };
}
