import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { runCampaignAutopilotUntilBlocked, type AutopilotLoopSummary } from "@/lib/autopilot/campaign-autopilot-orchestrator";
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
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function readMaxRuns(): number {
  const raw = process.env.MAX_CAMPAIGNS_PER_CRON_RUN?.trim() || process.env.MAX_CAMPAIGN_RUNS_PER_CRON?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1;
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Cron Autopilot: tìm các chiến dịch đang chạy, xử lý GIỚI HẠN batch/bước.
 * Bảo vệ bằng Bearer CRON_SECRET.
 */
async function handle(request: Request) {
  const authError = checkAuth(request);
  if (authError) return authError;

  try {
    const supabase = createSupabaseAdminClient();
    const maxRuns = readMaxRuns();
    const maxMicroSteps = readIntEnv("MAX_MICRO_STEPS_PER_CRON_RUN", 6, 1, 20);
    const maxSeconds = readIntEnv("MAX_SECONDS_PER_CRON_RUN", 40, 5, 55);
    const nextDelaySeconds = readIntEnv("AUTOPILOT_CRON_INTERVAL_SECONDS", 60, 30, 3600);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("ai_campaign_runs")
      .select("id, next_auto_run_at, is_autopilot_enabled, cron_run_count")
      .in("status", ACTIVE_STATUSES)
      .eq("paused", false)
      .order("updated_at", { ascending: true })
      .limit(maxRuns * 5);
    if (error) {
      return NextResponse.json({ ok: false, error: `Không tải được campaign autopilot: ${error.message}` }, { status: 500 });
    }
    const runRows = ((data ?? []) as Array<{ id: string; next_auto_run_at?: string | null; is_autopilot_enabled?: boolean | null; cron_run_count?: number | null }>)
      .filter((r) => r.is_autopilot_enabled !== false)
      .filter((r) => !r.next_auto_run_at || r.next_auto_run_at <= nowIso)
      .slice(0, maxRuns);

    const results: AutopilotLoopSummary[] = [];
    for (const row of runRows) {
      const runStartedMs = Date.now();
      const summary = await runCampaignAutopilotUntilBlocked({
        campaignRunId: row.id,
        trigger: "cron",
        maxMicroSteps,
        maxSeconds,
      });
      results.push(summary);
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
            errors: summary.errors.slice(0, 5),
          },
          last_auto_run_at: new Date(runStartedMs).toISOString(),
          next_auto_run_at: blocked ? null : new Date(runStartedMs + nextDelaySeconds * 1000).toISOString(),
          automation_error: summary.ok ? null : summary.errors.join("; ").slice(0, 800),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }

    revalidatePath("/dashboard/ai-autopilot");
    revalidatePath("/dashboard/review");

    const agg = (key: keyof AutopilotLoopSummary) => results.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
    return NextResponse.json({
      ok: true,
      campaign_runs_processed: results.length,
      micro_steps_processed: agg("micro_steps"),
      current_step: results[0]?.current_step ?? null,
      products_sourced: agg("products_sourced"),
      links_converted: agg("links_converted"),
      products_created: agg("products_created"),
      posts_created: agg("posts_created"),
      creative_jobs_started: agg("creative_jobs_started"),
      creative_job_steps_processed: agg("creative_job_steps_processed"),
      posts_ready_for_review: agg("posts_ready_for_review"),
      scheduled_count: agg("scheduled_count"),
      skipped_count: agg("skipped_count"),
      errors: results.flatMap((r) => r.errors),
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
