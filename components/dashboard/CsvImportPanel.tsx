"use client";

import { useState, useTransition } from "react";

import { importProductsCsv } from "@/app/dashboard/products/actions";

const SAMPLE =
  "product_name,original_url,affiliate_link,sub_id,price_note,target_customer,product_angle,status";

export default function CsvImportPanel() {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { kind: "success" | "error"; message: string } | null
  >(null);

  function handleImport() {
    setFeedback(null);
    startTransition(async () => {
      const r = await importProductsCsv(text);
      if (r.ok) {
        setFeedback({
          kind: "success",
          message: `Đã import ${r.inserted} sản phẩm (bỏ qua ${r.skipped} dòng thiếu tên).`,
        });
        setText("");
      } else {
        setFeedback({ kind: "error", message: r.error });
      }
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-base font-semibold text-gray-900">Import hàng loạt (CSV)</h3>
      <p className="mt-1 text-sm text-gray-500">
        Dán CSV có dòng tiêu đề. Link hợp lệ (s.shopee.vn / shope.ee) sẽ thành
        READY, chưa có link affiliate sẽ là “Cần chuyển link”.
      </p>
      <p className="mt-2 break-all rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-500">
        {SAMPLE}
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        rows={6}
        placeholder={`${SAMPLE}\nKhăn ướt,https://shopee.vn/abc,https://s.shopee.vn/xyz,,1k-9k,mẹ bỉm,deal rẻ,ACTIVE`}
        className="mt-3 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />

      <button
        type="button"
        onClick={handleImport}
        disabled={pending || !text.trim()}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Đang import..." : "Import CSV"}
      </button>

      {feedback ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            feedback.kind === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}
    </div>
  );
}
