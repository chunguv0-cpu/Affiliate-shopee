"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  convertSourcingCandidateToProduct,
  saveSourcingLink,
  updateSourcingStatus,
} from "@/app/dashboard/sourcing/actions";
import { SOURCING_STATUS_LABELS, type SourcingCandidate, type SourcingStatus } from "@/lib/types";

const STATUS_STYLES: Record<SourcingStatus, string> = {
  NEW: "bg-gray-100 text-gray-600",
  SOURCING: "bg-amber-50 text-amber-700",
  LINK_READY: "bg-blue-50 text-blue-700",
  IMPORTED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
};

function toKeywords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : String(x ?? ""))).filter((x) => x.trim() !== "");
}

export default function SourcingCandidateCard({ candidate }: { candidate: SourcingCandidate }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [link, setLink] = useState(candidate.affiliate_link ?? "");
  const [subId, setSubId] = useState(candidate.sub_id ?? "");
  const [notes, setNotes] = useState(candidate.notes ?? "");

  const keywords = toKeywords(candidate.suggested_search_keywords);
  const isImported = candidate.status === "IMPORTED";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: okText });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error ?? "Có lỗi xảy ra." });
      }
    });
  }

  function copyKeywords() {
    const text = keywords.join(", ");
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setMsg({ ok: true, text: "Đã copy từ khóa." }),
        () => setMsg({ ok: false, text: "Không copy được." }),
      );
    }
  }

  const shopeeUrl =
    keywords.length > 0 ? `https://shopee.vn/search?keyword=${encodeURIComponent(keywords[0])}` : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{candidate.suggested_product}</span>
        {candidate.category ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{candidate.category}</span> : null}
        {candidate.priority ? <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">{candidate.priority}</span> : null}
        {candidate.confidence ? <span className="text-xs text-gray-400">tin cậy: {candidate.confidence}</span> : null}
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[candidate.status]}`}>
          {SOURCING_STATUS_LABELS[candidate.status]}
        </span>
      </div>

      {candidate.reason ? <p className="mt-2 text-sm text-gray-600">{candidate.reason}</p> : null}
      <dl className="mt-1 space-y-0.5 text-xs text-gray-500">
        {candidate.target_customer ? <div>👤 Khách: {candidate.target_customer}</div> : null}
        {candidate.pain_point ? <div>❗ Nỗi đau: {candidate.pain_point}</div> : null}
        {candidate.content_angle ? <div>✍️ Góc viết: {candidate.content_angle}</div> : null}
        {candidate.first_post_hook ? <div className="text-gray-700">🪝 Hook: “{candidate.first_post_hook}”</div> : null}
        {candidate.cta ? <div>📣 CTA: {candidate.cta}</div> : null}
      </dl>

      {keywords.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {keywords.map((k, j) => (
            <span key={j} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{k}</span>
          ))}
        </div>
      ) : null}

      {candidate.affiliate_link ? (
        <p className="mt-2 break-all text-xs text-gray-500">
          🔗 <a href={candidate.affiliate_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{candidate.affiliate_link}</a>
        </p>
      ) : null}

      {/* Hành động */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        {keywords.length > 0 ? (
          <button type="button" onClick={copyKeywords} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            📋 Copy từ khóa
          </button>
        ) : null}
        {shopeeUrl ? (
          <a href={shopeeUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            🔎 Mở Shopee search
          </a>
        ) : null}
        {!isImported ? (
          <>
            {candidate.status !== "SOURCING" ? (
              <button type="button" disabled={pending} onClick={() => run(() => updateSourcingStatus(candidate.id, "SOURCING"), "Đã chuyển: Đang tìm.")} className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                Đánh dấu Đang tìm
              </button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => setShowLinkForm((v) => !v)} className="rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              🔗 Dán link affiliate
            </button>
            <button type="button" disabled={pending || !candidate.affiliate_link} onClick={() => run(() => convertSourcingCandidateToProduct(candidate.id), "Đã tạo sản phẩm READY.")} className="rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50" title={!candidate.affiliate_link ? "Cần dán link trước" : ""}>
              ➡️ Chuyển thành sản phẩm
            </button>
            {candidate.status !== "REJECTED" ? (
              <button type="button" disabled={pending} onClick={() => run(() => updateSourcingStatus(candidate.id, "REJECTED"), "Đã bỏ qua.")} className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                Bỏ qua
              </button>
            ) : null}
          </>
        ) : (
          <a href="/dashboard/products" className="text-xs font-medium text-green-700 hover:underline">Xem trong Sản phẩm →</a>
        )}
      </div>

      {showLinkForm && !isImported ? (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Dán link affiliate (https://s.shopee.vn/...)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={subId} onChange={(e) => setSubId(e.target.value)} placeholder="sub_id (tùy chọn)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú (tùy chọn)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <button type="button" disabled={pending} onClick={() => run(() => saveSourcingLink(candidate.id, link, subId, notes), "Đã lưu link (LINK_READY).")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "Đang lưu..." : "Lưu link"}
          </button>
        </div>
      ) : null}

      {msg ? <p className={`mt-2 text-xs ${msg.ok ? "text-green-600" : "text-amber-700"}`}>{msg.text}</p> : null}
    </div>
  );
}
