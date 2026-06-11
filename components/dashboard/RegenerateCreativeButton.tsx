"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { regeneratePostCreativeAssets } from "@/app/dashboard/posts/actions";

export default function RegenerateCreativeButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleClick() {
    setMsg(null);
    startTransition(async () => {
      const r = await regeneratePostCreativeAssets(postId);
      if (r.ok) {
        setMsg({ ok: true, text: `Đã dựng lại: ${r.status} (${r.total} ảnh thật).` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error });
      }
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
      >
        {pending ? "Đang tạo ảnh..." : "🎨 Dựng lại 4 ảnh AI"}
      </button>
      {msg ? <span className={`ml-2 text-xs ${msg.ok ? "text-green-600" : "text-amber-700"}`}>{msg.text}</span> : null}
    </div>
  );
}
