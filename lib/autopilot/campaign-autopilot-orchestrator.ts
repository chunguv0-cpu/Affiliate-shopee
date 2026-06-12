import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveLinkStatus, slugify } from "@/lib/affiliate";
import { convertProductUrlToAffiliateLink } from "@/lib/autopilot/affiliate-link-converter";
import {
  searchRawProducts,
  type SourcingSearchItem,
} from "@/lib/autopilot/product-sourcing-provider";
import { normalizeText, titleSimilarity } from "@/lib/autopilot/product-relevance";
import {
  classifyVertical,
  isBroadKeyword,
  type Vertical,
} from "@/lib/autopilot/campaign-vertical";
import {
  scoreProductForVertical,
  VERTICAL_REJECTION_LABELS,
  type VerticalRejectionReason,
} from "@/lib/autopilot/vertical-guardrails";
import { expandVerticalQueries, suggestSpecificKeywords } from "@/lib/autopilot/query-expansion";
import { scheduleApprovedPostsForRun } from "@/lib/autopilot/scheduler";
import { runAiJobStep } from "@/lib/jobs/ai-job-runner";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type {
  AiCampaignRun,
  CampaignRunStatus,
  CampaignSourcingDiagnostic,
  ProductOpportunity,
  SourcedCandidate,
  SourcingStatus,
} from "@/lib/types";

const NOVELTY_WINDOW_DAYS = readIntEnv("PRODUCT_NOVELTY_WINDOW_DAYS", 30, 1, 365);
const ALLOW_REPEAT_PRODUCTS = (process.env.ALLOW_REPEAT_PRODUCTS?.trim().toLowerCase() ?? "false") === "true";

/**
 * Phase 19 — Bộ điều phối Autopilot theo BATCH.
 * Mỗi lần gọi chỉ xử lý MỘT bước an toàn, lưu tiến độ, lần sau chạy tiếp.
 * KHÔNG xử lý tất cả sản phẩm/bài/ảnh trong một request.
 */

const AI_POST_JOB_TYPE = "CREATE_AI_POST_WITH_IMAGES";

function readIntEnv(name: string, fallback: number, min = 1, max = 50): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const LIMITS = {
  products: () => readIntEnv("MAX_CAMPAIGN_PRODUCTS_PER_RUN", 2),
  conversions: () => readIntEnv("MAX_LINK_CONVERSIONS_PER_RUN", 2),
  productsCreated: () => readIntEnv("MAX_PRODUCTS_CREATED_PER_RUN", 2),
  postsCreated: () => readIntEnv("MAX_POSTS_CREATED_PER_RUN", 2),
  creativeJobs: () => readIntEnv("MAX_CREATIVE_JOBS_STARTED_PER_RUN", 1),
  jobSteps: () => readIntEnv("MAX_AI_JOB_STEPS_PER_RUN", 2),
};
const SCHEDULE_BATCH = 8;

// Logs.
const LOG = {
  BATCH_STARTED: "AUTOPILOT_BATCH_STARTED",
  BATCH_FINISHED: "AUTOPILOT_BATCH_FINISHED",
  SOURCING_STARTED: "PRODUCT_SOURCING_STARTED",
  SOURCING_DONE: "PRODUCT_SOURCING_BATCH_COMPLETED",
  CONVERT_STARTED: "AFFILIATE_LINK_CONVERSION_STARTED",
  CONVERT_DONE: "AFFILIATE_LINK_CONVERSION_BATCH_COMPLETED",
  PRODUCTS_BATCH: "BULK_PRODUCTS_CREATED_BATCH",
  POSTS_BATCH: "BULK_POSTS_CREATED_BATCH",
  CREATIVE_JOBS_BATCH: "CREATIVE_JOBS_STARTED_BATCH",
  CREATIVE_STEP: "CREATIVE_JOB_STEP_PROCESSED",
  POST_SCHEDULED: "POST_SCHEDULED",
  SKIPPED_DUP: "AUTOPILOT_SKIPPED_DUPLICATE",
  CONTINUED_JOB: "AUTOPILOT_CONTINUED_EXISTING_JOB",
  FAILED_RECOVERABLE: "AUTOPILOT_FAILED_RECOVERABLE",
  FAILED_NON_RECOVERABLE: "AUTOPILOT_FAILED_NON_RECOVERABLE",
};

const AUTO_NEXT_DELAY_MS = 60_000;
const AUTO_RETRY_DELAY_MS = 5 * 60_000;
const DEFAULT_MICRO_STEPS_PER_RUN = readIntEnv("MAX_MICRO_STEPS_PER_CRON_RUN", 6, 1, 20);
const DEFAULT_SECONDS_PER_RUN = readIntEnv("MAX_SECONDS_PER_CRON_RUN", 40, 5, 55);

export type AutopilotStepInput = {
  campaignRunId?: string;
  trigger: "manual" | "cron";
  dryRun?: boolean;
};

export type AutopilotSummary = {
  ok: boolean;
  campaign_run_id: string | null;
  status: CampaignRunStatus | null;
  current_step: string | null;
  products_sourced: number;
  links_converted: number;
  products_created: number;
  posts_created: number;
  creative_jobs_started: number;
  creative_job_steps_processed: number;
  posts_ready_for_review: number;
  scheduled_count: number;
  skipped_count: number;
  errors: string[];
  message: string;
};

export type AutopilotLoopInput = AutopilotStepInput & {
  maxMicroSteps?: number;
  maxSeconds?: number;
};

export type AutopilotLoopSummary = AutopilotSummary & {
  micro_steps: number;
  budget_exhausted: boolean;
  stopped_reason: string;
  step_summaries: AutopilotSummary[];
};

function emptySummary(runId: string | null): AutopilotSummary {
  return {
    ok: true,
    campaign_run_id: runId,
    status: null,
    current_step: null,
    products_sourced: 0,
    links_converted: 0,
    products_created: 0,
    posts_created: 0,
    creative_jobs_started: 0,
    creative_job_steps_processed: 0,
    posts_ready_for_review: 0,
    scheduled_count: 0,
    skipped_count: 0,
    errors: [],
    message: "",
  };
}

function emptyLoopSummary(runId: string | null): AutopilotLoopSummary {
  return {
    ...emptySummary(runId),
    micro_steps: 0,
    budget_exhausted: false,
    stopped_reason: "",
    step_summaries: [],
  };
}

function mergeStepIntoLoop(loop: AutopilotLoopSummary, step: AutopilotSummary): void {
  loop.ok = loop.ok && step.ok;
  loop.campaign_run_id = step.campaign_run_id ?? loop.campaign_run_id;
  loop.status = step.status;
  loop.current_step = step.current_step;
  loop.products_sourced += step.products_sourced;
  loop.links_converted += step.links_converted;
  loop.products_created += step.products_created;
  loop.posts_created += step.posts_created;
  loop.creative_jobs_started += step.creative_jobs_started;
  loop.creative_job_steps_processed += step.creative_job_steps_processed;
  loop.posts_ready_for_review = Math.max(loop.posts_ready_for_review, step.posts_ready_for_review);
  loop.scheduled_count += step.scheduled_count;
  loop.skipped_count += step.skipped_count;
  loop.errors.push(...step.errors);
  loop.message = step.message;
  loop.step_summaries.push(step);
}

function isBlockedStatus(status: CampaignRunStatus | null): boolean {
  return (
    status === "WAITING_APPROVAL" ||
    status === "WAITING_POST_REVIEW" ||
    status === "PAUSED" ||
    status === "COMPLETED" ||
    status === "FAILED"
  );
}

function canAutoContinue(status: CampaignRunStatus | null): boolean {
  return !!status && !isBlockedStatus(status) && status !== "DRAFT" && status !== "AI_PLANNING";
}

function nowIso(): string {
  return new Date().toISOString();
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function parseCampaignRunRow(row: Record<string, unknown>): AiCampaignRun {
  return {
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    objective: (row.objective as string | null) ?? null,
    status: (row.status as CampaignRunStatus) ?? "DRAFT",
    mode: (row.mode as string) ?? "WEEKLY",
    start_date: (row.start_date as string | null) ?? null,
    end_date: (row.end_date as string | null) ?? null,
    target_customer: (row.target_customer as string | null) ?? null,
    budget_note: (row.budget_note as string | null) ?? null,
    ai_strategy: row.ai_strategy ?? {},
    product_opportunities: asArray<ProductOpportunity>(row.product_opportunities),
    sourced_candidates: asArray<SourcedCandidate>(row.sourced_candidates),
    sourcing_diagnostics: asArray<CampaignSourcingDiagnostic>(row.sourcing_diagnostics),
    posting_plan: (row.posting_plan as AiCampaignRun["posting_plan"]) ?? {},
    creative_direction: row.creative_direction ?? {},
    approved_at: (row.approved_at as string | null) ?? null,
    approved_by: (row.approved_by as string | null) ?? null,
    error_message: (row.error_message as string | null) ?? null,
    current_step: (row.current_step as string | null) ?? null,
    progress_current: Number(row.progress_current) || 0,
    progress_total: Number(row.progress_total) || 0,
    is_autopilot_enabled: row.is_autopilot_enabled !== false,
    auto_started_at: (row.auto_started_at as string | null) ?? null,
    last_auto_run_at: (row.last_auto_run_at as string | null) ?? null,
    next_auto_run_at: (row.next_auto_run_at as string | null) ?? null,
    last_cron_hit_at: (row.last_cron_hit_at as string | null) ?? null,
    last_cron_result: row.last_cron_result ?? null,
    cron_run_count: Number(row.cron_run_count) || 0,
    automation_error: (row.automation_error as string | null) ?? null,
    automation_attempts: Number(row.automation_attempts) || 0,
    paused: Boolean(row.paused),
    // Phase 21.
    shopee_account_id: (row.shopee_account_id as string | null) ?? null,
    facebook_page_id: (row.facebook_page_id as string | null) ?? null,
    user_keyword: (row.user_keyword as string | null) ?? null,
    user_objective: (row.user_objective as string | null) ?? null,
    user_category_hint: (row.user_category_hint as string | null) ?? null,
    locked_vertical: (row.locked_vertical as string | null) ?? null,
    vertical_confidence: row.vertical_confidence === null || row.vertical_confidence === undefined ? null : Number(row.vertical_confidence),
    keyword_lock_enabled: row.keyword_lock_enabled !== false,
    allowed_terms: asArray<string>(row.allowed_terms),
    negative_terms: asArray<string>(row.negative_terms),
    allowed_categories: asArray<string>(row.allowed_categories),
    blocked_categories: asArray<string>(row.blocked_categories),
    suggested_specific_queries: asArray<string>(row.suggested_specific_queries),
    needs_clarification: Boolean(row.needs_clarification),
    clarification_question: (row.clarification_question as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function candidateKey(item: { item_id?: string | null; product_url?: string | null; affiliate_link?: string | null; product_name?: string | null }): string {
  return (
    (item.item_id && `item:${item.item_id}`) ||
    (item.product_url && `url:${item.product_url}`) ||
    (item.affiliate_link && `aff:${item.affiliate_link}`) ||
    (item.product_name && `name:${item.product_name.toLowerCase()}`) ||
    `k:${Math.round((Date.now() % 1e7))}`
  );
}

function campaignSlug(run: AiCampaignRun): string {
  return slugify(run.title || run.objective || "camp");
}

async function patchRun(
  supabase: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase.from("ai_campaign_runs").update({ ...patch, updated_at: nowIso() }).eq("id", runId);
}

/** Đẩy một cơ hội/ứng viên sang Tìm link thủ công (sourcing_candidates). */
async function pushToManualSourcing(
  supabase: SupabaseClient,
  runId: string,
  opp: ProductOpportunity,
  note: string,
  status: SourcingStatus = "MANUAL_REQUIRED",
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("sourcing_candidates")
      .select("id")
      .eq("ai_campaign_run_id", runId)
      .ilike("suggested_product", opp.product_keyword)
      .limit(1);
    if (existing && existing.length > 0) return;
    await supabase.from("sourcing_candidates").insert({
      ai_campaign_run_id: runId,
      suggested_product: opp.product_keyword,
      category: opp.category ?? null,
      reason: opp.reason ?? null,
      target_customer: opp.target_customer ?? null,
      pain_point: opp.pain_point ?? null,
      suggested_search_keywords: opp.search_keywords ?? [],
      content_angle: opp.expected_content_angle ?? null,
      priority: opp.priority ?? null,
      status,
      notes: note.slice(0, 300),
    });
  } catch {
    // không chặn pipeline nếu push thủ công lỗi
  }
}

/** Lấy 1 run để xử lý (chỉ định hoặc chọn run đang chạy cũ nhất). */
async function pickRun(supabase: SupabaseClient, campaignRunId?: string): Promise<AiCampaignRun | null> {
  if (campaignRunId) {
    const { data } = await supabase.from("ai_campaign_runs").select("*").eq("id", campaignRunId).single();
    return data ? parseCampaignRunRow(data as Record<string, unknown>) : null;
  }
  const ACTIVE: CampaignRunStatus[] = [
    "APPROVED",
    "SOURCING_PRODUCTS",
    "CONVERTING_LINKS",
    "CREATING_PRODUCTS",
    "CREATING_POSTS",
    "CREATING_CREATIVES",
    "SCHEDULING",
    "SCHEDULED",
    "RUNNING",
  ];
  const { data } = await supabase
    .from("ai_campaign_runs")
    .select("*")
    .in("status", ACTIVE)
    .eq("paused", false)
    .order("updated_at", { ascending: true })
    .limit(1);
  const row = data?.[0];
  return row ? parseCampaignRunRow(row as Record<string, unknown>) : null;
}

/**
 * Chạy MỘT bước batch của một campaign run. KHÔNG throw.
 */
export async function runCampaignAutopilotStep(input: AutopilotStepInput): Promise<AutopilotSummary> {
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "DB error";
    return { ...emptySummary(input.campaignRunId ?? null), ok: false, message: `Không kết nối DB: ${m}`, errors: [m] };
  }

  const run = await pickRun(supabase, input.campaignRunId);
  if (!run) {
    return { ...emptySummary(input.campaignRunId ?? null), message: "Không có chiến dịch nào cần xử lý." };
  }

  const summary = emptySummary(run.id);
  summary.status = run.status;
  summary.current_step = run.current_step;

  if (run.paused) {
    summary.message = "Chiến dịch đang tạm dừng.";
    return summary;
  }
  const TERMINAL: CampaignRunStatus[] = ["DRAFT", "AI_PLANNING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "PAUSED"];
  if (TERMINAL.includes(run.status)) {
    summary.message = `Chiến dịch ở trạng thái ${run.status}, không xử lý batch.`;
    return summary;
  }

  if (input.dryRun) {
    summary.message = "dryRun: bỏ qua xử lý.";
    return summary;
  }

  await insertPostingLog(supabase, null, LOG.BATCH_STARTED, "SUCCESS", `Autopilot batch (${input.trigger}) cho "${run.title ?? run.id}" @ ${run.status}.`, {
    ai_campaign_run_id: run.id,
    status: run.status,
  });

  try {
    await dispatchStep(supabase, run, summary, input.trigger);
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    summary.errors.push(m);
    summary.ok = false;
    await insertPostingLog(supabase, null, LOG.FAILED_RECOVERABLE, "FAILED", `Autopilot lỗi: ${m}`.slice(0, 500), { ai_campaign_run_id: run.id });
  }

  // Đọc lại trạng thái sau bước.
  const { data: after } = await supabase.from("ai_campaign_runs").select("status, current_step").eq("id", run.id).single();
  if (after) {
    summary.status = (after as { status: CampaignRunStatus }).status;
    summary.current_step = (after as { current_step: string | null }).current_step;
  }
  const autoStopped =
    summary.status === "WAITING_APPROVAL" ||
    summary.status === "WAITING_POST_REVIEW" ||
    summary.status === "PAUSED" ||
    summary.status === "COMPLETED" ||
    summary.status === "FAILED";
  await patchRun(supabase, run.id, {
    last_auto_run_at: nowIso(),
    next_auto_run_at: autoStopped ? null : new Date(Date.now() + (summary.ok ? AUTO_NEXT_DELAY_MS : AUTO_RETRY_DELAY_MS)).toISOString(),
    automation_error: summary.ok ? null : summary.errors.join("; ").slice(0, 800),
    automation_attempts: run.automation_attempts + 1,
  });
  await insertPostingLog(supabase, null, LOG.BATCH_FINISHED, "SUCCESS", `Autopilot batch xong @ ${summary.status}.`, {
    ai_campaign_run_id: run.id,
    sourced: summary.products_sourced,
    converted: summary.links_converted,
    products: summary.products_created,
    posts: summary.posts_created,
    job_steps: summary.creative_job_steps_processed,
    scheduled: summary.scheduled_count,
  });
  return summary;
}

/**
 * Chạy nhiều micro-step an toàn trong một request cron/manual debug.
 * Cron vẫn gọi theo batch nhỏ, nhưng không dừng sau một chuyển trạng thái tầm thường.
 */
export async function runCampaignAutopilotUntilBlocked(input: AutopilotLoopInput): Promise<AutopilotLoopSummary> {
  const maxMicroSteps = Math.max(1, Math.min(20, input.maxMicroSteps ?? DEFAULT_MICRO_STEPS_PER_RUN));
  const maxMs = Math.max(5, Math.min(55, input.maxSeconds ?? DEFAULT_SECONDS_PER_RUN)) * 1000;
  const started = Date.now();
  let runId = input.campaignRunId;
  const loop = emptyLoopSummary(runId ?? null);

  for (let i = 0; i < maxMicroSteps; i += 1) {
    if (Date.now() - started > maxMs) {
      loop.budget_exhausted = true;
      loop.stopped_reason = "time_budget_exhausted";
      break;
    }

    const step = await runCampaignAutopilotStep({ ...input, campaignRunId: runId });
    loop.micro_steps += 1;
    mergeStepIntoLoop(loop, step);
    runId = step.campaign_run_id ?? runId;

    if (!step.campaign_run_id) {
      loop.stopped_reason = "no_campaign";
      break;
    }
    if (!step.ok) {
      loop.stopped_reason = "step_error";
      break;
    }
    if (isBlockedStatus(step.status)) {
      loop.stopped_reason = `blocked:${step.status}`;
      break;
    }
    if (!canAutoContinue(step.status)) {
      loop.stopped_reason = `no_auto_action:${step.status ?? "unknown"}`;
      break;
    }
    if (i === maxMicroSteps - 1) {
      loop.budget_exhausted = true;
      loop.stopped_reason = "micro_step_budget_exhausted";
    }
  }

  if (!loop.stopped_reason) loop.stopped_reason = "completed_budget";
  loop.message = `${loop.message || "Đã chạy autopilot."} (${loop.micro_steps} micro-step, dừng: ${loop.stopped_reason})`;
  return loop;
}

async function dispatchStep(
  supabase: SupabaseClient,
  run: AiCampaignRun,
  summary: AutopilotSummary,
  trigger: "manual" | "cron",
): Promise<void> {
  switch (run.status) {
    case "APPROVED":
      await patchRun(supabase, run.id, { status: "SOURCING_PRODUCTS", current_step: "SOURCING_PRODUCTS" });
      summary.message = "Bắt đầu tìm sản phẩm.";
      return;
    case "SOURCING_PRODUCTS":
      return stepSourcing(supabase, run, summary);
    case "CONVERTING_LINKS":
      return stepConvert(supabase, run, summary);
    case "CREATING_PRODUCTS":
      return stepCreateProducts(supabase, run, summary);
    case "CREATING_POSTS":
      return stepCreatePosts(supabase, run, summary);
    case "CREATING_CREATIVES":
      return stepCreatives(supabase, run, summary, trigger);
    case "WAITING_POST_REVIEW":
      return stepWaitingReview(supabase, run, summary);
    case "SCHEDULING":
      return stepScheduling(supabase, run, summary);
    case "SCHEDULED":
    case "RUNNING":
      return stepPublishingWatch(supabase, run, summary);
    default:
      summary.message = `Không có hành động cho trạng thái ${run.status}.`;
  }
}

// ---------------------------------------------------------------------------
// SOURCING_PRODUCTS — tìm + LỌC NGHIÊM NGẶT (relevance gate) + chống trùng.
// ---------------------------------------------------------------------------
type SeenIndex = { urls: Set<string>; affs: Set<string>; titles: string[] };

async function buildSeenIndex(supabase: SupabaseClient, windowDays: number): Promise<SeenIndex> {
  const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const urls = new Set<string>();
  const affs = new Set<string>();
  const titles: string[] = [];
  const add = (url: string | null | undefined, aff: string | null | undefined, title: string | null | undefined) => {
    if (url) urls.add(normalizeText(url));
    if (aff) affs.add(aff.trim());
    if (title) titles.push(title);
  };
  // products gần đây
  const { data: prods } = await supabase
    .from("products")
    .select("product_name, original_url, affiliate_link, created_at")
    .gte("created_at", sinceIso)
    .limit(800);
  for (const p of (prods ?? []) as Array<{ product_name: string | null; original_url: string | null; affiliate_link: string | null }>) {
    add(p.original_url, p.affiliate_link, p.product_name);
  }
  // sourcing_candidates gần đây
  const { data: cands } = await supabase
    .from("sourcing_candidates")
    .select("suggested_product, affiliate_link, created_at")
    .gte("created_at", sinceIso)
    .limit(800);
  for (const c of (cands ?? []) as Array<{ suggested_product: string | null; affiliate_link: string | null }>) {
    add(null, c.affiliate_link, c.suggested_product);
  }
  // sourced_candidates của các run gần đây
  const { data: runs } = await supabase
    .from("ai_campaign_runs")
    .select("sourced_candidates, created_at")
    .gte("created_at", sinceIso)
    .limit(60);
  for (const r of (runs ?? []) as Array<{ sourced_candidates: unknown }>) {
    const list = Array.isArray(r.sourced_candidates) ? (r.sourced_candidates as SourcedCandidate[]) : [];
    for (const c of list) add(c.product_url, c.affiliate_link, c.product_name);
  }
  return { urls, affs, titles };
}

function isDuplicateRecent(item: SourcingSearchItem, seen: SeenIndex): boolean {
  if (item.affiliate_link && seen.affs.has(item.affiliate_link.trim())) return true;
  if (item.product_url && seen.urls.has(normalizeText(item.product_url))) return true;
  return seen.titles.some((t) => titleSimilarity(t, item.product_name) >= 0.8);
}

/** Ngành đã khóa của chiến dịch (DB -> phân loại lại từ keyword/objective nếu thiếu). */
function resolveLockedVertical(run: AiCampaignRun): Vertical {
  const stored = (run.locked_vertical ?? "").trim();
  if (stored) return stored as Vertical;
  const text = `${run.user_keyword ?? ""} ${run.objective ?? ""} ${run.title ?? ""}`.trim();
  return classifyVertical(text).vertical;
}

async function stepSourcing(supabase: SupabaseClient, run: AiCampaignRun, summary: AutopilotSummary): Promise<void> {
  const opportunities = run.product_opportunities;
  const candidates = [...run.sourced_candidates];
  const diagnostics = [...run.sourcing_diagnostics];
  const attempted = new Set(candidates.map((c) => c.opportunity_index));
  const todo = opportunities.map((opp, idx) => ({ opp, idx })).filter(({ idx }) => !attempted.has(idx));

  if (todo.length === 0) {
    await patchRun(supabase, run.id, { status: "CONVERTING_LINKS", current_step: "CONVERTING_LINKS" });
    summary.message = "Đã tìm xong tất cả cơ hội, chuyển sang chuyển link.";
    return;
  }

  // Khóa ngành: nếu chưa xác định ngành -> dừng, yêu cầu làm rõ (không source bừa).
  const lockedVertical = resolveLockedVertical(run);
  if (run.keyword_lock_enabled !== false && lockedVertical === "UNKNOWN") {
    const msg = "Chưa xác định được ngành hàng của từ khóa. Hãy chọn nhóm sản phẩm cho chiến dịch rồi chạy lại.";
    await patchRun(supabase, run.id, { needs_clarification: true, clarification_question: msg, error_message: msg, automation_error: msg, next_auto_run_at: null });
    summary.ok = false;
    summary.errors.push(msg);
    summary.message = msg;
    return;
  }
  const broadKeyword = isBroadKeyword(run.user_keyword ?? run.objective ?? "");

  await insertPostingLog(supabase, null, LOG.SOURCING_STARTED, "SUCCESS", `Tìm sản phẩm (ngành ${lockedVertical}) cho ${Math.min(LIMITS.products(), todo.length)} cơ hội.`, { ai_campaign_run_id: run.id, locked_vertical: lockedVertical });

  const seen = await buildSeenIndex(supabase, NOVELTY_WINDOW_DAYS);
  const batch = todo.slice(0, LIMITS.products());
  const existingKeys = new Set(candidates.map((c) => c.key));
  let providerMissing = false;
  let lastError: string | null = null;

  for (const { opp, idx } of batch) {
    const queries = expandVerticalQueries(lockedVertical, opp).all;
    const res = await searchRawProducts(queries, {
      limit: 10,
      category: opp.category ?? null,
      maxResults: 30,
      shopeeAccountId: run.shopee_account_id,
    });

    if (!res.configured) {
      providerMissing = true;
      lastError = res.error;
      await pushToManualSourcing(supabase, run.id, opp, `Chưa cấu hình provider tìm sản phẩm: ${res.error ?? ""}`, "PROVIDER_MISSING");
      candidates.push(makeCandidate(opp, idx, null, "NEEDS_PROVIDER"));
      diagnostics.push(makeDiagnostic(opp, idx, queries, 0, 0, {}, [], [], [], res.provider, `Chưa cấu hình provider: ${res.error ?? ""}`));
      continue;
    }

    const rawItems = res.results;
    const rejectionReasons: Record<string, number> = {};
    const negativeHits = new Set<string>();
    const rejectedExamples: string[] = [];
    const accepted: Array<{ item: SourcingSearchItem; score: number; reason: string }> = [];

    for (const item of rawItems) {
      const dup = isDuplicateRecent(item, seen);
      const verdict = scoreProductForVertical(item, lockedVertical, opp, {
        requireImage: true,
        isDuplicateRecent: dup,
        allowRepeat: ALLOW_REPEAT_PRODUCTS,
        broadKeyword,
      });
      if (verdict.accepted) {
        accepted.push({ item, score: verdict.score, reason: verdict.accepted_reason ?? "" });
        await insertPostingLog(supabase, null, "PRODUCT_ACCEPTED_BY_RELEVANCE", "SUCCESS", `${item.product_name} (score ${verdict.score})`.slice(0, 300), { ai_campaign_run_id: run.id });
      } else {
        const reason = (verdict.rejected_reason ?? "LOW_RELEVANCE") as VerticalRejectionReason;
        rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
        for (const b of verdict.blocked_terms) negativeHits.add(b);
        if (rejectedExamples.length < 4) rejectedExamples.push(`${item.product_name} (${VERTICAL_REJECTION_LABELS[reason]}, score ${verdict.score})`);
      }
    }

    accepted.sort((a, b) => b.score - a.score);
    const chosen = accepted.find(({ item }) => !existingKeys.has(candidateKey(item)));
    const topAccepted = accepted.slice(0, 3).map((a) => `${a.item.product_name} (${a.score})`);

    if (chosen) {
      existingKeys.add(candidateKey(chosen.item));
      // Đưa title đã chấp nhận vào seen để cơ hội kế trong batch không chọn trùng.
      seen.titles.push(chosen.item.product_name);
      const cand = makeCandidate(opp, idx, chosen.item, "SOURCED");
      cand.relevance_score = chosen.score;
      cand.accepted_reason = chosen.reason;
      candidates.push(cand);
      summary.products_sourced += 1;
      diagnostics.push(
        makeDiagnostic(opp, idx, queries, rawItems.length, accepted.length, rejectionReasons, Array.from(negativeHits), topAccepted, rejectedExamples, res.provider, `Chấp nhận: ${chosen.item.product_name} (score ${chosen.score}).`),
      );
    } else {
      // accepted_count = 0 -> KHÔNG dùng sản phẩm xấu.
      const c = makeCandidate(opp, idx, null, "NO_RELEVANT_PRODUCT");
      c.rejected_reason = "LOW_RELEVANCE";
      candidates.push(c);
      const suggestions = suggestSpecificKeywords(lockedVertical);
      await pushToManualSourcing(supabase, run.id, opp, `Không tìm thấy sản phẩm đủ liên quan (raw ${rawItems.length}). Gợi ý từ khóa: ${suggestions.join(", ")}`, "MANUAL_REQUIRED");
      diagnostics.push(
        makeDiagnostic(
          opp,
          idx,
          queries,
          rawItems.length,
          0,
          rejectionReasons,
          Array.from(negativeHits),
          [],
          rejectedExamples,
          res.provider,
          `Không tìm thấy sản phẩm đủ liên quan. Thử từ khóa cụ thể hơn: ${suggestions.join(", ")}.`,
        ),
      );
    }
  }

  if (providerMissing) {
    const stillTodo = opportunities.map((opp, idx) => ({ opp, idx })).filter(({ idx }) => !candidates.some((c) => c.opportunity_index === idx));
    for (const { opp, idx } of stillTodo) {
      await pushToManualSourcing(supabase, run.id, opp, "Chưa cấu hình provider tìm sản phẩm.", "PROVIDER_MISSING");
      candidates.push(makeCandidate(opp, idx, null, "NEEDS_PROVIDER"));
      diagnostics.push(makeDiagnostic(opp, idx, [], 0, 0, {}, [], [], [], "none", "Chưa cấu hình provider tìm sản phẩm."));
    }
  }

  const allAttempted = opportunities.every((_, idx) => candidates.some((c) => c.opportunity_index === idx));
  const patch: Record<string, unknown> = {
    sourced_candidates: candidates,
    sourcing_diagnostics: diagnostics,
    progress_total: opportunities.length,
    progress_current: candidates.filter((c) => c.link_status === "SOURCED" || c.link_status === "READY").length,
  };
  if (providerMissing) {
    patch.error_message =
      "Chưa cấu hình provider tìm sản phẩm (SHOPEE_PRODUCT_SEARCH_PROVIDER) hoặc chưa có tài khoản Shopee ACTIVE. Các cơ hội đã được đưa sang Tìm link thủ công.";
    await insertPostingLog(supabase, null, LOG.FAILED_NON_RECOVERABLE, "FAILED", patch.error_message as string, { ai_campaign_run_id: run.id });
  }
  if (allAttempted) {
    const acceptedTotal = candidates.filter((c) => c.link_status === "SOURCED" || c.link_status === "READY" || !!c.product_id).length;
    if (acceptedTotal === 0) {
      const topRejected = diagnostics.flatMap((d) => d.top_rejected_examples ?? []).slice(0, 8).join("; ");
      const noRelevantMessage =
        typeof patch.error_message === "string"
          ? patch.error_message
          : "Không có sản phẩm nào đạt điểm liên quan. Hãy dùng từ khóa cụ thể hơn hoặc chỉnh nhóm sản phẩm." +
            (topRejected ? ` Ví dụ bị loại: ${topRejected}` : "");
      patch.status = "FAILED";
      patch.current_step = "FAILED";
      patch.error_message = noRelevantMessage;
      patch.automation_error = noRelevantMessage;
      patch.next_auto_run_at = null;
      summary.ok = false;
      summary.errors.push(noRelevantMessage);
      await insertPostingLog(supabase, null, LOG.FAILED_NON_RECOVERABLE, "FAILED", noRelevantMessage, { ai_campaign_run_id: run.id });
    } else {
      patch.status = "CONVERTING_LINKS";
      patch.current_step = "CONVERTING_LINKS";
    }
  }
  await patchRun(supabase, run.id, patch);
  await insertPostingLog(supabase, null, LOG.SOURCING_DONE, "SUCCESS", `Sourced ${summary.products_sourced} sản phẩm đạt chuẩn (batch).`, {
    ai_campaign_run_id: run.id,
    sourced: summary.products_sourced,
  });
  summary.message = `Đã tìm ${summary.products_sourced} sản phẩm đạt chuẩn.${lastError ? ` (Lưu ý: ${lastError})` : ""}`;
}

function makeDiagnostic(
  opp: ProductOpportunity,
  idx: number,
  queries: string[],
  rawCount: number,
  acceptedCount: number,
  rejectionReasons: Record<string, number>,
  negativeKeywordHits: string[],
  topAccepted: string[],
  topRejected: string[],
  provider: string,
  message: string,
): CampaignSourcingDiagnostic {
  const rejectedCount = Object.values(rejectionReasons).reduce((a, b) => a + b, 0);
  return {
    opportunity_index: idx,
    product_keyword: opp.product_keyword,
    queries,
    raw_count: rawCount,
    accepted_count: acceptedCount,
    rejected_count: rejectedCount,
    rejection_reasons: rejectionReasons,
    negative_keyword_hits: negativeKeywordHits,
    top_accepted: topAccepted,
    top_rejected_examples: topRejected,
    message,
    provider,
    created_at: new Date().toISOString(),
  };
}

function makeCandidate(
  opp: ProductOpportunity,
  idx: number,
  item: SourcingSearchItem | null,
  linkStatus: SourcedCandidate["link_status"],
): SourcedCandidate {
  if (!item) {
    return {
      key: `opp:${idx}:${slugify(opp.product_keyword)}`,
      opportunity_index: idx,
      product_keyword: opp.product_keyword,
      product_name: opp.product_keyword,
      product_url: null,
      item_id: null,
      shop_id: null,
      shop_name: null,
      image_urls: [],
      price_note: opp.suggested_price_range ?? null,
      category: opp.category ?? null,
      reason: opp.reason ?? null,
      affiliate_link: null,
      sub_id: null,
      link_status: linkStatus,
      product_id: null,
      score: 0,
      relevance_score: null,
      accepted_reason: null,
      rejected_reason: null,
    };
  }
  return {
    key: candidateKey(item),
    opportunity_index: idx,
    product_keyword: opp.product_keyword,
    product_name: item.product_name,
    product_url: item.product_url,
    item_id: item.item_id,
    shop_id: item.shop_id,
    shop_name: item.shop_name,
    image_urls: item.image_urls,
    price_note: item.price_note ?? opp.suggested_price_range ?? null,
    category: item.category ?? opp.category ?? null,
    reason: item.reason ?? opp.reason ?? null,
    affiliate_link: item.affiliate_link,
    sub_id: null,
    link_status: linkStatus,
    product_id: null,
    score: 0,
    relevance_score: null,
    accepted_reason: null,
    rejected_reason: null,
  };
}

// ---------------------------------------------------------------------------
// CONVERTING_LINKS
// ---------------------------------------------------------------------------
async function stepConvert(supabase: SupabaseClient, run: AiCampaignRun, summary: AutopilotSummary): Promise<void> {
  const candidates = [...run.sourced_candidates];
  const pending = candidates.filter((c) => c.link_status === "SOURCED");
  if (pending.length === 0) {
    const readyCount = candidates.filter((c) => c.link_status === "READY" && c.affiliate_link).length;
    if (readyCount === 0) {
      const msg = "Không có sản phẩm nào có link affiliate hợp lệ để tạo sản phẩm. Các lỗi chuyển link đã được đưa sang Công cụ thủ công.";
      await patchRun(supabase, run.id, {
        status: "FAILED",
        current_step: "FAILED",
        error_message: msg,
        automation_error: msg,
        next_auto_run_at: null,
      });
      summary.ok = false;
      summary.errors.push(msg);
      summary.message = msg;
      await insertPostingLog(supabase, null, LOG.FAILED_NON_RECOVERABLE, "FAILED", msg, { ai_campaign_run_id: run.id });
      return;
    }
    await patchRun(supabase, run.id, { status: "CREATING_PRODUCTS", current_step: "CREATING_PRODUCTS" });
    summary.message = "Đã chuyển xong link, sang tạo sản phẩm.";
    return;
  }

  await insertPostingLog(supabase, null, LOG.CONVERT_STARTED, "SUCCESS", `Chuyển link cho ${Math.min(LIMITS.conversions(), pending.length)} ứng viên.`, { ai_campaign_run_id: run.id });

  const slug = campaignSlug(run);
  const batch = pending.slice(0, LIMITS.conversions());
  let providerMissing = false;
  for (const cand of batch) {
    const globalIdx = candidates.findIndex((c) => c.key === cand.key);
    const res = await convertProductUrlToAffiliateLink({
      product_url: cand.product_url,
      existing_offer_link: cand.affiliate_link,
      campaign_slug: slug,
      index: globalIdx + 1,
      shopeeAccountId: run.shopee_account_id,
    });
    const target = candidates.find((c) => c.key === cand.key);
    if (!target) continue;
    if (res.ok && res.affiliate_link) {
      target.affiliate_link = res.affiliate_link;
      target.sub_id = res.sub_id;
      target.link_status = "READY";
      summary.links_converted += 1;
    } else if (!res.configured) {
      providerMissing = true;
      target.link_status = "NEEDS_PROVIDER";
      await pushToManualSourcing(supabase, run.id, opportunityFor(run, cand), `Chưa cấu hình chuyển link: ${res.error ?? ""}`, "PROVIDER_MISSING");
    } else {
      target.link_status = "LINK_CONVERSION_FAILED";
      await pushToManualSourcing(supabase, run.id, opportunityFor(run, cand), `Chuyển link thất bại: ${res.error ?? ""}`, "LINK_CONVERSION_FAILED");
    }
  }

  const stillPending = candidates.some((c) => c.link_status === "SOURCED");
  const patch: Record<string, unknown> = { sourced_candidates: candidates };
  if (providerMissing) {
    patch.error_message =
      "Chưa cấu hình SHOPEE_AFFILIATE_LINK_PROVIDER hoặc thiếu tài khoản Shopee. Không thể tự chuyển link. Các sản phẩm đã được đưa sang Tìm link thủ công.";
    await insertPostingLog(supabase, null, LOG.FAILED_NON_RECOVERABLE, "FAILED", patch.error_message as string, { ai_campaign_run_id: run.id });
  }
  if (!stillPending) {
    patch.status = "CREATING_PRODUCTS";
    patch.current_step = "CREATING_PRODUCTS";
  }
  await patchRun(supabase, run.id, patch);
  await insertPostingLog(supabase, null, LOG.CONVERT_DONE, "SUCCESS", `Đã chuyển ${summary.links_converted} link (batch).`, {
    ai_campaign_run_id: run.id,
    converted: summary.links_converted,
  });
  summary.message = `Đã chuyển ${summary.links_converted} link affiliate.`;
}

function opportunityFor(run: AiCampaignRun, cand: SourcedCandidate): ProductOpportunity {
  return (
    run.product_opportunities[cand.opportunity_index] ?? {
      product_keyword: cand.product_keyword,
      category: cand.category,
      reason: cand.reason,
    }
  );
}

// ---------------------------------------------------------------------------
// CREATING_PRODUCTS
// ---------------------------------------------------------------------------
async function stepCreateProducts(supabase: SupabaseClient, run: AiCampaignRun, summary: AutopilotSummary): Promise<void> {
  const candidates = [...run.sourced_candidates];
  const ready = candidates.filter((c) => c.link_status === "READY" && c.affiliate_link && !c.product_id);
  if (ready.length === 0) {
    const productCount = candidates.filter((c) => !!c.product_id).length;
    if (productCount === 0) {
      const msg = "Không có sản phẩm READY nào được tạo. Autopilot dừng để tránh tạo bài từ dữ liệu không hợp lệ.";
      await patchRun(supabase, run.id, {
        status: "FAILED",
        current_step: "FAILED",
        error_message: msg,
        automation_error: msg,
        next_auto_run_at: null,
      });
      summary.ok = false;
      summary.errors.push(msg);
      summary.message = msg;
      await insertPostingLog(supabase, null, LOG.FAILED_NON_RECOVERABLE, "FAILED", msg, { ai_campaign_run_id: run.id });
      return;
    }
    await patchRun(supabase, run.id, { status: "CREATING_POSTS", current_step: "CREATING_POSTS" });
    summary.message = "Đã tạo xong sản phẩm, sang tạo bài.";
    return;
  }

  const batch = ready.slice(0, LIMITS.productsCreated());
  for (const cand of batch) {
    const target = candidates.find((c) => c.key === cand.key);
    if (!target || !target.affiliate_link) continue;

    // Dedupe: theo affiliate_link, rồi original_url (tránh .or vì URL có thể chứa dấu phẩy/chấm).
    let { data: dup } = await supabase
      .from("products")
      .select("id, ai_campaign_run_id")
      .eq("affiliate_link", target.affiliate_link)
      .limit(1);
    if ((!dup || dup.length === 0) && target.product_url) {
      const byUrl = await supabase
        .from("products")
        .select("id, ai_campaign_run_id")
        .eq("original_url", target.product_url)
        .limit(1);
      dup = byUrl.data;
    }
    if (dup && dup.length > 0) {
      const existingId = String(dup[0].id);
      target.product_id = existingId;
      if (!dup[0].ai_campaign_run_id) {
        await supabase.from("products").update({ ai_campaign_run_id: run.id, updated_at: nowIso() }).eq("id", existingId);
      }
      summary.skipped_count += 1;
      await insertPostingLog(supabase, null, LOG.SKIPPED_DUP, "SUCCESS", `Sản phẩm đã tồn tại, dùng lại: ${target.product_name}.`, {
        ai_campaign_run_id: run.id,
        product_id: existingId,
      });
      continue;
    }

    const opp = opportunityFor(run, target);
    const { data: inserted, error } = await supabase
      .from("products")
      .insert({
        product_name: target.product_name,
        affiliate_link: target.affiliate_link,
        original_url: target.product_url,
        sub_id: target.sub_id,
        link_status: deriveLinkStatus(target.affiliate_link),
        link_note: target.category ? `Nhóm: ${target.category}` : null,
        image_url: target.image_urls[0] ?? null,
        source_product_images: target.image_urls,
        source_capture_status: target.image_urls.length > 0 ? "CAPTURED" : "PENDING",
        source_capture_method: "autopilot_shopee_api",
        source_captured_at: target.image_urls.length > 0 ? nowIso() : null,
        price_note: target.price_note ?? "giá có thể thay đổi theo thời điểm",
        target_customer: opp.target_customer ?? run.target_customer ?? null,
        product_angle: opp.expected_content_angle ?? null,
        status: "ACTIVE",
        ai_campaign_run_id: run.id,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      summary.errors.push(`Tạo sản phẩm thất bại: ${error?.message ?? "?"}`);
      continue;
    }
    target.product_id = String(inserted.id);
    summary.products_created += 1;
  }

  const stillReady = candidates.some((c) => c.link_status === "READY" && c.affiliate_link && !c.product_id);
  const patch: Record<string, unknown> = { sourced_candidates: candidates };
  if (!stillReady) {
    patch.status = "CREATING_POSTS";
    patch.current_step = "CREATING_POSTS";
  }
  await patchRun(supabase, run.id, patch);
  await insertPostingLog(supabase, null, LOG.PRODUCTS_BATCH, "SUCCESS", `Tạo ${summary.products_created} sản phẩm (batch).`, {
    ai_campaign_run_id: run.id,
    products_created: summary.products_created,
  });
  summary.message = `Đã tạo ${summary.products_created} sản phẩm.`;
}

// ---------------------------------------------------------------------------
// CREATING_POSTS — enqueue ai_jobs (job INIT sẽ tạo generated_post).
// ---------------------------------------------------------------------------
async function productsNeedingJobs(supabase: SupabaseClient, run: AiCampaignRun): Promise<string[]> {
  const productIds = run.sourced_candidates
    .filter((c) => c.link_status === "READY" && c.product_id)
    .map((c) => c.product_id as string);
  if (productIds.length === 0) return [];
  // Sản phẩm đã có ai_job (bất kỳ trạng thái nào trừ FAILED không kèm post) thì bỏ qua.
  const { data: jobs } = await supabase
    .from("ai_jobs")
    .select("related_product_id, status")
    .eq("ai_campaign_run_id", run.id)
    .in("related_product_id", productIds);
  const haveJob = new Set(
    ((jobs ?? []) as Array<{ related_product_id: string | null; status: string }>)
      .filter((j) => j.related_product_id)
      .map((j) => j.related_product_id as string),
  );
  if (haveJob.size > 0) {
    await insertPostingLog(supabase, null, LOG.CONTINUED_JOB, "SUCCESS", `Tiếp tục dùng ${haveJob.size} job AI đã tồn tại, không tạo trùng.`, {
      ai_campaign_run_id: run.id,
      existing_jobs: haveJob.size,
    });
  }
  return productIds.filter((id) => !haveJob.has(id));
}

async function stepCreatePosts(supabase: SupabaseClient, run: AiCampaignRun, summary: AutopilotSummary): Promise<void> {
  const need = await productsNeedingJobs(supabase, run);
  if (need.length === 0) {
    await patchRun(supabase, run.id, { status: "CREATING_CREATIVES", current_step: "CREATING_CREATIVES" });
    summary.message = "Đã tạo job cho tất cả sản phẩm, sang tạo ảnh creative.";
    return;
  }

  const batch = need.slice(0, LIMITS.postsCreated());
  const { data: prodRows } = await supabase
    .from("products")
    .select("id, product_name, original_url, affiliate_link, target_customer, product_angle, price_note")
    .in("id", batch);
  const prods = (prodRows ?? []) as Array<Record<string, unknown>>;

  for (const p of prods) {
    const affiliate = (p.affiliate_link as string | null) ?? "";
    if (!affiliate) {
      summary.skipped_count += 1;
      continue;
    }
    const { error } = await supabase.from("ai_jobs").insert({
      job_type: AI_POST_JOB_TYPE,
      status: "PENDING",
      step: "INIT",
      progress_current: 0,
      progress_total: 7,
      related_product_id: p.id as string,
      ai_campaign_run_id: run.id,
      facebook_page_id: run.facebook_page_id,
      input: {
        product_name: (p.product_name as string) ?? "Sản phẩm",
        original_url: (p.original_url as string | null) ?? null,
        affiliate_link: affiliate,
        target_customer: (p.target_customer as string | null) ?? null,
        product_angle: (p.product_angle as string | null) ?? null,
        price_note: (p.price_note as string | null) ?? null,
        facebook_page_id: run.facebook_page_id,
        shopee_account_id: run.shopee_account_id,
      },
    });
    if (error) {
      summary.errors.push(`Tạo job thất bại: ${error.message}`);
      continue;
    }
    summary.posts_created += 1;
    summary.creative_jobs_started += 1;
  }

  const remaining = await productsNeedingJobs(supabase, run);
  if (remaining.length === 0) {
    await patchRun(supabase, run.id, { status: "CREATING_CREATIVES", current_step: "CREATING_CREATIVES" });
  }
  await insertPostingLog(supabase, null, LOG.POSTS_BATCH, "SUCCESS", `Tạo ${summary.posts_created} job bài đăng (batch).`, {
    ai_campaign_run_id: run.id,
    posts_created: summary.posts_created,
  });
  summary.message = `Đã tạo ${summary.posts_created} job bài đăng.`;
}

// ---------------------------------------------------------------------------
// CREATING_CREATIVES — pump job steps (giới hạn), chờ tất cả job kết thúc.
// ---------------------------------------------------------------------------
async function stepCreatives(
  supabase: SupabaseClient,
  run: AiCampaignRun,
  summary: AutopilotSummary,
  trigger: "manual" | "cron",
): Promise<void> {
  // An toàn: enqueue nốt sản phẩm chưa có job (nếu sót).
  const need = await productsNeedingJobs(supabase, run);
  if (need.length > 0) {
    const { data: prodRows } = await supabase
      .from("products")
      .select("id, product_name, original_url, affiliate_link, target_customer, product_angle, price_note")
      .in("id", need.slice(0, LIMITS.creativeJobs()));
    for (const p of (prodRows ?? []) as Array<Record<string, unknown>>) {
      const affiliate = (p.affiliate_link as string | null) ?? "";
      if (!affiliate) continue;
      await supabase.from("ai_jobs").insert({
        job_type: AI_POST_JOB_TYPE,
        status: "PENDING",
        step: "INIT",
        progress_current: 0,
        progress_total: 7,
        related_product_id: p.id as string,
        ai_campaign_run_id: run.id,
        facebook_page_id: run.facebook_page_id,
        input: {
          product_name: (p.product_name as string) ?? "Sản phẩm",
          original_url: (p.original_url as string | null) ?? null,
          affiliate_link: affiliate,
          target_customer: (p.target_customer as string | null) ?? null,
          product_angle: (p.product_angle as string | null) ?? null,
          price_note: (p.price_note as string | null) ?? null,
          facebook_page_id: run.facebook_page_id,
          shopee_account_id: run.shopee_account_id,
        },
      });
      summary.creative_jobs_started += 1;
    }
    await insertPostingLog(supabase, null, LOG.CREATIVE_JOBS_BATCH, "SUCCESS", `Khởi tạo thêm ${summary.creative_jobs_started} job creative.`, { ai_campaign_run_id: run.id });
  }

  // Chạy tối đa N bước cho các job chưa kết thúc của run.
  if (trigger !== "cron") {
    const { data: runnableRows } = await supabase
      .from("ai_jobs")
      .select("id, status")
      .eq("ai_campaign_run_id", run.id)
      .in("status", ["PENDING", "WAITING_RETRY", "RUNNING"])
      .is("locked_at", null)
      .order("updated_at", { ascending: true })
      .limit(LIMITS.jobSteps() * 3);
    const runnable = (runnableRows ?? []) as Array<{ id: string }>;
    const stepBudget = LIMITS.jobSteps();
    for (let i = 0; i < runnable.length && summary.creative_job_steps_processed < stepBudget; i += 1) {
      const r = await runAiJobStep(runnable[i].id);
      summary.creative_job_steps_processed += 1;
      await insertPostingLog(supabase, null, LOG.CREATIVE_STEP, r.ok ? "SUCCESS" : "FAILED", `Job ${runnable[i].id} -> ${r.step ?? "?"} (${r.status}).`, {
        ai_campaign_run_id: run.id,
        job_id: runnable[i].id,
        step: r.step,
        status: r.status,
      });
    }
  }

  // Tất cả job của run đã kết thúc chưa?
  const { data: allJobs } = await supabase
    .from("ai_jobs")
    .select("status")
    .eq("ai_campaign_run_id", run.id);
  const jobs = (allJobs ?? []) as Array<{ status: string }>;
  const anyOpen = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING" || j.status === "WAITING_RETRY");

  // Đếm bài đã READY pack + chờ duyệt.
  const { data: readyPosts } = await supabase
    .from("generated_posts")
    .select("id")
    .eq("ai_campaign_run_id", run.id)
    .eq("creative_pack_status", "READY")
    .eq("review_status", "PENDING_REVIEW");
  summary.posts_ready_for_review = (readyPosts ?? []).length;

  // Còn sản phẩm chưa có job? (vẫn cần enqueue thêm ở lần sau)
  const remainingNeed = await productsNeedingJobs(supabase, run);

  // Đã xong khi: không còn job mở VÀ không còn sản phẩm cần tạo job.
  if (!anyOpen && remainingNeed.length === 0) {
    await patchRun(supabase, run.id, {
      status: "WAITING_POST_REVIEW",
      current_step: "WAITING_POST_REVIEW",
      progress_current: summary.posts_ready_for_review,
    });
    summary.message = `Tất cả ảnh creative xong. ${summary.posts_ready_for_review} bài chờ duyệt.`;
    return;
  }
  summary.message = `Đã chạy ${summary.creative_job_steps_processed} bước creative.`;
}

// ---------------------------------------------------------------------------
// WAITING_POST_REVIEW
// ---------------------------------------------------------------------------
async function stepWaitingReview(supabase: SupabaseClient, run: AiCampaignRun, summary: AutopilotSummary): Promise<void> {
  // Không có bài nào (vd: tất cả cơ hội đều không đủ liên quan) -> kết thúc, không kẹt.
  const { data: anyPosts } = await supabase
    .from("generated_posts")
    .select("id")
    .eq("ai_campaign_run_id", run.id)
    .limit(1);
  if (!anyPosts || anyPosts.length === 0) {
    await patchRun(supabase, run.id, {
      status: "COMPLETED",
      current_step: "COMPLETED",
      progress_current: 0,
      error_message:
        run.error_message ??
        "Không tạo được bài: không tìm thấy sản phẩm đủ liên quan. Hãy chỉnh từ khóa cơ hội cụ thể hơn hoặc xử lý thủ công.",
    });
    summary.message = "Chiến dịch kết thúc: không có sản phẩm/bài phù hợp.";
    return;
  }

  const { data: approved } = await supabase
    .from("generated_posts")
    .select("id")
    .eq("ai_campaign_run_id", run.id)
    .eq("review_status", "APPROVED")
    .is("scheduled_at", null)
    .limit(1);
  if (approved && approved.length > 0) {
    await patchRun(supabase, run.id, { status: "SCHEDULING", current_step: "SCHEDULING" });
    summary.message = "Có bài đã duyệt, chuyển sang xếp lịch.";
    return;
  }
  summary.message = "Đang chờ người dùng duyệt bài.";
}

// ---------------------------------------------------------------------------
// SCHEDULING
// ---------------------------------------------------------------------------
async function stepScheduling(supabase: SupabaseClient, run: AiCampaignRun, summary: AutopilotSummary): Promise<void> {
  const res = await scheduleApprovedPostsForRun(supabase, run.id, run.posting_plan, SCHEDULE_BATCH);
  summary.scheduled_count += res.scheduled;
  if (res.error) summary.errors.push(res.error);
  for (const iso of res.slots) {
    await insertPostingLog(supabase, null, LOG.POST_SCHEDULED, "SUCCESS", `Xếp lịch bài lúc ${iso}.`, { ai_campaign_run_id: run.id, scheduled_at: iso });
  }

  // Còn bài APPROVED chưa xếp?
  const { data: moreApproved } = await supabase
    .from("generated_posts")
    .select("id")
    .eq("ai_campaign_run_id", run.id)
    .eq("review_status", "APPROVED")
    .is("scheduled_at", null)
    .limit(1);
  if (moreApproved && moreApproved.length > 0) {
    summary.message = `Đã xếp ${summary.scheduled_count} bài, còn bài chờ xếp tiếp.`;
    return; // giữ nguyên SCHEDULING, lần sau xếp tiếp
  }

  // Còn bài chờ duyệt / cần sửa?
  const { data: pendingReview } = await supabase
    .from("generated_posts")
    .select("id")
    .eq("ai_campaign_run_id", run.id)
    .in("review_status", ["PENDING_REVIEW", "NEEDS_EDIT"])
    .limit(1);
  if (pendingReview && pendingReview.length > 0) {
    await patchRun(supabase, run.id, { status: "WAITING_POST_REVIEW", current_step: "WAITING_POST_REVIEW" });
    summary.message = `Đã xếp ${summary.scheduled_count} bài, chờ duyệt số còn lại.`;
    return;
  }

  await patchRun(supabase, run.id, { status: "SCHEDULED", current_step: "SCHEDULED" });
  summary.message = `Đã xếp lịch xong (${summary.scheduled_count} bài lần này).`;
}

// ---------------------------------------------------------------------------
// SCHEDULED / RUNNING — theo dõi publish (cron khác lo việc đăng).
// ---------------------------------------------------------------------------
async function stepPublishingWatch(supabase: SupabaseClient, run: AiCampaignRun, summary: AutopilotSummary): Promise<void> {
  // Bài mới được duyệt sau khi đã SCHEDULED -> quay lại xếp lịch.
  const { data: newApproved } = await supabase
    .from("generated_posts")
    .select("id")
    .eq("ai_campaign_run_id", run.id)
    .eq("review_status", "APPROVED")
    .is("scheduled_at", null)
    .limit(1);
  if (newApproved && newApproved.length > 0) {
    await patchRun(supabase, run.id, { status: "SCHEDULING", current_step: "SCHEDULING" });
    summary.message = "Có bài mới được duyệt, xếp lịch tiếp.";
    return;
  }

  const { data: posts } = await supabase
    .from("generated_posts")
    .select("status, review_status")
    .eq("ai_campaign_run_id", run.id);
  const list = (posts ?? []) as Array<{ status: string; review_status: string | null }>;
  const published = list.filter((p) => p.status === "PUBLISHED").length;
  const active = list.filter((p) => p.review_status !== "REJECTED" && p.status !== "PUBLISHED");

  if (list.length > 0 && active.length === 0) {
    await patchRun(supabase, run.id, { status: "COMPLETED", current_step: "COMPLETED", progress_current: published });
    summary.message = `Chiến dịch hoàn tất: ${published} bài đã đăng.`;
    return;
  }
  if (published > 0 && run.status !== "RUNNING") {
    await patchRun(supabase, run.id, { status: "RUNNING", current_step: "RUNNING", progress_current: published });
  }
  summary.message = `Đang đăng: ${published} bài đã đăng, ${active.length} bài còn lại.`;
}

/** Đếm số liệu cho dashboard. */
export async function getCampaignRunCounters(supabase: SupabaseClient, run: AiCampaignRun) {
  const candidates = run.sourced_candidates;
  const sourced = candidates.filter((c) => c.link_status === "SOURCED" || c.link_status === "READY").length;
  const linksConverted = candidates.filter((c) => c.link_status === "READY").length;
  const productsCreated = candidates.filter((c) => !!c.product_id).length;

  const { data: posts } = await supabase
    .from("generated_posts")
    .select("status, review_status, creative_pack_status")
    .eq("ai_campaign_run_id", run.id);
  const list = (posts ?? []) as Array<{ status: string; review_status: string | null; creative_pack_status: string | null }>;

  // Performance/cost: V98 ảnh hôm nay + jobs pending/done của chiến dịch.
  let v98Today = 0;
  let jobsPending = 0;
  let jobsDone = 0;
  let jobsWaitingRetry = 0;
  let jobsFailed = 0;
  let lastJobError: string | null = null;
  let v98PerDayLimit = 0;
  try {
    const { countV98ImagesToday, readCostLimits } = await import("@/lib/cost/cost-guardrails");
    const c = await countV98ImagesToday(supabase, run.id);
    v98Today = c.campaign;
    v98PerDayLimit = readCostLimits().perCampaignPerDay;
    const { data: jobRows } = await supabase.from("ai_jobs").select("status,error_message,updated_at").eq("ai_campaign_run_id", run.id).order("updated_at", { ascending: false });
    for (const j of (jobRows ?? []) as Array<{ status: string; error_message?: string | null }>) {
      if (j.status === "PENDING" || j.status === "RUNNING" || j.status === "WAITING_RETRY") jobsPending += 1;
      if (j.status === "WAITING_RETRY") jobsWaitingRetry += 1;
      if (j.status === "FAILED") jobsFailed += 1;
      else if (j.status === "SUCCESS") jobsDone += 1;
      if (!lastJobError && j.error_message) lastJobError = j.error_message.slice(0, 180);
    }
  } catch {
    // không chặn dashboard nếu đếm lỗi
  }

  return {
    opportunities: run.product_opportunities.length,
    sourced,
    linksConverted,
    productsCreated,
    postsCreated: list.length,
    creativesReady: list.filter((p) => p.creative_pack_status === "READY").length,
    postsWaitingReview: list.filter((p) => p.review_status === "PENDING_REVIEW").length,
    postsApproved: list.filter((p) => p.review_status === "APPROVED").length,
    postsScheduled: list.filter((p) => p.review_status === "APPROVED" && p.status !== "PUBLISHED").length,
    postsPublished: list.filter((p) => p.status === "PUBLISHED").length,
    v98Today,
    v98PerDayLimit,
    jobsPending,
    jobsDone,
    jobsWaitingRetry,
    jobsFailed,
    lastJobError,
  };
}
