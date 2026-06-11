import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { runCampaignAutopilotStep, type AutopilotSummary } from "@/lib/autopilot/campaign-autopilot-orchestrator";
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
  "WAITING_POST_REVIEW",
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
  const raw = process.env.MAX_CAMPAIGN_RUNS_PER_CRON?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 2;
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
    const { data } = await supabase
      .from("ai_campaign_runs")
      .select("id")
      .in("status", ACTIVE_STATUSES)
      .eq("paused", false)
      .order("updated_at", { ascending: true })
      .limit(readMaxRuns());
    const runIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);

    const results: AutopilotSummary[] = [];
    for (const id of runIds) {
      results.push(await runCampaignAutopilotStep({ campaignRunId: id, trigger: "cron" }));
    }

    revalidatePath("/dashboard/ai-autopilot");
    revalidatePath("/dashboard/review");

    const agg = (key: keyof AutopilotSummary) => results.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
    return NextResponse.json({
      ok: true,
      campaign_runs_processed: results.length,
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
      runs: results.map((r) => ({ id: r.campaign_run_id, status: r.status, current_step: r.current_step, message: r.message })),
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
