"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { runCurrentJobStep } from "@/app/dashboard/jobs/actions";
import { AI_JOB_STATUS_LABELS, type AiJobStatus } from "@/lib/types";

const STATUS_STYLE: Record<AiJobStatus, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  RUNNING: "bg-blue-50 text-blue-700",
  WAITING_RETRY: "bg-amber-50 text-amber-700",
  SUCCESS: "bg-green-50 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

const ACTIVE: AiJobStatus[] = ["PENDING", "RUNNING", "WAITING_RETRY"];
const POLL_MS = 5000;

export default function AiJobProgress({
  jobId,
  status,
  step,
  current,
  total,
}: {
  jobId: string;
  status: AiJobStatus;
  step: string | null;
  current: number;
  total: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const running = useRef(false);
  const active = ACTIVE.includes(status);

  const [auto, setAuto] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  function runStep() {
    if (running.current) return;
    running.current = true;
    startTransition(async () => {
      try {
        const result = await runCurrentJobStep(jobId);
        setNotice(result.message ?? (!result.ok ? result.error ?? null : null));
      } finally {
        running.current = false;
        router.refresh();
      }
    });
  }

  useEffect(() => {
    if (!active || !auto) return;
    // Tự chạy bước kế mỗi 5s (không nhanh hơn). Mỗi lần chỉ 1 bước.
    const timer = setInterval(() => {
      if (!running.current) runStep();
    }, POLL_MS);
    // Chạy ngay 1 bước khi mở trang (nếu chưa chạy).
    if (!running.current) runStep();
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status, auto]);

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
          {AI_JOB_STATUS_LABELS[status]}
        </span>
        <span className="text-sm text-gray-600">Bước: {step ?? "—"}</span>
        <span className="text-sm text-gray-400">{current}/{total}</span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${status === "FAILED" ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${pct}%` }} />
      </div>

      {active ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runStep}
            disabled={pending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Đang chạy bước..." : "▶ Chạy bước tiếp theo"}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-3.5 w-3.5" />
            Tự chạy mỗi 5s
          </label>
          {notice ? <p className="w-full text-xs text-amber-700">{notice}</p> : null}
        </div>
      ) : status === "SUCCESS" ? (
        <p className="mt-4 text-sm text-green-700">
          ✅ Hoàn tất.{" "}
          <Link href="/dashboard/posts" className="font-medium underline">Xem bài đăng →</Link>
        </p>
      ) : (
        <div className="mt-4">
          <Link href="/dashboard/posts" className="text-sm font-medium text-blue-600 underline">Xem bài đăng →</Link>
        </div>
      )}
    </div>
  );
}
