"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateRecommendationStatus } from "@/app/dashboard/ai-planner/actions";
import {
  RECOMMENDATION_STATUS_LABELS,
  type RecommendationStatus,
} from "@/lib/types";

export default function RecommendationStatusButtons({
  id,
  status,
}: {
  id: string;
  status: RecommendationStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update(next: "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const r = await updateRecommendationStatus(id, next);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500">
          Trạng thái: <strong>{RECOMMENDATION_STATUS_LABELS[status] ?? status}</strong>
        </span>
        <button
          type="button"
          onClick={() => update("APPROVED")}
          disabled={pending || status === "APPROVED"}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          ✓ Duyệt gợi ý
        </button>
        <button
          type="button"
          onClick={() => update("REJECTED")}
          disabled={pending || status === "REJECTED"}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Từ chối
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
