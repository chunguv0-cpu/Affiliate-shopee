import "server-only";

import { pickAndRunNextJob } from "@/lib/jobs/ai-job-runner";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type CreativeWorkerSummary = {
  ok: boolean;
  partial: boolean;
  jobs_seen: number;
  jobs_processed: number;
  image_calls_used: number;
  assets_reused: number;
  pending_jobs: number;
  waiting_retry_jobs: number;
  image_slots_ready: number;
  image_slots_failed: number;
  stopped_reason: string;
  duration_ms: number;
  last_error: string | null;
  result: unknown;
};

function isImageStep(step: unknown): boolean {
  return typeof step === "string" && /^IMAGE_\d+$/i.test(step);
}

export async function runCreativeWorker(options: {
  startTime: number;
  softTimeoutMs: number;
  maxSteps?: number;
}): Promise<CreativeWorkerSummary> {
  const supabase = createSupabaseAdminClient();
  const [openJobs, retryJobs, readyAssets, failedAssets] = await Promise.all([
    supabase.from("ai_jobs").select("id", { count: "exact", head: true }).in("status", ["PENDING", "RUNNING", "WAITING_RETRY"]),
    supabase.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status", "WAITING_RETRY"),
    supabase.from("post_creative_assets").select("id", { count: "exact", head: true }).eq("status", "READY"),
    supabase.from("post_creative_assets").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
  ]);

  const summary: CreativeWorkerSummary = {
    ok: true,
    partial: true,
    jobs_seen: openJobs.count ?? 0,
    jobs_processed: 0,
    image_calls_used: 0,
    assets_reused: 0,
    pending_jobs: openJobs.count ?? 0,
    waiting_retry_jobs: retryJobs.count ?? 0,
    image_slots_ready: readyAssets.count ?? 0,
    image_slots_failed: failedAssets.count ?? 0,
    stopped_reason: "NO_JOB",
    duration_ms: 0,
    last_error: null,
    result: null,
  };

  if (Date.now() - options.startTime >= options.softTimeoutMs) {
    summary.stopped_reason = "TIME_BUDGET_EXHAUSTED";
    summary.duration_ms = Date.now() - options.startTime;
    return summary;
  }

  const maxSteps = Math.max(1, Math.min(1, options.maxSteps ?? 1));
  for (let i = 0; i < maxSteps; i += 1) {
    const result = await pickAndRunNextJob();
    summary.result = result;
    summary.jobs_processed += "jobId" in result ? 1 : 0;
    summary.image_calls_used += "step" in result && isImageStep(result.step) ? 1 : 0;
    summary.last_error = "error" in result && typeof result.error === "string" ? result.error : null;
    summary.stopped_reason = summary.jobs_processed > 0 ? "STEP_PROCESSED" : "NO_RUNNABLE_JOB";
    if (Date.now() - options.startTime >= options.softTimeoutMs) {
      summary.stopped_reason = "TIME_BUDGET_EXHAUSTED";
      break;
    }
  }

  summary.duration_ms = Date.now() - options.startTime;
  return summary;
}
