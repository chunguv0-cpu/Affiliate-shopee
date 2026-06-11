"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { createAiPostWithCreatives } from "@/app/dashboard/posts/actions";

type Feedback =
  | { kind: "success"; imageCount: number }
  | { kind: "error"; message: string };

export default function GeneratePostButton({
  productId,
}: {
  productId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  function handleClick() {
    setFeedback(null);
    startTransition(async () => {
      const result = await createAiPostWithCreatives(productId);
      if (result.ok) {
        setFeedback({ kind: "success", imageCount: result.imageCount });
      } else {
        setFeedback({ kind: "error", message: result.error });
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
        {pending ? "Đang tạo caption và 4 ảnh..." : "🤖 Tạo bài đăng AI"}
      </button>

      {feedback?.kind === "success" ? (
        <span className="text-right text-xs text-green-600">
          Đã tạo bài + {feedback.imageCount}/4 ảnh.{" "}
          <Link href="/dashboard/posts" className="underline hover:text-green-700">
            Xem bài
          </Link>
        </span>
      ) : null}

      {feedback?.kind === "error" ? (
        <span className="max-w-[200px] text-right text-xs text-red-600">
          {feedback.message}
        </span>
      ) : null}
    </div>
  );
}
