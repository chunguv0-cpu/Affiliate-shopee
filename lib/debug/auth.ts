/**
 * Auth cho các route /api/debug/* .
 * Cho phép 2 cách (để mở được cả trên trình duyệt):
 *  - Header:  Authorization: Bearer <CRON_SECRET>
 *  - Query:   ?key=<CRON_SECRET>  hoặc  ?secret=<CRON_SECRET>
 * Local (NODE_ENV != production) -> luôn cho phép.
 */
export function debugAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("key")?.trim() || url.searchParams.get("secret")?.trim();
    if (q && q === secret) return true;
  } catch {
    /* ignore */
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
