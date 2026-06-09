import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ghi một dòng vào posting_logs.
 * Bọc try/catch để việc ghi log KHÔNG bao giờ làm hỏng luồng chính.
 */
export async function insertPostingLog(
  supabase: SupabaseClient,
  generatedPostId: string | null,
  action: string,
  status: "SUCCESS" | "FAILED",
  message: string,
  rawResponse: unknown,
): Promise<void> {
  try {
    await supabase.from("posting_logs").insert({
      generated_post_id: generatedPostId,
      action,
      status,
      message,
      raw_response: rawResponse ?? null,
    });
  } catch {
    // Bỏ qua lỗi ghi log để không ảnh hưởng kết quả trả về.
  }
}
