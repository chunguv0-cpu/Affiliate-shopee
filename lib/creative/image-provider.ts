import "server-only";

import OpenAI from "openai";

import { logImageApiUsage } from "@/lib/cost/api-usage-log";

/**
 * Phase 17 V2 — lớp sinh ảnh creative (pluggable).
 * Provider: mock (mặc định) | openai | none.
 * KHÔNG bao giờ throw — lỗi trả mảng rỗng để không làm hỏng việc tạo bài.
 */

export type ImageProvider = "mock" | "openai" | "v98" | "grok_gateway" | "none";
const TEXT_FREE_IMAGE_PROMPT_RULE = "no text, no letters, no words, no watermark, no logo, no UI text";
const V98_TIMEOUT_ERROR = "V98_IMAGE_TIMEOUT_RETRY_LATER";

// ===========================================================================
// HOTFIX — Chặn cứng: API ảnh (đặc biệt V98 Image Key) CHỈ được gọi trong
// creative worker. Quét/import/validate sản phẩm KHÔNG bao giờ được trừ tiền ảnh.
// Dù sau này có code gọi nhầm generateImageFromPrompt mà thiếu context hợp lệ,
// provider trả tiền (v98/openai/grok) cũng KHÔNG được gọi.
// ===========================================================================

export const IMAGE_BLOCKED_ERROR_CODE = "IMAGE_PROVIDER_BLOCKED_OUTSIDE_CREATIVE_WORKER";

/** Ngữ cảnh gọi sinh ảnh — bắt buộc để gọi provider trả tiền. */
export type ImageGenerationContext = {
  source: string;            // vd creative_worker | creative_regenerate | creative_manual | autopilot_creative
  job_type?: string | null;  // vd CREATE_AI_POST_WITH_IMAGES
  job_step?: string | null;  // vd AI_HERO_IMAGE | IMAGE_1 | IMAGE_2 | IMAGE_3
};

/** Context BỊ CHẶN tuyệt đối (quét/import/validate sản phẩm...). */
const BLOCKED_IMAGE_SOURCES = new Set([
  "product_scan",
  "shopee_api_test",
  "import_links",
  "validate_product",
  "source_image_fetch",
  "campaign_sourcing",
  "affiliate_conversion",
  "product_creation",
  "post_creation",
  "manual_product_scan",
]);

/** Context ĐƯỢC PHÉP gọi provider trả tiền (sinh ảnh creative). */
const ALLOWED_IMAGE_SOURCES = new Set([
  "creative_worker",     // ai-job-runner: AI_HERO_IMAGE / IMAGE_1..3
  "creative_regenerate", // tạo lại ảnh ở màn Bài đăng
  "creative_manual",     // tạo bài 1-bước thủ công
  "autopilot_creative",  // autopilot dựng creative pack
]);

function readBoolEnvImg(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export type ImageGuardDecision = { allowed: boolean; reason: string | null; code: string | null };

/**
 * Quyết định có cho phép gọi provider ảnh trả tiền với context này không.
 * - IMAGE_GENERATION_ENABLED=false  -> chặn tất cả.
 * - thiếu context / source bị chặn  -> chặn.
 * - IMAGE_GENERATION_ALLOWED_ONLY_IN_CREATIVE_WORKER=true (mặc định) -> chỉ allow source creative.
 */
export function checkImageGenerationContext(ctx?: ImageGenerationContext | null): ImageGuardDecision {
  if (!readBoolEnvImg("IMAGE_GENERATION_ENABLED", true)) {
    return { allowed: false, reason: "Sinh ảnh đang tắt (IMAGE_GENERATION_ENABLED=false).", code: "IMAGE_GENERATION_DISABLED" };
  }
  const source = ctx?.source?.trim().toLowerCase() ?? "";
  if (!source) {
    return { allowed: false, reason: "Thiếu context sinh ảnh — chặn để không trừ tiền API ảnh.", code: IMAGE_BLOCKED_ERROR_CODE };
  }
  if (BLOCKED_IMAGE_SOURCES.has(source)) {
    return { allowed: false, reason: `Context '${source}' không được phép gọi API ảnh.`, code: IMAGE_BLOCKED_ERROR_CODE };
  }
  const strict = readBoolEnvImg("IMAGE_GENERATION_ALLOWED_ONLY_IN_CREATIVE_WORKER", true);
  if (strict && !ALLOWED_IMAGE_SOURCES.has(source)) {
    return { allowed: false, reason: `Context '${source}' nằm ngoài creative worker — chặn API ảnh.`, code: IMAGE_BLOCKED_ERROR_CODE };
  }
  return { allowed: true, reason: null, code: null };
}

/** Provider có tính tiền hay không (cần guard). mock/none miễn phí. */
function isPaidImageProvider(provider: ImageProvider): boolean {
  return provider === "v98" || provider === "openai" || provider === "grok_gateway";
}

/** key_type cho log (V98 Image Key = image). */
function usageKeyType(provider: ImageProvider): string {
  return provider === "v98" || provider === "openai" || provider === "grok_gateway" ? "image" : provider;
}

/** Tên provider hiển thị trong log usage. */
function usageProviderName(provider: ImageProvider): string {
  return provider === "v98" ? "v98_image" : provider;
}

export type GenerateImageInput = {
  product_name: string;
  target_customer?: string | null;
  content_angle?: string | null;
  hook?: string | null;
  caption_summary?: string | null;
  category?: string | null;
  product_image_ref?: string | null;
};

export type GeneratedImage = {
  image_url: string | null;
  prompt: string;
  caption_overlay: string;
  source_type: "AI_GENERATED";
  status: "READY" | "FAILED";
  /** Ảnh placeholder/mock — KHÔNG được dùng đăng production. */
  mock: boolean;
};

export function getImageProvider(): ImageProvider {
  const raw = process.env.IMAGE_PROVIDER?.trim().toLowerCase();
  if (raw === "grok_gateway" || raw === "openai" || raw === "v98" || raw === "none" || raw === "mock") return raw;
  // Mặc định: ưu tiên V98 (key ảnh riêng hoặc key chung), rồi OpenAI, cuối cùng mock.
  const v98ImgKey = process.env.V98_IMAGE_API_KEY?.trim() || process.env.V98_API_KEY?.trim();
  const v98ImgBase = process.env.V98_IMAGE_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim();
  if (v98ImgKey && v98ImgBase) return "v98";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return "mock";
}

/** Provider fallback khi grok_gateway lỗi/hết hạn cookie: v98 | openai | mock | none. */
function grokGatewayFallback(): ImageProvider {
  const raw = process.env.GROK_GATEWAY_FALLBACK?.trim().toLowerCase();
  if (raw === "v98" || raw === "openai" || raw === "mock" || raw === "none") return raw;
  // Mặc định fallback về V98 nếu có cấu hình, không thì mock.
  if (process.env.V98_API_KEY?.trim() && process.env.V98_BASE_URL?.trim()) return "v98";
  return "mock";
}

/**
 * Gọi Grok image worker (chạy ngoài Vercel — Playwright + cookie tài khoản Grok).
 * Hợp đồng: POST {GROK_GATEWAY_URL}/generate, Bearer GROK_GATEWAY_SECRET,
 * body { prompt, size } -> { b64 } | { url } | { image_url } | { error }.
 * KHÔNG bao giờ throw. KHÔNG log token/cookie.
 */
async function callGrokGateway(prompt: string): Promise<PromptImageResult> {
  const base = process.env.GROK_GATEWAY_URL?.trim();
  const secret = process.env.GROK_GATEWAY_SECRET?.trim();
  const model = process.env.GROK_GATEWAY_MODEL?.trim() || "grok-image";
  if (!base) {
    return { b64: null, url: null, mock: false, provider: "grok_gateway", model: null, status: "FAILED", error: "Thiếu GROK_GATEWAY_URL." };
  }
  const endpoint = base.replace(/\/$/, "").endsWith("/generate") ? base.replace(/\/$/, "") : `${base.replace(/\/$/, "")}/generate`;
  const timeoutMs = readIntEnv("GROK_GATEWAY_TIMEOUT_MS", 50_000, 5_000, 110_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ prompt, size: "1024x1024" }),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const msg = typeof json.error === "string" ? json.error : `Grok gateway HTTP ${res.status}`;
      return { b64: null, url: null, mock: false, provider: "grok_gateway", model, status: "FAILED", error: msg.slice(0, 300) };
    }
    const b64 = typeof json.b64 === "string" ? json.b64 : typeof json.b64_json === "string" ? json.b64_json : null;
    const url = typeof json.url === "string" ? json.url : typeof json.image_url === "string" ? json.image_url : null;
    if (b64) return { b64, url: null, mock: false, provider: "grok_gateway", model, status: "READY" };
    if (url && /^https?:\/\//i.test(url)) return { b64: null, url, mock: false, provider: "grok_gateway", model, status: "READY" };
    const err = typeof json.error === "string" ? json.error : "Grok gateway không trả về ảnh.";
    return { b64: null, url: null, mock: false, provider: "grok_gateway", model, status: "FAILED", error: err.slice(0, 300) };
  } catch (err) {
    const m = err instanceof Error ? (err.name === "AbortError" ? "Grok gateway quá thời gian." : err.message) : "Grok gateway lỗi.";
    return { b64: null, url: null, mock: false, provider: "grok_gateway", model, status: "FAILED", error: m.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/** Kết quả sinh 1 ảnh từ prompt cụ thể (Phase 17 — fully AI). */
export type PromptImageResult = {
  b64: string | null; // ảnh thật (base64 png) -> upload storage
  url: string | null; // mock placeholder hoặc URL ảnh thật từ provider
  mock: boolean;
  provider: ImageProvider;
  model: string | null;
  status: "READY" | "FAILED";
  error?: string | null;
};

/** Chẩn đoán cấu hình provider ảnh (an toàn — KHÔNG lộ API key). */
export type ImageProviderConfig = {
  provider: ImageProvider;
  hasV98Key: boolean;
  v98BaseUrl: string | null;
  imageModel: string | null;
  isConfigured: boolean;
  errors: string[];
};

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function getImageProviderConfig(): ImageProviderConfig {
  const provider = getImageProvider();
  const hasV98Key = !!(process.env.V98_IMAGE_API_KEY?.trim() || process.env.V98_API_KEY?.trim());
  const v98BaseUrl = process.env.V98_IMAGE_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim() || null;
  const errors: string[] = [];
  let imageModel: string | null = null;

  if (provider === "v98") {
    imageModel = process.env.V98_IMAGE_MODEL?.trim() || "gpt-image-2";
    if (!hasV98Key) errors.push("V98_API_KEY is missing.");
    if (!v98BaseUrl) errors.push("V98_BASE_URL is missing.");
  } else if (provider === "grok_gateway") {
    imageModel = process.env.GROK_GATEWAY_MODEL?.trim() || "grok-image";
    if (!process.env.GROK_GATEWAY_URL?.trim()) errors.push("GROK_GATEWAY_URL is missing.");
  } else if (provider === "openai") {
    imageModel = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
    if (!process.env.OPENAI_API_KEY?.trim()) errors.push("OPENAI_API_KEY is missing.");
  } else if (provider === "mock") {
    imageModel = "mock";
  }

  const isConfigured = provider !== "none" && errors.length === 0;
  return { provider, hasV98Key, v98BaseUrl, imageModel, isConfigured, errors };
}

/** Cấu hình endpoint sinh ảnh tương thích OpenAI (openai chính chủ hoặc V98). */
function resolveImageConfig(
  provider: ImageProvider,
): { apiKey: string; baseURL?: string; model: string } | null {
  if (provider === "v98") {
    // 2 KEY tách biệt: ảnh dùng V98_IMAGE_* (fallback V98_* cũ). KHÔNG dùng key prompt cho ảnh.
    const apiKey = process.env.V98_IMAGE_API_KEY?.trim() || process.env.V98_API_KEY?.trim();
    const baseURL = process.env.V98_IMAGE_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim();
    const model = process.env.V98_IMAGE_MODEL?.trim() || "gpt-image-2";
    if (!apiKey || !baseURL) return null;
    return { apiKey, baseURL, model };
  }
  // openai chính chủ
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
  if (!apiKey) return null;
  return { apiKey, model };
}

/**
 * Sinh MỘT ảnh từ prompt do AI text tạo. KHÔNG throw.
 * - openai / v98: gọi endpoint tương thích OpenAI (images.generate), trả base64 hoặc URL.
 * - mock: trả URL placeholder, mock=true (KHÔNG production-ready).
 */
export async function generateImageFromPrompt(
  prompt: string,
  context?: ImageGenerationContext,
): Promise<PromptImageResult> {
  let provider = getImageProvider();

  // GUARD — chặn provider trả tiền nếu context không hợp lệ (vd quét/import/validate SP).
  if (isPaidImageProvider(provider)) {
    const guard = checkImageGenerationContext(context);
    if (!guard.allowed) {
      await logImageApiUsage({
        provider: usageProviderName(provider),
        model: null,
        keyType: usageKeyType(provider),
        callType: "image_generation_blocked",
        endpoint: null,
        context: { ...(context ?? {}), guard_code: guard.code },
        success: false,
        errorMessage: guard.reason,
      });
      return { b64: null, url: null, mock: false, provider, model: null, status: "FAILED", error: guard.code ?? IMAGE_BLOCKED_ERROR_CODE };
    }
  }

  // Grok qua cookie (worker ngoài Vercel). Lỗi/hết hạn cookie -> fallback an toàn.
  if (provider === "grok_gateway") {
    const g = await callGrokGateway(prompt);
    await logImageApiUsage({
      provider: "grok_gateway",
      model: g.model,
      keyType: "image",
      callType: "image_generation",
      endpoint: process.env.GROK_GATEWAY_URL?.trim() ?? null,
      context: context ?? null,
      success: g.status === "READY",
      errorMessage: g.error ?? null,
    });
    if (g.status === "READY") return g;
    const fb = grokGatewayFallback();
    if (fb === "none") return g; // giữ lỗi gốc
    provider = fb; // chạy tiếp với provider fallback (v98/openai/mock) bên dưới
    // Nếu fallback là provider trả tiền, guard đã pass ở trên (cùng context).
  }

  if (provider === "none") {
    return { b64: null, url: null, mock: false, provider, model: null, status: "FAILED" };
  }
  if (provider === "mock") {
    const url = `https://placehold.co/1024x1024/png?text=${encodeURIComponent("AI mock")}`;
    return { b64: null, url, mock: true, provider, model: "mock", status: "READY" };
  }

  const cfg = resolveImageConfig(provider);
  if (!cfg) {
    const error =
      provider === "v98"
        ? "Thiếu V98_API_KEY hoặc V98_BASE_URL."
        : "Thiếu OPENAI_API_KEY.";
    return { b64: null, url: null, mock: false, provider, model: null, status: "FAILED", error };
  }
  const usageEndpoint = cfg.baseURL ? `${cfg.baseURL.replace(/\/$/, "")}/images/generations` : "openai:images.generate";
  const logProviderCall = (success: boolean, errorMessage?: string | null) =>
    logImageApiUsage({
      provider: usageProviderName(provider),
      model: cfg.model,
      keyType: usageKeyType(provider),
      callType: "image_generation",
      endpoint: usageEndpoint,
      context: context ?? null,
      success,
      errorMessage: errorMessage ?? null,
    });

  const client = new OpenAI({ apiKey: cfg.apiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });
  const isGptImage = /gpt-image/i.test(cfg.model);
  const isDalle = /dall-e/i.test(cfg.model);
  const safePrompt = `${prompt} Hard visual constraints: ${TEXT_FREE_IMAGE_PROMPT_RULE}, no captions, no badges, no sticker text, no price text, no product packaging text.`;
  const params: Record<string, unknown> = { model: cfg.model, prompt: safePrompt, n: 1, size: "1024x1024" };
  // dall-e-* cần response_format để lấy b64; gpt-image-* trả b64 mặc định.
  if (isDalle && !isGptImage) params.response_format = "b64_json";

  // V98 hay trả 429 "Something wrong, please try again" -> tự chờ giãn rồi thử lại.
  const timeoutMs = readIntEnv("IMAGE_PROVIDER_TIMEOUT_MS", 22_000, 5_000, 55_000);
  const callImagesGenerate = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return (await client.images.generate(
        params as unknown as Parameters<typeof client.images.generate>[0],
        { signal: controller.signal } as never,
      )) as unknown as { data?: Array<{ b64_json?: string | null; url?: string | null }> };
    } finally {
      clearTimeout(timer);
    }
  };

  const isTimeout = (e: unknown): boolean => {
    const name = (e as { name?: string })?.name ?? "";
    const msg = e instanceof Error ? e.message : "";
    return name === "AbortError" || /abort|timeout/i.test(msg);
  };

  const isRetryable = (e: unknown): boolean => {
    const status = (e as { status?: number })?.status;
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return status === 429 || status === 503 || /429|rate|too many|try again|overload|timeout|temporar/i.test(msg);
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // Backoff đủ dài để vượt rate-limit V98 (tổng ~37s, trong giới hạn function 60s).
  const DELAYS: number[] = [];

  let lastError = "Image API call failed.";
  for (let attempt = 0; attempt <= DELAYS.length; attempt += 1) {
    try {
      const res = await callImagesGenerate();
      const b64 = res.data?.[0]?.b64_json ?? null;
      const url = res.data?.[0]?.url ?? null;
      if (b64) {
        await logProviderCall(true);
        return { b64, url: null, mock: false, provider, model: cfg.model, status: "READY" };
      }
      if (url) {
        await logProviderCall(true);
        return { b64: null, url, mock: false, provider, model: cfg.model, status: "READY" };
      }
      lastError = "No image URL or base64 returned from image model.";
      break; // không phải lỗi tạm thời -> dừng
    } catch (err) {
      lastError = isTimeout(err) ? V98_TIMEOUT_ERROR : err instanceof Error ? err.message.slice(0, 300) : "Image API call failed.";
      if (attempt < DELAYS.length && isRetryable(err)) {
        await sleep(DELAYS[attempt]);
        continue;
      }
      break;
    }
  }
  await logProviderCall(false, lastError);
  return { b64: null, url: null, mock: false, provider, model: cfg.model, status: "FAILED", error: lastError };
}

/** 4 phong cách ảnh creative (lifestyle / use-case / spotlight / benefit). */
const STYLES: { key: string; overlay: string; desc: string }[] = [
  { key: "lifestyle", overlay: "Trong đời sống", desc: "lifestyle context, natural home setting, warm light" },
  { key: "usecase", overlay: "Đang sử dụng", desc: "use-case scene showing the product in action" },
  { key: "spotlight", overlay: "Cận cảnh sản phẩm", desc: "clean product spotlight on simple background, soft shadow" },
  { key: "benefit", overlay: "Lợi ích nổi bật", desc: "benefit-focused composition, before/after-like clean layout (no text)" },
];

function buildPrompt(input: GenerateImageInput, styleDesc: string, hasRef: boolean): string {
  const parts = [
    `Supporting visual for an affiliate product post (NOT the product hero shot).`,
    `Theme: ${input.product_name}.`,
    input.category ? `Category: ${input.category}.` : "",
    input.target_customer ? `Audience: ${input.target_customer}.` : "",
    input.content_angle ? `Angle: ${input.content_angle}.` : "",
    `Style: ${styleDesc}.`,
    hasRef
      ? `A real product image is provided separately as reference; you may match its general look, but stay generic.`
      : `No product reference provided — keep it GENERIC. Do NOT imitate any specific product design.`,
    `Hard constraints: do NOT invent fake product packaging, brand names or logos; do NOT add price text; do NOT create fake screenshots, fake reviews or fake badges; no medical/health claims; ${TEXT_FREE_IMAGE_PROMPT_RULE}; no text overlay. The real product photo is shown separately. Clean, trustworthy lifestyle/checklist/benefit visual only.`,
  ];
  return parts.filter(Boolean).join(" ");
}

function mockImages(input: GenerateImageInput, count: number): GeneratedImage[] {
  const hasRef = Boolean(input.product_image_ref);
  const out: GeneratedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const style = STYLES[i % STYLES.length];
    const label = `AI · ${style.overlay}`.slice(0, 40);
    // Ảnh placeholder công khai (https). LÀ MOCK — không dùng đăng production.
    const url = `https://placehold.co/800x800/png?text=${encodeURIComponent(label)}`;
    out.push({
      image_url: url,
      prompt: buildPrompt(input, style.desc, hasRef),
      caption_overlay: style.overlay,
      source_type: "AI_GENERATED",
      status: "READY",
      mock: true,
    });
  }
  return out;
}

async function openaiImages(input: GenerateImageInput, count: number): Promise<GeneratedImage[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "dall-e-3";
  if (!apiKey) return [];
  const client = new OpenAI({ apiKey });
  const hasRef = Boolean(input.product_image_ref);
  const out: GeneratedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const style = STYLES[i % STYLES.length];
    const prompt = buildPrompt(input, style.desc, hasRef);
    try {
      const res = await client.images.generate({ model, prompt, n: 1, size: "1024x1024" });
      const url = res.data?.[0]?.url ?? null;
      out.push({
        image_url: url,
        prompt,
        caption_overlay: style.overlay,
        source_type: "AI_GENERATED",
        status: url ? "READY" : "FAILED",
        mock: false,
      });
    } catch {
      out.push({ image_url: null, prompt, caption_overlay: style.overlay, source_type: "AI_GENERATED", status: "FAILED", mock: false });
    }
  }
  return out;
}

/**
 * Sinh `count` ảnh creative còn thiếu cho một bài. KHÔNG throw.
 */
export async function generateCreativeImagesForPost(
  input: GenerateImageInput,
  count: number,
): Promise<GeneratedImage[]> {
  const n = Math.max(0, Math.min(4, Math.floor(count)));
  if (n === 0) return [];
  const provider = getImageProvider();
  try {
    if (provider === "openai") return await openaiImages(input, n);
    if (provider === "none") return [];
    return mockImages(input, n);
  } catch {
    return [];
  }
}
