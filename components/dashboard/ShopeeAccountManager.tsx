"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import {
  createShopeeAccount,
  deleteShopeeAccount,
  scanAndImportShopeeProducts,
  updateShopeeAccount,
} from "@/app/dashboard/shopee-accounts/actions";
import type { ShopeeAccount } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ShopeeAccountManager({ accounts }: { accounts: ShopeeAccount[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<ShopeeAccount | null>(null);

  function notify(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  }

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      const r = await createShopeeAccount(fd);
      if (r.ok) {
        notify(true, "Đã thêm tài khoản.");
        form.reset();
        router.refresh();
      } else notify(false, r.error);
    });
  }

  function handleUpdate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateShopeeAccount(editing.id, fd);
      if (r.ok) {
        notify(true, "Đã cập nhật.");
        setEditing(null);
        router.refresh();
      } else notify(false, r.error);
    });
  }

  function handleDelete(acc: ShopeeAccount) {
    if (!window.confirm(`Xóa tài khoản "${acc.label}"?`)) return;
    startTransition(async () => {
      const r = await deleteShopeeAccount(acc.id);
      if (r.ok) {
        notify(true, "Đã xóa.");
        router.refresh();
      } else notify(false, r.error);
    });
  }

  function handleScan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const accountId = String(fd.get("account_id") ?? "");
    const keyword = String(fd.get("keyword") ?? "");
    const limit = parseInt(String(fd.get("limit") ?? "20"), 10) || 20;
    startTransition(async () => {
      const r = await scanAndImportShopeeProducts(accountId, keyword, limit);
      if (r.ok) {
        notify(true, `Quét xong: nhập ${r.created} sản phẩm mới, bỏ qua ${r.skipped} trùng (tổng ${r.total}).${r.sample.length ? " VD: " + r.sample.join(", ") : ""}`);
        router.refresh();
      } else {
        notify(false, `${r.error}${r.raw ? " (xem debug để biết chi tiết)" : ""}`);
      }
    });
  }

  return (
    <div className="space-y-6">
      {msg ? (
        <div className={`rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      ) : null}

      {/* Test tìm sản phẩm bằng API (chẩn đoán) */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-1 text-base font-semibold text-gray-900">🔎 Test tìm sản phẩm bằng API</h3>
        <p className="mb-3 text-xs text-gray-500">
          Công cụ <strong>chẩn đoán / nhập thủ công</strong> — kiểm tra API tài khoản trả về sản phẩm gì. Đây không phải workflow chính;
          quy trình tự động (có lọc relevance) nằm ở <span className="font-medium text-blue-600">AI Autopilot</span>.
        </p>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-500">Hãy thêm ít nhất 1 tài khoản Shopee bên dưới trước khi quét.</p>
        ) : (
          <form onSubmit={handleScan} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-1">
              <label className={labelClass} htmlFor="account_id">Tài khoản</label>
              <select id="account_id" name="account_id" className={inputClass} defaultValue={accounts.find((a) => a.is_default)?.id ?? accounts[0]?.id}>
                {accounts.filter((a) => a.status === "ACTIVE").map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="keyword">Từ khóa sản phẩm</label>
              <input id="keyword" name="keyword" className={inputClass} placeholder="VD: máy xay cầm tay, đèn ngủ cảm biến" required />
            </div>
            <div>
              <label className={labelClass} htmlFor="limit">Số lượng tối đa</label>
              <input id="limit" name="limit" type="number" min={1} max={50} defaultValue={20} className={inputClass} />
            </div>
            <div className="sm:col-span-4">
              <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {pending ? "Đang quét..." : "Quét & nhập sản phẩm + ảnh gốc Shopee"}
              </button>
              <span className="ml-2 text-xs text-gray-400">Bước này chỉ lấy ảnh nguồn từ Shopee, không tạo ảnh AI (không tốn V98 Image Key).</span>
            </div>
          </form>
        )}
      </section>

      {/* Thêm tài khoản */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-semibold text-gray-900">➕ Thêm tài khoản Shopee</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="label">Tên tài khoản (gợi nhớ)</label>
            <input id="label" name="label" className={inputClass} placeholder="VD: Shop chính, Acc phụ 1" required />
          </div>
          <div>
            <label className={labelClass} htmlFor="api_endpoint">API endpoint (tùy chọn)</label>
            <input id="api_endpoint" name="api_endpoint" className={inputClass} placeholder="https://open-api.affiliate.shopee.vn/graphql" />
          </div>
          <div>
            <label className={labelClass} htmlFor="app_id">AppId</label>
            <input id="app_id" name="app_id" className={inputClass} required />
          </div>
          <div>
            <label className={labelClass} htmlFor="app_secret">Secret</label>
            <input id="app_secret" name="app_secret" type="password" className={inputClass} required />
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="is_default" value="true" className="h-4 w-4" /> Đặt làm tài khoản mặc định
            </label>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {pending ? "Đang lưu..." : "Thêm tài khoản"}
            </button>
            <span className="ml-2 text-xs text-gray-400">Secret được lưu phía server, không hiển thị lại.</span>
          </div>
        </form>
      </section>

      {/* Danh sách tài khoản */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-semibold text-gray-900">Tài khoản đã lưu</h3>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có tài khoản nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Tên</th>
                  <th className="px-3 py-2">AppId</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Dùng gần nhất</th>
                  <th className="px-3 py-2 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {a.label} {a.is_default ? <span className="ml-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">mặc định</span> : null}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{a.app_id}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{a.status}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{fmt(a.last_used_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => setEditing(a)} className="mr-2 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">Sửa</button>
                      <button type="button" onClick={() => handleDelete(a)} disabled={pending} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">Xóa</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">
          Test nhanh API 1 tài khoản: <Link href="/api/debug/affiliate-api" className="text-blue-600 underline">/api/debug/affiliate-api</Link> (xem hướng dẫn trong trang).
        </p>
      </section>

      {/* Modal sửa */}
      {editing ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Sửa tài khoản</h3>
              <button type="button" onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleUpdate} className="space-y-3">
              <div>
                <label className={labelClass}>Tên</label>
                <input name="label" defaultValue={editing.label} className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>AppId</label>
                <input name="app_id" defaultValue={editing.app_id} className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>Secret (để trống = giữ nguyên)</label>
                <input name="app_secret" type="password" className={inputClass} placeholder="••••••" />
              </div>
              <div>
                <label className={labelClass}>API endpoint</label>
                <input name="api_endpoint" defaultValue={editing.api_endpoint ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Trạng thái</label>
                <select name="status" defaultValue={editing.status} className={inputClass}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </div>
              <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {pending ? "Đang lưu..." : "Lưu"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
