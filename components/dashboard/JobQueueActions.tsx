"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelAiJob, continueJobStep, retryAiJob, unlockAiJob } from "@/app/dashboard/jobs/actions";

export default function JobQueueActions({ jobId, status, stuck }: { jobId: string; status: string; stuck: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? r.message ?? "OK" : r.error ?? "Lỗi");
      router.refresh();
    });
  }
  const btn = "rounded border px-2 py-0.5 text-[11px] font-medium disabled:opacity-50";
  const open = status === "PENDING" || status === "RUNNING" || status === "WAITING_RETRY";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Link href={`/dashboard/jobs/${jobId}`} className={`${btn} border-gray-300 text-gray-600 hover:bg-gray-50`}>Chi tiết</Link>
      {open ? <button type="button" disabled={pending} onClick={() => run(() => continueJobStep(jobId))} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}>Chạy 1 bước</button> : null}
      {(status === "FAILED" || status === "WAITING_RETRY") ? <button type="button" disabled={pending} onClick={() => run(() => retryAiJob(jobId))} className={`${btn} border-emerald-300 text-emerald-700 hover:bg-emerald-50`}>Chạy lại</button> : null}
      {stuck ? <button type="button" disabled={pending} onClick={() => run(() => unlockAiJob(jobId))} className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`}>Mở khóa</button> : null}
      {open ? <button type="button" disabled={pending} onClick={() => run(() => cancelAiJob(jobId))} className={`${btn} border-red-300 text-red-600 hover:bg-red-50`}>Hủy</button> : null}
      {msg ? <span className="text-[10px] text-gray-500">{msg}</span> : null}
    </div>
  );
}
