import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { CampaignRunStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const { data: runs, error: runError } = await supabase
      .from("ai_campaign_runs")
      .select("id, title, status, current_step, is_autopilot_enabled, paused, last_auto_run_at, next_auto_run_at, automation_error, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (runError) {
      return NextResponse.json({ ok: false, error: runError.message }, { status: 500 });
    }

    const rows = (runs ?? []) as Array<{
      id: string;
      title: string | null;
      status: CampaignRunStatus;
      current_step: string | null;
      is_autopilot_enabled: boolean | null;
      paused: boolean | null;
      last_auto_run_at: string | null;
      next_auto_run_at: string | null;
      automation_error: string | null;
      updated_at: string | null;
    }>;
    const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    const now = Date.now();
    const stuck = rows
      .filter((r) => ACTIVE_STATUSES.includes(r.status) && r.is_autopilot_enabled !== false && !r.paused)
      .filter((r) => {
        const last = r.last_auto_run_at ? new Date(r.last_auto_run_at).getTime() : NaN;
        return !Number.isFinite(last) || now - last > 5 * 60 * 1000;
      })
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        current_step: r.current_step,
        last_auto_run_at: r.last_auto_run_at,
        next_auto_run_at: r.next_auto_run_at,
        automation_error: r.automation_error,
      }));

    const [{ count: pendingAiJobs }, { count: failedAiJobs }] = await Promise.all([
      supabase.from("ai_jobs").select("id", { count: "exact", head: true }).in("status", ["PENDING", "RUNNING", "WAITING_RETRY"]),
      supabase.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
    ]);

    return NextResponse.json({
      ok: true,
      active_campaign_count: rows.filter((r) => ACTIVE_STATUSES.includes(r.status) && r.is_autopilot_enabled !== false && !r.paused).length,
      campaigns_by_status: byStatus,
      last_auto_run: rows.map((r) => r.last_auto_run_at).filter(Boolean).sort().at(-1) ?? null,
      stuck_campaigns: stuck,
      pending_ai_jobs_count: pendingAiJobs ?? 0,
      failed_ai_jobs_count: failedAiJobs ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
