import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateAffiliatePostBundle,
  generateOverlayTextPack,
  summarizeProductVisualIdentity,
  type ProductInput,
} from "@/lib/ai/client";
import {
  computePackQualityScore,
  enhanceAndStoreSourceProductImage,
  generateAndStoreImageAsset,
  storeSourceProductImage,
} from "@/lib/creative/generate-post-images";
import { insertPostingLog } from "@/lib/posts/log";
import { fetchProductDataFromProvider, getProductDataProvider } from "@/lib/product/product-data-provider";
import { extractShopeeImagesWithBrowser, getShopeeImageSourceProvider } from "@/lib/shopee/browser-extract";
import { isLikelyProductImage } from "@/lib/shopee/image-url";
import { extractShopeeProductImages, toCanonicalShopeeProductUrl } from "@/lib/shopee/extract";
import { findProductImagesViaSearch } from "@/lib/shopee/search-image-fallback";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AiJob, AiJobStatus, GeneratedPostStatus } from "@/lib/types";

const JOB_TYPE = "CREATE_AI_POST_WITH_IMAGES";
const PROGRESS_TOTAL = 7;
const STALE_MS = 5 * 60 * 1000;
// 1 ảnh thật Shopee + 3 ảnh AI bám sản phẩm = 4.
const V98_MAX_IMAGE_CALLS_PER_POST = readIntEnv("V98_MAX_IMAGE_CALLS_PER_POST", 2, 1, 4);
const AI_IMAGE_COUNT = Math.min(readIntEnv("AI_JOB_AI_IMAGE_COUNT", 3, 1, 3), V98_MAX_IMAGE_CALLS_PER_POST);
const IMAGE_STEP_COOLDOWN_MS = readIntEnv("AI_JOB_IMAGE_STEP_COOLDOWN_MS", 45 * 1000, 0, 10 * 60 * 1000);
const JOB_RETRY_DELAY_MS = readIntEnv("AI_JOB_RETRY_DELAY_MS", 60 * 1000, 0, 30 * 60 * 1000);
const RATE_LIMIT_RETRY_DELAY_MS = readIntEnv("AI_JOB_RATE_LIMIT_RETRY_DELAY_MS", 3 * 60 * 1000, 0, 60 * 60 * 1000);
const MAX_RETRY_DELAY_MS = readIntEnv("AI_JOB_MAX_RETRY_DELAY_MS", 15 * 60 * 1000, 0, 2 * 60 * 60 * 1000);
const DEFAULT_PACK_MODE = process.env.CREATIVE_DEFAULT_PACK_MODE?.trim().toUpperCase() || "1_AI_3_SOURCE";
// 1_AI_3_SOURCE = 1 ảnh AI HERO (slot 1, 1 lượt V98) + 3 ảnh nguồn Shopee enhance local (slot 2/3/4).
const ONE_AI_THREE_SOURCE = DEFAULT_PACK_MODE === "1_AI_3_SOURCE";
const SOURCE_FIRST_PACK = DEFAULT_PACK_MODE === "2_SOURCE_2_AI";
// 4_SOURCE_0_AI = 100% ảnh THẬT sản phẩm (4 slot), KHÔNG gọi API ảnh AI -> ảnh luôn giống SP + 0 tốn tiền ảnh.
const ALL_SOURCE_ALBUM = DEFAULT_PACK_MODE === "4_SOURCE_0_AI";
// Khi sản phẩm CHỈ có ít ảnh thật (Shopee chặn lấy gallery) -> slot lặp được img2img vẽ cảnh KHÁC
// (giữ đúng SP) để album không trùng. Tốn thêm lượt ảnh (trong trần ngày). Tắt -> chỉ cắt ảnh khác.
const FILL_DUP_WITH_AI = readBoolEnv("CREATIVE_FILL_DUP_WITH_AI", true);
// ÉP tail (slot 3,4...) thành các CẢNH AI KHÁC HẲN nhau (giữ 1 ảnh thật ở slot 2) -> 4 ảnh khác nhau
// kể cả khi Shopee chỉ cho 1 ảnh. Tốn ~3 lượt ảnh/bài. Tắt -> CREATIVE_TAIL_DISTINCT_AI=false.
const DISTINCT_AI_TAIL = readBoolEnv("CREATIVE_TAIL_DISTINCT_AI", true);
// Các CẢNH khác nhau cho ảnh AI tail (mô tả tiếng Anh cho model ảnh) -> mỗi slot 1 cảnh riêng.
const TAIL_AI_SCENES = [
  "clean studio product shot on a minimal wooden surface, soft diffused lighting, plain background",
  "real-life lifestyle scene, the product in everyday use, warm cozy home setting",
  "close-up detail shot at a 45-degree angle, emphasizing material and texture, soft gradient background",
  "outdoor lifestyle scene with natural daylight, dynamic modern composition",
];
// 1_AI_3_SOURCE: KHÔNG dùng fast-source-album (4 nguồn, 0 AI) để đảm bảo có đúng 1 ảnh HERO AI.
const FAST_SOURCE_ALBUM = ONE_AI_THREE_SOURCE ? false : readBoolEnv("AI_JOB_FAST_SOURCE_ALBUM", true);
const FAST_SOURCE_ALBUM_MIN_IMAGES = readIntEnv("AI_JOB_FAST_SOURCE_ALBUM_MIN_IMAGES", 4, 1, 4);
const ENHANCE_SOURCE_ALBUM = readBoolEnv("AI_JOB_ENHANCE_SOURCE_ALBUM", true);
// 1_AI_3_SOURCE chạy theo nhánh hybrid-ai-first: 1 AI trước (slot 1) rồi 3 nguồn (slot 2/3/4).
const HYBRID_AI_FIRST_ALBUM = ONE_AI_THREE_SOURCE ? true : SOURCE_FIRST_PACK ? false : readBoolEnv("AI_JOB_HYBRID_AI_FIRST_ALBUM", true);
const HYBRID_AI_IMAGE_COUNT = ONE_AI_THREE_SOURCE
  ? 1
  : Math.min(readIntEnv("AI_JOB_HYBRID_AI_IMAGE_COUNT", 2, 1, 3), V98_MAX_IMAGE_CALLS_PER_POST);
const HYBRID_SOURCE_IMAGE_COUNT = ONE_AI_THREE_SOURCE ? 3 : readIntEnv("AI_JOB_HYBRID_SOURCE_IMAGE_COUNT", 2, 1, 3);

// Logs.
const STEP_STARTED = "AI_JOB_STEP_STARTED";
const STEP_SUCCESS = "AI_JOB_STEP_SUCCESS";
const STEP_FAILED = "AI_JOB_STEP_FAILED";
const JOB_SUCCESS = "AI_JOB_SUCCESS";
const JOB_FAILED = "AI_JOB_FAILED";
const SHOPEE_FETCH_STARTED = "SHOPEE_PRODUCT_FETCH_STARTED";
const SHOPEE_FETCH_SUCCESS = "SHOPEE_PRODUCT_FETCH_SUCCESS";
const SHOPEE_FETCH_FAILED = "SHOPEE_PRODUCT_FETCH_FAILED";
const GROUNDING_READY = "PRODUCT_IMAGE_GROUNDING_READY";
const GROUNDING_MISSING = "PRODUCT_IMAGE_GROUNDING_MISSING";
const GROUNDED_GEN_STARTED = "GROUNDED_IMAGE_GENERATION_STARTED";
const GROUNDED_GEN_SUCCESS = "GROUNDED_IMAGE_GENERATION_SUCCESS";
const GROUNDED_GEN_FAILED = "GROUNDED_IMAGE_GENERATION_FAILED";
const SOURCE_ALBUM_READY = "SOURCE_PRODUCT_ALBUM_READY";

// Tiến độ theo bước (INIT là setup, không tính).
const STEP_PROGRESS: Record<string, number> = {
  INIT: 0,
  SOURCE: 1,
  VISION: 2,
  TEXT: 3,
  IMAGE_1: 4,
  IMAGE_2: 5,
  IMAGE_3: 6,
  FINALIZE: 7,
};

const MISSING_SOURCE_MSG =
  "Không lấy được ảnh sản phẩm tự động từ Shopee nên chưa thể tạo ảnh AI bám đúng sản phẩm.";

export type RunStepResult = {
  ok: boolean;
  jobId: string;
  step: string | null;
  status: AiJobStatus;
  progress: { current: number; total: number };
  error?: string;
  message?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function elapsedMsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return Date.now() - time;
}

function isRateLimitMessage(message: string | null | undefined): boolean {
  // Gồm cả thông báo "đã đạt giới hạn V98" -> dùng nhịp retry chậm hơn, đỡ poll.
  return /(^|\D)429($|\D)|rate.?limit|too many|try again|overload|quota|giới hạn|gioi han/i.test(message ?? "");
}

function retryDelayMs(job: Pick<AiJob, "attempts" | "error_message">): number {
  const attempts = Math.max(1, job.attempts ?? 1);
  if (/V98_IMAGE_TIMEOUT_RETRY_LATER|timeout|abort/i.test(job.error_message ?? "")) {
    const steps = [60_000, 3 * 60_000, 10 * 60_000];
    return steps[Math.min(steps.length - 1, attempts - 1)];
  }
  const base = isRateLimitMessage(job.error_message) ? RATE_LIMIT_RETRY_DELAY_MS : JOB_RETRY_DELAY_MS;
  const delay = base * 2 ** (attempts - 1);
  return Math.min(MAX_RETRY_DELAY_MS, delay);
}

function retryRemainingMs(job: Pick<AiJob, "status" | "attempts" | "error_message" | "updated_at">): number {
  if (job.status !== "WAITING_RETRY") return 0;
  const elapsed = elapsedMsSince(job.updated_at);
  if (elapsed === null) return 0;
  return Math.max(0, retryDelayMs(job) - elapsed);
}

function imageStepCooldownRemainingMs(step: string | null | undefined, updatedAt: string | null | undefined): number {
  const match = (step ?? "").match(/^IMAGE_([2-9]\d*)$/);
  if (!match) return 0;
  const elapsed = elapsedMsSince(updatedAt);
  if (elapsed === null) return 0;
  return Math.max(0, IMAGE_STEP_COOLDOWN_MS - elapsed);
}

function secondsLeft(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

function cleanSourceImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return dedupeSourceImages(
    images.filter((u): u is string => typeof u === "string").map((u) => u.trim()),
  );
}

// Số ảnh nguồn MONG MUỐN để album có 4 ảnh KHÁC NHAU (1 hero + 3 tail).
const DESIRED_SOURCE_IMAGES = 4;

/** Khóa chuẩn hóa ảnh Shopee CDN: cùng hash /file/<hash> => cùng 1 ảnh (bỏ _tn/size/query). */
function sourceImageKey(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/file\/([a-z0-9]+)/i);
    if (m) return `file:${m[1].toLowerCase()}`;
    return (u.origin + u.pathname).toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Dedupe ảnh nguồn theo ảnh THẬT (không tính biến thể size) -> tránh 3 slot trùng nhau. */
function dedupeSourceImages(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = (u ?? "").trim();
    if (!t || !/^https?:\/\//i.test(t)) continue;
    const k = sourceImageKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Chạy ĐÚNG MỘT bước của job. KHÔNG throw. */
async function storeSourceAlbumTail(options: {
  supabase: SupabaseClient;
  postId: string;
  sourceImages: string[];
  sourceOrigin: string | null;
  productName: string;
  overlays: string[];
  prompts: Array<{ prompt?: string | null; caption_overlay?: string | null; visual_angle?: string | null }>;
  startSortOrder: number;
  count: number;
  sourceStartIndex?: number;
  enhanced: boolean;
  // Khi 1 ảnh thật bị dùng lại: dùng img2img vẽ cảnh KHÁC (giữ đúng SP) thay vì lặp ảnh.
  fillDupWithAi?: boolean;
  // ÉP các slot tail (trừ slot đầu giữ ảnh thật) thành CẢNH AI khác hẳn nhau.
  distinctAiTail?: boolean;
  campaignRunId?: string | null;
}): Promise<{ ok: boolean; storedCount: number; errors: string[] }> {
  const {
    supabase,
    postId,
    sourceImages,
    sourceOrigin,
    productName,
    overlays,
    prompts,
    startSortOrder,
    count,
    sourceStartIndex = 1,
    enhanced: useEnhancement,
    fillDupWithAi = false,
    distinctAiTail = false,
    campaignRunId = null,
  } = options;
  await supabase
    .from("post_creative_assets")
    .delete()
    .eq("generated_post_id", postId)
    .gte("sort_order", startSortOrder)
    .lt("sort_order", startSortOrder + count);

  let storedCount = 0;
  const errors: string[] = [];
  // Đếm số lần 1 ảnh thật bị dùng lại -> ảnh lặp sẽ được cắt/zoom KHÁC để không trùng y hệt.
  const useCount = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    const src = sourceImages[sourceStartIndex + i] ?? sourceImages[i] ?? sourceImages[0];
    if (!src) {
      errors.push(`Missing source image ${sourceStartIndex + i}.`);
      continue;
    }
    const dupKey = sourceImageKey(src);
    const variant = useCount.get(dupKey) ?? 0;
    useCount.set(dupKey, variant + 1);
    const sortOrder = startSortOrder + i;
    const promptForImage = prompts[i];
    const metadata = {
      source_image_origin: sourceOrigin,
      exact_product_evidence: true,
      hybrid_ai_first_album: HYBRID_AI_FIRST_ALBUM,
      enhanced: useEnhancement,
      crop_variant: variant,
    };

    // Quyết định slot này dùng ẢNH AI (cảnh khác) hay ảnh thật:
    // - Giữ slot ĐẦU (i===0) là ẢNH THẬT để đảm bảo album có >=1 ảnh thật.
    // - distinctAiTail: ép slot i>=1 thành CẢNH AI khác hẳn nhau (kể cả khi không trùng).
    // - hoặc slot LẶP (variant>0) + fillDupWithAi: img2img cảnh khác để không trùng.
    const wantAiScene = fillDupWithAi && i >= 1 && (distinctAiTail || variant > 0);
    let stored: { ok: boolean; image_url: string | null; error: string | null } | null = null;
    if (wantAiScene) {
      const scene = TAIL_AI_SCENES[i % TAIL_AI_SCENES.length];
      const aiPrompt = `${productName}. ${scene}. Photorealistic e-commerce product photography, clean and realistic.`;
      const ai = await generateAndStoreImageAsset(
        supabase,
        postId,
        sortOrder,
        {
          prompt: aiPrompt,
          caption_overlay: overlays[i] ?? promptForImage?.caption_overlay ?? "",
          visual_angle: promptForImage?.visual_angle ?? `scene_${i}`,
        },
        {
          campaignRunId,
          referenceImageUrl: src,
          context: { source: "creative_worker", job_type: JOB_TYPE, job_step: `AI_SCENE_${sortOrder}` },
        },
      );
      if (ai.ok) {
        stored = { ok: true, image_url: ai.image_url, error: null };
      } else {
        await insertPostingLog(supabase, postId, "SOURCE_AI_SCENE_FALLBACK", "FAILED", `Cảnh AI slot ${sortOrder} không tạo được (${ai.error ?? "?"}), dùng ảnh thật cắt khác.`, {
          ai_job_id: null,
          slot_index: sortOrder,
        });
      }
    }

    if (!stored) {
      const enhanced = useEnhancement
        ? await enhanceAndStoreSourceProductImage(supabase, postId, sortOrder, src, {
            generatedFrom: HYBRID_AI_FIRST_ALBUM ? "SHOPEE_SOURCE_HYBRID_TAIL_ENHANCED" : "SHOPEE_SOURCE_FAST_ALBUM_ENHANCED",
            overlay: overlays[i] ?? promptForImage?.caption_overlay ?? "",
            productName,
            visualAngle: promptForImage?.visual_angle ?? null,
            variant,
            metadata,
          })
        : { ok: false, image_url: null, error: "source enhancement disabled" };
      stored = enhanced.ok
        ? enhanced
        : await storeSourceProductImage(supabase, postId, sortOrder, src, {
            generatedFrom: HYBRID_AI_FIRST_ALBUM ? "SHOPEE_SOURCE_HYBRID_TAIL" : "SHOPEE_SOURCE_FAST_ALBUM",
            captionOverlay: overlays[i] ?? promptForImage?.caption_overlay ?? "",
            productName,
            visualAngle: promptForImage?.visual_angle ?? null,
            metadata: { ...metadata, enhanced: false, enhance_error: enhanced.error ?? null },
          });
    }
    if (stored.ok) storedCount += 1;
    else if (stored.error) errors.push(stored.error);
  }
  return { ok: storedCount >= count, storedCount, errors };
}

export async function runAiJobStep(jobId: string): Promise<RunStepResult> {
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "DB error.";
    return { ok: false, jobId, step: null, status: "FAILED", progress: { current: 0, total: PROGRESS_TOTAL }, error: m };
  }

  const { data, error } = await supabase.from("ai_jobs").select("*").eq("id", jobId).single();
  if (error || !data) {
    return { ok: false, jobId, step: null, status: "FAILED", progress: { current: 0, total: PROGRESS_TOTAL }, error: "Không tìm thấy job." };
  }
  const job = data as AiJob;
  const progress = { current: job.progress_current, total: job.progress_total || PROGRESS_TOTAL };
  const step = job.step || "INIT";

  if (job.status === "SUCCESS" || job.status === "FAILED") {
    return { ok: true, jobId, step: job.step, status: job.status, progress, message: "Job đã kết thúc." };
  }
  if (job.status === "RUNNING" && job.locked_at) {
    const lockedMs = Date.now() - new Date(job.locked_at).getTime();
    if (Number.isFinite(lockedMs) && lockedMs < STALE_MS) {
      return { ok: true, jobId, step: job.step, status: job.status, progress, message: "Bước đang chạy, bỏ qua." };
    }
  }

  const retryRemaining = retryRemainingMs(job);
  if (retryRemaining > 0) {
    return {
      ok: true,
      jobId,
      step,
      status: "WAITING_RETRY",
      progress,
      error: job.error_message ?? undefined,
      message: `Dang cho provider ha rate-limit, thu lai sau khoang ${secondsLeft(retryRemaining)}s.`,
    };
  }

  const imageCooldownRemaining = imageStepCooldownRemainingMs(step, job.updated_at);
  if (job.status === "RUNNING" && imageCooldownRemaining > 0) {
    return {
      ok: true,
      jobId,
      step,
      status: "RUNNING",
      progress,
      message: `Dang gian nhip sinh anh, chay buoc ke sau khoang ${secondsLeft(imageCooldownRemaining)}s.`,
    };
  }

  await supabase
    .from("ai_jobs")
    .update({ status: "RUNNING", locked_at: nowIso(), started_at: job.started_at ?? nowIso(), updated_at: nowIso() })
    .eq("id", jobId);
  await insertPostingLog(supabase, job.related_post_id ?? null, STEP_STARTED, "SUCCESS", `Job ${JOB_TYPE} bước ${step}.`, {
    ai_job_id: jobId,
    step,
  });

  const advance = async (nextStep: string, patch?: Record<string, unknown>): Promise<RunStepResult> => {
    await supabase
      .from("ai_jobs")
      .update({
        status: "RUNNING",
        step: nextStep,
        progress_current: STEP_PROGRESS[step] ?? job.progress_current,
        locked_at: null,
        error_message: null,
        updated_at: nowIso(),
        ...(patch ?? {}),
      })
      .eq("id", jobId);
    await insertPostingLog(supabase, job.related_post_id ?? null, STEP_SUCCESS, "SUCCESS", `Xong bước ${step} -> ${nextStep}.`, {
      ai_job_id: jobId,
    });
    return {
      ok: true,
      jobId,
      step: nextStep,
      status: "RUNNING",
      progress: { current: STEP_PROGRESS[step] ?? progress.current, total: PROGRESS_TOTAL },
    };
  };

  const failStep = async (message: string): Promise<RunStepResult> => {
    const attempts = (job.attempts ?? 0) + 1;
    const willRetry = attempts < (job.max_attempts ?? 3);
    await insertPostingLog(supabase, job.related_post_id ?? null, STEP_FAILED, "FAILED", `Bước ${step} lỗi: ${message}`.slice(0, 1000), {
      ai_job_id: jobId,
      attempts,
    });
    if (willRetry) {
      await supabase
        .from("ai_jobs")
        .update({ status: "WAITING_RETRY", attempts, error_message: message.slice(0, 1000), locked_at: null, updated_at: nowIso() })
        .eq("id", jobId);
      return { ok: false, jobId, step, status: "WAITING_RETRY", progress, error: message };
    }
    return failHard(message, job.related_post_id);
  };

  // Dừng hẳn (không retry) — dùng cho MISSING_SOURCE / hết lượt.
  const failHard = async (message: string, postId: string | null, packStatus = "FAILED"): Promise<RunStepResult> => {
    await supabase
      .from("ai_jobs")
      .update({ status: "FAILED", error_message: message.slice(0, 1000), finished_at: nowIso(), locked_at: null, updated_at: nowIso() })
      .eq("id", jobId);
    if (postId) {
      await supabase
        .from("generated_posts")
        .update({ creative_pack_status: packStatus, creative_error: message.slice(0, 500), publish_mode: "FEED", updated_at: nowIso() })
        .eq("id", postId);
    }
    await insertPostingLog(supabase, postId ?? null, JOB_FAILED, "FAILED", `Job thất bại: ${message}`.slice(0, 1000), { ai_job_id: jobId });
    return { ok: false, jobId, step, status: "FAILED", progress, error: message };
  };

  try {
    const input = (job.input ?? {}) as {
      product_name?: string;
      original_url?: string | null;
      affiliate_link?: string;
      target_customer?: string | null;
      product_angle?: string | null;
      price_note?: string | null;
      facebook_page_id?: string | null;
      shopee_account_id?: string | null;
    };
    const jobFacebookPageId = (job as { facebook_page_id?: string | null }).facebook_page_id ?? input.facebook_page_id ?? null;

    // ---------- INIT ----------
    if (step === "INIT") {
      const { data: post, error: insErr } = await supabase
        .from("generated_posts")
        .insert({
          product_id: job.related_product_id,
          ai_campaign_run_id: job.ai_campaign_run_id ?? null,
          facebook_page_id: jobFacebookPageId,
          shopee_account_id: input.shopee_account_id ?? null,
          status: "DRAFT",
          should_publish: false,
          ai_score: 0,
          creative_pack_status: "PENDING",
          creative_pack_mode: "MIXED",
          creative_min_assets: 4,
          publish_mode: "FEED",
          // Autopilot: bài chờ duyệt; bài thủ công sẽ được set APPROVED ở FINALIZE.
          review_status: job.ai_campaign_run_id ? "PENDING_REVIEW" : null,
          automation_status: job.ai_campaign_run_id ? "WAITING_REVIEW" : null,
        })
        .select("id")
        .single();
      if (insErr || !post) return failStep(`Tạo bài nháp thất bại: ${insErr?.message ?? "không rõ"}`);
      return advance("SOURCE", { related_post_id: post.id });
    }

    const postId = job.related_post_id;
    if (!postId) return failStep("Thiếu related_post_id (chưa qua INIT).");

    // ---------- SOURCE: lấy ảnh thật từ link Shopee (robust + diagnostics) ----------
    if (step === "SOURCE") {
      await insertPostingLog(supabase, postId, SHOPEE_FETCH_STARTED, "SUCCESS", "Bắt đầu lấy ảnh sản phẩm từ Shopee.", { ai_job_id: jobId });

      // Strategy A: dùng ảnh đã lưu trên product nếu hợp lệ.
      let images: string[] = [];
      let diagnostics: unknown = null;
      let productUrl: string | null = null;
      let productOriginalUrl: string | null = null;
      let productAffiliateLink: string | null = null;
      let productName: string | null = null;
      let sourceImageOrigin: "stored" | "provider_api" | "shopee_server" | "shopee_browser" | "image_search_fallback" | null = null;
      if (job.related_product_id) {
        const { data: prod } = await supabase
          .from("products")
          .select("product_name, image_url, source_product_images, original_url, affiliate_link")
          .eq("id", job.related_product_id)
          .single();
        const stored = Array.isArray(prod?.source_product_images)
          ? (prod!.source_product_images as unknown[]).filter((u): u is string => typeof u === "string" && isLikelyProductImage(u))
          : [];
        if (stored.length > 0) {
          images = dedupeSourceImages(stored);
          sourceImageOrigin = "stored";
        } else if (typeof prod?.image_url === "string" && isLikelyProductImage(prod.image_url)) {
          images = [prod.image_url];
          sourceImageOrigin = "stored";
        }
        productName = typeof prod?.product_name === "string" ? prod.product_name : null;
        productOriginalUrl = typeof prod?.original_url === "string" ? prod.original_url : null;
        productAffiliateLink = typeof prod?.affiliate_link === "string" ? prod.affiliate_link : null;
      }

      // Strategy: Product Data Provider (Apify/custom_api) — nguồn API trả ảnh thật.
      // Làm giàu khi CHƯA đủ ảnh KHÁC NHAU (merge, không ghi đè) để album không bị trùng ảnh.
      let providerDiag: Record<string, unknown> | null = null;
      if (images.length < DESIRED_SOURCE_IMAGES && getProductDataProvider() !== "none") {
        const pr = await fetchProductDataFromProvider({
          affiliate_link: productAffiliateLink ?? input.affiliate_link ?? "",
          resolved_url: productOriginalUrl ?? input.original_url ?? null,
          shop_id: null,
          item_id: null,
        });
        providerDiag = {
          productDataProviderTried: true,
          productDataProvider: pr.source,
          productDataProviderOk: pr.ok,
          productDataProviderError: pr.error ?? null,
          productDataProviderImageCount: pr.image_urls?.length ?? 0,
        };
        if (pr.ok && pr.image_urls && pr.image_urls.length > 0) {
          images = dedupeSourceImages([...images, ...pr.image_urls]);
          if (!sourceImageOrigin) sourceImageOrigin = "provider_api";
          if (!productName && pr.product_name) productName = pr.product_name;
        }
      }

      // Strategy server_fetch (resolve + meta + api + html scan).
      const sourceLinks = Array.from(
        new Set(
          [
            productOriginalUrl,
            input.original_url,
            productAffiliateLink,
            input.affiliate_link,
          ]
            .map((u) => (u ?? "").trim())
            .filter((u) => u.length > 0),
        ),
      );
      let finalUrl = sourceLinks[0] ?? "";
      // Làm giàu gallery khi chưa đủ ảnh KHÁC NHAU: gọi extract (gồm Shopee item API trả full ảnh),
      // MERGE + dedupe theo ảnh thật. Dừng khi đã đủ DESIRED_SOURCE_IMAGES.
      if (images.length < DESIRED_SOURCE_IMAGES) {
        for (const sourceLink of sourceLinks) {
          const ext = await extractShopeeProductImages(sourceLink);
          diagnostics = ext.diagnostics;
          finalUrl = ext.diagnostics.finalUrl ?? sourceLink;
          productUrl = finalUrl;
          if (ext.ok) {
            images = dedupeSourceImages([...images, ...ext.image_urls]);
            if (!sourceImageOrigin) sourceImageOrigin = "shopee_server";
            if (images.length >= DESIRED_SOURCE_IMAGES) break;
          }
          const canonical = toCanonicalShopeeProductUrl(finalUrl);
          if (canonical && canonical !== finalUrl && images.length < DESIRED_SOURCE_IMAGES) {
            const canonicalExt = await extractShopeeProductImages(canonical);
            diagnostics = {
              ...canonicalExt.diagnostics,
              previousAttempt: ext.diagnostics,
            };
            finalUrl = canonicalExt.diagnostics.finalUrl ?? canonical;
            productUrl = finalUrl;
            if (canonicalExt.ok) {
              images = dedupeSourceImages([...images, ...canonicalExt.image_urls]);
              if (!sourceImageOrigin) sourceImageOrigin = "shopee_server";
              if (images.length >= DESIRED_SOURCE_IMAGES) break;
            }
          }
        }
      }

      // Strategy B: browser-render-gallery (chỉ khi server fetch trống + provider browserless).
      let browserDiag: Record<string, unknown> | null = null;
      const provider = getShopeeImageSourceProvider();
      if (images.length === 0 && provider === "browserless") {
        const browserUrls = Array.from(new Set([toCanonicalShopeeProductUrl(finalUrl), finalUrl].filter((u): u is string => !!u)));
        for (const browserUrl of browserUrls) {
          const b = await extractShopeeImagesWithBrowser(browserUrl);
          browserDiag = {
            browserExtractionTried: true,
            browserExtractionUrl: browserUrl,
            browserExtractionStatus: b.status,
            browserExtractionError: b.error,
            sourceStrategy: b.ok ? "browser-render-gallery" : undefined,
            ...b.diagnostics,
          };
          if (b.ok) {
            images = b.image_urls;
            sourceImageOrigin = "shopee_browser";
            break;
          }
        }
      }

      // Lưu ảnh nguồn vào product nếu có.
      // Strategy C: image-search fallback. Chạy sau cùng khi Shopee page/API/browser đều bị chặn.
      let imageSearchDiag: Record<string, unknown> | null = null;
      if (images.length === 0) {
        const diagRecord = diagnostics && typeof diagnostics === "object" ? (diagnostics as Record<string, unknown>) : {};
        const searchFallback = await findProductImagesViaSearch({
          productName,
          productUrl: finalUrl,
          shopId: typeof diagRecord.detectedShopId === "string" ? diagRecord.detectedShopId : null,
          itemId: typeof diagRecord.detectedItemId === "string" ? diagRecord.detectedItemId : null,
        });
        imageSearchDiag = {
          imageSearchFallbackTried: true,
          sourceStrategy: searchFallback.ok ? "image-search-fallback" : undefined,
          ...searchFallback.diagnostics,
        };
        if (searchFallback.ok) {
          images = searchFallback.image_urls;
          sourceImageOrigin = "image_search_fallback";
        }
      }

      if (images.length > 0 && job.related_product_id && sourceImageOrigin !== "image_search_fallback") {
        await supabase
          .from("products")
          .update({ source_product_images: images, image_url: images[0], updated_at: nowIso() })
          .eq("id", job.related_product_id);
      }

      const combinedDiag = {
        ...(diagnostics && typeof diagnostics === "object" ? (diagnostics as Record<string, unknown>) : {}),
        imageSourceProvider: provider,
        sourceLinkCandidates: sourceLinks.length,
        ...(providerDiag ?? {}),
        browserExtractionTried: browserDiag !== null,
        ...(browserDiag ?? {}),
        imageSearchFallbackTried: imageSearchDiag !== null,
        ...(imageSearchDiag ?? {}),
        sourceImageOrigin,
        firstValidImages: images.slice(0, 5),
      };
      const baseOutput = { ...((job.output as object) ?? {}), source_images: images, source_diagnostics: combinedDiag, product_url: productUrl };
      // Luôn ghi diagnostics vào output để UI xem được khi fail.
      await supabase.from("ai_jobs").update({ output: baseOutput, updated_at: nowIso() }).eq("id", jobId);

      if (images.length === 0) {
        await insertPostingLog(supabase, postId, SHOPEE_FETCH_FAILED, "FAILED", "Không lấy được ảnh sản phẩm thật.", { ai_job_id: jobId });
        await insertPostingLog(supabase, postId, GROUNDING_MISSING, "FAILED", MISSING_SOURCE_MSG, { ai_job_id: jobId });
        return failHard(
          "Chưa lấy được ảnh nguồn sản phẩm tự động. Hãy kiểm tra Browserless proxy/9proxy hoặc bổ sung original_url sạch rồi tạo lại bài.",
          postId,
          "MISSING_PRODUCT_IMAGE",
        );
      }

      const stored = await storeSourceProductImage(supabase, postId, 1, images[0], {
        generatedFrom: sourceImageOrigin === "image_search_fallback" ? "IMAGE_SEARCH_FALLBACK" : "SHOPEE_SOURCE",
        captionOverlay: "Ảnh gốc sản phẩm",
        productName: productName ?? input.product_name ?? "Sản phẩm",
        visualAngle: "source",
        metadata: {
          source_image_origin: sourceImageOrigin,
          exact_product_evidence: sourceImageOrigin !== "image_search_fallback",
          image_search_fallback_strict:
            imageSearchDiag && typeof imageSearchDiag.imageSearchFallbackStrict === "boolean"
              ? imageSearchDiag.imageSearchFallbackStrict
              : undefined,
        },
      });
      if (!stored.ok) return failStep(stored.error ?? "Lưu ảnh nguồn thất bại.");
      await insertPostingLog(supabase, postId, SHOPEE_FETCH_SUCCESS, "SUCCESS", `Lấy ${images.length} ảnh sản phẩm Shopee.`, { ai_job_id: jobId });
      await insertPostingLog(supabase, postId, GROUNDING_READY, "SUCCESS", "Đã có ảnh nguồn để grounding.", { ai_job_id: jobId });
      return advance("VISION", { attempts: 0, output: baseOutput });
    }

    // ---------- VISION: tóm tắt nhận diện thị giác ----------
    if (step === "VISION") {
      const out = (job.output ?? {}) as { source_images?: string[] };
      const images = Array.isArray(out.source_images) ? out.source_images : [];
      const vi = await summarizeProductVisualIdentity(images, input.product_name ?? "Sản phẩm");
      return advance("TEXT", { output: { ...out, visual_identity: vi } });
    }

    // ---------- TEXT: caption + hook + prompt (grounded) ----------
    if (step === "TEXT") {
      const out = (job.output ?? {}) as {
        visual_identity?: string;
        source_images?: unknown;
        source_diagnostics?: Record<string, unknown>;
      };
      const productInput: ProductInput = {
        product_name: input.product_name ?? "Sản phẩm",
        affiliate_link: input.affiliate_link ?? "",
        target_customer: input.target_customer ?? null,
        product_angle: input.product_angle ?? null,
        price_note: input.price_note ?? null,
      };
      const bundle = await generateAffiliatePostBundle(productInput, { visualIdentity: out.visual_identity });
      // Overlay text (feature/usage/benefit) cho ảnh #2-4.
      const overlays = await generateOverlayTextPack({
        product_name: productInput.product_name,
        target_customer: productInput.target_customer,
        product_angle: productInput.product_angle,
        visual_identity: (out as { visual_identity?: string }).visual_identity,
      });
      await supabase
        .from("generated_posts")
        .update({
          caption: bundle.caption,
          hook: bundle.hook,
          ai_score: bundle.score,
          safety_notes: bundle.safety_notes,
          should_publish: bundle.should_publish,
          updated_at: nowIso(),
        })
        .eq("id", postId);
      const sourceImages = cleanSourceImages(out.source_images);
      const sourceOrigin =
        out.source_diagnostics && typeof out.source_diagnostics.sourceImageOrigin === "string"
          ? out.source_diagnostics.sourceImageOrigin
          : null;

      // 4_SOURCE_0_AI: dùng 100% ảnh THẬT sản phẩm cho 4 slot, KHÔNG gọi API ảnh AI.
      // Slot 1 đã lưu ở bước SOURCE; ở đây lưu slot 2/3/4 (tự nhân bản nếu ít ảnh) rồi FINALIZE.
      if (ALL_SOURCE_ALBUM && sourceImages.length >= 1 && sourceOrigin !== "image_search_fallback") {
        const tail = await storeSourceAlbumTail({
          supabase,
          postId,
          sourceImages,
          sourceOrigin,
          productName: productInput.product_name,
          overlays,
          prompts: bundle.image_prompts.slice(1),
          startSortOrder: 2,
          count: 3,
          sourceStartIndex: 1,
          enhanced: ENHANCE_SOURCE_ALBUM,
          fillDupWithAi: false, // 4_SOURCE_0_AI: giữ 0 ảnh AI -> ảnh lặp chỉ cắt khác.
          distinctAiTail: false,
        });
        if (tail.ok) {
          await insertPostingLog(
            supabase,
            postId,
            SOURCE_ALBUM_READY,
            "SUCCESS",
            "Dùng 100% ảnh thật sản phẩm (4_SOURCE_0_AI) — KHÔNG gọi API ảnh AI, ảnh khớp đúng sản phẩm.",
            { ai_job_id: jobId, source_image_count: sourceImages.length },
          );
          return advance("FINALIZE", {
            attempts: 0,
            output: {
              ...out,
              image_prompts: bundle.image_prompts.slice(0, 1),
              overlays,
              ai_score: bundle.score,
              should_publish: bundle.should_publish,
              all_source_album: true,
            },
          });
        }
        await insertPostingLog(
          supabase,
          postId,
          SOURCE_ALBUM_READY,
          "FAILED",
          `4_SOURCE_0_AI: chưa lưu đủ ảnh thật (${tail.storedCount}/3). ${tail.errors[0] ?? ""}`.slice(0, 500),
          { ai_job_id: jobId },
        );
        // rơi xuống nhánh thường bên dưới (sẽ dùng AI) nếu không đủ ảnh thật.
      }

      const canUseFastSourceAlbum =
        FAST_SOURCE_ALBUM &&
        sourceImages.length >= FAST_SOURCE_ALBUM_MIN_IMAGES &&
        sourceOrigin !== "image_search_fallback";
      if (canUseFastSourceAlbum) {
        await supabase
          .from("post_creative_assets")
          .delete()
          .eq("generated_post_id", postId)
          .gte("sort_order", 2)
          .lte("sort_order", 4);

        let storedCount = 0;
        const storeErrors: string[] = [];
        for (let i = 1; i < Math.min(4, sourceImages.length); i += 1) {
          const promptForImage = bundle.image_prompts[i - 1];
          const metadata = {
            source_image_origin: sourceOrigin,
            exact_product_evidence: true,
            fast_source_album: true,
            enhanced: ENHANCE_SOURCE_ALBUM,
          };
          const enhanced = ENHANCE_SOURCE_ALBUM
            ? await enhanceAndStoreSourceProductImage(supabase, postId, i + 1, sourceImages[i], {
                generatedFrom: "SHOPEE_SOURCE_FAST_ALBUM_ENHANCED",
                overlay: overlays[i - 1] ?? promptForImage?.caption_overlay ?? "",
                productName: productInput.product_name,
                visualAngle: promptForImage?.visual_angle ?? null,
                metadata,
              })
            : { ok: false, image_url: null, error: "source enhancement disabled" };
          const stored = enhanced.ok
            ? enhanced
            : await storeSourceProductImage(supabase, postId, i + 1, sourceImages[i], {
                generatedFrom: "SHOPEE_SOURCE_FAST_ALBUM",
                captionOverlay: overlays[i - 1] ?? promptForImage?.caption_overlay ?? "",
                productName: productInput.product_name,
                visualAngle: promptForImage?.visual_angle ?? null,
                metadata: { ...metadata, enhanced: false, enhance_error: enhanced.error ?? null },
              });
          if (stored.ok) storedCount += 1;
          else if (stored.error) storeErrors.push(stored.error);
        }

        if (storedCount >= 3) {
          await insertPostingLog(
            supabase,
            postId,
            SOURCE_ALBUM_READY,
            "SUCCESS",
            "Dung 4 anh goc Shopee/Open API lam album nhanh, bo qua provider tao anh de tranh 429.",
            { ai_job_id: jobId, source_image_count: sourceImages.length },
          );
          return advance("FINALIZE", {
            attempts: 0,
            output: {
              ...out,
              image_prompts: bundle.image_prompts.slice(0, AI_IMAGE_COUNT),
              overlays,
              ai_score: bundle.score,
              should_publish: bundle.should_publish,
              fast_source_album: true,
              enhanced_source_album: ENHANCE_SOURCE_ALBUM,
            },
          });
        }

        await supabase
          .from("post_creative_assets")
          .delete()
          .eq("generated_post_id", postId)
          .gte("sort_order", 2)
          .lte("sort_order", 4);
        await insertPostingLog(
          supabase,
          postId,
          SOURCE_ALBUM_READY,
          "FAILED",
          `Khong luu du anh goc cho fast album (${storedCount}/3). Fallback sang AI image. ${storeErrors[0] ?? ""}`.slice(0, 1000),
          { ai_job_id: jobId, source_image_count: sourceImages.length },
        );
      }

      const sourceFirstForPost = SOURCE_FIRST_PACK && sourceImages.length >= 2 && sourceOrigin !== "image_search_fallback";
      if (sourceFirstForPost) {
        await supabase.from("post_creative_assets").delete().eq("generated_post_id", postId).eq("sort_order", 2);
        const promptForImage = bundle.image_prompts[1];
        const metadata = {
          source_image_origin: sourceOrigin,
          exact_product_evidence: true,
          source_first_pack: true,
          enhanced: ENHANCE_SOURCE_ALBUM,
        };
        const enhanced = ENHANCE_SOURCE_ALBUM
          ? await enhanceAndStoreSourceProductImage(supabase, postId, 2, sourceImages[1], {
              generatedFrom: "SHOPEE_SOURCE_2_SOURCE_2_AI_ENHANCED",
              overlay: overlays[1] ?? promptForImage?.caption_overlay ?? "",
              productName: productInput.product_name,
              visualAngle: promptForImage?.visual_angle ?? "source",
              metadata,
            })
          : { ok: false, image_url: null, error: "source enhancement disabled" };
        const stored = enhanced.ok
          ? enhanced
          : await storeSourceProductImage(supabase, postId, 2, sourceImages[1], {
              generatedFrom: "SHOPEE_SOURCE_2_SOURCE_2_AI",
              captionOverlay: overlays[1] ?? promptForImage?.caption_overlay ?? "",
              productName: productInput.product_name,
              visualAngle: promptForImage?.visual_angle ?? "source",
              metadata: { ...metadata, enhanced: false, enhance_error: enhanced.error ?? null },
            });
        if (!stored.ok) return failStep(stored.error ?? "Luu anh nguon slot 2 that bai.");
      }

      await insertPostingLog(supabase, postId, GROUNDED_GEN_STARTED, "SUCCESS", "Sinh ảnh AI bám sản phẩm + overlay.", { ai_job_id: jobId });
      return advance("IMAGE_1", {
        output: {
          ...out,
          image_prompts: bundle.image_prompts.slice(0, sourceFirstForPost ? 2 : HYBRID_AI_FIRST_ALBUM ? HYBRID_AI_IMAGE_COUNT : AI_IMAGE_COUNT),
          overlays,
          ai_score: bundle.score,
          should_publish: bundle.should_publish,
          hybrid_ai_first_album: HYBRID_AI_FIRST_ALBUM,
          source_first_pack: sourceFirstForPost,
          hybrid_source_image_count: HYBRID_SOURCE_IMAGE_COUNT,
        },
      });
    }

    // ---------- IMAGE_1..3: ảnh AI grounded (sort 2..4) ----------
    const imageStep = step.match(/^IMAGE_([1-3])$/);
    if (imageStep) {
      const idx = parseInt(imageStep[1], 10); // 1..3
      const out = (job.output ?? {}) as {
        image_prompts?: Array<{ prompt: string; caption_overlay?: string; visual_angle?: string }>;
        overlays?: string[];
        source_images?: unknown;
        source_diagnostics?: Record<string, unknown>;
        hybrid_ai_first_album?: boolean;
        source_first_pack?: boolean;
      };
      const prompts = Array.isArray(out.image_prompts) ? out.image_prompts : [];
      const overlays = Array.isArray(out.overlays) ? out.overlays : [];
      const p = prompts[idx - 1];
      const useHybrid = out.hybrid_ai_first_album === true;
      const sourceFirst = out.source_first_pack === true;
      const aiTargetCount = sourceFirst ? 2 : useHybrid ? HYBRID_AI_IMAGE_COUNT : AI_IMAGE_COUNT;
      const sortOrder = sourceFirst ? idx + 2 : useHybrid ? idx : idx + 1;
      if (!p || !p.prompt) return failStep(`Thiếu prompt ảnh #${idx}.`);
      // Gán overlay text -> generateAndStoreImageAsset sẽ render chữ lên ảnh.
      const pWithOverlay = { ...p, caption_overlay: overlays[idx - 1] ?? p.caption_overlay ?? "" };
      // Ảnh thật sản phẩm làm tham chiếu cho img2img (AI vẽ DỰA trên ảnh gốc -> giữ đúng sản phẩm).
      const refImages = cleanSourceImages(out.source_images);
      const referenceImageUrl = refImages[0] ?? null;
      const res = await generateAndStoreImageAsset(supabase, postId, sortOrder, pWithOverlay, {
        campaignRunId: job.ai_campaign_run_id ?? null,
        referenceImageUrl,
        // Context creative worker — chỉ ở đây V98 Image Key mới được phép bị trừ tiền.
        context: {
          source: "creative_worker",
          job_type: JOB_TYPE,
          job_step: idx === 1 ? "AI_HERO_IMAGE" : step,
        },
      });
      if (!res.ok && res.blockedByBudget) {
        // Hết quota V98 hôm nay -> tạm hoãn (KHÔNG tính attempts), chờ reset.
        const budgetMsg = res.error ?? "Đã đạt giới hạn V98 hôm nay.";
        await supabase
          .from("ai_jobs")
          .update({ status: "WAITING_RETRY", error_message: budgetMsg.slice(0, 500), locked_at: null, updated_at: nowIso() })
          .eq("id", jobId);
        if (job.ai_campaign_run_id) {
          await supabase
            .from("ai_campaign_runs")
            .update({ automation_error: budgetMsg.slice(0, 500), updated_at: nowIso() })
            .eq("id", job.ai_campaign_run_id);
        }
        await insertPostingLog(supabase, postId, "AUTOPILOT_FAILED_RECOVERABLE", "FAILED", budgetMsg, { ai_job_id: jobId, budget_block: true });
        return { ok: false, jobId, step, status: "WAITING_RETRY", progress, error: budgetMsg };
      }
      if (!res.ok) {
        await insertPostingLog(supabase, postId, GROUNDED_GEN_FAILED, "FAILED", res.error ?? `Ảnh #${idx} lỗi.`, { ai_job_id: jobId });
        return failStep(res.error ?? `Sinh ảnh #${idx} thất bại.`);
      }
      await insertPostingLog(supabase, postId, GROUNDED_GEN_SUCCESS, "SUCCESS", `Ảnh AI #${idx} xong.`, { ai_job_id: jobId });
      if (useHybrid && idx >= aiTargetCount) {
        const sourceImages = cleanSourceImages(out.source_images);
        const sourceOrigin =
          out.source_diagnostics && typeof out.source_diagnostics.sourceImageOrigin === "string"
            ? out.source_diagnostics.sourceImageOrigin
            : null;
        const tail = await storeSourceAlbumTail({
          supabase,
          postId,
          sourceImages,
          sourceOrigin,
          productName: input.product_name ?? "San pham",
          overlays: overlays.slice(aiTargetCount),
          prompts: prompts.slice(aiTargetCount),
          startSortOrder: aiTargetCount + 1,
          count: HYBRID_SOURCE_IMAGE_COUNT,
          sourceStartIndex: 1,
          enhanced: ENHANCE_SOURCE_ALBUM,
          fillDupWithAi: FILL_DUP_WITH_AI,
          distinctAiTail: DISTINCT_AI_TAIL,
          campaignRunId: job.ai_campaign_run_id ?? null,
        });
        if (!tail.ok) {
          await insertPostingLog(
            supabase,
            postId,
            SOURCE_ALBUM_READY,
            "FAILED",
            `Khong luu du anh goc cuoi album (${tail.storedCount}/${HYBRID_SOURCE_IMAGE_COUNT}). ${tail.errors[0] ?? ""}`.slice(0, 1000),
            { ai_job_id: jobId, source_image_count: sourceImages.length },
          );
          return failStep(`Chua luu du anh goc cuoi album: ${tail.storedCount}/${HYBRID_SOURCE_IMAGE_COUNT}.`);
        }
        await insertPostingLog(
          supabase,
          postId,
          SOURCE_ALBUM_READY,
          "SUCCESS",
          `Da them ${tail.storedCount} anh goc san pham vao cuoi album hybrid.`,
          { ai_job_id: jobId, source_image_count: sourceImages.length },
        );
        return advance("FINALIZE", { attempts: 0 });
      }
      if (!useHybrid && !sourceFirst && idx >= aiTargetCount) {
        const sourceImages = cleanSourceImages(out.source_images);
        const sourceOrigin =
          out.source_diagnostics && typeof out.source_diagnostics.sourceImageOrigin === "string"
            ? out.source_diagnostics.sourceImageOrigin
            : null;
        const tail = await storeSourceAlbumTail({
          supabase,
          postId,
          sourceImages,
          sourceOrigin,
          productName: input.product_name ?? "San pham",
          overlays: overlays.slice(aiTargetCount),
          prompts: prompts.slice(aiTargetCount),
          startSortOrder: aiTargetCount + 2,
          count: Math.max(0, 4 - (aiTargetCount + 1)),
          sourceStartIndex: 0,
          enhanced: ENHANCE_SOURCE_ALBUM,
          fillDupWithAi: FILL_DUP_WITH_AI,
          distinctAiTail: DISTINCT_AI_TAIL,
          campaignRunId: job.ai_campaign_run_id ?? null,
        });
        if (!tail.ok) {
          await insertPostingLog(
            supabase,
            postId,
            SOURCE_ALBUM_READY,
            "FAILED",
            `Khong luu du bien the anh nguon (${tail.storedCount}). ${tail.errors[0] ?? ""}`.slice(0, 1000),
            { ai_job_id: jobId, source_image_count: sourceImages.length },
          );
          return failStep(`Chua luu du bien the anh nguon: ${tail.storedCount}.`);
        }
        return advance("FINALIZE", { attempts: 0 });
      }
      const next = idx < aiTargetCount ? `IMAGE_${idx + 1}` : "FINALIZE";
      return advance(next, { attempts: 0 });
    }

    // ---------- FINALIZE ----------
    if (step === "FINALIZE") {
      const { data: assets } = await supabase
        .from("post_creative_assets")
        .select("status, image_url, source_type, metadata")
        .eq("generated_post_id", postId)
        .eq("status", "READY");
      const list = (assets ?? []) as Array<{ image_url: string | null; source_type: string | null; metadata: unknown }>;
      const realReady = list.filter((a) => {
        const m = a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
        return !!a.image_url && m.mock !== true;
      });
      const productCount = realReady.filter((a) => a.source_type === "PRODUCT").length;
      const total = realReady.length;
      const aiCount = realReady.filter((a) => a.source_type === "AI_GENERATED").length;
      const packScore = computePackQualityScore(
        list.map((a) => ({
          image_url: a.image_url,
          source_type: a.source_type,
          status: "READY",
          metadata: a.metadata,
        })),
      );

      const out = (job.output ?? {}) as { ai_score?: number; should_publish?: boolean };
      const aiScore = typeof out.ai_score === "number" ? out.ai_score : 0;
      const shouldPublish = out.should_publish === true;

      if (total >= 4 && productCount >= 1) {
        const isAutopilot = !!job.ai_campaign_run_id;
        // Autopilot: pack đủ ảnh -> luôn READY và chờ NGƯỜI duyệt (không tự đăng theo ai_score).
        // Thủ công: giữ hành vi cũ (READY nếu AI duyệt + score>=80), và set review_status=APPROVED
        // để cron đăng được như trước (cron giờ yêu cầu review_status=APPROVED).
        const postStatus: GeneratedPostStatus = isAutopilot
          ? "READY"
          : aiScore >= 80 && shouldPublish
            ? "READY"
            : "REJECTED";
        const reviewPatch = isAutopilot
          ? { review_status: "PENDING_REVIEW", automation_status: "WAITING_REVIEW" }
          : { review_status: postStatus === "READY" ? "APPROVED" : "REJECTED" };
        await supabase
          .from("generated_posts")
          .update({
            creative_pack_status: "READY",
            creative_pack_mode: "MIXED",
            publish_mode: "PHOTO_ALBUM",
            status: postStatus,
            ...reviewPatch,
            creative_summary: `${total} ảnh (nguồn Shopee: ${productCount}, AI bám SP: ${aiCount}, score: ${packScore}).`,
            creative_error: null,
            updated_at: nowIso(),
          })
          .eq("id", postId);
        await supabase
          .from("ai_jobs")
          .update({ status: "SUCCESS", step: "FINALIZE", progress_current: PROGRESS_TOTAL, finished_at: nowIso(), locked_at: null, error_message: null, updated_at: nowIso() })
          .eq("id", jobId);
        await insertPostingLog(supabase, postId, "CREATIVE_PACK_SCORE_COMPUTED", "SUCCESS", `Creative pack score: ${packScore}.`, {
          ai_job_id: jobId,
          creative_pack_score: packScore,
          v98_image_calls_used: aiCount,
        });
        if (isAutopilot) {
          await insertPostingLog(supabase, postId, "POST_WAITING_REVIEW", "SUCCESS", `Bài đã sẵn ảnh, chờ duyệt. Score: ${packScore}.`, {
            ai_job_id: jobId,
            ai_campaign_run_id: job.ai_campaign_run_id,
          });
        }
        await insertPostingLog(supabase, postId, JOB_SUCCESS, "SUCCESS", `Job xong: ${total} ảnh (nguồn ${productCount}), post ${postStatus}.`, { ai_job_id: jobId });
        return { ok: true, jobId, step: "FINALIZE", status: "SUCCESS", progress: { current: PROGRESS_TOTAL, total: PROGRESS_TOTAL } };
      }

      const msg =
        productCount === 0
          ? MISSING_SOURCE_MSG
          : `Chưa đủ ảnh: ${total}/4 (nguồn Shopee: ${productCount}).`;
      return failHard(msg, postId, productCount === 0 ? "MISSING_PRODUCT_IMAGE" : total >= 1 ? "PARTIAL" : "FAILED");
    }

    return advance("INIT");
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return failStep(m);
  }
}

/** Tìm 1 job để chạy: PENDING/WAITING_RETRY trước, rồi RUNNING quá hạn (stale). */
export async function pickAndRunNextJob(): Promise<RunStepResult | { ok: true; message: string }> {
  const supabase = createSupabaseAdminClient();
  const { data: pending } = await supabase
    .from("ai_jobs")
    .select("id")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(1);
  let jobId = pending?.[0]?.id as string | undefined;

  if (!jobId) {
    const { data: candidates } = await supabase
      .from("ai_jobs")
      .select("id,status,step,attempts,error_message,locked_at,updated_at")
      .in("status", ["WAITING_RETRY", "RUNNING"])
      .is("locked_at", null)
      .order("created_at", { ascending: true })
      .limit(20);
    const ready = ((candidates ?? []) as AiJob[]).find((candidate) => {
      if (retryRemainingMs(candidate) > 0) return false;
      if (imageStepCooldownRemainingMs(candidate.step, candidate.updated_at) > 0) return false;
      return true;
    });
    jobId = ready?.id;
  }

  if (!jobId) {
    const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
    const { data: stale } = await supabase
      .from("ai_jobs")
      .select("id")
      .eq("status", "RUNNING")
      .lt("locked_at", staleBefore)
      .order("created_at", { ascending: true })
      .limit(1);
    jobId = stale?.[0]?.id as string | undefined;
  }

  if (!jobId) return { ok: true, message: "Không có job nào để chạy." };
  return runAiJobStep(jobId);
}
