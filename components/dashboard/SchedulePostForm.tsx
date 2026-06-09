"use client";

import { useState, useTransition, type FormEvent } from "react";

import {
  clearPostSchedule,
  scheduleGeneratedPost,
} from "@/app/dashboard/posts/actions";
import type { GeneratedPostStatus } from "@/lib/types";

type SchedulePostFormProps = {
  postId: string;
  currentScheduledAt: string | null;
  status: GeneratedPostStatus;
};

/** Chuyển ISO string -> giá trị cho input datetime-local (giờ local). */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

export default function SchedulePostForm({
  postId,
  currentScheduledAt,
  status,
}: SchedulePostFormProps) {
  const [value, setValue] = useState(toLocalInputValue(currentScheduledAt));
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  if (status === "PUBLISHED") {
    return (
      <p className="text-sm text-gray-500">Bài đã đăng, không thể đổi lịch.</p>
    );
  }

  function handleSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!value) {
      setFeedback({ kind: "error", message: "Vui lòng chọn thời gian đăng." });
      return;
    }

    const when = new Date(value);
    if (Number.isNaN(when.getTime())) {
      setFeedback({ kind: "error", message: "Thời gian không hợp lệ." });
      return;
    }

    startTransition(async () => {
      const result = await scheduleGeneratedPost(postId, when.toISOString());
      setFeedback(
        result.ok
          ? { kind: "success", message: "Đã lưu lịch đăng." }
          : { kind: "error", message: result.error },
      );
    });
  }

  function handleClear() {
    setFeedback(null);
    startTransition(async () => {
      const result = await clearPostSchedule(postId);
      if (result.ok) {
        setValue("");
        setFeedback({ kind: "success", message: "Đã xóa lịch đăng." });
      } else {
        setFeedback({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form onSubmit={handleSchedule} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:w-auto"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Đang lưu..." : "Lưu lịch"}
          </button>
          {currentScheduledAt ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={pending}
              className="inline-flex items-center rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Xóa lịch
            </button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <p
          className={`text-xs ${
            feedback.kind === "success" ? "text-green-600" : "text-red-600"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}
