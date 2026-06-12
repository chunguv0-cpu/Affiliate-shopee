"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runStateRepair } from "@/app/dashboard/settings/repair-actions";

export default function RepairStatesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function handle() {
    setMsg(null);
    startTransition(async () => {
      const r = await runStateRepair();
      setMsg(r.ok ? r.summary : r.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handle}
        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {pending ? "Đang kiểm tra..." : "Kiểm tra & sửa trạng thái"}
      </button>
      {msg ? <span className="text-xs text-gray-600">{msg}</span> : null}
    </div>
  );
}
