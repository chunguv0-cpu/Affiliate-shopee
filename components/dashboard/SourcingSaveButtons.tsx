"use client";

import { useState, useTransition } from "react";

import {
  saveAllSourcingCandidates,
  saveSourcingCandidate,
  type OpportunityInput,
} from "@/app/dashboard/sourcing/actions";

/** Nút lưu MỘT cơ hội sản phẩm vào danh sách tìm link. */
export function SaveOpportunityButton({
  recommendationId,
  opportunity,
}: {
  recommendationId: string | null;
  opportunity: OpportunityInput;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleClick() {
    setMsg(null);
    startTransition(async () => {
      const r = await saveSourcingCandidate({ ...opportunity, recommendation_id: recommendationId });
      if (r.ok) setMsg({ ok: true, text: "Đã lưu vào danh sách tìm link." });
      else setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
      >
        {pending ? "Đang lưu..." : "🧲 Lưu vào danh sách tìm link"}
      </button>
      {msg ? (
        <span className={`ml-2 text-xs ${msg.ok ? "text-green-600" : "text-amber-700"}`}>{msg.text}</span>
      ) : null}
    </div>
  );
}

/** Nút lưu TẤT CẢ cơ hội sản phẩm của recommendation. */
export function SaveAllOpportunitiesButton({
  recommendationId,
  opportunities,
}: {
  recommendationId: string | null;
  opportunities: OpportunityInput[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleClick() {
    setMsg(null);
    startTransition(async () => {
      const r = await saveAllSourcingCandidates(recommendationId, opportunities);
      if (r.ok) setMsg({ ok: true, text: `Đã lưu ${r.created} sản phẩm (bỏ qua ${r.skipped} trùng).` });
      else setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? "Đang lưu..." : "🧲 Lưu tất cả sản phẩm gợi ý"}
      </button>
      {msg ? (
        <span className={`text-xs ${msg.ok ? "text-green-600" : "text-amber-700"}`}>{msg.text}</span>
      ) : null}
    </div>
  );
}
