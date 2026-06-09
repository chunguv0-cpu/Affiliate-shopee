"use client";

import { useState, useTransition } from "react";

import { retryFailedPost } from "@/app/dashboard/posts/actions";

type Result = { ok: true } | { ok: false; error: string };

export default function RetryPostButton({ postId }: { postId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  function handleClick() {
    const confirmed = window.confirm(
      "Đưa bài lỗi này về trạng thái Sẵn sàng (READY) để đăng lại?",
    );
    if (!confirmed) return;

    setResult(null);
    startTransition(async () => {
      const r = await retryFailedPost(postId);
      setResult(r);
    });
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
      >
        {pending ? "Đang xử lý..." : "🔄 Thử lại"}
      </button>

      {result?.ok ? (
        <span className="text-xs text-green-600">
          Đã đưa về READY. Bạn có thể đăng lại hoặc đặt lịch.
        </span>
      ) : null}
      {result && !result.ok ? (
        <span className="max-w-xs text-xs text-red-600">{result.error}</span>
      ) : null}
    </div>
  );
}
