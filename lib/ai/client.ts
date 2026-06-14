import "server-only";

import OpenAI from "openai";

import {
  AFFILIATE_SYSTEM_PROMPT,
  buildAffiliateUserPrompt,
  BUNDLE_SYSTEM_PROMPT,
  buildBundleUserPrompt,
  INFER_PRODUCT_SYSTEM_PROMPT,
  buildInferProductUserPrompt,
} from "@/lib/ai/prompt";
import { safeParseAIJson } from "@/lib/ai/json";
import { logTextApiUsage } from "@/lib/cost/api-usage-log";

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
  // Phase 17 — Visual Creative.
  visual_hook: string;
  creative_brief: string;
  suggested_creative_type: "TEXT_ONLY" | "IMAGE" | "VIDEO";
};

/**
 * Xác định provider AI cho TEXT (caption/vision/overlay -> dùng Prompt key).
 * - Có giá trị hợp lệ -> dùng đúng giá trị đó.
 * - Giá trị không hợp lệ -> ném lỗi rõ ràng.
 * - CHƯA ĐẶT -> TỰ NHẬN DIỆN (giống IMAGE_PROVIDER): nếu đã cấu hình V98 (prompt key/base/model
 *   hoặc key chung) thì dùng "v98" để TEXT thật sự gọi V98 (Prompt key được dùng). Tránh tình
 *   trạng quên đặt AI_PROVIDER -> text chạy mock -> Prompt key không bao giờ bị trừ.
 */
/** V98 text đã cấu hình ĐẦY ĐỦ chưa (key + base + model). */
function isV98TextConfigured(): boolean {
  const key = process.env.V98_PROMPT_API_KEY?.trim() || process.env.V98_API_KEY?.trim();
  const base = process.env.V98_PROMPT_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim();
  const model = process.env.V98_PROMPT_MODEL?.trim() || process.env.V98_MODEL?.trim();
  return !!(key && base && model);
}

export function getAIProvider(): AIProvider {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (raw === "v98" || raw === "openai") {
    return raw;
  }
  if (raw === "mock") {
    // Trên PRODUCTION nếu đã cấu hình đầy đủ V98 -> ưu tiên v98 (gỡ bẫy AI_PROVIDER=mock cũ còn sót
    // trong env làm TEXT chạy mock + Prompt key không bao giờ bị trừ). Local vẫn tôn trọng mock.
    if (process.env.NODE_ENV === "production" && isV98TextConfigured()) return "v98";
    return "mock";
  }
  if (raw) {
    throw new Error(
      `AI_PROVIDER không hợp lệ: "${process.env.AI_PROVIDER}". ` +
        `Chỉ chấp nhận một trong: mock, v98, openai.`,
    );
  }

  // CHƯA ĐẶT -> tự nhận diện.
  if (isV98TextConfigured()) return "v98";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return "mock";
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

  const visualHooks: Record<string, string> = {
    "Deal nhanh": "Săn deal đáng thử",
    "Review thật": "Ai dùng rồi sẽ hiểu",
    "Mua dự trữ": "Món nhỏ nhưng tiện",
    "Combo kéo traffic": "Gom deal hôm nay",
    "Story cá nhân": "Tự nhiên thấy thích",
  };
  const visual_hook = (variant && visualHooks[variant]) || "Món nhỏ nhưng tiện";

  return {
    caption: lines.join("\n"),
    hook,
    score: 85,
    safety_notes: "Mock mode: nội dung dùng để test local.",
    should_publish: true,
    visual_hook,
    creative_brief: `Ảnh thật sản phẩm "${name}", nền gọn, làm nổi bật công dụng. Tránh chữ quá nhiều trên ảnh.`,
    suggested_creative_type: "IMAGE",
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

/** Provider V98 (endpoint tương thích OpenAI). Dùng PROMPT key (qua resolveProviderConfig). */
async function generateViaV98(
  product: ProductInput,
): Promise<GeneratedCaptionResult> {
  // Dùng chung resolver -> ưu tiên V98_PROMPT_* (fallback V98_*). KHÔNG dùng key ảnh.
  const { apiKey, baseURL, model } = resolveProviderConfig("v98");
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
// Phase 17.2: 1 call text -> caption + hook + 4 image prompts (one-step)
// ===========================================================================
export type AiImagePrompt = {
  image_title: string;
  prompt: string;
  visual_angle: string;
  caption_overlay: string;
  negative_prompt: string;
};
export type AiPostBundle = {
  caption: string;
  hook: string;
  score: number;
  should_publish: boolean;
  safety_notes: string;
  image_prompts: AiImagePrompt[];
};

const ANGLE_KEYS = ["hero", "lifestyle", "detail", "benefit"] as const;
const ANGLE_OVERLAY: Record<string, string> = {
  hero: "Sản phẩm nổi bật",
  lifestyle: "Đang sử dụng",
  detail: "Điểm nổi bật",
  benefit: "Lý do nên mua",
};
const IMG_NEGATIVE =
  "no fake brand logos, no fake packaging text, no invented prices, no fake screenshots, no fake reviews, no medical claims, no text overlay, no watermark, photorealistic, clean";

function fallbackImagePrompts(product: ProductInput): AiImagePrompt[] {
  return ANGLE_KEYS.map((angle) => ({
    image_title: `${product.product_name} - ${angle}`,
    prompt: `Photorealistic ${angle} image clearly related to "${product.product_name}". ${IMG_NEGATIVE}.`,
    visual_angle: angle,
    caption_overlay: ANGLE_OVERLAY[angle],
    negative_prompt: IMG_NEGATIVE,
  }));
}

function mockBundle(product: ProductInput): AiPostBundle {
  const base = mockGenerate(product);
  return {
    caption: base.caption,
    hook: base.hook,
    score: base.score,
    should_publish: base.should_publish,
    safety_notes: base.safety_notes,
    image_prompts: fallbackImagePrompts(product),
  };
}

function parseBundle(raw: string, product: ProductInput): AiPostBundle {
  const fb = mockBundle(product);
  if (typeof raw !== "string" || !raw.trim()) return fb;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return fb;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return fb;
  }
  const str = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d);
  const caption = str(o.caption);
  let score = typeof o.ai_score === "number" && Number.isFinite(o.ai_score) ? o.ai_score : 0;
  let should = typeof o.should_publish === "boolean" ? o.should_publish : false;
  if (!caption) {
    score = 0;
    should = false;
  }
  const promptsRaw = Array.isArray(o.image_prompts) ? o.image_prompts : [];
  const prompts: AiImagePrompt[] = promptsRaw
    .map((x, i) => {
      const p = (x ?? {}) as Record<string, unknown>;
      const angle = str(p.visual_angle, ANGLE_KEYS[i % 4]);
      return {
        image_title: str(p.image_title, `${product.product_name} - ${angle}`),
        prompt: str(p.prompt),
        visual_angle: angle,
        caption_overlay: str(p.caption_overlay, ANGLE_OVERLAY[angle] ?? ""),
        negative_prompt: str(p.negative_prompt, IMG_NEGATIVE),
      };
    })
    .filter((p) => p.prompt);
  const image_prompts = prompts.length >= 4 ? prompts.slice(0, 4) : [...prompts, ...fallbackImagePrompts(product).slice(prompts.length, 4)];

  return {
    caption: caption || fb.caption,
    hook: str(o.hook, fb.hook),
    score,
    should_publish: should,
    safety_notes: str(o.safety_note ?? o.safety_notes),
    image_prompts,
  };
}

/**
 * Danh sách model text V98 thử lần lượt: model cấu hình trước, rồi các model phổ biến hay có sẵn.
 * Giúp vượt lỗi V98 503 "Something wrong" khi 1 model không khả dụng trên tài khoản.
 */
export function v98TextModelCandidates(primary: string): string[] {
  const common = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-3.5-turbo", "gemini-1.5-flash", "gpt-4o"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [primary, ...common]) {
    const k = (m ?? "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(m.trim());
  }
  return out;
}

/**
 * Một call text AI: caption + hook + 4 image prompts. KHÔNG throw (fallback mock).
 * opts.visualIdentity: nhận diện thị giác trích từ ảnh thật Shopee -> ground prompts.
 * Tự thử nhiều model (v98) cho tới khi 1 model chạy được -> vượt lỗi 503 model không khả dụng.
 */
export async function generateAffiliatePostBundle(
  product: ProductInput,
  opts?: { visualIdentity?: string | null },
): Promise<AiPostBundle> {
  const provider = getAIProvider();
  if (provider === "mock") return mockBundle(product);

  let apiKey: string;
  let baseURL: string | undefined;
  let model: string;
  try {
    ({ apiKey, baseURL, model } = resolveProviderConfig(provider));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "lỗi cấu hình";
    await logTextApiUsage({ model: null, step: "bundle", success: false, errorMessage: reason });
    return { ...mockBundle(product), safety_notes: `⚠️ V98 text lỗi cấu hình: ${reason}`.slice(0, 280) };
  }

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const vi = (opts?.visualIdentity ?? "").trim();
  const userContent = vi
    ? `${buildBundleUserPrompt(product)}\n\nNHẬN DIỆN THỊ GIÁC SẢN PHẨM (bám sát tuyệt đối, từ ảnh thật Shopee):\n${vi}`
    : buildBundleUserPrompt(product);
  const candidates = provider === "v98" ? v98TextModelCandidates(model) : [model];

  let lastErr = "Không gọi được model text nào.";
  for (const m of candidates) {
    try {
      const completion = await client.chat.completions.create({
        model: m,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: BUNDLE_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      });
      await logTextApiUsage({ model: m, step: "bundle", success: true });
      return parseBundle(completion.choices[0]?.message?.content ?? "", product);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "lỗi không xác định";
      // thử model kế tiếp
    }
  }

  await logTextApiUsage({ model: candidates[0] ?? null, step: "bundle", success: false, errorMessage: lastErr });
  // Hiện LÝ DO thật lên bài (kèm số model đã thử) để biết ngay vì sao rơi mock.
  const fb = mockBundle(product);
  return {
    ...fb,
    safety_notes: `⚠️ V98 text lỗi (đã thử ${candidates.length} model: ${candidates.join(", ")}). Lỗi cuối: ${lastErr}`.slice(0, 280),
  };
}

/**
 * Tóm tắt NHẬN DIỆN THỊ GIÁC sản phẩm từ ảnh thật (vision). KHÔNG throw.
 * Fallback: suy luận nhẹ từ tên sản phẩm nếu model không hỗ trợ ảnh.
 */
export async function summarizeProductVisualIdentity(
  imageUrls: string[],
  productName: string,
): Promise<string> {
  const urls = (imageUrls ?? []).filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 3);
  const fallback = `${productName} — giữ đúng loại sản phẩm, màu sắc, hình khối và chi tiết thiết kế như ảnh thật.`;
  const provider = getAIProvider();
  if (provider === "mock" || urls.length === 0) return fallback;
  try {
    const { apiKey, baseURL, model } = resolveProviderConfig(provider);
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text:
          `Mô tả NHẬN DIỆN THỊ GIÁC của sản phẩm "${productName}" từ các ảnh sau, NGẮN GỌN (<=80 từ), tiếng Việt: ` +
          "loại sản phẩm, màu sắc chính, hình khối/kiểu dáng, chi tiết thiết kế nổi bật, phụ kiện/ngữ cảnh nếu thấy. " +
          "KHÔNG bịa thương hiệu/giá. Chỉ trả mô tả thuần.",
      },
      ...urls.map((url) => ({ type: "image_url", image_url: { url } })),
    ];
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: "Bạn mô tả nhận diện thị giác sản phẩm ngắn gọn, chính xác, không bịa." },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: "user", content: content as any },
      ],
    });
    await logTextApiUsage({ model, step: "vision", success: true });
    const text = completion.choices[0]?.message?.content;
    const out = typeof text === "string" ? text.trim() : "";
    return out || fallback;
  } catch (err) {
    await logTextApiUsage({ model: process.env.V98_PROMPT_MODEL?.trim() || process.env.V98_MODEL?.trim() || null, step: "vision", success: false, errorMessage: err instanceof Error ? err.message : "error" });
    return fallback;
  }
}

/**
 * HOTFIX 17.4 — Sinh 3 overlay text NGẮN (feature / usage / benefit) cho ảnh #2-4.
 * KHÔNG throw. Fallback generic nếu AI lỗi.
 */
export async function generateOverlayTextPack(ctx: {
  product_name: string;
  target_customer?: string | null;
  product_angle?: string | null;
  visual_identity?: string | null;
}): Promise<string[]> {
  const fallback = ["Tiện lợi mỗi ngày", "Dễ dùng, gọn nhẹ", "Đáng để thử"];
  const provider = getAIProvider();
  if (provider === "mock") return fallback;
  try {
    const { apiKey, baseURL, model } = resolveProviderConfig(provider);
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    const sys =
      "Bạn viết overlay text ngắn cho ảnh quảng cáo sản phẩm. Trả 3 câu: (1) feature, (2) usage, (3) benefit. " +
      "Mỗi câu tiếng Việt, <= 6 từ, dễ đọc, KHÔNG bịa giá/thương hiệu/claim y tế. CHỈ trả JSON {\"overlays\":[\"\",\"\",\"\"]}.";
    const user = [
      `Sản phẩm: ${ctx.product_name}`,
      `Tệp khách: ${ctx.target_customer ?? "(không rõ)"}`,
      `Góc: ${ctx.product_angle ?? "(không rõ)"}`,
      ctx.visual_identity ? `Nhận diện: ${ctx.visual_identity}` : "",
      "Trả đúng 3 overlay (feature/usage/benefit). CHỈ JSON.",
    ].filter(Boolean).join("\n");
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });
    await logTextApiUsage({ model, step: "overlay", success: true });
    const raw = completion.choices[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    const obj = JSON.parse(raw.slice(start, end + 1)) as { overlays?: unknown };
    const arr = Array.isArray(obj.overlays) ? obj.overlays : [];
    const out = arr
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .map((s) => s.split(/\s+/).slice(0, 7).join(" "));
    if (out.length >= 3) return out.slice(0, 3);
    return [...out, ...fallback].slice(0, 3);
  } catch {
    return fallback;
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
    // Text/prompt: ưu tiên V98_PROMPT_* -> key chung V98_*.
    const apiKey = process.env.V98_PROMPT_API_KEY?.trim() || process.env.V98_API_KEY?.trim();
    // baseURL: prompt -> chung -> (last resort) base của ảnh. V98 thường CÙNG base URL cho text & ảnh,
    // nên mượn base ảnh giúp text chạy được dù chưa đặt V98_PROMPT_BASE_URL/V98_BASE_URL.
    const baseURL =
      process.env.V98_PROMPT_BASE_URL?.trim() ||
      process.env.V98_BASE_URL?.trim() ||
      process.env.V98_IMAGE_BASE_URL?.trim();
    // model TEXT: nếu chưa đặt -> mặc định gpt-4o-mini (ổn định trên v98store; KHÔNG ném lỗi).
    const model = process.env.V98_PROMPT_MODEL?.trim() || process.env.V98_MODEL?.trim() || "gpt-4o-mini";
    if (!apiKey) throw new Error("Thiếu V98_PROMPT_API_KEY (hoặc V98_API_KEY).");
    if (!baseURL) throw new Error("Thiếu V98_PROMPT_BASE_URL (hoặc V98_BASE_URL / V98_IMAGE_BASE_URL).");
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
