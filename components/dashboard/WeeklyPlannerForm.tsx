"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { generateWeeklyCampaignRecommendation } from "@/app/dashboard/ai-planner/actions";
import type { CampaignGoal } from "@/lib/ai/campaign-planner";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

const GOALS: { value: CampaignGoal; label: string }[] = [
  { value: "balanced", label: "Cân bằng" },
  { value: "clicks", label: "Tăng click" },
  { value: "orders", label: "Tăng đơn" },
  { value: "commission", label: "Tăng hoa hồng" },
  { value: "engagement", label: "Tăng tương tác" },
];

export default function WeeklyPlannerForm({
  canGenerate,
  hasReports,
}: {
  canGenerate: boolean;
  hasReports: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canGenerate) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Chưa có sản phẩm READY. Hãy <strong>import link affiliate</strong> trước khi tạo gợi ý.
      </div>
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const fd = new FormData(event.currentTarget);
    const input = {
      week_start: String(fd.get("week_start") ?? ""),
      week_end: String(fd.get("week_end") ?? ""),
      goal: (String(fd.get("goal") ?? "balanced") as CampaignGoal),
      target_customer: String(fd.get("target_customer") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      priority_notes: String(fd.get("priority_notes") ?? ""),
      detail_level: String(fd.get("detail_level") ?? "very_detailed") as
        | "quick"
        | "detailed"
        | "very_detailed",
      strategy_mode: (String(fd.get("strategy_mode") ?? "") || undefined) as
        | "safe_test"
        | "push_winners"
        | "find_new"
        | "boost_orders"
        | "boost_commission"
        | "boost_engagement"
        | undefined,
      use_market_research: fd.get("use_market_research") === "true",
    };

    startTransition(async () => {
      const r = await generateWeeklyCampaignRecommendation(input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/dashboard/ai-planner/${r.id}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!hasReports ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Chưa có <strong>dữ liệu báo cáo affiliate</strong> (click/đơn). AI vẫn lập kế
          hoạch dựa trên sản phẩm READY{" "}
          <strong>+ nghiên cứu thị trường</strong> (nếu bật bên dưới), nhưng đây là{" "}
          <strong>kế hoạch test</strong>. Hãy{" "}
          <a href="/dashboard/analytics/import" className="underline">
            import báo cáo Affiliate
          </a>{" "}
          (có sub_id) để gợi ý sát dữ liệu hơn.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="week_start">Tuần bắt đầu</label>
          <input id="week_start" name="week_start" type="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="week_end">Tuần kết thúc</label>
          <input id="week_end" name="week_end" type="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="goal">Mục tiêu</label>
          <select id="goal" name="goal" defaultValue="balanced" className={inputClass}>
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="target_customer">Tệp khách ưu tiên</label>
          <input id="target_customer" name="target_customer" type="text" placeholder="VD: mẹ bỉm, dân văn phòng" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="notes">Ghi chú thêm</label>
          <input id="notes" name="notes" type="text" placeholder="(tùy chọn)" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="priority_notes">
          Mục tiêu chi tiết — Bạn muốn AI ưu tiên điều gì?
        </label>
        <textarea
          id="priority_notes"
          name="priority_notes"
          rows={2}
          placeholder="Ví dụ: Tôi muốn tăng đơn hàng, ưu tiên sản phẩm dễ mua, giá tốt, không chỉ kéo click ảo."
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="detail_level">Mức độ cụ thể</label>
          <select id="detail_level" name="detail_level" defaultValue="very_detailed" className={inputClass}>
            <option value="quick">Nhanh gọn</option>
            <option value="detailed">Chi tiết</option>
            <option value="very_detailed">Rất chi tiết</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="strategy_mode">Chế độ chiến lược</label>
          <select id="strategy_mode" name="strategy_mode" defaultValue="" className={inputClass}>
            <option value="">(Theo mục tiêu)</option>
            <option value="safe_test">Test an toàn</option>
            <option value="push_winners">Đẩy mạnh sản phẩm thắng</option>
            <option value="find_new">Tìm sản phẩm mới</option>
            <option value="boost_orders">Tăng đơn hàng</option>
            <option value="boost_commission">Tăng hoa hồng</option>
            <option value="boost_engagement">Kéo tương tác</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" name="use_market_research" value="true" defaultChecked className="h-4 w-4" />
          Cho AI nghiên cứu thị trường trước khi lập kế hoạch
        </label>
        <p className="mt-1 text-xs text-gray-500">
          AI sẽ tìm kiếm thông tin công khai về sản phẩm, nhu cầu khách hàng và cách
          viết nội dung đang phù hợp. Không đăng bài tự động.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "AI đang nghiên cứu & lập kế hoạch..." : "🧠 Tạo gợi ý chiến dịch"}
      </button>
    </form>
  );
}
