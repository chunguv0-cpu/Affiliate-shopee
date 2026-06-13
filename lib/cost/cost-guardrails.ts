import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Performance/Ops phase — central V98 image cost guardrails.
 * Per-post cap is enforced in the job runner (step count). Here we enforce
 * per-campaign-per-day and global-per-day caps by counting AI_GENERATED assets
 * created today (each real V98 image == 1 asset, mock excluded).
 */

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

/** Đọc giá trị int ưu tiên tên mới (IMAGE_API_*), fallback tên cũ (V98_MAX_IMAGE_*). */
function readIntPref(primary: string, fallbackName: string, fallback: number): number {
  if (process.env[primary]?.trim()) return readInt(primary, fallback);
  return readInt(fallbackName, fallback);
}

export type CostLimits = {
  perPost: number;
  perCampaignPerDay: number;
  globalPerDay: number;
};

export function readCostLimits(): CostLimits {
  // Ưu tiên tên IMAGE_API_* (Master Rebuild), fallback V98_MAX_IMAGE_* (cũ).
  return {
    perPost: readIntPref("IMAGE_API_MAX_CALLS_PER_POST", "V98_MAX_IMAGE_CALLS_PER_POST", 1),
    perCampaignPerDay: readIntPref("IMAGE_API_MAX_CALLS_PER_CAMPAIGN_PER_DAY", "V98_MAX_IMAGE_CALLS_PER_CAMPAIGN_PER_DAY", 20),
    globalPerDay: readIntPref("IMAGE_API_MAX_CALLS_GLOBAL_PER_DAY", "V98_MAX_IMAGE_CALLS_GLOBAL_PER_DAY", 100),
  };
}

function startOfTodayUtcIso(): string {
  const d = new Date();
  // Đếm theo ngày UTC (đơn giản, ổn định). Reset lúc 00:00 UTC.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/** Đếm số ảnh AI thật (V98) tạo hôm nay — toàn cục và (tùy chọn) cho 1 campaign. */
export async function countV98ImagesToday(
  supabase: SupabaseClient,
  campaignRunId?: string | null,
): Promise<{ global: number; campaign: number }> {
  const sinceIso = startOfTodayUtcIso();
  // Global: AI_GENERATED assets THẬT (loại mock) tạo hôm nay ~= số lượt V98.
  const { count: globalCount } = await supabase
    .from("post_creative_assets")
    .select("id", { count: "exact", head: true })
    .eq("source_type", "AI_GENERATED")
    .eq("status", "READY")
    .neq("metadata->>mock", "true")
    .gte("created_at", sinceIso);

  let campaign = 0;
  if (campaignRunId) {
    const { count: campCount } = await supabase
      .from("post_creative_assets")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "AI_GENERATED")
      .eq("status", "READY")
      .neq("metadata->>mock", "true")
      .eq("ai_campaign_run_id", campaignRunId)
      .gte("created_at", sinceIso);
    campaign = campCount ?? 0;
  }
  return { global: globalCount ?? 0, campaign };
}

export type SpendDecision = { allowed: boolean; reason: string | null; global: number; campaign: number };

/** Kiểm tra còn quota V98 để tạo ảnh hay không (per-campaign/day + global/day). */
export async function canSpendV98(
  supabase: SupabaseClient,
  campaignRunId?: string | null,
): Promise<SpendDecision> {
  const limits = readCostLimits();
  const { global, campaign } = await countV98ImagesToday(supabase, campaignRunId);
  if (limits.globalPerDay > 0 && global >= limits.globalPerDay) {
    return { allowed: false, reason: `Đã đạt giới hạn V98 toàn hệ thống hôm nay (${global}/${limits.globalPerDay}).`, global, campaign };
  }
  if (campaignRunId && limits.perCampaignPerDay > 0 && campaign >= limits.perCampaignPerDay) {
    return { allowed: false, reason: `Đã đạt giới hạn V98 của chiến dịch hôm nay (${campaign}/${limits.perCampaignPerDay}).`, global, campaign };
  }
  return { allowed: true, reason: null, global, campaign };
}

/** Số lượt V98 đã tiết kiệm hôm nay nhờ tái dùng/cache (đếm log). */
export async function countV98SavedToday(supabase: SupabaseClient, campaignRunId?: string | null): Promise<number> {
  const sinceIso = startOfTodayUtcIso();
  void campaignRunId; // posting_logs không có cột campaign trực tiếp; đếm toàn cục.
  try {
    const { count } = await supabase
      .from("posting_logs")
      .select("id", { count: "exact", head: true })
      .in("action", ["V98_IMAGE_CALL_SKIPPED_REUSE_EXISTING", "V98_IMAGE_CALL_SKIPPED_CACHE_HIT", "V98_IMAGE_CALL_SKIPPED_SOURCE_VARIANT", "AI_JOB_REUSED_READY_ASSET", "ASSET_REUSE_CACHE_HIT"])
      .gte("created_at", sinceIso);
    return count ?? 0;
  } catch {
    return 0;
  }
}
