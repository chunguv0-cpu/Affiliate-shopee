import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Ops phase — repair safe state mismatches WITHOUT deleting data.
 * - Posts wrongly PENDING_REVIEW but not truly ready -> removed from approve list.
 * - Ready posts missing review_status -> PENDING_REVIEW.
 * - Stuck RUNNING jobs (expired lock) -> WAITING_RETRY (continue from last step).
 * - Campaigns WAITING_POST_REVIEW with no ready posts -> CREATING_CREATIVES / COMPLETED.
 */

export type RepairSummary = {
  postsDemoted: number;
  postsPromotedToReview: number;
  jobsUnlocked: number;
  campaignsRewound: number;
  notes: string[];
};

function lockTtlMs(): number {
  const raw = process.env.AUTOPILOT_LOCK_TTL_SECONDS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return (Number.isFinite(n) ? Math.min(900, Math.max(30, n)) : 120) * 1000;
}

async function readyAssetCount(supabase: SupabaseClient, postId: string): Promise<number> {
  const { count } = await supabase
    .from("post_creative_assets")
    .select("id", { count: "exact", head: true })
    .eq("generated_post_id", postId)
    .eq("status", "READY")
    .not("image_url", "is", null);
  return count ?? 0;
}

export async function repairStates(supabaseInput?: SupabaseClient): Promise<RepairSummary> {
  const supabase = supabaseInput ?? createSupabaseAdminClient();
  const summary: RepairSummary = { postsDemoted: 0, postsPromotedToReview: 0, jobsUnlocked: 0, campaignsRewound: 0, notes: [] };
  const nowIso = new Date().toISOString();

  // (4) Stuck RUNNING jobs (expired lock) -> WAITING_RETRY.
  const staleBefore = new Date(Date.now() - lockTtlMs()).toISOString();
  const { data: stuckJobs } = await supabase
    .from("ai_jobs")
    .select("id")
    .eq("status", "RUNNING")
    .lt("locked_at", staleBefore)
    .limit(200);
  for (const j of (stuckJobs ?? []) as Array<{ id: string }>) {
    await supabase.from("ai_jobs").update({ status: "WAITING_RETRY", locked_at: null, updated_at: nowIso }).eq("id", j.id);
    summary.jobsUnlocked += 1;
  }
  if (summary.jobsUnlocked > 0) await insertPostingLog(supabase, null, "AUTOPILOT_REPAIR_JOBS_UNLOCKED", "SUCCESS", `Mở khóa ${summary.jobsUnlocked} job kẹt.`, null);

  // (1) Posts PENDING_REVIEW but not truly ready -> demote.
  const { data: reviewPosts } = await supabase
    .from("generated_posts")
    .select("id, caption, creative_pack_status, review_status, products(affiliate_link)")
    .in("review_status", ["PENDING_REVIEW", "NEEDS_EDIT"])
    .limit(200);
  for (const p of (reviewPosts ?? []) as Array<Record<string, unknown>>) {
    const caption = (p.caption as string | null)?.trim();
    const packReady = p.creative_pack_status === "READY";
    const assets = await readyAssetCount(supabase, String(p.id));
    if (!caption || !packReady || assets < 4) {
      await supabase
        .from("generated_posts")
        .update({ review_status: null, automation_status: "CREATIVE_PENDING", updated_at: nowIso })
        .eq("id", p.id);
      summary.postsDemoted += 1;
    }
  }
  if (summary.postsDemoted > 0) await insertPostingLog(supabase, null, "AUTOPILOT_REPAIR_POSTS_DEMOTED", "SUCCESS", `Hạ ${summary.postsDemoted} bài chưa đủ chuẩn khỏi danh sách chờ duyệt.`, null);

  // (2) Ready posts missing review_status -> PENDING_REVIEW.
  const { data: readyPosts } = await supabase
    .from("generated_posts")
    .select("id, caption, creative_pack_status, review_status, ai_campaign_run_id")
    .eq("creative_pack_status", "READY")
    .is("review_status", null)
    .limit(200);
  for (const p of (readyPosts ?? []) as Array<Record<string, unknown>>) {
    if (!p.ai_campaign_run_id) continue; // chỉ tự đưa bài autopilot vào hàng chờ duyệt
    const caption = (p.caption as string | null)?.trim();
    const assets = await readyAssetCount(supabase, String(p.id));
    if (caption && assets >= 4) {
      await supabase
        .from("generated_posts")
        .update({ review_status: "PENDING_REVIEW", automation_status: "WAITING_REVIEW", updated_at: nowIso })
        .eq("id", p.id);
      summary.postsPromotedToReview += 1;
    }
  }
  if (summary.postsPromotedToReview > 0) await insertPostingLog(supabase, null, "AUTOPILOT_REPAIR_POSTS_PROMOTED", "SUCCESS", `Đưa ${summary.postsPromotedToReview} bài đủ chuẩn vào chờ duyệt.`, null);

  // (3) Campaigns WAITING_POST_REVIEW but no ready posts.
  const { data: waitingCampaigns } = await supabase
    .from("ai_campaign_runs")
    .select("id")
    .eq("status", "WAITING_POST_REVIEW")
    .limit(100);
  for (const c of (waitingCampaigns ?? []) as Array<{ id: string }>) {
    const runId = String(c.id);
    const { count: readyCount } = await supabase
      .from("generated_posts")
      .select("id", { count: "exact", head: true })
      .eq("ai_campaign_run_id", runId)
      .eq("creative_pack_status", "READY")
      .in("review_status", ["PENDING_REVIEW", "APPROVED"]);
    if ((readyCount ?? 0) > 0) continue; // có bài thật -> ổn
    const { count: openJobs } = await supabase
      .from("ai_jobs")
      .select("id", { count: "exact", head: true })
      .eq("ai_campaign_run_id", runId)
      .in("status", ["PENDING", "RUNNING", "WAITING_RETRY"]);
    const { count: anyPosts } = await supabase
      .from("generated_posts")
      .select("id", { count: "exact", head: true })
      .eq("ai_campaign_run_id", runId);
    if ((openJobs ?? 0) > 0) {
      await supabase.from("ai_campaign_runs").update({ status: "CREATING_CREATIVES", current_step: "CREATING_CREATIVES", next_auto_run_at: nowIso, updated_at: nowIso }).eq("id", runId);
      summary.campaignsRewound += 1;
    } else if ((anyPosts ?? 0) === 0) {
      await supabase.from("ai_campaign_runs").update({ status: "COMPLETED", current_step: "COMPLETED", updated_at: nowIso }).eq("id", runId);
      summary.campaignsRewound += 1;
    }
  }
  if (summary.campaignsRewound > 0) await insertPostingLog(supabase, null, "AUTOPILOT_REPAIR_CAMPAIGNS", "SUCCESS", `Sửa trạng thái ${summary.campaignsRewound} chiến dịch kẹt ở chờ duyệt.`, null);

  summary.notes.push(`Mở khóa ${summary.jobsUnlocked} job, hạ ${summary.postsDemoted} bài, đưa ${summary.postsPromotedToReview} bài vào chờ duyệt, sửa ${summary.campaignsRewound} chiến dịch.`);
  return summary;
}
