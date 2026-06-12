import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { checkCronAuth } from "@/lib/cron/utils";
import { pickAndRunNextJob } from "@/lib/jobs/ai-job-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Một bước có thể gọi V98 image (chậm) — cho phép tới 60s.
export const maxDuration = 30;

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
void checkAuth;

/**
 * Chạy MỘT bước của job kế tiếp (PENDING/WAITING_RETRY hoặc RUNNING quá hạn).
 * Bảo vệ bằng Bearer CRON_SECRET. Cho phép cron-job.org gọi mỗi 1 phút.
 */
async function handle(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  try {
    const result = await pickAndRunNextJob();
    revalidatePath("/dashboard/posts");
    return NextResponse.json({ ok: true, result });
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
