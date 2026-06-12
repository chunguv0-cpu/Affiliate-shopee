import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Performance phase — campaign-level lock so overlapping cron runs don't
 * process the same campaign twice. Each claim is a single atomic conditional
 * UPDATE (row-lock serializes concurrent writers). Release only clears OWN lock.
 */

export function lockTtlSeconds(): number {
  const raw = process.env.AUTOPILOT_LOCK_TTL_SECONDS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(900, Math.max(30, n)) : 120;
}

export type LockResult = { acquired: boolean; takeover: boolean };

/**
 * Khóa campaign bằng 2 lần thử UPDATE có điều kiện (atomic):
 *  (1) chưa khóa (lock_expires_at IS NULL)
 *  (2) khóa đã hết hạn (lock_expires_at < now) -> takeover
 * Hai cron chạy song song: chỉ MỘT cái update trúng (row-lock của Postgres).
 */
export async function acquireCampaignLock(
  supabase: SupabaseClient,
  runId: string,
  lockedBy: string,
): Promise<LockResult> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresIso = new Date(now + lockTtlSeconds() * 1000).toISOString();
  const patch = { locked_at: nowIso, locked_by: lockedBy, lock_expires_at: expiresIso, updated_at: nowIso };

  // (1) Khóa khi đang trống.
  const fresh = await supabase
    .from("ai_campaign_runs")
    .update(patch)
    .eq("id", runId)
    .is("lock_expires_at", null)
    .select("id");
  if (fresh.data && fresh.data.length > 0) return { acquired: true, takeover: false };

  // (2) Khóa khi khóa cũ đã hết hạn (takeover).
  const expired = await supabase
    .from("ai_campaign_runs")
    .update(patch)
    .eq("id", runId)
    .lt("lock_expires_at", nowIso)
    .select("id");
  if (expired.data && expired.data.length > 0) return { acquired: true, takeover: true };

  return { acquired: false, takeover: false };
}

/** Mở khóa — CHỈ khi đúng chủ khóa (tránh xóa khóa của cron khác). */
export async function releaseCampaignLock(supabase: SupabaseClient, runId: string, lockedBy: string): Promise<void> {
  await supabase
    .from("ai_campaign_runs")
    .update({ locked_at: null, locked_by: null, lock_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("locked_by", lockedBy);
}
