"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { regeneratePostCreativeAssetSlot } from "@/app/dashboard/posts/actions";

export default function RegenerateAssetButton({
  postId,
  sortOrder,
  sourceType,
}: {
  postId: string;
  sortOrder: number;
  sourceType: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const isAi = sourceType === "AI_GENERATED";

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await regeneratePostCreativeAssetSlot(postId, sortOrder);
      if (result.ok) {
        setMessage(result.v98CallUsed ? "Đã tạo lại, tốn 1 lượt V98." : "Đã tạo biến thể local.");
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title={isAi ? "Tốn 1 lượt V98 image nếu ảnh này là ảnh AI." : "Ảnh nguồn: tạo biến thể overlay local, không gọi V98."}
        className="w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Đang tạo..." : "Regenerate ảnh này"}
      </button>
      {message ? <p className="mt-0.5 line-clamp-2 text-[10px] text-amber-700">{message}</p> : null}
    </div>
  );
}
