"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import CsvImportPanel from "@/components/dashboard/CsvImportPanel";
import { importAffiliateLinksOnly } from "@/app/dashboard/import-products/actions";
import { getAllowedShopeeHost } from "@/lib/affiliate";

type RowStatus = "valid" | "dup" | "invalid";
type PreviewRow = { stt: number; link: string; status: RowStatus };

type ImportResult = {
  inserted: number;
  skipped: number;
  warnings: string[];
  errors: string[];
};

const PLACEHOLDER = `https://s.shopee.vn/xxxx
https://s.shopee.vn/yyyy
https://shope.ee/zzzz`;

function parseLines(text: string): PreviewRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const seen = new Set<string>();
  return lines.map((link, i) => {
    let status: RowStatus;
    if (seen.has(link)) {
      status = "dup";
    } else if (!/^https?:\/\//i.test(link) || !getAllowedShopeeHost(link)) {
      status = "invalid";
    } else {
      status = "valid";
    }
    seen.add(link);
    return { stt: i + 1, link, status };
  });
}

const STATUS_LABEL: Record<RowStatus, { text: string; cls: string }> = {
  valid: { text: "Hợp lệ", cls: "bg-green-50 text-green-700" },
  dup: { text: "Trùng", cls: "bg-amber-50 text-amber-700" },
  invalid: { text: "Lỗi", cls: "bg-red-50 text-red-700" },
};

export default function AffiliateLinksImportForm() {
  const [mode, setMode] = useState<"link" | "csv">("link");
  const [text, setText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => parseLines(text), [text]);
  const validLinks = useMemo(
    () => rows.filter((r) => r.status === "valid").map((r) => r.link),
    [rows],
  );

  function handleImport() {
    setError(null);
    setResult(null);
    if (validLinks.length === 0) {
      setError("Không có link hợp lệ để import.");
      return;
    }
    if (validLinks.length > 20) {
      setError("Mỗi lần chỉ import tối đa 20 link để tránh quá tải.");
      return;
    }
    startTransition(async () => {
      const r = await importAffiliateLinksOnly(validLinks);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult({
        inserted: r.inserted,
        skipped: r.skipped,
        warnings: r.warnings,
        errors: r.errors,
      });
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("link")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            mode === "link" ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Mỗi dòng một link
        </button>
        <button
          type="button"
          onClick={() => setMode("csv")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            mode === "csv" ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          CSV nâng cao
        </button>
      </div>

      {mode === "csv" ? (
        <CsvImportPanel />
      ) : (
        <div>
          <p className="mb-2 text-sm text-gray-500">
            Dán mỗi dòng một link Affiliate Shopee đã chuyển đổi. Hệ thống sẽ tự
            đọc link và dùng AI để điền thông tin sản phẩm.
          </p>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            disabled={pending}
            rows={7}
            placeholder={PLACEHOLDER}
            className="w-full rounded-lg border border-gray-300 p-3 font-mono text-xs text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {showPreview ? "Ẩn preview" : "Preview link"}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={pending || validLinks.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "Đang import & AI điền..." : `Import & AI tự điền (${validLinks.length})`}
            </button>
            <span className="text-xs text-gray-400">Tối đa 20 link/lần.</span>
          </div>

          {showPreview && rows.length > 0 ? (
            <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2 w-12">STT</th>
                    <th className="px-3 py-2">Affiliate link</th>
                    <th className="px-3 py-2 w-24">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={`${r.stt}-${r.link}`}>
                      <td className="px-3 py-2 text-gray-500">{r.stt}</td>
                      <td className="px-3 py-2 max-w-md truncate font-mono text-xs text-gray-700" title={r.link}>
                        {r.link}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_LABEL[r.status].cls}`}>
                          {STATUS_LABEL[r.status].text}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="mt-3 space-y-2">
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                Đã import <strong>{result.inserted}</strong> sản phẩm, bỏ qua{" "}
                <strong>{result.skipped}</strong> link.{" "}
                <Link href="/dashboard/products" className="underline hover:text-green-900">
                  Xem sản phẩm
                </Link>
              </div>
              {result.warnings.length > 0 ? (
                <ul className="list-disc rounded-lg bg-amber-50 px-6 py-2 text-xs text-amber-800">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {result.errors.length > 0 ? (
                <ul className="list-disc rounded-lg bg-red-50 px-6 py-2 text-xs text-red-700">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
