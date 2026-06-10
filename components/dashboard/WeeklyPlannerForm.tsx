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
          Chưa có nhiều dữ liệu hiệu quả. AI sẽ tạo kế hoạch test dựa trên sản phẩm hiện có.
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
        {pending ? "AI đang phân tích..." : "🧠 Tạo gợi ý chiến dịch"}
      </button>
    </form>
  );
}
