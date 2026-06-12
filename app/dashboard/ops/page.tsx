import Link from "next/link";

import PageHeader from "@/components/dashboard/PageHeader";
import { getOpsData, type OpsTask } from "@/app/dashboard/ops/actions";

export const dynamic = "force-dynamic";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const ict = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(ict.getUTCHours())}:${p(ict.getUTCMinutes())}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const ict = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(ict.getUTCDate())}/${p(ict.getUTCMonth() + 1)} ${p(ict.getUTCHours())}:${p(ict.getUTCMinutes())}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const ict = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(ict.getUTCDate())}/${p(ict.getUTCMonth() + 1)}/${ict.getUTCFullYear()}`;
}

const POST_STATUS_STYLES: Record<string, string> = {
  READY: "bg-blue-50 text-blue-700",
  PUBLISHING: "bg-amber-50 text-amber-700",
  PUBLISHED: "bg-green-50 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  REJECTED: "bg-gray-100 text-gray-600",
  DRAFT: "bg-gray-100 text-gray-600",
  SKIPPED: "bg-gray-100 text-gray-500",
};
const REC_STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  APPROVED: "bg-green-50 text-green-700",
  RUNNING: "bg-blue-50 text-blue-700",
  FAILED: "bg-red-100 text-red-700",
};
const PRIORITY_STYLES: Record<OpsTask["priority"], string> = {
  HIGH: "border-red-200 bg-red-50",
  MEDIUM: "border-amber-200 bg-amber-50",
  LOW: "border-gray-200 bg-gray-50",
};
const PRIORITY_LABEL: Record<OpsTask["priority"], string> = { HIGH: "Cao", MEDIUM: "Vừa", LOW: "Thấp" };

function Card({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? "text-gray-900"}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}
function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default async function OpsPage() {
  const data = await getOpsData();
  const { counts } = data;

  return (
    <div>
      <PageHeader
        title="Vận hành hôm nay"
        description="Tổng hợp bài đăng, campaign, sourcing và lỗi cần xử lý trong ngày."
      />

      <p className="mb-4 text-xs text-gray-400">
        Khoảng hôm nay (giờ VN): {fmtDate(data.todayStart)} · {fmtTime(data.todayStart)} → {fmtTime(data.todayEnd)}
      </p>

      {/* Overview */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card label="Bài hôm nay" value={counts.today} />
        <Card label="Sắp đăng" value={counts.upcoming} tone="text-blue-700" />
        <Card label="Đã đăng" value={counts.published} tone="text-green-700" />
        <Card label="Lỗi 24h" value={counts.failed24h} tone={counts.failed24h > 0 ? "text-red-700" : undefined} hint="cần xử lý" />
        <Card label="Cần tìm link" value={counts.needLink} tone={counts.needLink > 0 ? "text-amber-700" : undefined} />
        <Card label="Plan chờ duyệt" value={counts.draftPlans} tone={counts.draftPlans > 0 ? "text-amber-700" : undefined} />
      </div>

      <div className="space-y-6">
        {/* Việc cần làm */}
        <Section title="Việc cần làm">
          {data.tasks.length === 0 ? (
            <p className="text-sm text-gray-500">🎉 Không có việc gấp. Hệ thống đang ổn.</p>
          ) : (
            <div className="space-y-2">
              {data.tasks.map((t, i) => (
                <Link key={i} href={t.href} className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${PRIORITY_STYLES[t.priority]} hover:opacity-90`}>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{t.title}</p>
                    <p className="text-xs text-gray-600">{t.reason} · {t.action}</p>
                  </div>
                  <span className="flex-none rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-gray-700">{PRIORITY_LABEL[t.priority]}</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* Lịch đăng hôm nay */}
        <Section title="Lịch đăng hôm nay" right={<Link href="/dashboard/calendar" className="text-xs font-medium text-blue-600 hover:underline">Lịch đăng →</Link>}>
          {data.todayPosts.length === 0 ? (
            <p className="text-sm text-gray-500">Hôm nay chưa có bài nào được lên lịch.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.todayPosts.map((p) => (
                <div key={p.id} className="flex items-start gap-3 py-2">
                  <span className="mt-0.5 flex-none rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">{fmtTime(p.scheduled_at)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{p.product_name}</span>
                      {p.campaign_name ? <span className="text-xs text-gray-400">· {p.campaign_name}</span> : null}
                      {p.content_angle_variant ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{p.content_angle_variant}</span> : null}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${POST_STATUS_STYLES[p.status] ?? "bg-gray-100 text-gray-600"}`}>{p.status}</span>
                    </div>
                    {p.caption ? <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{p.caption.slice(0, 160)}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Sourcing snapshot */}
          <Section title="Sản phẩm cần tìm link" right={<Link href="/dashboard/manual-tools?tab=sourcing" className="text-xs font-medium text-blue-600 hover:underline">Tìm link →</Link>}>
            {data.sourcing.length === 0 ? (
              <p className="text-sm text-gray-500">Không có sản phẩm nào đang chờ tìm link.</p>
            ) : (
              <div className="space-y-2">
                {data.sourcing.map((c) => (
                  <div key={c.id} className="rounded-lg border border-gray-200 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{c.suggested_product}</span>
                      {c.priority ? <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">{c.priority}</span> : null}
                      {c.confidence ? <span className="text-xs text-gray-400">tin cậy: {c.confidence}</span> : null}
                    </div>
                    {c.keyword ? <p className="mt-1 text-xs text-gray-500">🔎 {c.keyword}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Campaign đang chạy */}
          <Section title="Campaign đang chạy" right={<Link href="/dashboard/campaigns" className="text-xs font-medium text-blue-600 hover:underline">Chiến dịch →</Link>}>
            {data.campaigns.length === 0 ? (
              <p className="text-sm text-gray-500">Không có campaign nào đang chạy.</p>
            ) : (
              <div className="space-y-2">
                {data.campaigns.map((c) => (
                  <div key={c.id} className="rounded-lg border border-gray-200 p-2.5">
                    <p className="text-sm font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">{fmtDate(c.start_at)} → {fmtDate(c.end_at)}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      {c.total} bài · <span className="text-blue-700">{c.ready} READY</span> · <span className="text-green-700">{c.published} đã đăng</span> · <span className="text-red-700">{c.failed} lỗi</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* AI planner snapshot */}
          <Section title="Gợi ý AI chờ xử lý" right={<Link href="/dashboard/ai-planner" className="text-xs font-medium text-blue-600 hover:underline">Gợi ý AI →</Link>}>
            {data.recommendations.length === 0 ? (
              <p className="text-sm text-gray-500">Chưa có gợi ý nào.</p>
            ) : (
              <div className="space-y-2">
                {data.recommendations.map((r) => (
                  <Link key={r.id} href={`/dashboard/ai-planner/${r.id}`} className="block rounded-lg border border-gray-200 p-2.5 hover:bg-gray-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{r.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REC_STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                      {r.stuck ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Có thể bị treo</span> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">{r.planner_mode ?? "—"} · {r.goal ?? "—"} · {fmtDateTime(r.created_at)}</p>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* Lỗi gần đây */}
          <Section title="Lỗi gần đây" right={<Link href="/dashboard/logs" className="text-xs font-medium text-blue-600 hover:underline">Logs →</Link>}>
            {data.errors.length === 0 ? (
              <p className="text-sm text-gray-500">Không có lỗi nào gần đây. 👍</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.errors.map((e) => (
                  <li key={e.id} className="border-b border-gray-100 pb-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{e.action ?? "—"}</span>
                      <span className="text-xs text-gray-400">{fmtDateTime(e.created_at)}</span>
                    </div>
                    {e.message ? <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{e.message}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
