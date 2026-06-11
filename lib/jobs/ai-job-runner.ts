import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateAffiliatePostBundle, type ProductInput } from "@/lib/ai/client";
import { generateAndStoreImageAsset } from "@/lib/creative/generate-post-images";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AiJob, AiJobStatus, GeneratedPostStatus } from "@/lib/types";

const JOB_TYPE = "CREATE_AI_POST_WITH_IMAGES";
const PROGRESS_TOTAL = 6;
const STALE_MS = 5 * 60 * 1000;

// Logs.
const STEP_STARTED = "AI_JOB_STEP_STARTED";
const STEP_SUCCESS = "AI_JOB_STEP_SUCCESS";
const STEP_FAILED = "AI_JOB_STEP_FAILED";
const JOB_SUCCESS = "AI_JOB_SUCCESS";
const JOB_FAILED = "AI_JOB_FAILED";

// Tiến độ theo bước (INIT là setup, không tính).
const STEP_PROGRESS: Record<string, number> = {
  INIT: 0,
  TEXT: 1,
  IMAGE_1: 2,
  IMAGE_2: 3,
  IMAGE_3: 4,
  IMAGE_4: 5,
  FINALIZE: 6,
};

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

/** Chạy ĐÚNG MỘT bước của job. KHÔNG throw. Idempotent nhẹ qua locked_at. */
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

  // Đã kết thúc.
  if (job.status === "SUCCESS" || job.status === "FAILED") {
    return { ok: true, jobId, step: job.step, status: job.status, progress, message: "Job đã kết thúc." };
  }

  // Đang chạy bởi runner khác (locked gần đây) -> bỏ qua.
  if (job.status === "RUNNING" && job.locked_at) {
    const lockedMs = Date.now() - new Date(job.locked_at).getTime();
    if (Number.isFinite(lockedMs) && lockedMs < STALE_MS) {
      return { ok: true, jobId, step: job.step, status: job.status, progress, message: "Bước đang chạy, bỏ qua." };
    }
    // stale -> tiếp tục (recover).
  }

  const step = job.step || "INIT";

  // Claim: chuyển RUNNING + khóa.
  await supabase
    .from("ai_jobs")
    .update({ status: "RUNNING", locked_at: nowIso(), started_at: job.started_at ?? nowIso(), updated_at: nowIso() })
    .eq("id", jobId);

  await insertPostingLog(supabase, job.related_post_id ?? null, STEP_STARTED, "SUCCESS", `Job ${JOB_TYPE} bước ${step}.`, {
    ai_job_id: jobId,
    step,
  });

  // Helper: tiến sang bước kế.
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

  // Helper: lỗi 1 bước -> retry hoặc fail hẳn.
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
    // Hết lượt -> FAILED + cập nhật post.
    await supabase
      .from("ai_jobs")
      .update({ status: "FAILED", attempts, error_message: message.slice(0, 1000), finished_at: nowIso(), locked_at: null, updated_at: nowIso() })
      .eq("id", jobId);
    if (job.related_post_id) {
      await supabase
        .from("generated_posts")
        .update({ creative_pack_status: "FAILED", creative_error: message.slice(0, 500), updated_at: nowIso() })
        .eq("id", job.related_post_id);
    }
    await insertPostingLog(supabase, job.related_post_id ?? null, JOB_FAILED, "FAILED", `Job thất bại: ${message}`.slice(0, 1000), {
      ai_job_id: jobId,
    });
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
          creative_pack_mode: "GENERATED_ONLY",
          creative_min_assets: 4,
          publish_mode: "FEED",
        })
        .select("id")
        .single();
      if (insErr || !post) return failStep(`Tạo bài nháp thất bại: ${insErr?.message ?? "không rõ"}`);
      return advance("TEXT", { related_post_id: post.id });
    }

    const postId = job.related_post_id;
    if (!postId) return failStep("Thiếu related_post_id (chưa qua INIT).");

    // ---------- TEXT ----------
    if (step === "TEXT") {
      const productInput: ProductInput = {
        product_name: input.product_name ?? "Sản phẩm",
        affiliate_link: input.affiliate_link ?? "",
        target_customer: input.target_customer ?? null,
        product_angle: input.product_angle ?? null,
        price_note: input.price_note ?? null,
      };
      const bundle = await generateAffiliatePostBundle(productInput);
      const postStatus: GeneratedPostStatus =
        bundle.score >= 80 && bundle.should_publish === true ? "READY" : "REJECTED";
      await supabase
        .from("generated_posts")
        .update({
          caption: bundle.caption,
          hook: bundle.hook,
          ai_score: bundle.score,
          safety_notes: bundle.safety_notes,
          should_publish: bundle.should_publish,
          // status tạm để REJECTED/READY về sau ở FINALIZE; giữ DRAFT tới khi đủ ảnh.
          updated_at: nowIso(),
        })
        .eq("id", postId);
      return advance("IMAGE_1", {
        output: {
          image_prompts: bundle.image_prompts,
          target_status: postStatus,
          ai_score: bundle.score,
          should_publish: bundle.should_publish,
        },
      });
    }

    // ---------- IMAGE_1..4 ----------
    const imageStep = step.match(/^IMAGE_([1-4])$/);
    if (imageStep) {
      const idx = parseInt(imageStep[1], 10); // 1..4
      const out = (job.output ?? {}) as { image_prompts?: Array<{ prompt: string; caption_overlay?: string; visual_angle?: string }> };
      const prompts = Array.isArray(out.image_prompts) ? out.image_prompts : [];
      const p = prompts[idx - 1];
      if (!p || !p.prompt) return failStep(`Thiếu prompt ảnh #${idx}.`);
      const res = await generateAndStoreImageAsset(supabase, postId, idx, p);
      if (!res.ok) return failStep(res.error ?? `Sinh ảnh #${idx} thất bại.`);
      const next = idx < 4 ? `IMAGE_${idx + 1}` : "FINALIZE";
      // reset attempts khi 1 ảnh thành công.
      return advance(next, { attempts: 0 });
    }

    // ---------- FINALIZE ----------
    if (step === "FINALIZE") {
      const { data: assets } = await supabase
        .from("post_creative_assets")
        .select("status, image_url, metadata")
        .eq("generated_post_id", postId)
        .eq("status", "READY");
      const realReady = ((assets ?? []) as Array<{ image_url: string | null; metadata: unknown }>).filter((a) => {
        const m = a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
        return !!a.image_url && m.mock !== true;
      }).length;

      const out = (job.output ?? {}) as { ai_score?: number; should_publish?: boolean };
      const aiScore = typeof out.ai_score === "number" ? out.ai_score : 0;
      const shouldPublish = out.should_publish === true;

      if (realReady >= 4) {
        const postStatus: GeneratedPostStatus = aiScore >= 80 && shouldPublish ? "READY" : "REJECTED";
        await supabase
          .from("generated_posts")
          .update({
            creative_pack_status: "READY",
            creative_pack_mode: "GENERATED_ONLY",
            publish_mode: "PHOTO_ALBUM",
            status: postStatus,
            creative_summary: `${realReady}/4 ảnh thật.`,
            creative_error: null,
            updated_at: nowIso(),
          })
          .eq("id", postId);
        await supabase
          .from("ai_jobs")
          .update({ status: "SUCCESS", step: "FINALIZE", progress_current: PROGRESS_TOTAL, finished_at: nowIso(), locked_at: null, error_message: null, updated_at: nowIso() })
          .eq("id", jobId);
        await insertPostingLog(supabase, postId, JOB_SUCCESS, "SUCCESS", `Job xong: ${realReady}/4 ảnh, post ${postStatus}.`, {
          ai_job_id: jobId,
        });
        return { ok: true, jobId, step: "FINALIZE", status: "SUCCESS", progress: { current: PROGRESS_TOTAL, total: PROGRESS_TOTAL } };
      }

      const msg = `Only ${realReady}/4 images generated.`;
      await supabase
        .from("generated_posts")
        .update({
          creative_pack_status: realReady >= 1 ? "PARTIAL" : "FAILED",
          publish_mode: "FEED",
          creative_error: msg,
          updated_at: nowIso(),
        })
        .eq("id", postId);
      await supabase
        .from("ai_jobs")
        .update({ status: "FAILED", finished_at: nowIso(), locked_at: null, error_message: msg, updated_at: nowIso() })
        .eq("id", jobId);
      await insertPostingLog(supabase, postId, JOB_FAILED, "FAILED", `Job thất bại: ${msg}`, { ai_job_id: jobId });
      return { ok: false, jobId, step: "FINALIZE", status: "FAILED", progress: { current: PROGRESS_TOTAL, total: PROGRESS_TOTAL }, error: msg };
    }

    // Bước không hợp lệ -> coi như INIT lại.
    return advance("INIT");
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return failStep(m);
  }
}

/**
 * Tìm 1 job để chạy: PENDING/WAITING_RETRY trước, rồi RUNNING quá hạn (stale).
 */
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
