"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { runRecommendationJob } from "@/app/dashboard/ai-planner/actions";

/**
 * Hiển thị khi gợi ý đang RUNNING:
 * - Kích hoạt job nặng (research + AI) MỘT lần khi mount (giữ request sống khi ở trang).
 * - Tự refresh mỗi 4s để cập nhật trạng thái.
 * - Có nút tải lại thủ công. Không throw ra client.
 */
export default function AiPlannerStatusPoller({ id }: { id: string }) {
  const router = useRouter();
  const triggered = useRef(false);

  useEffect(() => {
    let active = true;

    if (!triggered.current) {
      triggered.current = true;
      runRecommendationJob(id)
        .then(() => {
          if (active) router.refresh();
        })
        .catch(() => {
          if (active) router.refresh();
        });
    }

    const timer = setInterval(() => {
      if (active) router.refresh();
    }, 4000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, router]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 text-center">
      <div className="mb-2 text-3xl">⏳</div>
      <h3 className="text-base font-semibold text-blue-800">
        AI đang nghiên cứu và lập kế hoạch...
      </h3>
      <p className="mt-1 text-sm text-blue-700">
        Quá trình có thể mất 10–40 giây (research + phân tích). Trang sẽ tự cập nhật.
      </p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="mt-4 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
      >
        Tải lại trạng thái
      </button>
    </div>
  );
}
