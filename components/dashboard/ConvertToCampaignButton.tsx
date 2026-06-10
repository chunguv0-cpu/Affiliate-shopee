"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { convertAiRecommendationToCampaign } from "@/app/dashboard/ai-planner/actions";
import type { PlannerMode, RecommendationStatus } from "@/lib/types";

type Result = {
  campaignId: string;
  createdPosts: number;
  rejectedPosts: number;
  failedPosts: number;
  productsUsed: number;
  skipped: number;
};

export default function ConvertToCampaignButton({
  id,
  status,
  plannerMode,
}: {
  id: string;
  status: RecommendationStatus;
  plannerMode: PlannerMode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  if (status === "CONVERTED_TO_CAMPAIGN") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        ✅ Đã tạo campaign thật từ gợi ý này.{" "}
        <Link href="/dashboard/campaigns" className="font-medium underline">Xem chiến dịch →</Link>
      </div>
    );
  }

  if (status !== "APPROVED") {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        Bạn cần <strong>duyệt gợi ý</strong> trước khi tạo campaign.
      </div>
    );
  }

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await convertAiRecommendationToCampaign(id);
      if (r.ok) {
        setResult({
          campaignId: r.campaignId,
          createdPosts: r.createdPosts,
          rejectedPosts: r.rejectedPosts,
          failedPosts: r.failedPosts,
          productsUsed: r.productsUsed,
          skipped: r.skipped,
        });
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {plannerMode === "DISCOVERY_ONLY" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Discovery plan chỉ có sản phẩm gợi ý. Cần convert sản phẩm thành READY trước khi tạo campaign.
        </div>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">✅ Đã tạo campaign.</p>
          <ul className="mt-1 list-disc pl-5">
            <li>Bài READY: {result.createdPosts}</li>
            <li>Bài bị từ chối (điểm thấp): {result.rejectedPosts}</li>
            <li>Bài lỗi: {result.failedPosts}</li>
            <li>Sản phẩm dùng: {result.productsUsed}</li>
            <li>Sản phẩm bỏ qua: {result.skipped}</li>
          </ul>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href="/dashboard/campaigns" className="font-medium underline">Xem chiến dịch →</Link>
            <Link href="/dashboard/calendar" className="font-medium underline">Xem lịch đăng →</Link>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Đang tạo campaign..." : "🚀 Tạo campaign từ gợi ý AI"}
        </button>
      )}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
    </div>
  );
}
