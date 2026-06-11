import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateAffiliatePostBundle,
  generateOverlayTextPack,
  summarizeProductVisualIdentity,
  type ProductInput,
} from "@/lib/ai/client";
import { generateAndStoreImageAsset, storeSourceProductImage } from "@/lib/creative/generate-post-images";
import { insertPostingLog } from "@/lib/posts/log";
import { extractShopeeImagesWithBrowser, getShopeeImageSourceProvider } from "@/lib/shopee/browser-extract";
import { isLikelyProductImage } from "@/lib/shopee/enrich";
import { extractShopeeProductImages } from "@/lib/shopee/extract";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AiJob, AiJobStatus, GeneratedPostStatus } from "@/lib/types";

const JOB_TYPE = "CREATE_AI_POST_WITH_IMAGES";
const PROGRESS_TOTAL = 7;
const STALE_MS = 5 * 60 * 1000;
// 1 ảnh thật Shopee + 3 ảnh AI bám sản phẩm = 4.
const AI_IMAGE_COUNT = 3;

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
  "Không lấy được ảnh sản phẩm từ link Shopee nên chưa thể tạo ảnh AI bám đúng sản phẩm.";

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

/** Chạy ĐÚNG MỘT bước của job. KHÔNG throw. */
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

  if (job.status === "SUCCESS" || job.status === "FAILED") {
    return { ok: true, jobId, step: job.step, status: job.status, progress, message: "Job đã kết thúc." };
  }
  if (job.status === "RUNNING" && job.locked_at) {
    const lockedMs = Date.now() - new Date(job.locked_at).getTime();
    if (Number.isFinite(lockedMs) && lockedMs < STALE_MS) {
      return { ok: true, jobId, step: job.step, status: job.status, progress, message: "Bước đang chạy, bỏ qua." };
    }
  }

  const step = job.step || "INIT";

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
      affiliate_link?: string;
      target_customer?: string | null;
      product_angle?: string | null;
      price_note?: string | null;
    };

    // ---------- INIT ----------
    if (step === "INIT") {
      const { data: post, error: insErr } = await supabase
        .from("generated_posts")
        .insert({
          product_id: job.related_product_id,
          status: "DRAFT",
          should_publish: false,
          ai_score: 0,
          creative_pack_status: "PENDING",
          creative_pack_mode: "MIXED",
          creative_min_assets: 4,
          publish_mode: "FEED",
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
      const link = (input.affiliate_link ?? "").trim();

      // Strategy A: dùng ảnh đã lưu trên product nếu hợp lệ.
      let images: string[] = [];
      let diagnostics: unknown = null;
      let productUrl: string | null = null;
      if (job.related_product_id) {
        const { data: prod } = await supabase
          .from("products")
          .select("image_url, source_product_images")
          .eq("id", job.related_product_id)
          .single();
        const stored = Array.isArray(prod?.source_product_images)
          ? (prod!.source_product_images as unknown[]).filter((u): u is string => typeof u === "string" && isLikelyProductImage(u))
          : [];
        if (stored.length > 0) images = stored;
        else if (typeof prod?.image_url === "string" && isLikelyProductImage(prod.image_url)) images = [prod.image_url];
      }

      // Strategy server_fetch (resolve + meta + api + html scan).
      let finalUrl = link;
      if (images.length === 0) {
        const ext = await extractShopeeProductImages(link);
        diagnostics = ext.diagnostics;
        finalUrl = ext.diagnostics.finalUrl ?? link;
        productUrl = finalUrl;
        images = ext.image_urls;
      }

      // Strategy B: browser-render-gallery (chỉ khi server fetch trống + provider browserless).
      let browserDiag: Record<string, unknown> | null = null;
      const provider = getShopeeImageSourceProvider();
      if (images.length === 0 && provider === "browserless") {
        const b = await extractShopeeImagesWithBrowser(finalUrl);
        browserDiag = {
          browserExtractionTried: true,
          browserExtractionStatus: b.status,
          browserExtractionError: b.error,
          browserImageCandidatesCount: b.candidatesCount,
          browserValidImagesCount: b.validCount,
          sourceStrategy: b.ok ? "browser-render-gallery" : undefined,
        };
        if (b.ok) images = b.image_urls;
      }

      // Lưu ảnh nguồn vào product nếu có.
      if (images.length > 0 && job.related_product_id) {
        await supabase
          .from("products")
          .update({ source_product_images: images, image_url: images[0], updated_at: nowIso() })
          .eq("id", job.related_product_id);
      }

      const combinedDiag = {
        ...(diagnostics && typeof diagnostics === "object" ? (diagnostics as Record<string, unknown>) : {}),
        imageSourceProvider: provider,
        browserExtractionTried: browserDiag !== null,
        ...(browserDiag ?? {}),
        firstValidImages: images.slice(0, 5),
      };
      const baseOutput = { ...((job.output as object) ?? {}), source_images: images, source_diagnostics: combinedDiag, product_url: productUrl };
      // Luôn ghi diagnostics vào output để UI xem được khi fail.
      await supabase.from("ai_jobs").update({ output: baseOutput, updated_at: nowIso() }).eq("id", jobId);

      if (images.length === 0) {
        await insertPostingLog(supabase, postId, SHOPEE_FETCH_FAILED, "FAILED", "Không lấy được ảnh sản phẩm thật.", { ai_job_id: jobId });
        await insertPostingLog(supabase, postId, GROUNDING_MISSING, "FAILED", MISSING_SOURCE_MSG, { ai_job_id: jobId });
        return failHard(
          "Không lấy được ảnh sản phẩm thật từ Shopee. Có thể Shopee chặn server fetch hoặc link cần render bằng trình duyệt.",
          postId,
          "MISSING_PRODUCT_IMAGE",
        );
      }

      const stored = await storeSourceProductImage(supabase, postId, 1, images[0]);
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
      const out = (job.output ?? {}) as { visual_identity?: string };
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
      await insertPostingLog(supabase, postId, GROUNDED_GEN_STARTED, "SUCCESS", "Sinh ảnh AI bám sản phẩm + overlay.", { ai_job_id: jobId });
      return advance("IMAGE_1", {
        output: {
          ...out,
          image_prompts: bundle.image_prompts.slice(0, AI_IMAGE_COUNT),
          overlays,
          ai_score: bundle.score,
          should_publish: bundle.should_publish,
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
      };
      const prompts = Array.isArray(out.image_prompts) ? out.image_prompts : [];
      const overlays = Array.isArray(out.overlays) ? out.overlays : [];
      const p = prompts[idx - 1];
      if (!p || !p.prompt) return failStep(`Thiếu prompt ảnh #${idx}.`);
      // Gán overlay text -> generateAndStoreImageAsset sẽ render chữ lên ảnh.
      const pWithOverlay = { ...p, caption_overlay: overlays[idx - 1] ?? p.caption_overlay ?? "" };
      const res = await generateAndStoreImageAsset(supabase, postId, idx + 1, pWithOverlay); // sort 2,3,4
      if (!res.ok) {
        await insertPostingLog(supabase, postId, GROUNDED_GEN_FAILED, "FAILED", res.error ?? `Ảnh #${idx} lỗi.`, { ai_job_id: jobId });
        return failStep(res.error ?? `Sinh ảnh #${idx} thất bại.`);
      }
      await insertPostingLog(supabase, postId, GROUNDED_GEN_SUCCESS, "SUCCESS", `Ảnh AI #${idx} xong.`, { ai_job_id: jobId });
      const next = idx < AI_IMAGE_COUNT ? `IMAGE_${idx + 1}` : "FINALIZE";
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

      const out = (job.output ?? {}) as { ai_score?: number; should_publish?: boolean };
      const aiScore = typeof out.ai_score === "number" ? out.ai_score : 0;
      const shouldPublish = out.should_publish === true;

      if (total >= 4 && productCount >= 1) {
        const postStatus: GeneratedPostStatus = aiScore >= 80 && shouldPublish ? "READY" : "REJECTED";
        await supabase
          .from("generated_posts")
          .update({
            creative_pack_status: "READY",
            creative_pack_mode: "MIXED",
            publish_mode: "PHOTO_ALBUM",
            status: postStatus,
            creative_summary: `${total} ảnh (nguồn Shopee: ${productCount}, AI bám SP: ${total - productCount}).`,
            creative_error: null,
            updated_at: nowIso(),
          })
          .eq("id", postId);
        await supabase
          .from("ai_jobs")
          .update({ status: "SUCCESS", step: "FINALIZE", progress_current: PROGRESS_TOTAL, finished_at: nowIso(), locked_at: null, error_message: null, updated_at: nowIso() })
          .eq("id", jobId);
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
  const { data: ready } = await supabase
    .from("ai_jobs")
    .select("id")
    .in("status", ["PENDING", "WAITING_RETRY"])
    .order("created_at", { ascending: true })
    .limit(1);
  let jobId = ready?.[0]?.id as string | undefined;

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
