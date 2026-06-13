"use server";

import { revalidatePath } from "next/cache";

import { isProductDead } from "@/lib/affiliate";
import { runAiJobStep, type RunStepResult } from "@/lib/jobs/ai-job-runner";
import { insertPostingLog } from "@/lib/posts/log";
import { buildProductValidationPatch, validateShopeeProductExists } from "@/lib/shopee/validate-product-link";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AiJob, Product } from "@/lib/types";

const JOB_TYPE = "CREATE_AI_POST_WITH_IMAGES";
const JOB_CREATED = "AI_JOB_CREATED";

export type CreateJobResult = { ok: true; jobId: string } | { ok: false; error: string };

/**
 * Tạo job tạo bài AI + 4 ảnh. NHANH — không sinh caption/ảnh ở đây.
 */
export async function createAiPostImageJob(productId: string): Promise<CreateJobResult> {
  if (!productId || typeof productId !== "string") return { ok: false, error: "Thiếu mã sản phẩm." };
  try {
    const supabase = createSupabaseAdminClient();
    // select("*") để KHÔNG lỗi nếu migration cột mới (product_status...) chưa chạy.
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();
    if (prodErr || !product) return { ok: false, error: "Không tìm thấy sản phẩm." };
    const p = product as Pick<
      Product,
      | "id"
      | "product_name"
      | "original_url"
      | "affiliate_link"
      | "target_customer"
      | "product_angle"
      | "price_note"
      | "link_status"
      | "product_status"
      | "resolved_url"
      | "shop_id"
      | "item_id"
    >;
    if (p.link_status !== "READY" || !p.affiliate_link) {
      return { ok: false, error: "Sản phẩm chưa có link Affiliate hợp lệ. Vui lòng chuyển link trước." };
    }

    // HOTFIX — chặn tạo bài AI cho sản phẩm CHẾT (đã kiểm chứng trước đó).
    if (isProductDead(p.product_status)) {
      return {
        ok: false,
        error: "Sản phẩm này không còn tồn tại trên Shopee. Hãy bấm 'Kiểm tra lại' hoặc thay link trước khi tạo bài.",
      };
    }

    // Kiểm chứng nhanh: CHỈ chặn khi xác nhận chết; mơ hồ (UNKNOWN do bị chặn bot) thì cho qua.
    const check = await validateShopeeProductExists({
      affiliate_link: p.affiliate_link,
      original_url: p.original_url,
      resolved_url: p.resolved_url ?? null,
      shop_id: p.shop_id ?? null,
      item_id: p.item_id ?? null,
      product_name: p.product_name,
    });
    if (check.product_status !== "UNKNOWN") {
      await supabase.from("products").update(buildProductValidationPatch(check)).eq("id", p.id);
    }
    if (!check.exists && isProductDead(check.product_status)) {
      await insertPostingLog(
        supabase,
        null,
        "PRODUCT_LINK_DEAD_BLOCKED",
        "FAILED",
        `Chặn tạo bài: sản phẩm chết (${check.product_status}).`,
        { product_id: p.id },
      );
      return {
        ok: false,
        error: `Sản phẩm không tồn tại trên Shopee (${check.product_status}). Không thể tạo bài AI.`,
      };
    }

    const { data: existingJobs } = await supabase
      .from("ai_jobs")
      .select("id, status")
      .eq("job_type", JOB_TYPE)
      .eq("related_product_id", p.id)
      .in("status", ["PENDING", "RUNNING", "WAITING_RETRY", "SUCCESS"])
      .order("updated_at", { ascending: false })
      .limit(1);
    const existing = existingJobs?.[0] as { id: string; status: string } | undefined;
    if (existing) {
      await insertPostingLog(supabase, null, "AUTOPILOT_CONTINUED_EXISTING_JOB", "SUCCESS", `Dùng lại job ${existing.status} cho "${p.product_name}", không tạo trùng.`, {
        ai_job_id: existing.id,
        product_id: p.id,
      });
      return { ok: true, jobId: existing.id };
    }

    const { data: job, error: jobErr } = await supabase
      .from("ai_jobs")
      .insert({
        job_type: JOB_TYPE,
        status: "PENDING",
        step: "INIT",
        progress_current: 0,
        progress_total: 7,
        related_product_id: p.id,
        input: {
          product_name: p.product_name,
          original_url: p.original_url,
          affiliate_link: p.affiliate_link,
          target_customer: p.target_customer,
          product_angle: p.product_angle,
          price_note: p.price_note,
        },
      })
      .select("id")
      .single();
    if (jobErr || !job) return { ok: false, error: `Tạo job thất bại: ${jobErr?.message ?? "không rõ"}` };

    await insertPostingLog(supabase, null, JOB_CREATED, "SUCCESS", `Tạo job ${JOB_TYPE} cho "${p.product_name}".`, {
      ai_job_id: job.id,
      product_id: p.id,
    });

    revalidatePath("/dashboard/jobs");
    return { ok: true, jobId: job.id as string };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo job thất bại: ${m}` };
  }
}

/** Chạy MỘT bước của job (cho nút "Chạy tiếp" / poller). */
export async function runCurrentJobStep(jobId: string): Promise<RunStepResult> {
  const result = await runAiJobStep(jobId);
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/posts");
  return result;
}

export type AiJobView = {
  job: AiJob;
  productName: string | null;
} | null;

export type SimpleResult = { ok: true; message?: string } | { ok: false; error: string };

const LOCK_TTL_MS = (() => {
  const raw = process.env.AUTOPILOT_LOCK_TTL_SECONDS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return (Number.isFinite(n) ? Math.min(900, Math.max(30, n)) : 120) * 1000;
})();

export type JobQueueRow = {
  id: string;
  job_type: string;
  status: string;
  step: string | null;
  progress_current: number;
  progress_total: number;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  error_message: string | null;
  ai_campaign_run_id: string | null;
  related_post_id: string | null;
  created_at: string;
  updated_at: string;
  stuck: boolean;
};

export type JobQueue = {
  counts: { total: number; pending: number; running: number; waiting_retry: number; success: number; failed: number; stuck: number };
  jobs: JobQueueRow[];
};

/** Danh sách + thống kê hàng đợi AI Jobs. */
export async function getAiJobsQueue(limit = 100): Promise<JobQueue> {
  const empty: JobQueue = { counts: { total: 0, pending: 0, running: 0, waiting_retry: 0, success: 0, failed: 0, stuck: 0 }, jobs: [] };
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("ai_jobs")
      .select("id, job_type, status, step, progress_current, progress_total, attempts, max_attempts, locked_at, error_message, ai_campaign_run_id, related_post_id, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const now = Date.now();
    const counts = { total: rows.length, pending: 0, running: 0, waiting_retry: 0, success: 0, failed: 0, stuck: 0 };
    const jobs: JobQueueRow[] = rows.map((j) => {
      const status = String(j.status);
      const lockedAt = (j.locked_at as string | null) ?? null;
      const stuck = status === "RUNNING" && !!lockedAt && now - new Date(lockedAt).getTime() > LOCK_TTL_MS;
      if (status === "PENDING") counts.pending += 1;
      else if (status === "RUNNING") counts.running += 1;
      else if (status === "WAITING_RETRY") counts.waiting_retry += 1;
      else if (status === "SUCCESS") counts.success += 1;
      else if (status === "FAILED") counts.failed += 1;
      if (stuck) counts.stuck += 1;
      return {
        id: String(j.id),
        job_type: String(j.job_type),
        status,
        step: (j.step as string | null) ?? null,
        progress_current: Number(j.progress_current) || 0,
        progress_total: Number(j.progress_total) || 0,
        attempts: Number(j.attempts) || 0,
        max_attempts: Number(j.max_attempts) || 0,
        locked_at: lockedAt,
        error_message: (j.error_message as string | null) ?? null,
        ai_campaign_run_id: (j.ai_campaign_run_id as string | null) ?? null,
        related_post_id: (j.related_post_id as string | null) ?? null,
        created_at: String(j.created_at ?? ""),
        updated_at: String(j.updated_at ?? ""),
        stuck,
      };
    });
    return { counts, jobs };
  } catch {
    return empty;
  }
}

/** Cho job chạy lại (PENDING) — không reset attempts để vẫn tôn trọng giới hạn. */
export async function retryAiJob(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã job." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("ai_jobs")
      .update({ status: "PENDING", locked_at: null, error_message: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    await insertPostingLog(supabase, null, "AI_JOB_RETRY_REQUESTED", "SUCCESS", "Người dùng yêu cầu chạy lại job.", { ai_job_id: id });
    revalidatePath("/dashboard/jobs");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi." };
  }
}

/** Hủy job (FAILED, không xóa dữ liệu). */
export async function cancelAiJob(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã job." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("ai_jobs")
      .update({ status: "FAILED", locked_at: null, error_message: "Hủy bởi người dùng.", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["PENDING", "RUNNING", "WAITING_RETRY"]);
    await insertPostingLog(supabase, null, "AI_JOB_CANCELLED", "SUCCESS", "Người dùng hủy job.", { ai_job_id: id });
    revalidatePath("/dashboard/jobs");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi." };
  }
}

/** Mở khóa job bị kẹt (RUNNING + locked quá hạn) -> WAITING_RETRY để chạy tiếp từ bước hiện tại. */
export async function unlockAiJob(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã job." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("ai_jobs")
      .update({ status: "WAITING_RETRY", locked_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["RUNNING", "WAITING_RETRY"]);
    await insertPostingLog(supabase, null, "AI_JOB_UNLOCKED", "SUCCESS", "Mở khóa job bị kẹt; sẽ chạy tiếp từ bước hiện tại (không gọi lại V98 cho ảnh đã xong).", { ai_job_id: id });
    revalidatePath("/dashboard/jobs");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi." };
  }
}

/** Chạy MỘT bước cho job từ trang hàng đợi. */
export async function continueJobStep(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã job." };
  try {
    const r = await runAiJobStep(id);
    revalidatePath("/dashboard/jobs");
    return r.ok ? { ok: true, message: `Đã chạy bước ${r.step ?? "?"} (${r.status}).` } : { ok: false, error: r.error ?? "Bước lỗi." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi." };
  }
}

/** Đọc 1 job + tên sản phẩm cho trang chi tiết. */
export async function getAiJob(id: string): Promise<AiJobView> {
  try {
    if (!id) return null;
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from("ai_jobs").select("*").eq("id", id).single();
    if (error || !data) return null;
    const job = data as AiJob;
    let productName: string | null = null;
    if (job.related_product_id) {
      const { data: prod } = await supabase
        .from("products")
        .select("product_name")
        .eq("id", job.related_product_id)
        .single();
      productName = (prod?.product_name as string | null) ?? null;
    }
    return { job, productName };
  } catch {
    return null;
  }
}
