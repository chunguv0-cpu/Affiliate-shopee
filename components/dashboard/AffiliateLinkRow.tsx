"use client";

import { useState, useTransition } from "react";

import LinkStatusBadge from "@/components/dashboard/LinkStatusBadge";
import { saveAffiliateLink } from "@/app/dashboard/products/actions";
import type { LinkStatus, Product } from "@/lib/types";

export default function AffiliateLinkRow({
  product,
  suggestedSubId,
}: {
  product: Product;
  suggestedSubId: string;
}) {
  const [value, setValue] = useState(product.affiliate_link ?? "");
  const [status, setStatus] = useState<LinkStatus>(product.link_status);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { kind: "success" | "error"; message: string } | null
  >(null);

  function handleSave() {
    setFeedback(null);
    startTransition(async () => {
      const r = await saveAffiliateLink(product.id, value);
      if (r.ok) {
        setStatus(r.linkStatus);
        setFeedback(
          r.linkStatus === "READY"
            ? { kind: "success", message: "Đã lưu — link hợp lệ (READY)." }
            : { kind: "error", message: "Đã lưu nhưng link chưa hợp lệ (cần s.shopee.vn / shope.ee)." },
        );
      } else {
        setFeedback({ kind: "error", message: r.error });
      }
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{product.product_name}</p>
          {product.original_url ? (
            <a
              href={product.original_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block max-w-md truncate text-xs text-gray-500 hover:underline"
              title={product.original_url}
            >
              gốc: {product.original_url}
            </a>
          ) : (
            <p className="mt-0.5 text-xs text-gray-400">Chưa có link gốc</p>
          )}
        </div>
        <LinkStatusBadge status={status} />
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Sub ID gợi ý: <span className="font-mono text-gray-600">{product.sub_id ?? suggestedSubId}</span>
      </p>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          placeholder="Dán link affiliate (https://s.shopee.vn/...)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Đang lưu..." : "Lưu nhanh"}
        </button>
      </div>

      {feedback ? (
        <p
          className={`mt-2 text-xs ${
            feedback.kind === "success" ? "text-green-600" : "text-red-600"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
