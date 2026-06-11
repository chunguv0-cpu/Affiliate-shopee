import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostingPlan } from "@/lib/types";

/**
 * Phase 19 — Auto scheduler cho bài đã DUYỆT trong một chiến dịch autopilot.
 * Chỉ xếp lịch bài review_status=APPROVED, chưa có scheduled_at.
 * Giờ tính theo ICT (+07:00), lưu scheduled_at dạng UTC ISO.
 */

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

function defaultWindows(): string[] {
  const raw = process.env.AUTOPILOT_DEFAULT_WINDOWS?.trim();
  const fromEnv = raw
    ? raw.split(",").map((s) => s.trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s))
    : [];
  return fromEnv.length > 0 ? fromEnv : ["09:00", "12:30", "20:30"];
}

function parseHHMM(s: string): { hh: number; mm: number } | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

/** Quy đổi 1 slot ICT (ngày gốc + offset ngày + HH:MM) sang UTC ms. */
function ictSlotToUtcMs(baseIctMs: number, dayOffset: number, hh: number, mm: number): number {
  const ict = new Date(baseIctMs);
  const y = ict.getUTCFullYear();
  const mo = ict.getUTCMonth();
  const d = ict.getUTCDate();
  // Instant tại Y/M/(D+offset) HH:MM theo ICT = UTC - 7h.
  return Date.UTC(y, mo, d + dayOffset, hh, mm, 0, 0) - ICT_OFFSET_MS;
}

export type ScheduleResult = {
  scheduled: number;
  slots: string[];
  error: string | null;
};

/**
 * Xếp lịch tối đa `limit` bài APPROVED chưa có lịch của một campaign run.
 * Tránh trùng phút với các bài đã có lịch (trong cùng run).
 */
export async function scheduleApprovedPostsForRun(
  supabase: SupabaseClient,
  runId: string,
  postingPlan: PostingPlan | null | undefined,
  limit: number,
): Promise<ScheduleResult> {
  const windows = (postingPlan?.suggested_windows && postingPlan.suggested_windows.length > 0
    ? postingPlan.suggested_windows
    : defaultWindows()
  )
    .map(parseHHMM)
    .filter((x): x is { hh: number; mm: number } => x !== null);
  const effectiveWindows = windows.length > 0 ? windows : defaultWindows().map(parseHHMM).filter((x): x is { hh: number; mm: number } => x !== null);
  const postsPerDay = Math.max(1, Math.min(effectiveWindows.length, postingPlan?.posts_per_day ?? effectiveWindows.length));

  // Bài APPROVED chưa có lịch (cần xếp).
  const { data: pendingRows, error: pendErr } = await supabase
    .from("generated_posts")
    .select("id, created_at")
    .eq("ai_campaign_run_id", runId)
    .eq("review_status", "APPROVED")
    .is("scheduled_at", null)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, limit));
  if (pendErr) return { scheduled: 0, slots: [], error: pendErr.message };
  const pending = (pendingRows ?? []) as Array<{ id: string }>;
  if (pending.length === 0) return { scheduled: 0, slots: [], error: null };

  // Các lịch đã đặt trong run (để tránh trùng phút).
  const { data: takenRows } = await supabase
    .from("generated_posts")
    .select("scheduled_at")
    .eq("ai_campaign_run_id", runId)
    .not("scheduled_at", "is", null);
  const taken = new Set<number>(
    ((takenRows ?? []) as Array<{ scheduled_at: string | null }>)
      .map((r) => (r.scheduled_at ? new Date(r.scheduled_at).getTime() : NaN))
      .filter((t) => Number.isFinite(t)),
  );

  const now = Date.now();
  const baseIctMs = now + ICT_OFFSET_MS;
  const buffer = 10 * 60 * 1000; // tối thiểu 10 phút từ bây giờ

  // Sinh các slot ứng viên (tối đa 60 ngày tới).
  const candidates: number[] = [];
  for (let day = 0; day < 60 && candidates.length < pending.length + taken.size + 5; day += 1) {
    for (let w = 0; w < postsPerDay; w += 1) {
      const win = effectiveWindows[w];
      if (!win) continue;
      const slotMs = ictSlotToUtcMs(baseIctMs, day, win.hh, win.mm);
      if (slotMs <= now + buffer) continue;
      if (taken.has(slotMs)) continue;
      candidates.push(slotMs);
    }
  }
  candidates.sort((a, b) => a - b);

  let scheduled = 0;
  const slots: string[] = [];
  for (const post of pending) {
    const slotMs = candidates.find((c) => !taken.has(c));
    if (slotMs === undefined) break;
    taken.add(slotMs);
    const iso = new Date(slotMs).toISOString();
    const { error: updErr } = await supabase
      .from("generated_posts")
      .update({
        scheduled_at: iso,
        automation_status: "SCHEDULED",
        auto_scheduled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id)
      .eq("review_status", "APPROVED")
      .is("scheduled_at", null);
    if (!updErr) {
      scheduled += 1;
      slots.push(iso);
    }
  }

  return { scheduled, slots, error: null };
}
