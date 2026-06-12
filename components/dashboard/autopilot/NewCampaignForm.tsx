"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createCampaignPlanAction } from "@/app/dashboard/ai-autopilot/actions";

type Option = { id: string; label: string; is_default: boolean };
type VerticalOption = { key: string; label: string };

export default function NewCampaignForm({
  shopeeAccounts = [],
  facebookPages = [],
  verticals = [],
}: {
  shopeeAccounts?: Option[];
  facebookPages?: Option[];
  verticals?: VerticalOption[];
}) {
  const router = useRouter();
  const defaultAccount = shopeeAccounts.find((a) => a.is_default)?.id ?? shopeeAccounts[0]?.id ?? "";
  const defaultPage = facebookPages.find((p) => p.is_default)?.id ?? facebookPages[0]?.id ?? "";
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await createCampaignPlanAction(formData);
      if (res.ok) {
        setMessage("Đã tạo gợi ý chiến dịch. Kiểm tra bên dưới và bấm Duyệt chiến dịch.");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-gray-900">Bắt đầu chiến dịch mới</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2 text-sm">
          <span className="mb-1 block font-medium text-gray-700">Mục tiêu chiến dịch *</span>
          <input
            name="objective"
            required
            placeholder="VD: Tăng đơn hàng nhóm đồ gia dụng nhà bếp dưới 150k"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Số ngày</span>
          <input name="days" type="number" min={1} max={60} defaultValue={7} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Số bài/ngày</span>
          <input name="posts_per_day" type="number" min={1} max={10} defaultValue={2} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Nhóm sản phẩm ưu tiên (tùy chọn)</span>
          <input name="priority_group" placeholder="VD: Nhà bếp, Gia dụng" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Tệp khách hàng (tùy chọn)</span>
          <input name="target_customer" placeholder="VD: Mẹ bỉm, nội trợ 25-40 tuổi" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Mức giá mong muốn (tùy chọn)</span>
          <input name="preferred_price_range" placeholder="VD: dưới 200k, dễ ra đơn" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Loại sản phẩm muốn tránh (tùy chọn)</span>
          <input name="avoid_products" placeholder="VD: mỹ phẩm, thời trang nữ, phụ kiện nail" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Ngành hàng (khóa từ khóa)</span>
          <select name="category_vertical" defaultValue="" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">Tự động phát hiện từ mục tiêu</option>
            {verticals.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Tài khoản Shopee</span>
          <select name="shopee_account_id" defaultValue={defaultAccount} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
            {shopeeAccounts.length === 0 ? <option value="">(Chưa có — dùng mặc định)</option> : null}
            {shopeeAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label}{a.is_default ? " (mặc định)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Facebook Page đăng bài</span>
          <select name="facebook_page_id" defaultValue={defaultPage} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
            {facebookPages.length === 0 ? <option value="">(Chưa có — dùng env/Page mặc định)</option> : null}
            {facebookPages.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.is_default ? " (mặc định)" : ""}</option>
            ))}
          </select>
        </label>
      </div>
      {(shopeeAccounts.length === 0 || facebookPages.length === 0) ? (
        <p className="mt-2 text-xs text-amber-600">
          Mẹo: thêm Tài khoản Shopee và Facebook Page ở mục <strong>Tài khoản &amp; Page</strong> để chọn theo từng chiến dịch.
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Đang tạo gợi ý..." : "Tạo gợi ý chiến dịch AI"}
        </button>
        {message ? <span className="text-sm text-emerald-600">{message}</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        AI chỉ <strong>đề xuất</strong> chiến dịch + cơ hội sản phẩm. Hệ thống chỉ tự tìm sản phẩm sau khi bạn duyệt.
      </p>
    </form>
  );
}
