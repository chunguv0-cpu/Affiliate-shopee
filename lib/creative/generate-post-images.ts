import "server-only";

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

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
const OVERLAY_VERSION = "vietnamese-safe-v2";
export const TEXT_FREE_IMAGE_PROMPT_RULE = "no text, no letters, no words, no watermark, no logo, no UI text";
const require = createRequire(import.meta.url);
const TextToSVG = require("text-to-svg") as {
  loadSync: (file: string) => {
    getPath: (
      text: string,
      options: {
        x?: number;
        y?: number;
        fontSize?: number;
        anchor?: string;
        attributes?: Record<string, string>;
      },
    ) => string;
  };
};

// Logs.
const PROMPTS_CREATED = "POST_IMAGE_PROMPTS_CREATED";
const GEN_STARTED = "V98_IMAGE_GENERATION_STARTED";
const GEN_SUCCESS = "V98_IMAGE_GENERATION_SUCCESS";
const GEN_FAILED = "V98_IMAGE_GENERATION_FAILED";
const V98_CALL_SKIPPED_REUSE = "V98_IMAGE_CALL_SKIPPED_REUSE_EXISTING";
const V98_CALL_STARTED = "V98_IMAGE_CALL_STARTED";
const V98_CALL_SUCCESS = "V98_IMAGE_CALL_SUCCESS";
const V98_CALL_FAILED = "V98_IMAGE_CALL_FAILED";
const LOCAL_OVERLAY_RENDERED = "CREATIVE_LOCAL_OVERLAY_RENDERED";
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
  `no fake brand logos, no fake packaging text, no invented prices, no fake screenshots, no fake reviews/badges, no medical claims, ${TEXT_FREE_IMAGE_PROMPT_RULE}, photorealistic, clean`;

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
type ImageBufferOutcome = { buffer: Buffer | null; contentType: string; error: string | null };
type EnhancedImageOptions = {
  overlay?: string | null;
  productName?: string | null;
  visualAngle?: string | null;
  sortOrder: number;
};

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

async function fetchImageBuffer(url: string): Promise<ImageBufferOutcome> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return { buffer: null, contentType: "image/png", error: `Fetch image URL failed: HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return { buffer: null, contentType: "image/png", error: "URL did not return an image." };
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType, error: null };
  } catch (err) {
    return { buffer: null, contentType: "image/png", error: err instanceof Error ? err.message.slice(0, 200) : "Fetch image failed." };
  }
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizePromptText(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\uFFFD]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function withTextFreePromptRule(prompt: string): string {
  const base = normalizePromptText(prompt);
  const rule =
    `Hard visual constraints: ${TEXT_FREE_IMAGE_PROMPT_RULE}, no captions, no badges, ` +
    "no sticker text, no price text, no product packaging text; leave clean safe empty space for local overlays; " +
    "uncluttered realistic social commerce image.";
  return `${base} ${rule}`.trim();
}

export function normalizeOverlayText(input: unknown, maxLength: number): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "number" && !Number.isFinite(input)) return "";
  const raw = String(input).trim();
  if (!raw || /^(null|undefined|nan)$/i.test(raw)) return "";
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\uFFFD\uFFFC\u25A1\u25A0\u25AB\u25AD]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^(null|undefined|nan)$/i.test(cleaned)) return "";
  const chars = Array.from(cleaned);
  return chars.length > maxLength ? chars.slice(0, Math.max(0, maxLength)).join("").trim() : cleaned;
}

function slotBadgeText(visualAngle: string | null | undefined, sortOrder: number): string {
  const angle = normalizeOverlayText(visualAngle, 24).toLowerCase();
  if (angle.includes("detail")) return "Chi tiết rõ hơn";
  if (angle.includes("benefit")) return "Lợi ích dễ thấy";
  if (angle.includes("lifestyle")) return "Dùng hằng ngày";
  if (angle.includes("use")) return "Dễ sử dụng";
  const fallback = ["Gợi ý hôm nay", "Tiện hơn mỗi ngày", "Đáng xem", "Chọn nhanh"][Math.max(0, sortOrder - 1) % 4];
  return fallback;
}

function miniStickerText(sortOrder: number): string {
  return ["Hot", "Gọn", "Tiện", "Mới"][Math.max(0, sortOrder - 1) % 4];
}

let textToSvgCache: ReturnType<typeof TextToSVG.loadSync> | null | undefined;

function getTextToSvg(): ReturnType<typeof TextToSVG.loadSync> | null {
  if (textToSvgCache !== undefined) return textToSvgCache;
  try {
    const fontPath = path.join(
      process.cwd(),
      "public",
      "fonts",
      "NotoSans-Bold.ttf",
    );
    textToSvgCache = TextToSVG.loadSync(fontPath);
  } catch {
    textToSvgCache = null;
  }
  return textToSvgCache;
}

function textPath(
  text: string,
  options: { x: number; y: number; size: number; fill: string; anchor?: string },
): string {
  const renderer = getTextToSvg();
  const safe = normalizeOverlayText(text, 80);
  if (!renderer || !safe) return "";
  return renderer.getPath(safe, {
    x: options.x,
    y: options.y,
    fontSize: options.size,
    anchor: options.anchor ?? "left top",
    attributes: { fill: options.fill },
  });
}

function buildEnhancementSvg(input: {
  overlay: string;
  productName: string;
  sortOrder: number;
  visualAngle?: string | null;
}): Buffer {
  const palettes = [
    { accent: "#ef4444", dark: "#111827", soft: "#fff7ed", chip: "#f97316" },
    { accent: "#2563eb", dark: "#0f172a", soft: "#eff6ff", chip: "#0ea5e9" },
    { accent: "#16a34a", dark: "#14532d", soft: "#f0fdf4", chip: "#14b8a6" },
    { accent: "#7c3aed", dark: "#1f2937", soft: "#f5f3ff", chip: "#a855f7" },
  ];
  const p = palettes[(input.sortOrder - 1) % palettes.length];
  const topBadge = normalizeOverlayText(slotBadgeText(input.visualAngle, input.sortOrder), 24);
  const overlay = normalizeOverlayText(input.overlay, 42);
  const product = normalizeOverlayText(input.productName, 34);
  const sticker = normalizeOverlayText(miniStickerText(input.sortOrder), 12);

  const topBadgePath = textPath(topBadge, { x: 226, y: 86, size: 27, fill: "#ffffff", anchor: "center top" });
  const overlayPath = textPath(overlay, { x: 104, y: product ? 762 : 792, size: product ? 44 : 48, fill: p.dark });
  const productPath = textPath(product, { x: 106, y: overlay ? 834 : 806, size: 25, fill: "#475569" });
  const stickerPath = textPath(sticker, { x: 902, y: 82, size: 24, fill: "#ffffff", anchor: "center top" });
  const showTopBadge = Boolean(topBadgePath);
  const showBottomCard = Boolean(overlayPath || productPath);
  const showSticker = Boolean(stickerPath);
  const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#111827" flood-opacity="0.22"/>
    </filter>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.56"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" fill="none"/>
  ${showBottomCard ? '<rect x="0" y="610" width="1024" height="414" fill="url(#fade)"/>' : ""}
  ${showTopBadge ? `
    <g filter="url(#shadow)">
      <rect x="56" y="62" rx="24" ry="24" width="340" height="66" fill="${p.accent}"/>
      ${topBadgePath}
    </g>
  ` : ""}
  ${showSticker ? `
    <g filter="url(#shadow)">
      <circle cx="902" cy="93" r="48" fill="${p.chip}"/>
      <circle cx="902" cy="93" r="56" fill="none" stroke="#ffffff" stroke-width="8" stroke-opacity="0.85"/>
      ${stickerPath}
    </g>
  ` : ""}
  ${showBottomCard ? `
    <g filter="url(#shadow)">
      <rect x="54" y="736" rx="30" ry="30" width="916" height="176" fill="#ffffff" fill-opacity="0.96"/>
      <rect x="54" y="736" rx="30" ry="30" width="16" height="176" fill="${p.accent}"/>
      <circle cx="900" cy="824" r="38" fill="${p.soft}" stroke="${p.accent}" stroke-width="6" stroke-opacity="0.65"/>
      <path d="M880 824 L895 840 L924 806" fill="none" stroke="${p.accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      ${overlayPath}
      ${productPath}
    </g>
  ` : ""}
</svg>`;
  return Buffer.from(svg);
}

async function enhanceImageBuffer(
  buffer: Buffer,
  options: EnhancedImageOptions,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const base = await sharp(buffer)
    .rotate()
    .resize(1024, 1024, { fit: "cover", position: "center", background: "#f8fafc" })
    .png()
    .toBuffer();
  const overlaySvg = buildEnhancementSvg({
    overlay: options.overlay ?? "",
    productName: options.productName ?? "",
    visualAngle: options.visualAngle ?? null,
    sortOrder: options.sortOrder,
  });
  return sharp(base)
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .png({ quality: 92, compressionLevel: 8 })
    .toBuffer();
}

async function createLocalTemplateImage(options: EnhancedImageOptions): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const palettes = ["#eff6ff", "#f8fafc", "#f0fdf4", "#fff7ed"];
  const bg = palettes[Math.max(0, options.sortOrder - 1) % palettes.length];
  const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg}"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="188" cy="178" r="110" fill="#ffffff" fill-opacity="0.72"/>
  <circle cx="848" cy="312" r="142" fill="#ffffff" fill-opacity="0.58"/>
  <rect x="190" y="260" width="640" height="430" rx="44" fill="#ffffff" fill-opacity="0.66"/>
</svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return enhanceImageBuffer(base, options);
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

function imagePromptHash(input: {
  postId: string;
  sortOrder: number;
  prompt: string;
  overlay: string;
  visualAngle?: string | null;
}): string {
  return hashText(
    [
      input.postId,
      input.sortOrder,
      normalizePromptText(input.prompt),
      normalizeOverlayText(input.overlay, 80),
      normalizeOverlayText(input.visualAngle, 40),
      OVERLAY_VERSION,
    ].join("|"),
  );
}

async function findReusableReadyAsset(
  supabase: SupabaseClient,
  postId: string,
  sortOrder: number,
  promptHash: string,
): Promise<string | null> {
  if (!readBoolEnv("CREATIVE_REUSE_EXISTING_ASSETS", true)) return null;
  try {
    const { data } = await supabase
      .from("post_creative_assets")
      .select("image_url, metadata")
      .eq("generated_post_id", postId)
      .eq("sort_order", sortOrder)
      .eq("status", "READY")
      .not("image_url", "is", null)
      .limit(1)
      .maybeSingle();
    const row = data as { image_url?: unknown; metadata?: unknown } | null;
    const url = typeof row?.image_url === "string" ? row.image_url.trim() : "";
    if (!/^https?:\/\//i.test(url)) return null;
    const meta = row?.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    if (meta.local_overlay_version !== OVERLAY_VERSION) return null;
    if (meta.prompt_hash !== promptHash) return null;
    if (meta.mock === true) return null;
    return url;
  } catch {
    return null;
  }
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
      generateImageFromPrompt(withTextFreePromptRule(pr)),
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
    const cleanPrompt = withTextFreePromptRule(p.prompt);
    const r = results[i];
    const overlay = normalizeOverlayText(p.caption_overlay, 42);
    const promptHash = imagePromptHash({
      postId,
      sortOrder: i + 1,
      prompt: cleanPrompt,
      overlay,
      visualAngle: p.visual_angle ?? null,
    });
    let imageUrl: string | null = null;
    if (r.status === "READY") {
      if (r.b64) {
        const composed = await enhanceImageBuffer(Buffer.from(r.b64, "base64"), {
          overlay,
          productName: "",
          visualAngle: p.visual_angle ?? null,
          sortOrder: i + 1,
        });
        const up = await uploadBuffer(supabase, postId, i + 1, composed, "image/png");
        imageUrl = up.url;
        if (!up.url && up.error) {
          errorMessages.push(up.error);
          await insertPostingLog(supabase, postId, STORAGE_UPLOAD_FAILED, "FAILED", up.error, { generated_post_id: postId });
        }
        if (up.url) {
          await insertPostingLog(supabase, postId, LOCAL_OVERLAY_RENDERED, "SUCCESS", `Rendered local overlay for slot ${i + 1}.`, {
            generated_post_id: postId,
            slot_index: i + 1,
            overlay_version: OVERLAY_VERSION,
          });
        }
      } else if (r.url && !r.mock) {
        // Ảnh thật trả về dạng URL (V98/OpenAI) -> compose local overlay rồi re-host. Không lưu raw base image.
        const fetched = await fetchImageBuffer(r.url);
        if (fetched.buffer) {
          const composed = await enhanceImageBuffer(fetched.buffer, {
            overlay,
            productName: "",
            visualAngle: p.visual_angle ?? null,
            sortOrder: i + 1,
          });
          const up = await uploadBuffer(supabase, postId, i + 1, composed, "image/png");
          imageUrl = up.url;
          if (!up.url && up.error) {
            errorMessages.push(up.error);
            await insertPostingLog(supabase, postId, STORAGE_UPLOAD_FAILED, "FAILED", up.error, { generated_post_id: postId });
          }
          if (up.url) {
            await insertPostingLog(supabase, postId, LOCAL_OVERLAY_RENDERED, "SUCCESS", `Rendered local overlay for slot ${i + 1}.`, {
              generated_post_id: postId,
              slot_index: i + 1,
              overlay_version: OVERLAY_VERSION,
            });
          }
        } else {
          errorMessages.push(fetched.error ?? "Fetch generated image failed.");
        }
      } else if (r.url) {
        const composed = await createLocalTemplateImage({
          overlay,
          productName: "",
          visualAngle: p.visual_angle ?? null,
          sortOrder: i + 1,
        });
        const up = await uploadBuffer(supabase, postId, i + 1, composed, "image/png");
        imageUrl = up.url;
        if (!up.url && up.error) errorMessages.push(up.error);
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
      prompt: cleanPrompt,
      caption_overlay: overlay,
      sort_order: i + 1,
      status: ok ? "READY" : "FAILED",
      metadata: {
        visual_angle: p.visual_angle ?? "",
        provider: r.provider,
        model: r.model,
        generated_from: "ONE_STEP_AI_POST",
        mock: r.mock,
        prompt_hash: promptHash,
        local_overlay_version: OVERLAY_VERSION,
        local_overlay_applied: ok && r.mock !== true,
      },
    });
  }

  // 4) Lưu (regenerate-safe: xóa pack cũ trước).
  let persistError: string | null = null;
  try {
    const { error: deleteError } = await supabase.from("post_creative_assets").delete().eq("generated_post_id", postId);
    if (deleteError) throw deleteError;
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("post_creative_assets").insert(rows);
      if (insertError) throw insertError;
    }
  } catch (err) {
    persistError = err instanceof Error ? err.message.slice(0, 200) : "Could not save image assets.";
    errorMessages.push(`Không lưu được asset ảnh: ${persistError}`);
    await insertPostingLog(supabase, postId, STORAGE_UPLOAD_FAILED, "FAILED", `Không lưu được asset ảnh: ${persistError}`, {
      generated_post_id: postId,
    });
  }

  // 5) Tính trạng thái — CHỈ ảnh thật (không mock) mới tính publish-ready.
  const savedRows = persistError ? [] : rows;
  const realReady = savedRows.filter((r) => r.status === "READY" && r.image_url && r.metadata.mock !== true).length;
  const anyReady = savedRows.filter((r) => r.status === "READY" && r.image_url).length;

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
  // Keep AI images text-free, then render every Vietnamese overlay locally for legibility.
  const overlay = normalizeOverlayText(prompt.caption_overlay, 42);
  const cleanPrompt = withTextFreePromptRule(prompt.prompt);
  const promptHash = imagePromptHash({
    postId,
    sortOrder,
    prompt: cleanPrompt,
    overlay,
    visualAngle: prompt.visual_angle ?? null,
  });
  const reusable = await findReusableReadyAsset(supabase, postId, sortOrder, promptHash);
  if (reusable) {
    await insertPostingLog(supabase, postId, V98_CALL_SKIPPED_REUSE, "SUCCESS", `Reused READY creative asset for slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
      prompt_hash: promptHash,
    });
    return { ok: true, mock: false, image_url: reusable, error: null };
  }

  await insertPostingLog(supabase, postId, V98_CALL_STARTED, "SUCCESS", `Starting image provider call for slot ${sortOrder}.`, {
    generated_post_id: postId,
    slot_index: sortOrder,
    prompt_hash: promptHash,
  });
  const r = await generateImageFromPrompt(cleanPrompt);
  if (r.status !== "READY") {
    await insertPostingLog(supabase, postId, V98_CALL_FAILED, "FAILED", r.error ?? `Image provider failed for slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
      prompt_hash: promptHash,
    });
    return { ok: false, mock: false, image_url: null, error: r.error ?? "Image generation failed." };
  }
  let imageUrl: string | null = null;
  let storageErr: string | null = null;
  if (r.b64) {
    let buffer: Buffer<ArrayBufferLike> = Buffer.from(r.b64, "base64");
    buffer = await enhanceImageBuffer(buffer, {
      overlay,
      productName: "",
      visualAngle: prompt.visual_angle ?? null,
      sortOrder,
    });
    const up = await uploadBuffer(supabase, postId, sortOrder, buffer, "image/png");
    imageUrl = up.url;
    storageErr = up.error;
  } else if (r.url && !r.mock) {
    const fetched = await fetchImageBuffer(r.url);
    if (fetched.buffer) {
      const buffer = await enhanceImageBuffer(fetched.buffer, {
        overlay,
        productName: "",
        visualAngle: prompt.visual_angle ?? null,
        sortOrder,
      });
      const up = await uploadBuffer(supabase, postId, sortOrder, buffer, "image/png");
      imageUrl = up.url;
      storageErr = up.error;
    } else {
      storageErr = fetched.error;
    }
  } else if (r.url) {
    const buffer = await createLocalTemplateImage({
      overlay,
      productName: "",
      visualAngle: prompt.visual_angle ?? null,
      sortOrder,
    });
    const up = await uploadBuffer(supabase, postId, sortOrder, buffer, "image/png");
    imageUrl = up.url;
    storageErr = up.error;
  }
  if (!imageUrl) {
    await insertPostingLog(supabase, postId, V98_CALL_FAILED, "FAILED", storageErr ?? "No image URL produced.", {
      generated_post_id: postId,
      slot_index: sortOrder,
      prompt_hash: promptHash,
    });
    return { ok: false, mock: r.mock, image_url: null, error: storageErr ?? "No image URL produced." };
  }
  try {
    await supabase.from("post_creative_assets").delete().eq("generated_post_id", postId).eq("sort_order", sortOrder);
    await supabase.from("post_creative_assets").insert({
      generated_post_id: postId,
      asset_type: "IMAGE",
      source_type: "AI_GENERATED",
      image_url: imageUrl,
      prompt: cleanPrompt,
      caption_overlay: overlay,
      sort_order: sortOrder,
      status: "READY",
      metadata: {
        visual_angle: prompt.visual_angle ?? "",
        provider: r.provider,
        model: r.model,
        generated_from: "AI_JOB",
        mock: r.mock,
        prompt_hash: promptHash,
        local_overlay_version: OVERLAY_VERSION,
        local_overlay_applied: r.mock !== true,
      },
    });
  } catch (err) {
    return { ok: false, mock: r.mock, image_url: null, error: err instanceof Error ? err.message.slice(0, 200) : "Insert asset failed." };
  }
  await insertPostingLog(supabase, postId, V98_CALL_SUCCESS, "SUCCESS", `Image provider call completed for slot ${sortOrder}.`, {
    generated_post_id: postId,
    slot_index: sortOrder,
    prompt_hash: promptHash,
  });
  if (r.mock !== true) {
    await insertPostingLog(supabase, postId, LOCAL_OVERLAY_RENDERED, "SUCCESS", `Rendered local overlay for slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
      overlay_version: OVERLAY_VERSION,
    });
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
  options?: {
    generatedFrom?: string;
    captionOverlay?: string;
    productName?: string | null;
    visualAngle?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; image_url: string | null; error: string | null }> {
  const src = (imageUrl ?? "").trim();
  if (!/^https?:\/\//i.test(src)) return { ok: false, image_url: null, error: "Source image URL không hợp lệ." };
  const overlay = normalizeOverlayText(options?.captionOverlay, 42);
  const productName = normalizeOverlayText(options?.productName, 34);
  const fetched = await fetchImageBuffer(src);
  if (!fetched.buffer) return { ok: false, image_url: null, error: fetched.error ?? "Fetch source image failed." };
  const composed = await enhanceImageBuffer(fetched.buffer, {
    overlay,
    productName,
    visualAngle: options?.visualAngle ?? null,
    sortOrder,
  });
  const up = await uploadBuffer(supabase, postId, sortOrder, composed, "image/png");
  if (!up.url) return { ok: false, image_url: null, error: up.error ?? "Source image upload failed." };
  try {
    await supabase.from("post_creative_assets").insert({
      generated_post_id: postId,
      asset_type: "IMAGE",
      source_type: "PRODUCT",
      image_url: up.url,
      prompt: null,
      caption_overlay: overlay,
      sort_order: sortOrder,
      status: "READY",
      metadata: {
        generated_from: options?.generatedFrom ?? "SHOPEE_SOURCE",
        mock: false,
        rehosted: true,
        origin: src,
        enhanced: true,
        visual_angle: options?.visualAngle ?? "",
        local_overlay_version: OVERLAY_VERSION,
        local_overlay_applied: true,
        ...(options?.metadata ?? {}),
      },
    });
  } catch (err) {
    return { ok: false, image_url: null, error: err instanceof Error ? err.message.slice(0, 200) : "Insert source asset failed." };
  }
  await insertPostingLog(supabase, postId, LOCAL_OVERLAY_RENDERED, "SUCCESS", `Rendered local overlay for source slot ${sortOrder}.`, {
    generated_post_id: postId,
    slot_index: sortOrder,
    overlay_version: OVERLAY_VERSION,
  });
  return { ok: true, image_url: up.url, error: null };
}

export async function enhanceAndStoreSourceProductImage(
  supabase: SupabaseClient,
  postId: string,
  sortOrder: number,
  imageUrl: string,
  options: {
    overlay?: string | null;
    productName?: string | null;
    visualAngle?: string | null;
    generatedFrom?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<{ ok: boolean; image_url: string | null; error: string | null }> {
  const src = (imageUrl ?? "").trim();
  if (!/^https?:\/\//i.test(src)) return { ok: false, image_url: null, error: "Source image URL khong hop le." };
  try {
    const fetched = await fetchImageBuffer(src);
    if (!fetched.buffer) return { ok: false, image_url: null, error: fetched.error };
    const sharp = (await import("sharp")).default;
    const base = await sharp(fetched.buffer)
      .rotate()
      .resize(1024, 1024, { fit: "contain", background: "#f8fafc" })
      .png()
      .toBuffer();
    const overlaySvg = buildEnhancementSvg({
      overlay: normalizeOverlayText(options.overlay, 42),
      productName: normalizeOverlayText(options.productName, 34),
      visualAngle: options.visualAngle ?? null,
      sortOrder,
    });
    const enhanced = await sharp(base)
      .composite([{ input: overlaySvg, top: 0, left: 0 }])
      .png({ quality: 92, compressionLevel: 8 })
      .toBuffer();
    const up = await uploadBuffer(supabase, postId, sortOrder, enhanced, "image/png");
    if (!up.url) return { ok: false, image_url: null, error: up.error ?? "Enhanced image upload failed." };
    await supabase.from("post_creative_assets").insert({
      generated_post_id: postId,
      asset_type: "IMAGE",
      source_type: "PRODUCT",
      image_url: up.url,
      prompt: null,
      caption_overlay: normalizeOverlayText(options.overlay, 42),
      sort_order: sortOrder,
      status: "READY",
      metadata: {
        generated_from: options.generatedFrom ?? "SHOPEE_SOURCE_ENHANCED",
        mock: false,
        rehosted: true,
        origin: src,
        enhanced: true,
        visual_angle: options.visualAngle ?? "",
        local_overlay_version: OVERLAY_VERSION,
        local_overlay_applied: true,
        ...(options.metadata ?? {}),
      },
    });
    await insertPostingLog(supabase, postId, LOCAL_OVERLAY_RENDERED, "SUCCESS", `Rendered local overlay for source slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
      overlay_version: OVERLAY_VERSION,
    });
    return { ok: true, image_url: up.url, error: null };
  } catch (err) {
    return {
      ok: false,
      image_url: null,
      error: err instanceof Error ? err.message.slice(0, 200) : "Enhance source image failed.",
    };
  }
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
