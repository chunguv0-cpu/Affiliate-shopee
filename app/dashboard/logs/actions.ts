"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { PostingLog } from "@/lib/types";

export type PostingLogsResult =
  | { ok: true; logs: PostingLog[] }
  | { ok: false; error: string };

/**
 * Lấy nhật ký hệ thống từ posting_logs, mới nhất trước (giới hạn 200 dòng).
 */
export async function getPostingLogs(): Promise<PostingLogsResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("posting_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return { ok: false, error: `Không tải được nhật ký: ${error.message}` };
    }

    return { ok: true, logs: (data ?? []) as PostingLog[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }
}
