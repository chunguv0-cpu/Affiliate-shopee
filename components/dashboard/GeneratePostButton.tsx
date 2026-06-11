"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createAiPostImageJob } from "@/app/dashboard/jobs/actions";

export default function GeneratePostButton({
  productId,
}: {
  productId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createAiPostImageJob(productId);
      if (result.ok) {
        // Không chờ sinh ảnh — chuyển sang trang tiến trình job (AI chạy theo bước).
        router.push(`/dashboard/jobs/${result.jobId}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Đã tạo job, AI đang xử lý..." : "🤖 Tạo bài đăng AI"}
      </button>

      {error ? (
        <span className="max-w-[200px] text-right text-xs text-red-600">{error}</span>
      ) : null}
    </div>
  );
}
