"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  approveCampaignRun,
  pauseCampaignRun,
  regenerateCampaignPlan,
  rejectCampaignRun,
  resumeCampaignRun,
  runAutopilotStepAction,
} from "@/app/dashboard/ai-autopilot/actions";
import type { CampaignRunStatus } from "@/lib/types";

const PIPELINE: CampaignRunStatus[] = [
  "APPROVED",
  "SOURCING_PRODUCTS",
  "CONVERTING_LINKS",
  "CREATING_PRODUCTS",
  "CREATING_POSTS",
  "CREATING_CREATIVES",
  "WAITING_POST_REVIEW",
  "SCHEDULING",
  "SCHEDULED",
  "RUNNING",
];

export default function CampaignRunActions({
  runId,
  status,
  paused,
}: {
  runId: string;
  status: CampaignRunStatus;
  paused: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? res.message ?? "Đã xử lý." : res.error ?? "Lỗi.");
      router.refresh();
    });
  }

  const inPipeline = PIPELINE.includes(status);
  const btn = "rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === "WAITING_APPROVAL" ? (
        <>
          <button type="button" disabled={pending} onClick={() => run(() => approveCampaignRun(runId))} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
            Duyệt chiến dịch
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => regenerateCampaignPlan(runId))} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            Chạy lại gợi ý AI
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => rejectCampaignRun(runId))} className={`${btn} border border-red-300 text-red-600 hover:bg-red-50`}>
            Từ chối
          </button>
        </>
      ) : null}

      {inPipeline ? (
        <>
          <button type="button" disabled={pending || paused} onClick={() => run(() => runAutopilotStepAction(runId))} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            {pending ? "Đang chạy..." : "Chạy ngay 1 batch"}
          </button>
          <span className="text-xs text-gray-400">Chỉ dùng để test hoặc chạy ngay, bình thường cron sẽ tự chạy.</span>
          {paused ? (
            <button type="button" disabled={pending} onClick={() => run(() => resumeCampaignRun(runId))} className={`${btn} border border-emerald-300 text-emerald-700 hover:bg-emerald-50`}>
              Tiếp tục
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => run(() => pauseCampaignRun(runId))} className={`${btn} border border-amber-300 text-amber-700 hover:bg-amber-50`}>
              Tạm dừng
            </button>
          )}
          {(status === "WAITING_POST_REVIEW" || status === "SCHEDULING" || status === "SCHEDULED" || status === "RUNNING") ? (
            <Link href="/dashboard/review" className={`${btn} border border-purple-300 text-purple-700 hover:bg-purple-50`}>
              Mở mục Chờ duyệt bài
            </Link>
          ) : null}
        </>
      ) : null}

      <Link href="/dashboard/manual-tools?tab=sourcing" className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50`}>
        Tìm link thủ công
      </Link>

      {message ? <span className="text-xs text-gray-500">{message}</span> : null}
    </div>
  );
}
