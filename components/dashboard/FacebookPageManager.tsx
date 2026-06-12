"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createFacebookPage,
  deleteFacebookPage,
  setDefaultFacebookPage,
  testFacebookPage,
} from "@/app/dashboard/accounts/facebook-actions";
import type { FacebookPage } from "@/lib/types";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";
const labelClass = "mb-1 block text-xs font-medium text-gray-600";

export default function FacebookPageManager({ pages }: { pages: FacebookPage[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function notify(ok: boolean, t: string) {
    setMsg({ ok, text: t });
    router.refresh();
  }

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    setMsg(null);
    startTransition(async () => {
      const r = await createFacebookPage(fd);
      if (r.ok) {
        form.reset();
        notify(true, "Đã thêm Page.");
      } else {
        notify(false, r.error);
      }
    });
  }

  function handleTest(id: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await testFacebookPage(id);
      notify(r.ok, r.ok ? `Kết nối OK: ${r.pageName ?? "Page"}.` : `Lỗi: ${r.error}`);
    });
  }
  function handleDefault(id: string) {
    startTransition(async () => {
      const r = await setDefaultFacebookPage(id);
      notify(r.ok, r.ok ? "Đã đặt Page mặc định." : r.error);
    });
  }
  function handleDelete(id: string) {
    startTransition(async () => {
      const r = await deleteFacebookPage(id);
      notify(r.ok, r.ok ? "Đã xóa Page." : r.error);
    });
  }

  return (
    <div className="space-y-5">
      {msg ? (
        <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-1 text-base font-semibold text-gray-900">➕ Thêm Facebook Page</h3>
        <p className="mb-3 text-xs text-gray-500">Token chỉ lưu phía server và hiển thị dạng che (••••abcd). KHÔNG bao giờ lộ token ra giao diện.</p>
        <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Tên (nội bộ) *</label>
            <input name="name" required className={inputClass} placeholder="VD: Page Gia Dụng Chính" />
          </div>
          <div>
            <label className={labelClass}>Page ID *</label>
            <input name="page_id" required className={inputClass} placeholder="VD: 1234567890" />
          </div>
          <div>
            <label className={labelClass}>Tên Page (tùy chọn)</label>
            <input name="page_name" className={inputClass} placeholder="Tên hiển thị của Page" />
          </div>
          <div>
            <label className={labelClass}>Page Access Token *</label>
            <input name="page_access_token" type="password" required className={inputClass} placeholder="EAAB..." autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Ghi chú</label>
            <input name="notes" className={inputClass} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="is_default" value="true" /> Đặt làm Page mặc định
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {pending ? "Đang lưu..." : "Thêm Page"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-semibold text-gray-900">Danh sách Page ({pages.length})</h3>
        {pages.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có Page nào. Thêm Page ở trên. Nếu chưa thêm, hệ thống sẽ dùng env FACEBOOK_PAGE_ID/TOKEN làm fallback.</p>
        ) : (
          <div className="space-y-2">
            {pages.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 p-3">
                <div className="text-sm">
                  <span className="font-medium text-gray-900">{p.name}</span>
                  {p.is_default ? <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">Mặc định</span> : null}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${p.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{p.status}</span>
                  <div className="mt-0.5 text-xs text-gray-500">Page ID: {p.page_id} · Token: {p.token_masked ?? "—"}</div>
                  {p.last_publish_test_at ? <div className="text-[11px] text-gray-400">Test gần nhất: {new Date(p.last_publish_test_at).toLocaleString("vi-VN")}</div> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={pending} onClick={() => handleTest(p.id)} className="rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Kiểm tra</button>
                  {!p.is_default ? (
                    <button type="button" disabled={pending} onClick={() => handleDefault(p.id)} className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Đặt mặc định</button>
                  ) : null}
                  <button type="button" disabled={pending} onClick={() => handleDelete(p.id)} className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Xóa</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
