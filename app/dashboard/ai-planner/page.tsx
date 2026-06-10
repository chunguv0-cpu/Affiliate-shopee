import Link from "next/link";

import EmptyState from "@/components/dashboard/EmptyState";
import PageHeader from "@/components/dashboard/PageHeader";
import WeeklyPlannerForm from "@/components/dashboard/WeeklyPlannerForm";
import {
  getCampaignRecommendations,
  getPlannerPrereqs,
} from "@/app/dashboard/ai-planner/actions";
import { RECOMMENDATION_STATUS_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  CONVERTED_TO_CAMPAIGN: "bg-blue-50 text-blue-700",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default async function AiPlannerPage() {
  const [prereqs, listRes] = await Promise.all([
    getPlannerPrereqs(),
    getCampaignRecommendations(),
  ]);
  const items = listRes.ok ? listRes.items : [];

  return (
    <div>
      <PageHeader
        title="Gợi ý AI cho chiến dịch tuần"
        description="AI phân tích sản phẩm, bài đã đăng và báo cáo affiliate để đề xuất chiến dịch nên chạy trong tuần."
      />

      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Tạo gợi ý mới</h3>
        <WeeklyPlannerForm canGenerate={prereqs.canGenerate} hasReports={prereqs.hasReports} />
      </div>

      <h3 className="mb-3 text-base font-semibold text-gray-900">Gợi ý đã tạo</h3>

      {!listRes.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {listRes.error}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🧠"
          title="Chưa có gợi ý nào"
          description="Tạo gợi ý đầu tiên để AI đề xuất chiến dịch cho tuần."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Tiêu đề</th>
                <th className="px-4 py-3">Tuần</th>
                <th className="px-4 py-3">Mục tiêu</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Ngày tạo</th>
                <th className="px-4 py-3 text-right">Xem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.title}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                    {fmtDate(r.week_start)} → {fmtDate(r.week_end)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.goal ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {RECOMMENDATION_STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/ai-planner/${r.id}`} className="text-xs font-medium text-blue-600 hover:underline">
                      Chi tiết →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
