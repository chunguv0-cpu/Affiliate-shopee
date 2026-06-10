import Link from "next/link";
import { notFound } from "next/navigation";

import PageHeader from "@/components/dashboard/PageHeader";
import RecommendationStatusButtons from "@/components/dashboard/RecommendationStatusButtons";
import {
  getCampaignRecommendationById,
  getResearchRun,
  getResearchSources,
} from "@/app/dashboard/ai-planner/actions";
import type {
  CampaignConcept,
  CreativeItem,
  InteractionItem,
  RecAngle,
  RecHook,
  RecProduct,
  RecScheduleItem,
  SuggestedProduct,
} from "@/lib/ai/campaign-planner";
import type { MarketResearchInsights } from "@/lib/research/research-summarizer";

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
  const interaction = arr<InteractionItem>(rec.interaction_plan);
  const creative = arr<CreativeItem>(rec.creative_directions);
  const suggested = arr<SuggestedProduct>(rec.suggested_new_products);
  const concept = (rec.campaign_concept ?? null) as CampaignConcept | null;
  const mr = (rec.market_research ?? null) as MarketResearchInsights | null;
  const sources = rec.research_run_id ? await getResearchSources(rec.research_run_id) : [];
  const runMeta = rec.research_run_id ? await getResearchRun(rec.research_run_id) : null;

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

      {/* Badge research */}
      <div className="mb-4">
        {rec.research_run_id ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            🔍 Có nghiên cứu thị trường · provider: {runMeta?.provider ?? "—"} ·{" "}
            {runMeta?.query_count ?? 0} query · {sources.length} nguồn
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
            Không dùng nghiên cứu thị trường (chỉ dữ liệu nội bộ)
          </span>
        )}
      </div>

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
          <p className="mb-3 text-xs text-gray-400">
            Chỉ gồm sản phẩm READY trong kho của bạn — nghiên cứu thị trường định
            hướng <strong>cách đẩy</strong> (angle/hook/nhóm), không thêm sản phẩm chưa có link.
          </p>
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

        {/* Sản phẩm nên tìm thêm */}
        {suggested.length > 0 ? (
          <Section title="Sản phẩm nên tìm thêm (đi tìm link affiliate)">
            <p className="mb-3 text-xs text-gray-400">
              Gợi ý từ nghiên cứu thị trường — <strong>chưa có trong kho</strong>. Bấm để tìm trên Shopee, chuyển link affiliate rồi import.
            </p>
            <div className="space-y-3">
              {suggested.map((s, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{s.product_name}</span>
                    {s.category ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{s.category}</span> : null}
                  </div>
                  {s.reason ? <p className="mt-1 text-sm text-gray-600">{s.reason}</p> : null}
                  {s.why_now ? <p className="mt-1 text-xs text-gray-500">Vì sao tuần này: {s.why_now}</p> : null}
                  {s.search_keyword ? (
                    <a
                      href={`https://shopee.vn/search?keyword=${encodeURIComponent(s.search_keyword)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
                    >
                      🔎 Tìm “{s.search_keyword}” trên Shopee →
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

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
                    <th className="px-3 py-2">Mục tiêu</th><th className="px-3 py-2">Hook</th><th className="px-3 py-2">CTA</th><th className="px-3 py-2">Comment</th>
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
                      <td className="px-3 py-2 text-gray-500">{s.comment_prompt}</td>
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

        {/* Campaign concept */}
        {concept ? (
          <Section title="Concept chiến dịch">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-gray-400">Big idea</dt><dd className="font-medium text-gray-800">{concept.big_idea || "—"}</dd></div>
              <div><dt className="text-gray-400">Cảm xúc mục tiêu</dt><dd className="text-gray-700">{concept.target_emotion || "—"}</dd></div>
              <div><dt className="text-gray-400">Cơ chế lan tỏa</dt><dd className="text-gray-700">{concept.viral_mechanism || "—"}</dd></div>
              <div><dt className="text-gray-400">Vì sao tuần này</dt><dd className="text-gray-700">{concept.why_this_week || "—"}</dd></div>
            </dl>
          </Section>
        ) : null}

        {/* Interaction plan */}
        {interaction.length > 0 ? (
          <Section title="Kế hoạch kéo tương tác">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <tr><th className="px-3 py-2">Loại bài</th><th className="px-3 py-2">Câu hỏi/Comment</th><th className="px-3 py-2">Trigger lưu/share</th><th className="px-3 py-2">Hành vi kỳ vọng</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {interaction.map((it, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2 text-gray-700">{it.post_type}</td>
                      <td className="px-3 py-2 text-gray-600">{it.comment_prompt}</td>
                      <td className="px-3 py-2 text-gray-500">{it.save_share_trigger}</td>
                      <td className="px-3 py-2 text-gray-500">{it.expected_behavior}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        {/* Creative directions */}
        {creative.length > 0 ? (
          <Section title="Hướng sáng tạo nội dung">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {creative.map((c, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <p className="font-medium text-gray-900">{c.format}</p>
                  <p className="mt-1 text-sm text-gray-700">{c.idea}</p>
                  {c.example_copy_direction ? <p className="mt-1 text-xs text-gray-500">Gợi ý: {c.example_copy_direction}</p> : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* Research summary */}
        {mr ? (
          <Section title="Nghiên cứu thị trường">
            <p className="text-sm text-gray-700">{mr.market_summary}</p>
            {mr.customer_pain_points?.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-gray-400">Pain points của khách</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {mr.customer_pain_points.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            ) : null}
            {mr.trend_opportunities?.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-gray-400">Cơ hội / xu hướng</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {mr.trend_opportunities.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            ) : null}
            {mr.engagement_tactics?.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-gray-400">Tactic tăng tương tác</p>
                <ul className="mt-1 space-y-1 text-sm text-gray-700">
                  {mr.engagement_tactics.map((t, i) => (
                    <li key={i}>• <strong>{t.tactic}</strong>{t.example ? ` — ${t.example}` : ""}{t.risk ? ` (⚠ ${t.risk})` : ""}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {mr.content_hooks?.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-gray-400">Hook gợi ý từ research</p>
                <ul className="mt-1 space-y-1 text-sm text-gray-700">
                  {mr.content_hooks.map((h, i) => (
                    <li key={i}>• “{h.hook}”{h.best_for_product ? ` — hợp với: ${h.best_for_product}` : ""}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {mr.recommended_product_groups?.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-gray-400">Nhóm sản phẩm nên đẩy (theo research)</p>
                <ul className="mt-1 space-y-1 text-sm text-gray-700">
                  {mr.recommended_product_groups.map((g, i) => (
                    <li key={i}>• <strong>{g.group}</strong>{g.reason ? ` — ${g.reason}` : ""}{g.products?.length ? ` [${g.products.join(", ")}]` : ""}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
        ) : null}

        {/* Sources */}
        {sources.length > 0 ? (
          <Section title="Nguồn tham khảo">
            <ul className="space-y-2 text-sm">
              {sources.map((s, i) => (
                <li key={i} className="border-b border-gray-100 pb-2 last:border-0">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">
                      {s.title || s.url}
                    </a>
                  ) : (
                    <span className="font-medium text-gray-800">{s.title || "—"}</span>
                  )}
                  {s.snippet ? <p className="mt-0.5 text-xs text-gray-500">{s.snippet}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

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
