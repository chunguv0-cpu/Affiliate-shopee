"use client";

import { useState, useTransition } from "react";

import { publishGeneratedPost } from "@/app/dashboard/posts/actions";
import type { GeneratedPostStatus } from "@/lib/types";

type PublishPostButtonProps = {
  postId: string;
  status: GeneratedPostStatus;
  shouldPublish: boolean;
  aiScore: number | null;
  caption?: string | null;
};

type Result =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

/** Lý do không đủ điều kiện đăng (null nếu đủ điều kiện). */
function ineligibleReason(props: PublishPostButtonProps): string | null {
  if (props.status !== "READY") return "Chỉ bài READY mới có thể đăng.";
  if (props.shouldPublish !== true) return "Bài chưa được AI duyệt để đăng.";
  if ((props.aiScore ?? 0) < 80) return "Điểm AI dưới 80, không thể đăng.";
  if (!props.caption || props.caption.trim() === "")
    return "Caption rỗng, không thể đăng.";
  return null;
}

export default function PublishPostButton(props: PublishPostButtonProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  const reason = ineligibleReason(props);

  // Không đủ điều kiện -> hiện lý do (không ẩn im lặng).
  if (reason) {
    return <p className="text-xs text-gray-500">{reason}</p>;
  }

  function handleClick() {
    const confirmed = window.confirm(
      "Bạn chắc chắn muốn đăng bài này lên Facebook Fanpage ngay bây giờ?",
    );
    if (!confirmed) return;

    setResult(null);
    startTransition(async () => {
      const r = await publishGeneratedPost(props.postId);
      setResult(
        r.ok ? { ok: true, url: r.facebookPostUrl } : { ok: false, error: r.error },
      );
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {pending ? "Đang đăng..." : "📤 Đăng ngay"}
      </button>

      {result?.ok ? (
        <span className="text-xs text-green-600">
          Đăng thành công.{" "}
          {result.url ? (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-green-700"
            >
              Mở bài Facebook
            </a>
          ) : null}
        </span>
      ) : null}

      {result && !result.ok ? (
        <span className="max-w-xs text-xs text-red-600">{result.error}</span>
      ) : null}
    </div>
  );
}
