import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { runCreativeWorker } from "@/lib/autopilot/creative-worker";
import { checkCronAuth, readCronHardTimeoutMs, readCronSoftTimeoutMs, readIntEnv } from "@/lib/cron/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function handle(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const softTimeoutMs = Math.min(readCronSoftTimeoutMs(), readCronHardTimeoutMs() - 2_000);
  const maxSteps = readIntEnv("MAX_AI_JOB_STEPS_PER_RUN", 1, 1, 1);

  try {
    const summary = await runCreativeWorker({ startTime, softTimeoutMs, maxSteps });
    revalidatePath("/dashboard/ai-autopilot");
    revalidatePath("/dashboard/review");
    revalidatePath("/dashboard/posts");
    return NextResponse.json({
      ...summary,
      ok: true,
      partial: true,
      status: "CREATING_CREATIVES",
      message: "Processed limited creative step. Cron will continue next run.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown creative worker error.";
    return NextResponse.json({
      ok: true,
      partial: true,
      status: "CREATING_CREATIVES",
      stopped_reason: "RECOVERABLE_ERROR",
      duration_ms: Date.now() - startTime,
      error: message,
    });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
