"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createCampaignPlanAction } from "@/app/dashboard/ai-autopilot/actions";

export default function NewCampaignForm() {
  const router = useRouter();
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
      </div>
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
