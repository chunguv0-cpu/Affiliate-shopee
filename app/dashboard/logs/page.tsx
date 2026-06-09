import Link from "next/link";

import EmptyState from "@/components/dashboard/EmptyState";
import PageHeader from "@/components/dashboard/PageHeader";
import { getPostingLogs } from "@/app/dashboard/logs/actions";

// Luôn lấy dữ liệu mới từ database.
export const dynamic = "force-dynamic";

type LogFilter = "ALL" | "SUCCESS" | "FAILED";

/** Định dạng ngày giờ dạng dd/MM/yyyy HH:mm (tránh lệch locale). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const statusColor: Record<string, string> = {
  SUCCESS: "bg-green-50 text-green-600",
  FAILED: "bg-red-50 text-red-600",
  INFO: "bg-gray-100 text-gray-600",
};

const FILTERS: { key: LogFilter; label: string }[] = [
  { key: "ALL", label: "Tất cả" },
  { key: "SUCCESS", label: "SUCCESS" },
  { key: "FAILED", label: "FAILED" },
];

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter: LogFilter =
    sp.status === "SUCCESS" || sp.status === "FAILED" ? sp.status : "ALL";

  const result = await getPostingLogs();
  const allLogs = result.ok ? result.logs : [];
  const logs =
    filter === "ALL" ? allLogs : allLogs.filter((l) => l.status === filter);

  return (
    <div>
      <PageHeader
        title="Nhật ký hệ thống"
        description="Lịch sử các hành động: tạo caption, lên lịch, đăng Facebook, thử lại..."
      />

      {/* Filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const href =
            f.key === "ALL" ? "/dashboard/logs" : `/dashboard/logs?status=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                active
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {!result.ok ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {result.error}
        </div>
      ) : null}

      {logs.length === 0 ? (
        <EmptyState
          icon="📜"
          title="Chưa có nhật ký nào"
          description="Các hành động như tạo caption AI, đăng Facebook sẽ được ghi lại tại đây."
        />
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => (
            <li
              key={log.id}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    statusColor[log.status ?? ""] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {log.status ?? "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {log.action ?? "—"}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {log.message ?? "—"}
                  </p>
                  {log.generated_post_id ? (
                    <p className="mt-1 truncate text-xs text-gray-400">
                      Bài: {log.generated_post_id}
                    </p>
                  ) : null}
                  {log.raw_response != null ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                        Chi tiết phản hồi
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-xs text-gray-700">
                        {JSON.stringify(log.raw_response, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-gray-400">
                  {formatDateTime(log.created_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
