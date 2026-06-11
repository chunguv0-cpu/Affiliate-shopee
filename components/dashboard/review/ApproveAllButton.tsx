"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { approveAllEligible } from "@/app/dashboard/review/actions";

export default function ApproveAllButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handle() {
    setMessage(null);
    startTransition(async () => {
      const res = await approveAllEligible();
      setMessage(res.ok ? `Đã duyệt ${res.approved} bài đạt chuẩn.` : res.error ?? "Lỗi.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handle}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? "Đang duyệt..." : "Duyệt tất cả bài đạt chuẩn"}
      </button>
      {message ? <span className="text-xs text-gray-500">{message}</span> : null}
    </div>
  );
}
