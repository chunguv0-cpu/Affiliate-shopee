"use client";

import { useState } from "react";

type CopyState = "idle" | "copied" | "error";

export default function CopyButton({
  text,
  label = "Copy caption",
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API không khả dụng.");
      }
      setState("copied");
    } catch {
      setState("error");
    } finally {
      // Tự reset trạng thái sau 2 giây.
      setTimeout(() => setState("idle"), 2000);
    }
  }

  const className =
    state === "copied"
      ? "border-green-300 bg-green-50 text-green-700"
      : state === "error"
        ? "border-red-300 bg-red-50 text-red-700"
        : "border-gray-300 text-gray-700 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${className}`}
    >
      {state === "copied"
        ? "✓ Đã copy"
        : state === "error"
          ? "Không copy được"
          : `📋 ${label}`}
    </button>
  );
}
