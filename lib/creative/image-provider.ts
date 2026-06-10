import "server-only";

import OpenAI from "openai";

/**
 * Phase 17 V2 — lớp sinh ảnh creative (pluggable).
 * Provider: mock (mặc định) | openai | none.
 * KHÔNG bao giờ throw — lỗi trả mảng rỗng để không làm hỏng việc tạo bài.
 */

export type ImageProvider = "mock" | "openai" | "none";

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
};

export function getImageProvider(): ImageProvider {
  const raw = process.env.IMAGE_PROVIDER?.trim().toLowerCase();
  if (raw === "openai" || raw === "none" || raw === "mock") return raw;
  return "mock";
}

/** 4 phong cách ảnh creative (lifestyle / use-case / spotlight / benefit). */
const STYLES: { key: string; overlay: string; desc: string }[] = [
  { key: "lifestyle", overlay: "Trong đời sống", desc: "lifestyle context, natural home setting, warm light" },
  { key: "usecase", overlay: "Đang sử dụng", desc: "use-case scene showing the product in action" },
  { key: "spotlight", overlay: "Cận cảnh sản phẩm", desc: "clean product spotlight on simple background, soft shadow" },
  { key: "benefit", overlay: "Lợi ích nổi bật", desc: "benefit-focused composition, before/after-like clean layout (no text)" },
];

function buildPrompt(input: GenerateImageInput, styleDesc: string): string {
  const parts = [
    `Realistic commercial photo for an affiliate product post.`,
    `Product: ${input.product_name}.`,
    input.category ? `Category: ${input.category}.` : "",
    input.target_customer ? `Audience: ${input.target_customer}.` : "",
    input.content_angle ? `Angle: ${input.content_angle}.` : "",
    `Style: ${styleDesc}.`,
    `Constraints: no text overlay, no fake brand logos, no price tags, no fake screenshots, no medical/health claims, no misleading badges. Clean, trustworthy, scroll-stopping.`,
  ];
  return parts.filter(Boolean).join(" ");
}

function mockImages(input: GenerateImageInput, count: number): GeneratedImage[] {
  const out: GeneratedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const style = STYLES[i % STYLES.length];
    const label = `${input.product_name} · ${style.overlay}`.slice(0, 60);
    // Ảnh placeholder công khai (https) — dùng để test album publish.
    const url = `https://placehold.co/800x800/png?text=${encodeURIComponent(label)}`;
    out.push({
      image_url: url,
      prompt: buildPrompt(input, style.desc),
      caption_overlay: style.overlay,
      source_type: "AI_GENERATED",
      status: "READY",
    });
  }
  return out;
}

async function openaiImages(input: GenerateImageInput, count: number): Promise<GeneratedImage[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "dall-e-3";
  if (!apiKey) return [];
  const client = new OpenAI({ apiKey });
  const out: GeneratedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const style = STYLES[i % STYLES.length];
    const prompt = buildPrompt(input, style.desc);
    try {
      const res = await client.images.generate({ model, prompt, n: 1, size: "1024x1024" });
      const url = res.data?.[0]?.url ?? null;
      out.push({
        image_url: url,
        prompt,
        caption_overlay: style.overlay,
        source_type: "AI_GENERATED",
        status: url ? "READY" : "FAILED",
      });
    } catch {
      out.push({ image_url: null, prompt, caption_overlay: style.overlay, source_type: "AI_GENERATED", status: "FAILED" });
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
