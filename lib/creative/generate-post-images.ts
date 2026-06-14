import "server-only";

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAIProvider, resolveProviderConfig } from "@/lib/ai/client";
import {
  generateImageFromPrompt,
  generateImageFromReference,
  getImageProvider,
  getImageProviderConfig,
  type ImageGenerationContext,
  type PromptImageResult,
} from "@/lib/creative/image-provider";
import { canSpendV98 } from "@/lib/cost/cost-guardrails";
import { insertPostingLog } from "@/lib/posts/log";
import type { CreativePackStatus, PublishMode } from "@/lib/types";

const MIN_ASSETS = 4;
// Bucket Storage cho ảnh (HOTFIX 17.2.3: mặc định post-creatives). Có thể override bằng CREATIVE_BUCKET.
const CREATIVE_BUCKET = process.env.CREATIVE_BUCKET?.trim() || "post-creatives";
const OVERLAY_VERSION = "slim-vietnamese-safe-v3";
export const TEXT_FREE_IMAGE_PROMPT_RULE = "no text, no letters, no words, no watermark, no logo, no UI text";
export type CreativeTemplatePreset = "CLEAN" | "DEAL" | "LIFESTYLE";
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
const V98_CALL_SKIPPED_SOURCE_VARIANT = "V98_IMAGE_CALL_SKIPPED_SOURCE_VARIANT";
const V98_CALL_STARTED = "V98_IMAGE_CALL_STARTED";
const V98_CALL_SUCCESS = "V98_IMAGE_CALL_SUCCESS";
const V98_CALL_FAILED = "V98_IMAGE_CALL_FAILED";
const LOCAL_OVERLAY_RENDERED = "CREATIVE_LOCAL_OVERLAY_RENDERED";
const OVERLAY_SKIPPED_EMPTY_TEXT = "CREATIVE_OVERLAY_SKIPPED_EMPTY_TEXT";
const TEMPLATE_SELECTED = "CREATIVE_TEMPLATE_SELECTED";
const PACK_SCORE_COMPUTED = "CREATIVE_PACK_SCORE_COMPUTED";
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
  template?: CreativeTemplatePreset;
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

function readCreativeTemplatePreset(): CreativeTemplatePreset | null {
  const raw = process.env.CREATIVE_TEMPLATE_PRESET?.trim().toUpperCase();
  if (raw === "CLEAN" || raw === "DEAL" || raw === "LIFESTYLE") return raw;
  return null;
}

export function selectCreativeTemplate(postId: string): CreativeTemplatePreset {
  const configured = readCreativeTemplatePreset();
  if (configured) return configured;
  const presets: CreativeTemplatePreset[] = ["CLEAN", "DEAL", "LIFESTYLE"];
  const n = Number.parseInt(hashText(postId).slice(0, 2), 16);
  return presets[n % presets.length];
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

function splitOverlayLines(text: string, maxLineLength = 24, maxLines = 2): string[] {
  const words = normalizeOverlayText(text, maxLineLength * maxLines + 4).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (Array.from(next).length <= maxLineLength) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines).map((line, idx) => {
    if (idx < maxLines - 1) return line;
    const chars = Array.from(line);
    return chars.length > maxLineLength ? `${chars.slice(0, maxLineLength - 1).join("").trim()}…` : line;
  });
}

function estimateCardWidth(lines: string[]): number {
  const longest = Math.max(...lines.map((line) => Array.from(line).length), 0);
  return Math.min(760, Math.max(310, longest * 24 + 112));
}

function estimateOverlayCardHeightRatio(overlay: unknown): number {
  const lines = splitOverlayLines(normalizeOverlayText(overlay, 36), 24, 2);
  if (lines.length === 0) return 0;
  return (lines.length >= 2 ? 126 : 82) / 1024;
}

export function computeAssetQualityScore(input: {
  imageUrl?: string | null;
  overlay?: string | null;
  mock?: boolean;
  localOverlayApplied?: boolean;
  cardHeightRatio?: number;
}): number {
  let score = 45;
  if (input.imageUrl && /^https?:\/\//i.test(input.imageUrl)) score += 20;
  if (normalizeOverlayText(input.overlay, 40)) score += 14;
  if (input.localOverlayApplied) score += 12;
  if ((input.cardHeightRatio ?? 0) <= 0.22) score += 7;
  if (input.mock) score -= 20;
  if ((input.cardHeightRatio ?? 0) > 0.22) score -= 18;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computePackQualityScore(
  assets: Array<{ image_url?: string | null; source_type?: string | null; metadata?: unknown; status?: string | null }>,
): number {
  const real = assets.filter((asset) => {
    const meta = asset.metadata && typeof asset.metadata === "object" ? (asset.metadata as Record<string, unknown>) : {};
    return asset.status === "READY" && !!asset.image_url && meta.mock !== true;
  });
  const scores = real.map((asset) => {
    const meta = asset.metadata && typeof asset.metadata === "object" ? (asset.metadata as Record<string, unknown>) : {};
    return typeof meta.asset_quality_score === "number" ? meta.asset_quality_score : 70;
  });
  const average = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const v98Calls = real.filter((asset) => asset.source_type === "AI_GENERATED").length;
  const readyBonus = real.length >= 4 ? 8 : 0;
  const costBonus = v98Calls <= 2 ? 6 : -8;
  return Math.max(0, Math.min(100, Math.round(average + readyBonus + costBonus)));
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
  template?: CreativeTemplatePreset;
}): Buffer {
  const template = input.template ?? "CLEAN";
  const paletteByTemplate: Record<CreativeTemplatePreset, { accent: string; dark: string; soft: string; chip: string; cardOpacity: number }> = {
    CLEAN: { accent: "#2563eb", dark: "#0f172a", soft: "#eff6ff", chip: "#0ea5e9", cardOpacity: 0.9 },
    DEAL: { accent: "#ef4444", dark: "#111827", soft: "#fff7ed", chip: "#f97316", cardOpacity: 0.92 },
    LIFESTYLE: { accent: "#16a34a", dark: "#14532d", soft: "#f0fdf4", chip: "#14b8a6", cardOpacity: 0.88 },
  };
  const p = paletteByTemplate[template];
  const topBadge = normalizeOverlayText(slotBadgeText(input.visualAngle, input.sortOrder), 22);
  const overlay = normalizeOverlayText(input.overlay, 36);
  const sticker = normalizeOverlayText(miniStickerText(input.sortOrder), 10);
  const overlayLines = splitOverlayLines(overlay, 24, 2);
  const longestBottom = estimateCardWidth(overlayLines);
  const cardW = longestBottom;
  const cardH = overlayLines.length >= 2 ? 126 : overlayLines.length === 1 ? 82 : 0;
  const cardX = overlayLines.length > 0 ? (input.sortOrder % 2 === 0 ? 1024 - cardW - 58 : 58) : 0;
  const cardY = 1024 - cardH - 54;
  const stripeH = Math.max(0, cardH - 24);

  const topBadgePath = textPath(topBadge, { x: 180, y: 78, size: 24, fill: "#ffffff", anchor: "center top" });
  const overlayPathA = textPath(overlayLines[0] ?? "", { x: cardX + 52, y: cardY + 24, size: 35, fill: p.dark });
  const overlayPathB = textPath(overlayLines[1] ?? "", { x: cardX + 52, y: cardY + 70, size: 31, fill: p.dark });
  const stickerPath = textPath(sticker, { x: 898, y: 82, size: 22, fill: "#ffffff", anchor: "center top" });
  const showTopBadge = Boolean(topBadgePath);
  const showBottomCard = Boolean(overlayPathA || overlayPathB);
  const showSticker = Boolean(stickerPath);
  const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#111827" flood-opacity="0.22"/>
    </filter>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.28"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" fill="none"/>
  ${showBottomCard ? '<rect x="0" y="760" width="1024" height="264" fill="url(#fade)"/>' : ""}
  ${showTopBadge ? `
    <g filter="url(#shadow)">
      <rect x="56" y="58" rx="22" ry="22" width="248" height="58" fill="${p.accent}" fill-opacity="0.94"/>
      ${topBadgePath}
    </g>
  ` : ""}
  ${showSticker ? `
    <g filter="url(#shadow)">
      <circle cx="898" cy="90" r="42" fill="${p.chip}" fill-opacity="0.95"/>
      <circle cx="898" cy="90" r="49" fill="none" stroke="#ffffff" stroke-width="6" stroke-opacity="0.78"/>
      ${stickerPath}
    </g>
  ` : ""}
  ${showBottomCard ? `
    <g filter="url(#shadow)">
      <rect x="${cardX}" y="${cardY}" rx="24" ry="24" width="${cardW}" height="${cardH}" fill="#ffffff" fill-opacity="${p.cardOpacity}"/>
      <rect x="${cardX + 18}" y="${cardY + 12}" rx="7" ry="7" width="10" height="${stripeH}" fill="${p.accent}" fill-opacity="0.96"/>
      <circle cx="${cardX + cardW - 44}" cy="${cardY + Math.floor(cardH / 2)}" r="24" fill="${p.soft}" stroke="${p.accent}" stroke-width="4" stroke-opacity="0.62"/>
      <path d="M${cardX + cardW - 57} ${cardY + Math.floor(cardH / 2)} L${cardX + cardW - 47} ${cardY + Math.floor(cardH / 2) + 10} L${cardX + cardW - 31} ${cardY + Math.floor(cardH / 2) - 12}" fill="none" stroke="${p.accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      ${overlayPathA}
      ${overlayPathB}
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
    template: options.template,
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
  options: { context?: ImageGenerationContext } = {},
): Promise<GeneratePackResult> {
  // Context creative (mặc định creative_worker) để qua được guard chống trừ tiền ngoài creative.
  const imageContext: ImageGenerationContext = options.context ?? {
    source: "creative_worker",
    job_type: "CREATE_AI_POST_WITH_IMAGES",
    job_step: "MATERIALIZE_IMAGES",
  };
  const provider = getImageProvider();
  const prompts = promptsIn.slice(0, MIN_ASSETS);
  const errorMessages: string[] = [];
  const creativeTemplate = selectCreativeTemplate(postId);

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
  await insertPostingLog(supabase, postId, TEMPLATE_SELECTED, "SUCCESS", `Creative template: ${creativeTemplate}.`, {
    generated_post_id: postId,
    creative_template: creativeTemplate,
  });

  // Per-image timeout 30s, song song; backstop tổng 75s.
  const genOne = (pr: string): Promise<PromptImageResult> =>
    Promise.race([
      generateImageFromPrompt(withTextFreePromptRule(pr), imageContext),
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
    const cardHeightRatio = estimateOverlayCardHeightRatio(overlay);
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
          template: creativeTemplate,
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
            template: creativeTemplate,
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
          template: creativeTemplate,
        });
        const up = await uploadBuffer(supabase, postId, i + 1, composed, "image/png");
        imageUrl = up.url;
        if (!up.url && up.error) errorMessages.push(up.error);
      }
    } else if (r.error) {
      errorMessages.push(r.error);
    }
    const ok = !!imageUrl;
    if (!overlay) {
      await insertPostingLog(supabase, postId, OVERLAY_SKIPPED_EMPTY_TEXT, "SUCCESS", `Skipped empty overlay for slot ${i + 1}.`, {
        generated_post_id: postId,
        slot_index: i + 1,
      });
    }
    const assetQualityScore = computeAssetQualityScore({
      imageUrl,
      overlay,
      mock: r.mock,
      localOverlayApplied: ok && r.mock !== true,
      cardHeightRatio,
    });
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
        creative_template: creativeTemplate,
        card_height_ratio: cardHeightRatio,
        asset_quality_score: assetQualityScore,
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
  const packScore = computePackQualityScore(savedRows.map((r) => ({
    image_url: r.image_url,
    source_type: r.source_type,
    status: r.status,
    metadata: r.metadata,
  })));
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
    creativeError = "Chỉ có ảnh mock — chưa đủ ảnh thật để đăng album. Đặt IMAGE_PROVIDER=v98 + V98_IMAGE_MODEL=<model V98 hợp lệ> (xem /api/debug/v98-models).";
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
  await insertPostingLog(supabase, postId, PACK_SCORE_COMPUTED, status === "READY" ? "SUCCESS" : "FAILED", `Creative pack score: ${packScore}.`, {
    generated_post_id: postId,
    creative_template: creativeTemplate,
    creative_pack_score: packScore,
  });

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
  options: { force?: boolean; campaignRunId?: string | null; context?: ImageGenerationContext; referenceImageUrl?: string | null } = {},
): Promise<{ ok: boolean; mock: boolean; image_url: string | null; error: string | null; blockedByBudget?: boolean }> {
  // Context creative (mặc định creative_worker) — guard chống trừ tiền ngoài creative worker.
  const imageContext: ImageGenerationContext = options.context ?? {
    source: "creative_worker",
    job_type: "CREATE_AI_POST_WITH_IMAGES",
    job_step: `AI_IMAGE_${sortOrder}`,
  };
  // Keep AI images text-free, then render every Vietnamese overlay locally for legibility.
  const overlay = normalizeOverlayText(prompt.caption_overlay, 42);
  const cleanPrompt = withTextFreePromptRule(prompt.prompt);
  const creativeTemplate = selectCreativeTemplate(postId);
  const cardHeightRatio = estimateOverlayCardHeightRatio(overlay);
  const promptHash = imagePromptHash({
    postId,
    sortOrder,
    prompt: cleanPrompt,
    overlay,
    visualAngle: prompt.visual_angle ?? null,
  });
  const reusable = options.force ? null : await findReusableReadyAsset(supabase, postId, sortOrder, promptHash);
  if (reusable) {
    await insertPostingLog(supabase, postId, V98_CALL_SKIPPED_REUSE, "SUCCESS", `Reused READY creative asset for slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
      prompt_hash: promptHash,
    });
    return { ok: true, mock: false, image_url: reusable, error: null };
  }

  // V98 cost guardrail (per-campaign/day + global/day). Source images không qua đây.
  const budget = await canSpendV98(supabase, options.campaignRunId ?? null);
  if (!budget.allowed) {
    await insertPostingLog(supabase, postId, "V98_CALL_BLOCKED_BY_BUDGET", "FAILED", budget.reason ?? "Đã đạt giới hạn V98.", {
      generated_post_id: postId,
      slot_index: sortOrder,
      v98_global_today: budget.global,
      v98_campaign_today: budget.campaign,
    });
    return { ok: false, mock: false, image_url: null, error: budget.reason ?? "Đã đạt giới hạn V98 hôm nay.", blockedByBudget: true };
  }

  await insertPostingLog(supabase, postId, TEMPLATE_SELECTED, "SUCCESS", `Creative template: ${creativeTemplate}.`, {
    generated_post_id: postId,
    slot_index: sortOrder,
    creative_template: creativeTemplate,
  });
  await insertPostingLog(supabase, postId, V98_CALL_STARTED, "SUCCESS", `Starting image provider call for slot ${sortOrder}.`, {
    generated_post_id: postId,
    slot_index: sortOrder,
    prompt_hash: promptHash,
  });
  // IMG2IMG: nếu bật + có ảnh tham chiếu thật -> AI vẽ DỰA trên ảnh gốc (giữ đúng sản phẩm).
  // Lỗi/không hỗ trợ -> fallback text-to-image. Vẫn chỉ tốn đúng 1 lượt ảnh/bài.
  let r: PromptImageResult;
  const useImg2Img = readBoolEnv("CREATIVE_HERO_IMG2IMG", true) && !!options.referenceImageUrl;
  if (useImg2Img) {
    const ref = await fetchImageBuffer(options.referenceImageUrl as string);
    if (ref.buffer) {
      r = await generateImageFromReference(cleanPrompt, ref.buffer, ref.contentType, imageContext);
      if (r.status !== "READY") {
        await insertPostingLog(supabase, postId, "IMG2IMG_FALLBACK_TEXT2IMG", "FAILED", `img2img lỗi (${r.error ?? "?"}), chuyển text-to-image.`, {
          generated_post_id: postId,
          slot_index: sortOrder,
        });
        r = await generateImageFromPrompt(cleanPrompt, imageContext);
      } else {
        await insertPostingLog(supabase, postId, "IMG2IMG_USED_REFERENCE", "SUCCESS", `Sinh ảnh AI dựa trên ảnh thật sản phẩm (slot ${sortOrder}).`, {
          generated_post_id: postId,
          slot_index: sortOrder,
        });
      }
    } else {
      r = await generateImageFromPrompt(cleanPrompt, imageContext);
    }
  } else {
    r = await generateImageFromPrompt(cleanPrompt, imageContext);
  }
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
      template: creativeTemplate,
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
        template: creativeTemplate,
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
      template: creativeTemplate,
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
  if (!overlay) {
    await insertPostingLog(supabase, postId, OVERLAY_SKIPPED_EMPTY_TEXT, "SUCCESS", `Skipped empty overlay for slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
    });
  }
  const assetQualityScore = computeAssetQualityScore({
    imageUrl,
    overlay,
    mock: r.mock,
    localOverlayApplied: r.mock !== true,
    cardHeightRatio,
  });
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
        creative_template: creativeTemplate,
        card_height_ratio: cardHeightRatio,
        asset_quality_score: assetQualityScore,
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
  const creativeTemplate = selectCreativeTemplate(postId);
  const cardHeightRatio = estimateOverlayCardHeightRatio(overlay);
  const fetched = await fetchImageBuffer(src);
  if (!fetched.buffer) return { ok: false, image_url: null, error: fetched.error ?? "Fetch source image failed." };
  const composed = await enhanceImageBuffer(fetched.buffer, {
    overlay,
    productName,
    visualAngle: options?.visualAngle ?? null,
    sortOrder,
    template: creativeTemplate,
  });
  const up = await uploadBuffer(supabase, postId, sortOrder, composed, "image/png");
  if (!up.url) return { ok: false, image_url: null, error: up.error ?? "Source image upload failed." };
  if (!overlay) {
    await insertPostingLog(supabase, postId, OVERLAY_SKIPPED_EMPTY_TEXT, "SUCCESS", `Skipped empty overlay for source slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
    });
  }
  try {
    const assetQualityScore = computeAssetQualityScore({
      imageUrl: up.url,
      overlay,
      mock: false,
      localOverlayApplied: true,
      cardHeightRatio,
    });
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
        creative_template: creativeTemplate,
        card_height_ratio: cardHeightRatio,
        asset_quality_score: assetQualityScore,
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
  await insertPostingLog(supabase, postId, V98_CALL_SKIPPED_SOURCE_VARIANT, "SUCCESS", `Used local source variant for slot ${sortOrder}; no V98 call.`, {
    generated_post_id: postId,
    slot_index: sortOrder,
    creative_template: creativeTemplate,
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
    /** >0 = ảnh thật bị dùng lại -> cắt/zoom khác để 2 slot không trùng y hệt. */
    variant?: number;
  } = {},
): Promise<{ ok: boolean; image_url: string | null; error: string | null }> {
  const src = (imageUrl ?? "").trim();
  if (!/^https?:\/\//i.test(src)) return { ok: false, image_url: null, error: "Source image URL khong hop le." };
  try {
    const overlay = normalizeOverlayText(options.overlay, 42);
    const productName = normalizeOverlayText(options.productName, 34);
    const creativeTemplate = selectCreativeTemplate(postId);
    const cardHeightRatio = estimateOverlayCardHeightRatio(overlay);
    const fetched = await fetchImageBuffer(src);
    if (!fetched.buffer) return { ok: false, image_url: null, error: fetched.error };
    const sharp = (await import("sharp")).default;
    // variant>0: ảnh thật bị dùng lại -> cắt theo vị trí khác (cover) để KHÔNG trùng y hệt slot trước.
    const variant = options.variant ?? 0;
    const cropPositions = ["centre", "top", "bottom", "left", "right"] as const;
    const resizeOpts =
      variant > 0
        ? { fit: "cover" as const, position: cropPositions[variant % cropPositions.length] }
        : { fit: "contain" as const, background: "#f8fafc" };
    const base = await sharp(fetched.buffer).rotate().resize(1024, 1024, resizeOpts).png().toBuffer();
    const overlaySvg = buildEnhancementSvg({
      overlay,
      productName,
      visualAngle: options.visualAngle ?? null,
      sortOrder,
      template: creativeTemplate,
    });
    const enhanced = await sharp(base)
      .composite([{ input: overlaySvg, top: 0, left: 0 }])
      .png({ quality: 92, compressionLevel: 8 })
      .toBuffer();
    const up = await uploadBuffer(supabase, postId, sortOrder, enhanced, "image/png");
    if (!up.url) return { ok: false, image_url: null, error: up.error ?? "Enhanced image upload failed." };
    if (!overlay) {
      await insertPostingLog(supabase, postId, OVERLAY_SKIPPED_EMPTY_TEXT, "SUCCESS", `Skipped empty overlay for source slot ${sortOrder}.`, {
        generated_post_id: postId,
        slot_index: sortOrder,
      });
    }
    const assetQualityScore = computeAssetQualityScore({
      imageUrl: up.url,
      overlay,
      mock: false,
      localOverlayApplied: true,
      cardHeightRatio,
    });
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
        generated_from: options.generatedFrom ?? "SHOPEE_SOURCE_ENHANCED",
        mock: false,
        rehosted: true,
        origin: src,
        enhanced: true,
        visual_angle: options.visualAngle ?? "",
        local_overlay_version: OVERLAY_VERSION,
        local_overlay_applied: true,
        creative_template: creativeTemplate,
        card_height_ratio: cardHeightRatio,
        asset_quality_score: assetQualityScore,
        ...(options.metadata ?? {}),
      },
    });
    await insertPostingLog(supabase, postId, LOCAL_OVERLAY_RENDERED, "SUCCESS", `Rendered local overlay for source slot ${sortOrder}.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
      overlay_version: OVERLAY_VERSION,
    });
    await insertPostingLog(supabase, postId, V98_CALL_SKIPPED_SOURCE_VARIANT, "SUCCESS", `Used local source variant for slot ${sortOrder}; no V98 call.`, {
      generated_post_id: postId,
      slot_index: sortOrder,
      creative_template: creativeTemplate,
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
