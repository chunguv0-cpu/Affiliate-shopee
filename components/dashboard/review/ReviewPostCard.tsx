"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import RegenerateAssetButton from "@/components/dashboard/RegenerateAssetButton";
import {
  approvePost,
  markPostNeedsEdit,
  rejectPost,
  updatePostCaption,
  type ReviewPost,
} from "@/app/dashboard/review/actions";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  } catch {
    return iso;
  }
}

export default function ReviewPostCard({ post }: { post: ReviewPost }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption ?? "");

  const sortedAssets = [...post.assets].sort((a, b) => a.sort_order - b.sort_order);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? okMsg : res.error ?? "Lỗi.");
      if (res.ok) router.refresh();
    });
  }

  const btn = "rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{post.product_name ?? "Sản phẩm"}</h3>
          {post.campaign_title ? <p className="text-xs text-gray-500">Chiến dịch: {post.campaign_title}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {post.review_status === "NEEDS_EDIT" ? (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Cần sửa</span>
          ) : (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Chờ duyệt</span>
          )}
          {post.creative_score !== null ? (
            <span className="rounded-full bg-lime-50 px-2 py-0.5 text-xs font-medium text-lime-700">Score: {post.creative_score}</span>
          ) : null}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">V98: {post.v98_calls}</span>
          <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700">{sortedAssets.length} ảnh</span>
        </div>
      </div>

      {/* 4-image preview */}
      {sortedAssets.length > 0 ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {sortedAssets.map((a) => (
            <div key={a.sort_order} className="relative">
              {a.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.image_url} alt="" className="aspect-square w-full rounded-md border border-gray-200 object-cover" />
              ) : (
                <div className="aspect-square w-full rounded-md border border-dashed border-gray-200 bg-gray-50" />
              )}
              <span className="absolute left-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white">
                {a.source_type === "PRODUCT" ? "Ảnh thật" : a.source_type === "AI_GENERATED" ? "AI" : "Tìm"}
              </span>
              <RegenerateAssetButton postId={post.id} sortOrder={a.sort_order} sourceType={a.source_type} />
            </div>
          ))}
        </div>
      ) : null}

      {/* Caption */}
      <div className="mt-3">
        {editing ? (
          <div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-gray-300 p-2 text-sm"
            />
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => updatePostCaption(post.id, caption), "Đã lưu caption.")}
                className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}
              >
                Lưu caption
              </button>
              <button type="button" onClick={() => setEditing(false)} className={`${btn} border border-gray-300 text-gray-600`}>
                Hủy
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-xs text-gray-700">{post.caption ?? "(chưa có caption)"}</p>
        )}
      </div>

      {post.affiliate_link ? (
        <p className="mt-2 truncate text-xs text-blue-600">🔗 {post.affiliate_link}</p>
      ) : null}
      {post.scheduled_at ? (
        <p className="mt-1 text-xs text-gray-500">Lịch dự kiến: {formatDate(post.scheduled_at)}</p>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => approvePost(post.id), "Đã duyệt bài.")} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
          Duyệt bài
        </button>
        <button type="button" disabled={pending} onClick={() => setEditing((v) => !v)} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
          Sửa caption
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => markPostNeedsEdit(post.id), "Đã đánh dấu cần sửa.")} className={`${btn} border border-orange-300 text-orange-700 hover:bg-orange-50`}>
          Cần sửa
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => rejectPost(post.id), "Đã từ chối bài.")} className={`${btn} border border-red-300 text-red-600 hover:bg-red-50`}>
          Từ chối
        </button>
        {message ? <span className="text-xs text-gray-500">{message}</span> : null}
      </div>
    </div>
  );
}
