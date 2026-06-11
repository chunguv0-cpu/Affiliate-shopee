"use server";

import { revalidatePath } from "next/cache";

import { runAiJobStep, type RunStepResult } from "@/lib/jobs/ai-job-runner";
import { insertPostingLog } from "@/lib/posts/log";
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
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id, product_name, original_url, affiliate_link, target_customer, product_angle, price_note, link_status")
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
    >;
    if (p.link_status !== "READY" || !p.affiliate_link) {
      return { ok: false, error: "Sản phẩm chưa có link Affiliate hợp lệ. Vui lòng chuyển link trước." };
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
