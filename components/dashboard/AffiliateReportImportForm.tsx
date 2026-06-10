"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { importAffiliateReportRows } from "@/app/dashboard/analytics/actions";
import { mapReportRows, type ReportRowInput } from "@/lib/analytics";

const SAMPLE = "sub_id,clicks,orders,commission,revenue,date\nfb_page_khan-uot_20260610,120,5,45000,900000,2026-06-10";

export default function AffiliateReportImportForm() {
  const [text, setText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ inserted: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => mapReportRows(text), [text]);

  function handleImport() {
    setError(null);
    setResult(null);
    if (parsed.rows.length === 0) {
      setError("Chưa có dòng dữ liệu hợp lệ. Cần dòng tiêu đề + dữ liệu.");
      return;
    }
    const rows: ReportRowInput[] = parsed.rows;
    startTransition(async () => {
      const r = await importAffiliateReportRows(rows);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult({ inserted: r.inserted, warnings: r.warnings });
    });
  }

  const preview = parsed.rows.slice(0, 10);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-base font-semibold text-gray-900">Import báo cáo Affiliate (CSV)</h3>
      <p className="mt-1 text-sm text-gray-500">
        Xuất báo cáo từ Shopee Affiliate rồi dán CSV vào đây. App nhận diện linh hoạt các
        cột: sub_id, affiliate_link/link, clicks/click, orders/đơn hàng, commission/hoa hồng,
        revenue/doanh thu, date/ngày.
      </p>
      <p className="mt-2 break-all rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-500">
        {SAMPLE.split("\n")[0]}
      </p>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        disabled={pending}
        rows={8}
        placeholder={SAMPLE}
        className="mt-3 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {showPreview ? "Ẩn preview" : "Preview"}
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={pending || parsed.rows.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Đang import..." : `Import (${parsed.rows.length} dòng)`}
        </button>
      </div>

      {parsed.warnings.length > 0 ? (
        <ul className="mt-3 list-disc rounded-lg bg-amber-50 px-6 py-2 text-xs text-amber-800">
          {parsed.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {showPreview && preview.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50 text-left font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Ngày</th>
                <th className="px-3 py-2">Sub ID</th>
                <th className="px-3 py-2">Clicks</th>
                <th className="px-3 py-2">Đơn</th>
                <th className="px-3 py-2">Hoa hồng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-gray-600">{r.report_date ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{r.sub_id ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{r.clicks ?? "0"}</td>
                  <td className="px-3 py-2 text-gray-600">{r.orders ?? "0"}</td>
                  <td className="px-3 py-2 text-gray-600">{r.commission ?? "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.rows.length > preview.length ? (
            <p className="px-3 py-2 text-xs text-gray-400">
              … và {parsed.rows.length - preview.length} dòng nữa.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Đã import <strong>{result.inserted}</strong> dòng báo cáo.{" "}
          <Link href="/dashboard/analytics" className="underline hover:text-green-900">
            Xem hiệu quả
          </Link>
          {result.warnings.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
