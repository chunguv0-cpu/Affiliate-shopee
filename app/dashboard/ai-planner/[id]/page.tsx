import Link from "next/link";
import { notFound } from "next/navigation";

import PageHeader from "@/components/dashboard/PageHeader";
import RecommendationStatusButtons from "@/components/dashboard/RecommendationStatusButtons";
import { getCampaignRecommendationById } from "@/app/dashboard/ai-planner/actions";
import type {
  RecAngle,
  RecHook,
  RecProduct,
  RecScheduleItem,
} from "@/lib/ai/campaign-planner";

export const dynamic = "force-dynamic";

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-base font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}

const PRIORITY_STYLE: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700",
  MEDIUM: "bg-amber-50 text-amber-700",
  LOW: "bg-gray-100 text-gray-600",
};

export default async function RecommendationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rec = await getCampaignRecommendationById(id);
  if (!rec) notFound();

  const products = arr<RecProduct>(rec.recommended_products);
  const schedule = arr<RecScheduleItem>(rec.recommended_schedule);
  const angles = arr<RecAngle>(rec.content_angles);
  const hooks = arr<RecHook>(rec.engagement_hooks);
  const risks = arr<string>(rec.risks);

  return (
    <div>
      <PageHeader
        title={rec.title}
        description="Gợi ý chiến dịch do AI tạo — duyệt hoặc từ chối. Phase này chưa tự tạo campaign thật."
        action={
          <Link href="/dashboard/ai-planner" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            ← Danh sách
          </Link>
        }
      />

      <div className="space-y-6">
        {/* Tổng quan */}
        <Section title="Tổng quan chiến dịch">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-gray-400">Mục tiêu</dt><dd className="font-medium text-gray-800">{rec.goal ?? "—"}</dd></div>
            <div><dt className="text-gray-400">Tuần chạy</dt><dd className="font-medium text-gray-800">{rec.week_start ?? "—"} → {rec.week_end ?? "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-gray-400">Tóm tắt</dt><dd className="text-gray-700">{rec.summary ?? "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-gray-400">Chiến lược</dt><dd className="whitespace-pre-wrap text-gray-700">{rec.strategy ?? "—"}</dd></div>
          </dl>
          <div className="mt-4 border-t border-gray-100 pt-4">
            <RecommendationStatusButtons id={rec.id} status={rec.status} />
          </div>
        </Section>

        {/* Sản phẩm đề xuất */}
        <Section title="Sản phẩm AI đề xuất">
          {products.length === 0 ? (
            <p className="text-sm text-gray-500">Không có đề xuất sản phẩm.</p>
          ) : (
            <div className="space-y-3">
              {products.map((p, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{p.product_name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[p.priority] ?? "bg-gray-100 text-gray-600"}`}>{p.priority}</span>
                    {p.suggested_role ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{p.suggested_role}</span> : null}
                  </div>
                  {p.reason ? <p className="mt-1 text-sm text-gray-600">{p.reason}</p> : null}
                  {p.risk ? <p className="mt-1 text-xs text-amber-700">⚠ {p.risk}</p> : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Lịch đề xuất */}
        <Section title="Lịch đề xuất">
          {schedule.length === 0 ? (
            <p className="text-sm text-gray-500">Không có lịch đề xuất.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Giờ</th>
                    <th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2">Angle</th>
                    <th className="px-3 py-2">Mục tiêu</th><th className="px-3 py-2">Hook</th><th className="px-3 py-2">CTA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {schedule.map((s, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{s.day}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{s.time}</td>
                      <td className="px-3 py-2 text-gray-700">{s.product_name}</td>
                      <td className="px-3 py-2 text-gray-700">{s.angle}</td>
                      <td className="px-3 py-2 text-gray-500">{s.objective}</td>
                      <td className="px-3 py-2 text-gray-500">{s.hook_direction}</td>
                      <td className="px-3 py-2 text-gray-500">{s.cta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Content angles */}
        <Section title="Góc viết (content angles)">
          {angles.length === 0 ? (
            <p className="text-sm text-gray-500">—</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {angles.map((a, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <p className="font-medium text-gray-900">{a.angle} <span className="text-xs font-normal text-gray-400">· {a.purpose}</span></p>
                  <p className="mt-1 text-xs text-gray-500">Hợp với: {a.best_for}</p>
                  {a.example_hook ? <p className="mt-1 text-sm text-gray-700">“{a.example_hook}”</p> : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Engagement hooks */}
        <Section title="Hook tăng tương tác">
          {hooks.length === 0 ? (
            <p className="text-sm text-gray-500">—</p>
          ) : (
            <ul className="space-y-2">
              {hooks.map((h, i) => (
                <li key={i} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-medium uppercase text-gray-400">{h.type}</p>
                  <p className="mt-0.5 text-sm text-gray-800">“{h.hook}”</p>
                  {h.why_it_works ? <p className="mt-1 text-xs text-gray-500">{h.why_it_works}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Rủi ro */}
        <Section title="Rủi ro / cảnh báo">
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {risks.length === 0 ? (
              <li>Không bịa giá; kiểm tra sản phẩm trước khi chạy; dữ liệu ít thì chỉ là test plan.</li>
            ) : (
              risks.map((r, i) => <li key={i}>{r}</li>)
            )}
          </ul>
          {rec.ai_reasoning_summary ? (
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <strong>AI reasoning:</strong> {rec.ai_reasoning_summary}
            </p>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
