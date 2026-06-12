import Link from "next/link";

import JobQueueActions from "@/components/dashboard/JobQueueActions";
import PageHeader from "@/components/dashboard/PageHeader";
import { getAiJobsQueue } from "@/app/dashboard/jobs/actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  RUNNING: "bg-blue-50 text-blue-700",
  WAITING_RETRY: "bg-amber-50 text-amber-700",
  SUCCESS: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  } catch {
    return iso;
  }
}

export default async function JobsQueuePage() {
  const { counts, jobs } = await getAiJobsQueue(120);
  const Stat = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-center">
      <div className={`text-lg font-semibold ${tone ?? "text-gray-900"}`}>{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Hàng đợi AI Jobs" description="Theo dõi & điều khiển job tạo bài + ảnh AI. Mở khóa job kẹt mà không gọi lại V98 cho ảnh đã xong." />

      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-7">
        <Stat label="Tổng" value={counts.total} />
        <Stat label="Chờ" value={counts.pending} />
        <Stat label="Đang chạy" value={counts.running} tone="text-blue-700" />
        <Stat label="Chờ retry" value={counts.waiting_retry} tone="text-amber-700" />
        <Stat label="Xong" value={counts.success} tone="text-emerald-700" />
        <Stat label="Lỗi" value={counts.failed} tone="text-red-700" />
        <Stat label="Kẹt" value={counts.stuck} tone="text-orange-700" />
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">Chưa có job nào.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2">Bước</th>
                <th className="px-3 py-2">Tiến độ</th>
                <th className="px-3 py-2">Lần thử</th>
                <th className="px-3 py-2">Chiến dịch</th>
                <th className="px-3 py-2">Cập nhật</th>
                <th className="px-3 py-2">Lỗi</th>
                <th className="px-3 py-2">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status] ?? "bg-gray-100 text-gray-600"}`}>{j.status}</span>
                    {j.stuck ? <span className="ml-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">KẸT</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">{j.step ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{j.progress_current}/{j.progress_total}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{j.attempts}/{j.max_attempts}</td>
                  <td className="px-3 py-2 text-xs">
                    {j.ai_campaign_run_id ? <Link href="/dashboard/ai-autopilot" className="text-blue-600 hover:underline">autopilot</Link> : <span className="text-gray-400">thủ công</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[11px] text-gray-500">{fmt(j.updated_at)}</td>
                  <td className="px-3 py-2 text-[11px] text-red-600">{j.error_message ? j.error_message.slice(0, 120) : "—"}</td>
                  <td className="px-3 py-2"><JobQueueActions jobId={j.id} status={j.status} stuck={j.stuck} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
