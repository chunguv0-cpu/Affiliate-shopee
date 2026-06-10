"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";

import { createCampaignAndSchedulePosts } from "@/app/dashboard/campaigns/actions";
import { CAMPAIGN_DEFAULT_TIME_SLOTS, type Product } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

type Result =
  | { ok: true; createdPosts: number; rejectedPosts: number; failedPosts: number }
  | { ok: false; error: string };

export default function CampaignForm({ products }: { products: Product[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const r = await createCampaignAndSchedulePosts(formData);
      setResult(r);
    });
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Chưa có sản phẩm <strong>ACTIVE</strong> nào. Hãy vào{" "}
        <Link href="/dashboard/products" className="underline">
          Sản phẩm
        </Link>{" "}
        thêm sản phẩm và đặt trạng thái <strong>Đang chạy</strong> trước khi tạo
        chiến dịch.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="c_name">
            Tên chiến dịch <span className="text-red-500">*</span>
          </label>
          <input id="c_name" name="name" type="text" required className={inputClass} placeholder="VD: Tuần lễ deal mẹ & bé" />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="c_desc">
            Mô tả
          </label>
          <input id="c_desc" name="description" type="text" className={inputClass} placeholder="(tùy chọn)" />
        </div>

        <div>
          <label className={labelClass} htmlFor="c_start">
            Ngày bắt đầu <span className="text-red-500">*</span>
          </label>
          <input id="c_start" name="start_date" type="date" required className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="c_days">
              Số ngày chạy
            </label>
            <input id="c_days" name="days" type="number" min={1} max={30} defaultValue={3} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="c_ppd">
              Số bài/ngày
            </label>
            <input id="c_ppd" name="posts_per_day" type="number" min={1} max={4} defaultValue={4} className={inputClass} />
          </div>
        </div>
      </div>

      <div>
        <p className={labelClass}>Khung giờ đăng (giờ VN)</p>
        <div className="flex flex-wrap gap-3">
          {CAMPAIGN_DEFAULT_TIME_SLOTS.map((t) => (
            <label key={t} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700">
              <input type="checkbox" name="time_slots" value={t} defaultChecked className="h-4 w-4" />
              {t}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Hệ thống dùng tối đa <strong>“số bài/ngày”</strong> khung giờ đầu tiên đã chọn.
        </p>
      </div>

      <div>
        <p className={labelClass}>
          Chọn sản phẩm ACTIVE <span className="text-red-500">*</span>
        </p>
        <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-gray-200 p-2">
          {products.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
              <input type="checkbox" name="product_ids" value={p.id} className="h-4 w-4" />
              <span className="font-medium text-gray-900">{p.product_name}</span>
              {p.price_note ? <span className="text-xs text-gray-400">· {p.price_note}</span> : null}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Mỗi lần tạo tối đa <strong>20 bài</strong>. Nếu chọn nhiều hơn số slot, chỉ tạo theo giới hạn.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Đang tạo lịch AI..." : "🚀 Tạo lịch AI hàng loạt"}
      </button>

      {result?.ok ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Đã tạo chiến dịch: <strong>{result.createdPosts}</strong> bài sẵn sàng,{" "}
          <strong>{result.rejectedPosts}</strong> bị từ chối,{" "}
          <strong>{result.failedPosts}</strong> lỗi.{" "}
          <Link href="/dashboard/posts" className="underline hover:text-green-900">
            Xem bài đăng
          </Link>{" "}
          ·{" "}
          <Link href="/dashboard/calendar" className="underline hover:text-green-900">
            Xem lịch
          </Link>
        </div>
      ) : null}
      {result && !result.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      ) : null}
    </form>
  );
}
