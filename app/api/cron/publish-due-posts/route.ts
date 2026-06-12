import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { insertPostingLog } from "@/lib/posts/log";
import { publishGeneratedPostById } from "@/lib/posts/publish";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_ACTION = "CRON_PUBLISH_DUE_POSTS";

/**
 * Xác thực request bằng header Authorization: Bearer {CRON_SECRET}.
 * Trả NextResponse lỗi nếu không hợp lệ, hoặc null nếu hợp lệ.
 */
function checkAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    // Server chưa cấu hình secret -> coi như chưa thiết lập đúng.
    return NextResponse.json(
      { ok: false, error: "Chưa cấu hình CRON_SECRET trên server." },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  return null;
}

/**
 * Tìm và đăng tối đa 1 bài đến hạn (chống spam).
 */
async function handle(request: Request) {
  const authError = checkAuth(request);
  if (authError) return authError;

  try {
    const supabase = createSupabaseAdminClient();

    const nowIso = new Date().toISOString();

    // Phase 19: chỉ đăng bài ĐÃ DUYỆT (review_status=APPROVED). Bài chưa duyệt -> bỏ qua + log.
    const { data: creativeNotReady } = await supabase
      .from("generated_posts")
      .select("id")
      .eq("status", "READY")
      .eq("should_publish", true)
      .gte("ai_score", 80)
      .neq("creative_pack_status", "READY")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", nowIso)
      .eq("review_status", "APPROVED")
      .limit(20);
    if (creativeNotReady && creativeNotReady.length > 0) {
      await insertPostingLog(
        supabase,
        null,
        "CRON_SKIPPED_CREATIVE_NOT_READY",
        "SUCCESS",
        `Bỏ qua ${creativeNotReady.length} bài đến hạn nhưng pack ảnh chưa READY.`,
        { skipped: creativeNotReady.length },
      );
    }

    const { data: notApproved } = await supabase
      .from("generated_posts")
      .select("id")
      .eq("status", "READY")
      .eq("should_publish", true)
      .gte("ai_score", 80)
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", nowIso)
      .neq("review_status", "APPROVED")
      .limit(20);
    if (notApproved && notApproved.length > 0) {
      await insertPostingLog(
        supabase,
        null,
        "CRON_SKIPPED_NOT_APPROVED",
        "SUCCESS",
        `Bỏ qua ${notApproved.length} bài đến hạn nhưng chưa được duyệt (review_status != APPROVED).`,
        { skipped: notApproved.length },
      );
    }

    // Tìm bài đến hạn: READY + should_publish + ai_score>=80 + APPROVED + scheduled_at<=now
    const { data, error } = await supabase
      .from("generated_posts")
      .select("id")
      .eq("status", "READY")
      .eq("should_publish", true)
      .gte("ai_score", 80)
      .eq("review_status", "APPROVED")
      .eq("creative_pack_status", "READY")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(1);

    if (error) {
      await insertPostingLog(
        supabase,
        null,
        CRON_ACTION,
        "FAILED",
        `Truy vấn bài đến hạn lỗi: ${error.message}`,
        null,
      );
      return NextResponse.json(
        { ok: false, error: `Truy vấn bài đến hạn lỗi: ${error.message}` },
        { status: 500 },
      );
    }

    const duePost = data?.[0];
    if (!duePost) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        message: "Không có bài đến hạn.",
      });
    }

    // Đăng bài (dùng chung logic với manual publish).
    const result = await publishGeneratedPostById(duePost.id as string, "CRON");

    revalidatePath("/dashboard/posts");
    revalidatePath("/dashboard/calendar");
    revalidatePath("/dashboard/logs");

    return NextResponse.json({ ok: true, processed: 1, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    // Cố gắng ghi log lỗi hệ thống (không để cron crash).
    try {
      const supabase = createSupabaseAdminClient();
      await insertPostingLog(supabase, null, CRON_ACTION, "FAILED", message, null);
    } catch {
      // bỏ qua
    }
    return NextResponse.json(
      { ok: false, error: `Cron lỗi: ${message}` },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
