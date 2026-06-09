/**
 * Tiện ích đọc biến môi trường an toàn (chỉ dùng phía server).
 *
 * LƯU Ý BẢO MẬT:
 * - KHÔNG import file này vào client component.
 * - Các key nhạy cảm (SUPABASE_SERVICE_ROLE_KEY, V98_API_KEY,
 *   FACEBOOK_PAGE_ACCESS_TOKEN, OPENAI_API_KEY...) chỉ được đọc server-side.
 * - Chỉ các biến có tiền tố NEXT_PUBLIC_ mới được phép lộ ra browser.
 */

/**
 * Đọc một biến môi trường BẮT BUỘC.
 * Ném lỗi rõ ràng nếu biến chưa được cấu hình hoặc rỗng.
 */
export function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === null || value.trim() === "") {
    throw new Error(
      `[env] Thiếu biến môi trường bắt buộc: "${name}". ` +
        `Hãy kiểm tra file .env.local (tham khảo .env.example).`,
    );
  }

  return value;
}

/**
 * Đọc một biến môi trường TÙY CHỌN.
 * Trả về fallback nếu biến chưa được cấu hình.
 */
export function getOptionalEnv(name: string): string | undefined;
export function getOptionalEnv(name: string, fallback: string): string;
export function getOptionalEnv(
  name: string,
  fallback?: string,
): string | undefined {
  const value = process.env[name];

  if (value === undefined || value === null || value.trim() === "") {
    return fallback;
  }

  return value;
}
