import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { runCampaignAutopilotUntilBlocked, type AutopilotLoopSummary } from "@/lib/autopilot/campaign-autopilot-orchestrator";
import { acquireCampaignLock, releaseCampaignLock } from "@/lib/autopilot/campaign-lock";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { CampaignRunStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Một bước có thể chạy 1-2 bước job (gồm V98 image) — cho phép tới 60s.
export const maxDuration = 60;

const ACTIVE_STATUSES: CampaignRunStatus[] = [
  "APPROVED",
  "SOURCING_PRODUCTS",
  "CONVERTING_LINKS",
  "CREATING_PRODUCTS",
  "CREATING_POSTS",
  "CREATING_CREATIVES",
  "SCHEDULING",
  "SCHEDULED",
  "RUNNING",
];

function checkAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: "Chưa cấu hình CRON_SECRET." }, { status: 500 });
  }
  const auth = request.headers.get("authorization")?.trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  const querySecret = new URL(request.url).searchParams.get("secret")?.trim();
  const ok = auth === `Bearer ${cronSecret}` || headerSecret === cronSecret || querySecret === cronSecret;
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function readMaxRuns(): number {
  const raw = process.env.MAX_CAMPAIGNS_PER_CRON_RUN?.trim() || process.env.MAX_CAMPAIGN_RUNS_PER_CRON?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  // Mặc định 3 để nhiều chiến dịch chạy song song (round-robin), không kẹt 1 cái.
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 3;
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

type CronRunRow = {
  id: string;
  next_auto_run_at?: string | null;
  last_cron_hit_at?: string | null;
  is_autopilot_enabled?: boolean | null;
  cron_run_count?: number | null;
};

function timeValue(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function compareDueCampaigns(a: CronRunRow, b: CronRunRow): number {
  return (
    timeValue(a.next_auto_run_at) - timeValue(b.next_auto_run_at) ||
    timeValue(a.last_cron_hit_at) - timeValue(b.last_cron_hit_at) ||
    (a.cron_run_count ?? 0) - (b.cron_run_count ?? 0)
  );
}

/**
 * Cron Autopilot: tìm các chiến dịch đang chạy, xử lý GIỚI HẠN batch/bước.
 * Bảo vệ bằng Bearer CRON_SECRET.
 */
async function handle(request: Request) {
  const authError = checkAuth(request);
  if (authError) return authError;

  try {
    const cronStartedMs = Date.now();
    const cronRunId = `cron_${cronStartedMs.toString(36)}`;
    const supabase = createSupabaseAdminClient();
    const maxRuns = readMaxRuns();
    // Per-campaign cap để KHÔNG cho 1 chiến dịch chiếm hết worker (round-robin công bằng).
    const totalMicroStepsBudget = readIntEnv("MAX_TOTAL_MICRO_STEPS_PER_CRON_RUN", 8, 1, 40);
    // Đảm bảo mỗi chiến dịch chỉ được phần nhỏ -> nhiều chiến dịch cùng tiến.
    const perCampaignMicroSteps = Math.max(
      1,
      Math.min(readIntEnv("MAX_MICRO_STEPS_PER_CAMPAIGN_PER_RUN", 2, 1, 10), Math.ceil(totalMicroStepsBudget / maxRuns)),
    );
    const maxSeconds = readIntEnv("MAX_SECONDS_PER_CRON_RUN", 45, 5, 55);
    const nextDelaySeconds = readIntEnv("AUTOPILOT_CRON_INTERVAL_SECONDS", 60, 30, 3600);
    const deadlineMs = cronStartedMs + maxSeconds * 1000;
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("ai_campaign_runs")
      .select("id, next_auto_run_at, last_cron_hit_at, is_autopilot_enabled, cron_run_count")
      .in("status", ACTIVE_STATUSES)
      .eq("paused", false)
      .order("next_auto_run_at", { ascending: true })
      .limit(Math.max(50, maxRuns * 10));
    if (error) {
      return NextResponse.json({ ok: false, error: `Không tải được campaign autopilot: ${error.message}` }, { status: 500 });
    }
    const candidates = ((data ?? []) as CronRunRow[])
      .filter((r) => r.is_autopilot_enabled !== false)
      .filter((r) => !r.next_auto_run_at || r.next_auto_run_at <= nowIso)
      .sort(compareDueCampaigns)
      .slice(0, maxRuns);

    const results: AutopilotLoopSummary[] = [];
    const loopErrors: string[] = [];
    let totalMicroSteps = 0;
    let stoppedReason = "all_processed";
    for (const row of candidates) {
      if (Date.now() >= deadlineMs) { stoppedReason = "time_budget_exhausted"; break; }
      if (totalMicroSteps >= totalMicroStepsBudget) { stoppedReason = "micro_step_budget_exhausted"; break; }

      // PART 2 — khóa campaign để tránh xử lý trùng khi cron chồng nhau.
      const lock = await acquireCampaignLock(supabase, row.id, cronRunId);
      if (!lock.acquired) {
        await insertPostingLog(supabase, null, "AUTOPILOT_CAMPAIGN_LOCK_SKIPPED", "SUCCESS", "Campaign đang được xử lý bởi cron khác, bỏ qua.", { ai_campaign_run_id: row.id });
        continue;
      }
      await insertPostingLog(supabase, null, lock.takeover ? "AUTOPILOT_CAMPAIGN_LOCK_EXPIRED_TAKEOVER" : "AUTOPILOT_CAMPAIGN_LOCK_ACQUIRED", "SUCCESS", "Đã khóa campaign để xử lý.", { ai_campaign_run_id: row.id, cron_run_id: cronRunId });

      const runStartedMs = Date.now();
      try {
        const remainingSeconds = Math.max(3, Math.ceil((deadlineMs - runStartedMs) / 1000));
        const remainingMicro = Math.max(1, totalMicroStepsBudget - totalMicroSteps);
        const summary = await runCampaignAutopilotUntilBlocked({
          campaignRunId: row.id,
          trigger: "cron",
          maxMicroSteps: Math.min(perCampaignMicroSteps, remainingMicro),
          maxSeconds: remainingSeconds,
        });
        results.push(summary);
        totalMicroSteps += summary.micro_steps ?? 0;
        const finalStatus = summary.status;
        const blocked =
          finalStatus === "WAITING_APPROVAL" ||
          finalStatus === "WAITING_POST_REVIEW" ||
          finalStatus === "PAUSED" ||
          finalStatus === "COMPLETED" ||
          finalStatus === "FAILED";
        await supabase
          .from("ai_campaign_runs")
          .update({
            last_cron_hit_at: new Date().toISOString(),
            cron_run_count: (row.cron_run_count ?? 0) + 1,
            last_cron_result: {
              ok: summary.ok,
              cron_run_id: cronRunId,
              micro_steps: summary.micro_steps,
              stopped_reason: summary.stopped_reason,
              status: summary.status,
              current_step: summary.current_step,
              products_sourced: summary.products_sourced,
              links_converted: summary.links_converted,
              products_created: summary.products_created,
              posts_created: summary.posts_created,
              creative_job_steps_processed: summary.creative_job_steps_processed,
              posts_ready_for_review: summary.posts_ready_for_review,
              scheduled_count: summary.scheduled_count,
              duration_ms: Date.now() - runStartedMs,
              errors: summary.errors.slice(0, 5),
            },
            last_auto_run_at: new Date(runStartedMs).toISOString(),
            next_auto_run_at: blocked ? null : new Date(runStartedMs + nextDelaySeconds * 1000).toISOString(),
            automation_error: summary.ok ? null : summary.errors.join("; ").slice(0, 800),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      } catch (campErr) {
        // Lỗi 1 campaign KHÔNG được làm sập cả cron — log + đi tiếp.
        const m = campErr instanceof Error ? campErr.message : "Lỗi không xác định.";
        loopErrors.push(`${row.id}: ${m}`);
        await insertPostingLog(supabase, null, "AUTOPILOT_FAILED_RECOVERABLE", "FAILED", `Cron lỗi khi xử lý campaign: ${m}`.slice(0, 500), { ai_campaign_run_id: row.id });
        await supabase
          .from("ai_campaign_runs")
          .update({ automation_error: m.slice(0, 500), last_cron_hit_at: new Date().toISOString(), cron_run_count: (row.cron_run_count ?? 0) + 1, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      } finally {
        await releaseCampaignLock(supabase, row.id, cronRunId);
        await insertPostingLog(supabase, null, "AUTOPILOT_CAMPAIGN_LOCK_RELEASED", "SUCCESS", "Đã mở khóa campaign.", { ai_campaign_run_id: row.id });
      }
    }

    revalidatePath("/dashboard/ai-autopilot");
    revalidatePath("/dashboard/review");

    const agg = (key: keyof AutopilotLoopSummary) => results.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
    return NextResponse.json({
      ok: true,
      cron_run_id: cronRunId,
      campaigns_seen: candidates.length,
      campaigns_processed: results.length,
      campaign_ids: results.map((r) => r.campaign_run_id),
      campaign_runs_processed: results.length, // back-compat
      micro_steps_done: totalMicroSteps,
      micro_steps_processed: agg("micro_steps"),
      current_step: results[0]?.current_step ?? null,
      products_sourced: agg("products_sourced"),
      links_converted: agg("links_converted"),
      products_created: agg("products_created"),
      posts_created: agg("posts_created"),
      creative_jobs_started: agg("creative_jobs_started"),
      creative_job_steps_processed: agg("creative_job_steps_processed"),
      ai_jobs_processed: agg("creative_job_steps_processed"),
      posts_ready_for_review: agg("posts_ready_for_review"),
      scheduled_count: agg("scheduled_count"),
      skipped_count: agg("skipped_count"),
      duration_ms: Date.now() - cronStartedMs,
      stopped_reason: stoppedReason,
      errors: [...results.flatMap((r) => r.errors), ...loopErrors],
      runs: results.map((r) => ({
        id: r.campaign_run_id,
        status: r.status,
        current_step: r.current_step,
        micro_steps: r.micro_steps,
        stopped_reason: r.stopped_reason,
        message: r.message,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
