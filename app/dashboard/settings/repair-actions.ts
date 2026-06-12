"use server";

import { revalidatePath } from "next/cache";

import { repairStates } from "@/lib/maintenance/repair-states";

export type RepairResult = { ok: true; summary: string } | { ok: false; error: string };

/** Kiểm tra & sửa trạng thái sai (an toàn, không xóa dữ liệu). */
export async function runStateRepair(): Promise<RepairResult> {
  try {
    const s = await repairStates();
    revalidatePath("/dashboard/review");
    revalidatePath("/dashboard/ai-autopilot");
    revalidatePath("/dashboard/jobs");
    return {
      ok: true,
      summary: `Mở khóa ${s.jobsUnlocked} job kẹt · hạ ${s.postsDemoted} bài chưa đủ chuẩn · đưa ${s.postsPromotedToReview} bài vào chờ duyệt · sửa ${s.campaignsRewound} chiến dịch.`,
    };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Sửa trạng thái thất bại: ${m}` };
  }
}
