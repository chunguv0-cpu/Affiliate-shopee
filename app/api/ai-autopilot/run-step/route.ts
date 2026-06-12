import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { runCampaignAutopilotUntilBlocked } from "@/lib/autopilot/campaign-autopilot-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chạy MỘT bước batch autopilot cho 1 campaign run (hoặc tự chọn run đang chạy).
 * Production: yêu cầu Bearer CRON_SECRET (dashboard nên dùng server action thay cho route này).
 */
async function handle(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const url = new URL(request.url);
    let campaignRunId = url.searchParams.get("campaign_run_id")?.trim() || undefined;
    if (!campaignRunId) {
      try {
        const body = (await request.json()) as { campaign_run_id?: string };
        if (body && typeof body.campaign_run_id === "string") campaignRunId = body.campaign_run_id.trim() || undefined;
      } catch {
        // không có body JSON
      }
    }
    const summary = await runCampaignAutopilotUntilBlocked({ campaignRunId, trigger: "manual" });
    revalidatePath("/dashboard/ai-autopilot");
    revalidatePath("/dashboard/review");
    return NextResponse.json({ ok: summary.ok, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}
export async function GET(request: Request) {
  return handle(request);
}
