import "server-only";

import OpenAI from "openai";

/**
 * Phase 17 V2 — lớp sinh ảnh creative (pluggable).
 * Provider: mock (mặc định) | openai | none.
 * KHÔNG bao giờ throw — lỗi trả mảng rỗng để không làm hỏng việc tạo bài.
 */

export type ImageProvider = "mock" | "openai" | "v98" | "none";

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
  if (raw === "openai" || raw === "v98" || raw === "none" || raw === "mock") return raw;
  // Mặc định: ưu tiên V98 (nếu đang dùng), rồi OpenAI, cuối cùng mock.
  if (process.env.V98_API_KEY?.trim() && process.env.V98_BASE_URL?.trim()) return "v98";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return "mock";
}

/** Kết quả sinh 1 ảnh từ prompt cụ thể (Phase 17 — fully AI). */
export type PromptImageResult = {
  b64: string | null; // ảnh thật (base64 png) -> upload storage
  url: string | null; // chỉ dùng cho mock (placeholder)
  mock: boolean;
  provider: ImageProvider;
  model: string | null;
  status: "READY" | "FAILED";
};

/** Cấu hình endpoint sinh ảnh tương thích OpenAI (openai chính chủ hoặc V98). */
function resolveImageConfig(
  provider: ImageProvider,
): { apiKey: string; baseURL?: string; model: string } | null {
  if (provider === "v98") {
    const apiKey = process.env.V98_API_KEY?.trim();
    const baseURL = process.env.V98_BASE_URL?.trim();
    // V98 dùng model ảnh riêng (KHÔNG dùng V98_MODEL vốn là model text gpt-5.5).
    const model = process.env.V98_IMAGE_MODEL?.trim() || "dall-e-3";
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
export async function generateImageFromPrompt(prompt: string): Promise<PromptImageResult> {
  const provider = getImageProvider();
  if (provider === "none") {
    return { b64: null, url: null, mock: false, provider, model: null, status: "FAILED" };
  }
  if (provider === "mock") {
    const url = `https://placehold.co/1024x1024/png?text=${encodeURIComponent("AI mock")}`;
    return { b64: null, url, mock: true, provider, model: "mock", status: "READY" };
  }

  const cfg = resolveImageConfig(provider);
  if (!cfg) return { b64: null, url: null, mock: false, provider, model: null, status: "FAILED" };

  try {
    const client = new OpenAI({ apiKey: cfg.apiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });
    const isGptImage = /gpt-image/i.test(cfg.model);
    const params: Record<string, unknown> = { model: cfg.model, prompt, n: 1, size: "1024x1024" };
    // dall-e-* cần response_format để lấy b64; gpt-image-* trả b64 mặc định.
    if (!isGptImage) params.response_format = "b64_json";
    const res = (await client.images.generate(
      params as unknown as Parameters<typeof client.images.generate>[0],
    )) as unknown as { data?: Array<{ b64_json?: string | null; url?: string | null }> };
    const b64 = res.data?.[0]?.b64_json ?? null;
    const url = res.data?.[0]?.url ?? null;
    if (b64) return { b64, url: null, mock: false, provider, model: cfg.model, status: "READY" };
    if (url) return { b64: null, url, mock: false, provider, model: cfg.model, status: "READY" };
    return { b64: null, url: null, mock: false, provider, model: cfg.model, status: "FAILED" };
  } catch {
    return { b64: null, url: null, mock: false, provider, model: cfg.model, status: "FAILED" };
  }
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
    `Hard constraints: do NOT invent fake product packaging, brand names or logos; do NOT add price text; do NOT create fake screenshots, fake reviews or fake badges; no medical/health claims; no text overlay. The real product photo is shown separately. Clean, trustworthy lifestyle/checklist/benefit visual only.`,
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
