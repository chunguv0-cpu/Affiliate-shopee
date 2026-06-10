import "server-only";

import OpenAI from "openai";

import {
  AFFILIATE_SYSTEM_PROMPT,
  buildAffiliateUserPrompt,
  INFER_PRODUCT_SYSTEM_PROMPT,
  buildInferProductUserPrompt,
} from "@/lib/ai/prompt";
import { safeParseAIJson } from "@/lib/ai/json";

/**
 * AI Provider Layer.
 *
 * BẢO MẬT:
 * - File này import "server-only" → KHÔNG bao giờ bị bundle vào client.
 * - Các API key (V98_API_KEY, OPENAI_API_KEY) chỉ được đọc tại đây, phía server.
 * - Chỉ gọi từ server route / server action.
 */

/** Các provider AI được hỗ trợ. */
export type AIProvider = "mock" | "v98" | "openai";

/** Dữ liệu sản phẩm đầu vào để sinh caption. */
export type ProductInput = {
  id?: string;
  product_name: string;
  affiliate_link: string;
  price_note?: string | null;
  target_customer?: string | null;
  product_angle?: string | null;
  image_url?: string | null;
  /** Góc viết riêng cho bài này (Phase 10.1), vd "Deal nhanh", "Review thật"... */
  content_angle_variant?: string | null;
};

/** Kết quả caption do AI sinh ra. */
export type GeneratedCaptionResult = {
  caption: string;
  hook: string;
  score: number;
  safety_notes: string;
  should_publish: boolean;
};

/**
 * Xác định provider AI hiện tại từ biến môi trường AI_PROVIDER.
 * - Không có giá trị -> "mock".
 * - Giá trị không hợp lệ -> ném lỗi rõ ràng.
 */
export function getAIProvider(): AIProvider {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (!raw) {
    return "mock";
  }
  if (raw === "mock" || raw === "v98" || raw === "openai") {
    return raw;
  }

  throw new Error(
    `AI_PROVIDER không hợp lệ: "${process.env.AI_PROVIDER}". ` +
      `Chỉ chấp nhận một trong: mock, v98, openai.`,
  );
}

/**
 * Sinh caption GIẢ LẬP (mock) — không gọi API bên ngoài.
 */
function mockGenerate(product: ProductInput): GeneratedCaptionResult {
  const name = product.product_name.trim();
  const audience = product.target_customer?.trim();
  const price = product.price_note?.trim();
  const angle = product.product_angle?.trim();
  const variant = product.content_angle_variant?.trim();

  // Hook thay đổi theo góc viết (content angle) để mỗi bài khác nhau.
  const variantHooks: Record<string, string> = {
    "Deal nhanh": `🔥 ${name} đang có deal, nhanh tay kẻo lỡ!`,
    "Review thật": `Mình dùng thử ${name} một thời gian rồi, review thật nè.`,
    "Mua dự trữ": `${name} là món hay dùng, thấy deal là mình gom dự trữ luôn.`,
    "Combo kéo traffic": `Gom vài deal hay hôm nay — mình để link ${name} trước, ai cần xem thêm nhé.`,
    "Story cá nhân": `Hôm nay tình cờ thấy lại ${name}, tự nhiên muốn kể mọi người nghe.`,
  };

  const hook =
    (variant && variantHooks[variant]) ||
    (audience
      ? `Mình vừa thấy deal ${name} khá ổn cho ${audience}.`
      : `Mình vừa thấy deal ${name} khá ổn, chia sẻ với mọi người nè.`);

  const lines: string[] = [hook, ""];

  if (price) {
    // Tránh lặp disclaimer nếu price_note đã có sẵn câu này.
    const hasDisclaimer = /giá có thể thay đổi theo thời điểm/i.test(price);
    lines.push(
      hasDisclaimer
        ? `Giá tham khảo: ${price}.`
        : `Giá tham khảo: ${price} (giá có thể thay đổi theo thời điểm).`,
    );
    lines.push("");
  }

  const cta = angle
    ? `Ai cần ${angle} thì xem link này nhé 👇`
    : "Ai quan tâm thì xem link này nhé 👇";

  lines.push(
    cta,
    product.affiliate_link,
    "",
    "Bài có gắn link tiếp thị liên kết.",
  );

  return {
    caption: lines.join("\n"),
    hook,
    score: 85,
    safety_notes: "Mock mode: nội dung dùng để test local.",
    should_publish: true,
  };
}

/**
 * Gọi một endpoint tương thích OpenAI (dùng chung cho v98 & openai).
 */
async function generateViaOpenAICompatible(
  product: ProductInput,
  options: { apiKey: string; baseURL?: string; model: string },
): Promise<GeneratedCaptionResult> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });

  const completion = await client.chat.completions.create({
    model: options.model,
    temperature: 0.8,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: AFFILIATE_SYSTEM_PROMPT },
      { role: "user", content: buildAffiliateUserPrompt(product) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return safeParseAIJson(raw);
}

/** Provider V98 (endpoint tương thích OpenAI). */
async function generateViaV98(
  product: ProductInput,
): Promise<GeneratedCaptionResult> {
  const apiKey = process.env.V98_API_KEY?.trim();
  const baseURL = process.env.V98_BASE_URL?.trim();
  const model = process.env.V98_MODEL?.trim();

  if (!apiKey) {
    throw new Error("Thiếu V98_API_KEY. Vui lòng cấu hình trong .env.local.");
  }
  if (!baseURL) {
    throw new Error("Thiếu V98_BASE_URL. Vui lòng cấu hình trong .env.local.");
  }
  if (!model) {
    throw new Error("Thiếu V98_MODEL. Vui lòng cấu hình trong .env.local.");
  }

  return generateViaOpenAICompatible(product, { apiKey, baseURL, model });
}

/** Provider OpenAI chính thức. */
async function generateViaOpenAI(
  product: ProductInput,
): Promise<GeneratedCaptionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error("Thiếu OPENAI_API_KEY. Vui lòng cấu hình trong .env.local.");
  }

  return generateViaOpenAICompatible(product, { apiKey, model });
}

/**
 * Sinh caption Affiliate theo provider hiện tại (mock / v98 / openai).
 */
export async function generateAffiliateCaption(
  product: ProductInput,
): Promise<GeneratedCaptionResult> {
  const provider = getAIProvider();

  switch (provider) {
    case "v98":
      return generateViaV98(product);
    case "openai":
      return generateViaOpenAI(product);
    case "mock":
    default:
      return mockGenerate(product);
  }
}

// ===========================================================================
// Phase 11: suy luận thông tin sản phẩm từ link affiliate + metadata
// ===========================================================================

/** Đầu vào suy luận sản phẩm. */
export type InferProductInput = {
  affiliate_link: string;
  resolved_url?: string | null;
  title?: string | null;
  description?: string | null;
};

/** Kết quả suy luận sản phẩm. */
export type InferredProductInfo = {
  product_name: string;
  price_note: string | null;
  target_customer: string | null;
  product_angle: string | null;
  confidence: number;
  notes: string;
};

const DEFAULT_PRICE_NOTE = "giá có thể thay đổi theo thời điểm";

/** Suy luận GIẢ LẬP khi AI_PROVIDER=mock. */
function mockInfer(input: InferProductInput): InferredProductInfo {
  const title = input.title?.trim();
  if (!title) {
    return {
      product_name: "Sản phẩm Shopee",
      price_note: DEFAULT_PRICE_NOTE,
      target_customer: "người mua sắm online",
      product_angle: "deal sản phẩm Shopee, cần kiểm tra thêm",
      confidence: 50,
      notes: "Mock: không có metadata, cần kiểm tra lại.",
    };
  }
  return {
    product_name: title.slice(0, 80),
    price_note: DEFAULT_PRICE_NOTE,
    target_customer: "người mua sắm online",
    product_angle: "deal sản phẩm Shopee",
    confidence: 75,
    notes: "Mock: suy luận từ title metadata.",
  };
}

/** Đọc cấu hình provider (v98/openai) cho gọi chat JSON. */
export function resolveProviderConfig(provider: "v98" | "openai"): {
  apiKey: string;
  baseURL?: string;
  model: string;
} {
  if (provider === "v98") {
    const apiKey = process.env.V98_API_KEY?.trim();
    const baseURL = process.env.V98_BASE_URL?.trim();
    const model = process.env.V98_MODEL?.trim();
    if (!apiKey) throw new Error("Thiếu V98_API_KEY. Vui lòng cấu hình trong .env.local.");
    if (!baseURL) throw new Error("Thiếu V98_BASE_URL. Vui lòng cấu hình trong .env.local.");
    if (!model) throw new Error("Thiếu V98_MODEL. Vui lòng cấu hình trong .env.local.");
    return { apiKey, baseURL, model };
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  if (!apiKey) throw new Error("Thiếu OPENAI_API_KEY. Vui lòng cấu hình trong .env.local.");
  return { apiKey, model };
}

/** Parse JSON suy luận an toàn (fallback về mock nếu lỗi). */
function parseInferJson(raw: string, input: InferProductInput): InferredProductInfo {
  const fallback = mockInfer(input);
  if (typeof raw !== "string" || raw.trim() === "") return fallback;

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return fallback;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return fallback;
  }

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const productName =
    str(obj.product_name)?.slice(0, 120) ??
    input.title?.trim()?.slice(0, 120) ??
    "Sản phẩm Shopee";
  const priceNote = str(obj.price_note) ?? DEFAULT_PRICE_NOTE;
  const confidenceRaw =
    typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
      ? obj.confidence
      : 50;
  const confidence = Math.max(0, Math.min(100, Math.round(confidenceRaw)));

  return {
    product_name: productName,
    price_note: priceNote,
    target_customer: str(obj.target_customer),
    product_angle: str(obj.product_angle),
    confidence,
    notes: typeof obj.notes === "string" ? obj.notes : "",
  };
}

/**
 * Suy luận thông tin sản phẩm từ link affiliate + metadata (mock/v98/openai).
 */
export async function inferProductInfoFromAffiliateLink(
  input: InferProductInput,
): Promise<InferredProductInfo> {
  const provider = getAIProvider();
  if (provider === "mock") return mockInfer(input);

  const { apiKey, baseURL, model } = resolveProviderConfig(provider);
  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INFER_PRODUCT_SYSTEM_PROMPT },
      { role: "user", content: buildInferProductUserPrompt(input) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return parseInferJson(raw, input);
}
