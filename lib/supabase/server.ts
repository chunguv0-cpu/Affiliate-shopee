import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getRequiredEnv } from "@/lib/utils/env";

/**
 * Tạo Supabase client với quyền ADMIN (service role).
 *
 * CẢNH BÁO BẢO MẬT:
 * - File này import "server-only" để đảm bảo KHÔNG bao giờ bị bundle vào client.
 * - SUPABASE_SERVICE_ROLE_KEY có toàn quyền truy cập database, bỏ qua RLS.
 *   TUYỆT ĐỐI không được expose ra browser.
 * - Chỉ gọi hàm này trong Server Component, Route Handler hoặc Server Action.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // Client admin server-side không cần lưu/persist session.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
