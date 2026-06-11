import "server-only";

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAIProvider, resolveProviderConfig } from "@/lib/ai/client";
import {
  generateImageFromPrompt,
  getImageProvider,
  getImageProviderConfig,
  type PromptImageResult,
} from "@/lib/creative/image-provider";
import { insertPostingLog } from "@/lib/posts/log";
import type { CreativePackStatus, PublishMode } from "@/lib/types";

const MIN_ASSETS = 4;
// Bucket Storage cho ảnh (HOTFIX 17.2.3: mặc định post-creatives). Có thể override bằng CREATIVE_BUCKET.
const CREATIVE_BUCKET = process.env.CREATIVE_BUCKET?.trim() || "post-creatives";

// Logs.
const PROMPTS_CREATED = "POST_IMAGE_PROMPTS_CREATED";
const GEN_STARTED = "V98_IMAGE_GENERATION_STARTED";
const GEN_SUCCESS = "V98_IMAGE_GENERATION_SUCCESS";
const GEN_FAILED = "V98_IMAGE_GENERATION_FAILED";
const CONFIG_INVALID = "V98_IMAGE_PROVIDER_CONFIG_INVALID";
const STORAGE_UPLOAD_FAILED = "IMAGE_STORAGE_UPLOAD_FAILED";
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
  error?: string | null; // lỗi đọc được khi không đủ ảnh
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

type UploadOutcome = { url: string | null; error: string | null };

/** Upload buffer ảnh lên Supabase Storage, trả public URL + error đọc được. */
async function uploadBuffer(
  supabase: SupabaseClient,
  postId: string,
  index: number,
  buffer: Buffer,
  contentType: string,
): Promise<UploadOutcome> {
  try {
    const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
    const path = `posts/${postId}/${index}.${ext}`;
    const { error } = await supabase.storage
      .from(CREATIVE_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      const msg = error.message || String(error);
      const bucketMissing = /bucket.*not.*found|not found/i.test(msg);
      return {
        url: null,
        error: bucketMissing
          ? `Supabase Storage bucket '${CREATIVE_BUCKET}' is missing.`
          : `Supabase Storage upload failed: ${msg}`,
      };
    }
    const { data } = supabase.storage.from(CREATIVE_BUCKET).getPublicUrl(path);
    return { url: data?.publicUrl ?? null, error: data?.publicUrl ? null : "Storage public URL empty." };
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message.slice(0, 200) : "Storage upload error." };
  }
}

/** Upload ảnh base64 lên Storage. */
async function uploadImage(
  supabase: SupabaseClient,
  postId: string,
  index: number,
  b64: string,
): Promise<UploadOutcome> {
  try {
    return await uploadBuffer(supabase, postId, index, Buffer.from(b64, "base64"), "image/png");
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message.slice(0, 200) : "Decode base64 failed." };
  }
}

/** Tải ảnh từ URL (V98/OpenAI) rồi re-host lên Storage để URL bền + Facebook fetch được. */
async function uploadImageFromUrl(
  supabase: SupabaseClient,
  postId: string,
  index: number,
  url: string,
): Promise<UploadOutcome> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return { url: null, error: `Fetch image URL failed: HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return { url: null, error: "URL did not return an image." };
    const buffer = Buffer.from(await res.arrayBuffer());
    return await uploadBuffer(supabase, postId, index, buffer, contentType);
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message.slice(0, 200) : "Re-host failed." };
  }
}

/** Prompt tối thiểu cho sinh ảnh (tương thích ImagePrompt & AiImagePrompt). */
export type MinimalPrompt = {
  prompt: string;
  caption_overlay?: string | null;
  visual_angle?: string | null;
};

const PER_IMAGE_TIMEOUT_MS = 30_000;
const OVERALL_TIMEOUT_MS = 75_000;

function failResult(provider: ReturnType<typeof getImageProvider>, error?: string): PromptImageResult {
  return { b64: null, url: null, mock: false, provider, model: null, status: "FAILED", error: error ?? null };
}

/**
 * Sinh ảnh thật từ bộ prompt (song song, có timeout) -> lưu Storage -> post_creative_assets -> cập nhật pack.
 * KHÔNG throw. Mock KHÔNG tính là ảnh thật. Dùng cho one-step + regenerate.
 */
export async function materializeImages(
  supabase: SupabaseClient,
  postId: string,
  promptsIn: MinimalPrompt[],
): Promise<GeneratePackResult> {
  const provider = getImageProvider();
  const prompts = promptsIn.slice(0, MIN_ASSETS);
  const errorMessages: string[] = [];

  // Gate cấu hình: thiếu key/base url -> dừng sớm với lỗi rõ ràng.
  const cfg = getImageProviderConfig();
  if (!cfg.isConfigured) {
    const msg = cfg.errors.join(" ") || `Image provider chưa cấu hình (provider=${cfg.provider}).`;
    await insertPostingLog(supabase, postId, CONFIG_INVALID, "FAILED", msg, { generated_post_id: postId });
    try {
      await supabase
        .from("generated_posts")
        .update({
          creative_pack_status: "FAILED",
          creative_pack_mode: "GENERATED_ONLY",
          creative_min_assets: MIN_ASSETS,
          publish_mode: "FEED",
          creative_summary: "0/4 ảnh.",
          creative_error: msg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId);
    } catch {
      /* ignore */
    }
    await insertPostingLog(supabase, postId, PACK_FAILED, "FAILED", `Pack FAILED: ${msg}`, { generated_post_id: postId });
    return { status: "FAILED", total: 0, publish_mode: "FEED", error: msg };
  }

  await insertPostingLog(supabase, postId, GEN_STARTED, "SUCCESS", `Bắt đầu sinh ${prompts.length} ảnh (provider: ${provider}, model: ${cfg.imageModel}).`, {
    generated_post_id: postId,
  });

  // Per-image timeout 30s, song song; backstop tổng 75s.
  const genOne = (pr: string): Promise<PromptImageResult> =>
    Promise.race([
      generateImageFromPrompt(pr),
      new Promise<PromptImageResult>((res) =>
        setTimeout(() => res(failResult(provider, "Image generation timed out (30s).")), PER_IMAGE_TIMEOUT_MS),
      ),
    ]);
  const results = await Promise.race([
    Promise.all(prompts.map((p) => genOne(p.prompt))),
    new Promise<PromptImageResult[]>((res) =>
      setTimeout(
        () => res(prompts.map(() => failResult(provider, "Overall image generation timed out (75s)."))),
        OVERALL_TIMEOUT_MS,
      ),
    ),
  ]);

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
      if (r.b64) {
        const up = await uploadImage(supabase, postId, i + 1, r.b64);
        imageUrl = up.url;
        if (!up.url && up.error) {
          errorMessages.push(up.error);
          await insertPostingLog(supabase, postId, STORAGE_UPLOAD_FAILED, "FAILED", up.error, { generated_post_id: postId });
        }
      } else if (r.url && !r.mock) {
        // Ảnh thật trả về dạng URL (V98/OpenAI) -> re-host để bền; fallback URL gốc nếu re-host lỗi.
        const up = await uploadImageFromUrl(supabase, postId, i + 1, r.url);
        imageUrl = up.url ?? r.url;
        if (!up.url && up.error) {
          await insertPostingLog(supabase, postId, STORAGE_UPLOAD_FAILED, "FAILED", up.error, { generated_post_id: postId });
        }
      } else if (r.url) {
        imageUrl = r.url; // mock placeholder, giữ nguyên
      }
    } else if (r.error) {
      errorMessages.push(r.error);
    }
    const ok = !!imageUrl;
    rows.push({
      generated_post_id: postId,
      asset_type: "IMAGE",
      source_type: "AI_GENERATED",
      image_url: imageUrl,
      prompt: p.prompt,
      caption_overlay: p.caption_overlay ?? "",
      sort_order: i + 1,
      status: ok ? "READY" : "FAILED",
      metadata: {
        visual_angle: p.visual_angle ?? "",
        provider: r.provider,
        model: r.model,
        generated_from: "ONE_STEP_AI_POST",
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

  const firstErr = errorMessages.find(Boolean) ?? null;
  let status: CreativePackStatus;
  let creativeError: string | null = null;
  if (realReady >= MIN_ASSETS) {
    status = "READY";
  } else if (anyReady >= 1 && realReady === 0) {
    // Chỉ có ảnh mock.
    status = "PARTIAL";
    creativeError = "Chỉ có ảnh mock — chưa đủ ảnh thật để đăng album. Đặt IMAGE_PROVIDER=v98 + V98_IMAGE_MODEL=gpt-image-2.";
  } else if (realReady >= 1) {
    status = "PARTIAL";
    creativeError = `Chưa đủ ảnh thật: ${realReady}/${MIN_ASSETS}.${firstErr ? " " + firstErr : ""}`;
  } else {
    status = "FAILED";
    creativeError = firstErr
      ? `Lỗi tạo ảnh: ${firstErr}`
      : "Chưa tạo được ảnh thật cho bài viết.";
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

  return { status, total: realReady, publish_mode, error: creativeError };
}

/**
 * Sinh + lưu MỘT ảnh (cho job runner — mỗi bước 1 ảnh). KHÔNG throw.
 * Chỉ insert asset READY khi có image_url thật. Trả lỗi đọc được nếu fail.
 */
export async function generateAndStoreImageAsset(
  supabase: SupabaseClient,
  postId: string,
  sortOrder: number,
  prompt: MinimalPrompt,
): Promise<{ ok: boolean; mock: boolean; image_url: string | null; error: string | null }> {
  const r = await generateImageFromPrompt(prompt.prompt);
  if (r.status !== "READY") {
    return { ok: false, mock: false, image_url: null, error: r.error ?? "Image generation failed." };
  }
  let imageUrl: string | null = null;
  let storageErr: string | null = null;
  if (r.b64) {
    const up = await uploadImage(supabase, postId, sortOrder, r.b64);
    imageUrl = up.url;
    storageErr = up.error;
  } else if (r.url && !r.mock) {
    const up = await uploadImageFromUrl(supabase, postId, sortOrder, r.url);
    imageUrl = up.url ?? r.url;
    if (!up.url) storageErr = up.error;
  } else if (r.url) {
    imageUrl = r.url; // mock placeholder
  }
  if (!imageUrl) {
    return { ok: false, mock: r.mock, image_url: null, error: storageErr ?? "No image URL produced." };
  }
  try {
    await supabase.from("post_creative_assets").insert({
      generated_post_id: postId,
      asset_type: "IMAGE",
      source_type: "AI_GENERATED",
      image_url: imageUrl,
      prompt: prompt.prompt,
      caption_overlay: prompt.caption_overlay ?? "",
      sort_order: sortOrder,
      status: "READY",
      metadata: {
        visual_angle: prompt.visual_angle ?? "",
        provider: r.provider,
        model: r.model,
        generated_from: "AI_JOB",
        mock: r.mock,
      },
    });
  } catch (err) {
    return { ok: false, mock: r.mock, image_url: null, error: err instanceof Error ? err.message.slice(0, 200) : "Insert asset failed." };
  }
  return { ok: true, mock: r.mock, image_url: imageUrl, error: null };
}

/**
 * HOTFIX 17.3 — Lưu MỘT ảnh THẬT của sản phẩm Shopee thành asset PRODUCT (re-host về Storage).
 * Fallback dùng URL gốc nếu re-host lỗi. KHÔNG throw.
 */
export async function storeSourceProductImage(
  supabase: SupabaseClient,
  postId: string,
  sortOrder: number,
  imageUrl: string,
): Promise<{ ok: boolean; image_url: string | null; error: string | null }> {
  const src = (imageUrl ?? "").trim();
  if (!/^https?:\/\//i.test(src)) return { ok: false, image_url: null, error: "Source image URL không hợp lệ." };
  const up = await uploadImageFromUrl(supabase, postId, sortOrder, src);
  const finalUrl = up.url ?? src; // re-host được thì dùng Storage; không thì dùng URL gốc.
  try {
    await supabase.from("post_creative_assets").insert({
      generated_post_id: postId,
      asset_type: "IMAGE",
      source_type: "PRODUCT",
      image_url: finalUrl,
      prompt: null,
      caption_overlay: "Ảnh sản phẩm Shopee",
      sort_order: sortOrder,
      status: "READY",
      metadata: { generated_from: "SHOPEE_SOURCE", mock: false, rehosted: !!up.url, origin: src },
    });
  } catch (err) {
    return { ok: false, image_url: null, error: err instanceof Error ? err.message.slice(0, 200) : "Insert source asset failed." };
  }
  return { ok: true, image_url: finalUrl, error: null };
}

/**
 * Dựng pack từ context (tự sinh prompt pack rồi sinh ảnh). Dùng cho REGENERATE.
 * One-step flow truyền thẳng prompts từ 1 call text -> dùng materializeImages.
 */
export async function generatePostCreativePack(
  supabase: SupabaseClient,
  postId: string,
  ctx: PostImageContext,
): Promise<GeneratePackResult> {
  const prompts = await generateImagePromptPackForPost(ctx);
  await insertPostingLog(supabase, postId, PROMPTS_CREATED, "SUCCESS", `Đã tạo ${prompts.length} prompt ảnh.`, {
    generated_post_id: postId,
  });
  return materializeImages(supabase, postId, prompts);
}
