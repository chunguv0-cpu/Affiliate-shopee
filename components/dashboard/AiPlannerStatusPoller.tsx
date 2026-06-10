"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  markStuckRecommendationFailed,
  runRecommendationJob,
} from "@/app/dashboard/ai-planner/actions";

// Quy tắc polling (hotfix chống spam GET trên Vercel):
const POLL_INTERVAL_MS = 5000; // tối thiểu 5s
const MAX_RUN_MS = 5 * 60 * 1000; // job quá 5 phút coi như treo, dừng poll

/**
 * Hiển thị khi gợi ý đang RUNNING.
 * - Kích hoạt job nặng (research + AI) MỘT lần khi mount (ref guard).
 * - Poll bằng router.refresh() mỗi 5s — CHỈ khi status === "RUNNING".
 * - Tự dừng poll sau 10 phút và hiện cảnh báo job treo.
 * - Không cập nhật state gây refresh mỗi render. Dọn interval khi unmount.
 */
export default function AiPlannerStatusPoller({
  id,
  status,
  createdAt,
}: {
  id: string;
  status: string;
  createdAt: string | null;
}) {
  const router = useRouter();
  const triggered = useRef(false);
  const [tooLong, setTooLong] = useState(false);
  const [marking, startMarking] = useTransition();

  useEffect(() => {
    // Chỉ poll khi đang RUNNING.
    if (status !== "RUNNING") return;

    let active = true;
    const startedAt = createdAt ? new Date(createdAt).getTime() : Date.now();
    const elapsed = () => Date.now() - startedAt;

    // Đã treo quá lâu ngay từ đầu (record cũ): không poll, không trigger.
    if (Number.isFinite(startedAt) && elapsed() > MAX_RUN_MS) {
      setTooLong(true);
      return;
    }

    // Kích hoạt job nặng đúng MỘT lần.
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
      if (!active) return;
      if (elapsed() > MAX_RUN_MS) {
        setTooLong(true);
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, status, createdAt, router]);

  // Bảo hiểm: không phải RUNNING thì không render gì.
  if (status !== "RUNNING") return null;

  function handleMarkFailed() {
    startMarking(async () => {
      try {
        await markStuckRecommendationFailed(id);
      } finally {
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 text-center">
      {tooLong ? (
        <>
          <div className="mb-2 text-3xl">⚠️</div>
          <h3 className="text-base font-semibold text-amber-800">
            Job này đã chạy quá lâu. Vui lòng đánh dấu thất bại hoặc tạo lại kế hoạch.
          </h3>
        </>
      ) : (
        <>
          <div className="mb-2 text-3xl">⏳</div>
          <h3 className="text-base font-semibold text-blue-800">
            AI đang nghiên cứu và lập kế hoạch...
          </h3>
          <p className="mt-1 text-sm text-blue-700">
            Quá trình có thể mất 10–40 giây (research + phân tích). Trang sẽ tự cập nhật mỗi 5 giây.
          </p>
        </>
      )}

      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          Tải lại trạng thái
        </button>
        <button
          type="button"
          onClick={handleMarkFailed}
          disabled={marking}
          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {marking ? "Đang cập nhật..." : "Đánh dấu thất bại"}
        </button>
      </div>
    </div>
  );
}
