import Link from "next/link";
import { notFound } from "next/navigation";

import AiPlannerStatusPoller from "@/components/dashboard/AiPlannerStatusPoller";
import PageHeader from "@/components/dashboard/PageHeader";
import RecommendationStatusButtons from "@/components/dashboard/RecommendationStatusButtons";
import {
  getCampaignRecommendationById,
  getResearchRun,
  getResearchSources,
} from "@/app/dashboard/ai-planner/actions";
import { normalizeCampaignPlan } from "@/lib/ai/normalize-campaign-plan";
import { PLANNER_MODE_LABELS, type PlannerMode } from "@/lib/types";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-base font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}
function Bullets({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <p className="text-sm text-gray-400">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
      {items.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  );
}

const PRIORITY_STYLE: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700",
  MEDIUM: "bg-amber-50 text-amber-700",
  LOW: "bg-gray-100 text-gray-600",
};
const DECISION_STYLE: Record<string, string> = {
  PUSH: "bg-green-50 text-green-700",
  TEST: "bg-amber-50 text-amber-700",
  HOLD: "bg-gray-100 text-gray-600",
  AVOID: "bg-red-50 text-red-700",
};

export default async function RecommendationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rec = await getCampaignRecommendationById(id);
  if (!rec) notFound();

  const backLink = (
    <Link href="/dashboard/ai-planner" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
      ← Danh sách
    </Link>
  );

  // RUNNING — đang chạy, không render plan.
  if (rec.status === "RUNNING") {
    return (
      <div>
        <PageHeader title={rec.title || "Đang lập kế hoạch"} description="AI đang xử lý — vui lòng đợi." action={backLink} />
        <AiPlannerStatusPoller id={rec.id} status={rec.status} createdAt={rec.created_at ?? null} />
      </div>
    );
  }

  // FAILED — hiện lỗi rõ ràng, không crash.
  if (rec.status === "FAILED") {
    return (
      <div>
        <PageHeader title={rec.title || "Kế hoạch thất bại"} description="Tạo kế hoạch không thành công." action={backLink} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <p className="font-semibold">Kế hoạch AI tạo thất bại.</p>
          {rec.error_message ? <p className="mt-1 whitespace-pre-wrap">{rec.error_message}</p> : null}
          <p className="mt-3 text-red-600">
            Hãy thử <Link href="/dashboard/ai-planner" className="underline">tạo lại</Link> (có thể chọn mức chi tiết thấp hơn hoặc tắt nghiên cứu thị trường).
          </p>
        </div>
      </div>
    );
  }

  // SUCCESS/DRAFT/... — chuẩn hóa an toàn trước khi render.
  const plan = normalizeCampaignPlan(rec);
  const qw = Array.isArray(rec.quality_warnings) ? (rec.quality_warnings as string[]) : [];
  const sources = rec.research_run_id ? await getResearchSources(rec.research_run_id) : [];
  const runMeta = rec.research_run_id ? await getResearchRun(rec.research_run_id) : null;

  const isStrategic =
    Boolean(plan.executive_summary) ||
    plan.product_decision_table.length > 0 ||
    plan.weekly_execution_plan.length > 0;

  const gs = plan.goal_strategy;
  const md = plan.market_diagnosis;
  const idd = plan.internal_data_diagnosis;
  const es = plan.engagement_system;
  const cb = plan.creative_brief;
  const mp = plan.measurement_plan;
  const pd = plan.product_discovery_strategy;
  const plannerMode: PlannerMode = (rec.planner_mode as PlannerMode) ?? plan.planner_mode ?? "HYBRID";
  const hasDiscovery =
    pd.new_product_opportunities.length > 0 ||
    pd.recommended_categories.length > 0 ||
    Boolean(pd.discovery_summary);

  return (
    <div>
      <PageHeader
        title={rec.title}
        description="Gợi ý chiến lược do AI tạo — duyệt hoặc từ chối. Phase này chưa tự tạo campaign thật."
        action={backLink}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          🧭 Chế độ: {PLANNER_MODE_LABELS[plannerMode]}
        </span>
        {rec.research_run_id ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            🔍 Có nghiên cứu thị trường · provider: {runMeta?.provider ?? "—"} · {runMeta?.query_count ?? 0} query · {sources.length} nguồn
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
            Không dùng nghiên cứu thị trường
          </span>
        )}
      </div>

      {qw.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Kế hoạch cần kiểm tra thêm:</strong>
          <ul className="mt-1 list-disc pl-5">{qw.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      ) : null}

      <div className="space-y-6">
        <Section title="Chiến lược tổng quan">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-gray-400">Mục tiêu</dt><dd className="font-medium text-gray-800">{rec.goal ?? "—"}</dd></div>
            <div><dt className="text-gray-400">Tuần chạy</dt><dd className="font-medium text-gray-800">{rec.week_start ?? "—"} → {rec.week_end ?? "—"}</dd></div>
          </dl>
          {plan.executive_summary ? <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{plan.executive_summary}</p> : null}
          {isStrategic ? (
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-sm">
              {gs.main_strategy ? <p><span className="text-gray-400">Chiến lược chính: </span>{gs.main_strategy}</p> : null}
              {gs.why_this_strategy ? <p><span className="text-gray-400">Vì sao: </span>{gs.why_this_strategy}</p> : null}
              {gs.funnel_logic ? <p><span className="text-gray-400">Phễu: </span>{gs.funnel_logic}</p> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase text-green-600">Nên làm</p><Bullets items={gs.do} /></div>
                <div><p className="text-xs font-semibold uppercase text-red-600">Tránh</p><Bullets items={gs.avoid} /></div>
              </div>
            </div>
          ) : null}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <RecommendationStatusButtons id={rec.id} status={rec.status} />
          </div>
        </Section>

        {!isStrategic ? (
          <Section title="Nội dung gợi ý">
            <p className="text-sm text-gray-500">
              Gợi ý này được tạo ở bản cũ (chưa có chiến lược chi tiết). Hãy tạo gợi ý mới để xem đầy đủ các block.
            </p>
          </Section>
        ) : (
          <>
            {hasDiscovery ? (
              <>
                <Section title="Chiến lược tìm sản phẩm mới">
                  <div className="mb-3 inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                    Chế độ: {PLANNER_MODE_LABELS[plannerMode]}
                  </div>
                  {pd.discovery_summary ? <p className="text-sm text-gray-700">{pd.discovery_summary}</p> : null}
                  {pd.recommended_categories.length > 0 ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {pd.recommended_categories.map((c, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-gray-900">{c.category}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[c.purchase_intent] ?? "bg-gray-100 text-gray-600"}`}>Ý định mua: {c.purchase_intent}</span>
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">Nội dung: {c.content_potential}</span>
                          </div>
                          {c.why_now ? <p className="mt-1 text-sm text-gray-600"><span className="text-gray-400">Vì sao lúc này: </span>{c.why_now}</p> : null}
                          {c.target_customer ? <p className="mt-0.5 text-xs text-gray-500">Khách: {c.target_customer}</p> : null}
                          {c.risk ? <p className="mt-0.5 text-xs text-amber-700">Rủi ro: {c.risk}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Section>

                {pd.new_product_opportunities.length > 0 ? (
                  <Section title={`Sản phẩm mới nên tìm link affiliate (${pd.new_product_opportunities.length})`}>
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Các sản phẩm này <strong>chưa có link affiliate</strong>. Cần tìm và import link trước khi tạo campaign thật.
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {pd.new_product_opportunities.map((op, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-gray-900">{op.suggested_product}</span>
                            {op.category ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{op.category}</span> : null}
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[op.priority] ?? "bg-gray-100 text-gray-600"}`}>{op.priority}</span>
                            {op.confidence ? <span className="text-xs text-gray-400">tin cậy: {op.confidence}</span> : null}
                          </div>
                          {op.reason ? <p className="mt-1 text-sm text-gray-600">{op.reason}</p> : null}
                          <dl className="mt-1 space-y-0.5 text-xs text-gray-500">
                            {op.target_customer ? <div>👤 Khách: {op.target_customer}</div> : null}
                            {op.pain_point ? <div>❗ Nỗi đau: {op.pain_point}</div> : null}
                            {op.suggested_price_band ? <div>💰 Khoảng giá: {op.suggested_price_band}</div> : null}
                            {op.content_angle ? <div>✍️ Góc viết: {op.content_angle}</div> : null}
                            {op.first_post_hook ? <div className="text-gray-700">🪝 Hook: “{op.first_post_hook}”</div> : null}
                            {op.cta ? <div>📣 CTA: {op.cta}</div> : null}
                          </dl>
                          {op.suggested_search_keywords.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {op.suggested_search_keywords.map((k, j) => (
                                <a key={j} href={`https://shopee.vn/search?keyword=${encodeURIComponent(k)}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:underline">🔎 {k}</a>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </Section>
                ) : null}

                {pd.sourcing_plan.length > 0 ? (
                  <Section title="Kế hoạch tìm nguồn (sourcing plan)">
                    <ol className="space-y-2 text-sm text-gray-700">
                      {pd.sourcing_plan.map((st, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">{i + 1}</span>
                          <span><strong>{st.step}</strong>{st.detail ? <span className="text-gray-600"> — {st.detail}</span> : null}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Các sản phẩm này chưa có link affiliate. Cần tìm và import link trước khi tạo campaign thật.
                    </div>
                  </Section>
                ) : null}
              </>
            ) : null}

            {plannerMode === "DISCOVERY_ONLY" ? null : (
            <>
            <Section title="Chẩn đoán thị trường">
              {md.summary ? <p className="text-sm text-gray-700">{md.summary}</p> : null}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase text-gray-400">Pain points</p><Bullets items={md.customer_pain_points} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Purchase triggers</p><Bullets items={md.purchase_triggers} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Content patterns</p><Bullets items={md.content_patterns} /></div>
              </div>
              {md.source_based_insights.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-gray-700">
                  {md.source_based_insights.map((x, i) => (
                    <li key={i}>• <strong>{x.insight}</strong> <span className="text-xs text-gray-400">({x.confidence}{x.evidence ? ` · ${x.evidence}` : ""})</span></li>
                  ))}
                </ul>
              ) : null}
            </Section>

            <Section title="Chẩn đoán dữ liệu nội bộ">
              <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">{idd.data_quality}</span>
              {idd.summary ? <p className="mt-2 text-sm text-gray-700">{idd.summary}</p> : null}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div><p className="text-xs font-semibold uppercase text-gray-400">Đã biết</p><Bullets items={idd.what_we_know} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Chưa biết</p><Bullets items={idd.what_we_do_not_know} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Giả thuyết test</p><Bullets items={idd.testing_assumption} /></div>
              </div>
            </Section>

            {plan.product_decision_table.length > 0 ? (
              <Section title="Bảng quyết định sản phẩm">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2">Quyết định</th><th className="px-3 py-2">Ưu tiên</th>
                        <th className="px-3 py-2">Vai trò</th><th className="px-3 py-2">Lý do</th><th className="px-3 py-2">Angle</th>
                        <th className="px-3 py-2">CTA</th><th className="px-3 py-2">Rủi ro</th><th className="px-3 py-2">Tin cậy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {plan.product_decision_table.map((d, i) => (
                        <tr key={i} className="align-top">
                          <td className="px-3 py-2 font-medium text-gray-900">{d.product_name}</td>
                          <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_STYLE[d.decision] ?? "bg-gray-100 text-gray-600"}`}>{d.decision}</span></td>
                          <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[d.priority] ?? "bg-gray-100 text-gray-600"}`}>{d.priority}</span></td>
                          <td className="px-3 py-2 text-gray-600">{d.role}</td>
                          <td className="px-3 py-2 text-gray-600">{d.reason}</td>
                          <td className="px-3 py-2 text-gray-600">{d.best_angle}</td>
                          <td className="px-3 py-2 text-gray-600">{d.best_cta}</td>
                          <td className="px-3 py-2 text-amber-700">{d.risk}</td>
                          <td className="px-3 py-2 text-gray-500">{d.confidence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            ) : null}

            {plan.products_to_source.length > 0 ? (
              <Section title="Sản phẩm nên đi tìm link affiliate">
                <p className="mb-3 text-xs text-gray-400">Gợi ý từ research — chưa có trong kho. Bấm để tìm trên Shopee, chuyển link affiliate rồi import.</p>
                <div className="space-y-3">
                  {plan.products_to_source.map((s, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{s.suggested_product}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[s.priority] ?? "bg-gray-100 text-gray-600"}`}>{s.priority}</span>
                      </div>
                      {s.reason ? <p className="mt-1 text-sm text-gray-600">{s.reason}</p> : null}
                      {s.target_customer ? <p className="mt-1 text-xs text-gray-500">Khách: {s.target_customer} · Angle: {s.content_angle}</p> : null}
                      {s.suggested_search_keywords.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {s.suggested_search_keywords.map((k, j) => (
                            <a key={j} href={`https://shopee.vn/search?keyword=${encodeURIComponent(k)}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:underline">🔎 {k}</a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {plan.weekly_execution_plan.length > 0 ? (
              <Section title="Kế hoạch đăng 7 ngày">
                <div className="space-y-4">
                  {plan.weekly_execution_plan.map((d, i) => (
                    <div key={i} className="rounded-lg border border-gray-200">
                      <div className="border-b border-gray-100 bg-gray-50/60 px-3 py-2">
                        <span className="font-medium text-gray-900">{d.day}</span>
                        {d.theme ? <span className="ml-2 text-xs text-gray-500">· {d.theme}</span> : null}
                      </div>
                      <div className="divide-y divide-gray-100">
                        {d.posts.map((p, j) => (
                          <div key={j} className="px-3 py-2 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">{p.time}</span>
                              <span className="font-medium text-gray-900">{p.product_name}</span>
                              {p.post_type ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{p.post_type}</span> : null}
                              {p.objective ? <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">{p.objective}</span> : null}
                              {p.angle ? <span className="text-xs text-gray-400">angle: {p.angle}</span> : null}
                            </div>
                            {p.hook ? <p className="mt-1 text-gray-800"><span className="text-gray-400">Hook: </span>“{p.hook}”</p> : null}
                            {p.body_direction ? <p className="mt-0.5 text-gray-600"><span className="text-gray-400">Nội dung: </span>{p.body_direction}</p> : null}
                            {p.cta ? <p className="mt-0.5 text-gray-600"><span className="text-gray-400">CTA: </span>{p.cta}</p> : null}
                            {p.comment_prompt ? <p className="mt-0.5 text-gray-500"><span className="text-gray-400">Comment: </span>{p.comment_prompt}</p> : null}
                            {p.save_share_trigger ? <p className="mt-0.5 text-gray-500"><span className="text-gray-400">Lưu/share: </span>{p.save_share_trigger}</p> : null}
                            {p.why_this_post ? <p className="mt-0.5 text-xs text-gray-400">Vì sao: {p.why_this_post}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title="Hệ thống tăng tương tác">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase text-gray-400">Câu hỏi kéo comment</p><Bullets items={es.comment_baits_safe} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Lý do lưu bài</p><Bullets items={es.save_triggers} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Tạo niềm tin</p><Bullets items={es.trust_builders} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Tăng ý định mua</p><Bullets items={es.conversion_boosters} /></div>
              </div>
            </Section>

            <Section title="Creative brief">
              {cb.tone ? <p className="mb-2 text-sm text-gray-700"><span className="text-gray-400">Tone: </span>{cb.tone}</p> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase text-gray-400">Hình ảnh</p><Bullets items={cb.visual_direction} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Quy tắc viết</p><Bullets items={cb.copywriting_rules} /></div>
              </div>
            </Section>

            <Section title="Kế hoạch đo lường">
              <p className="text-sm text-gray-700"><span className="text-gray-400">Chỉ số chính: </span><strong>{mp.primary_metric || "—"}</strong></p>
              {mp.success_threshold ? <p className="mt-1 text-sm text-gray-600"><span className="text-gray-400">Ngưỡng đạt: </span>{mp.success_threshold}</p> : null}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase text-gray-400">Chỉ số phụ</p><Bullets items={mp.secondary_metrics} /></div>
                <div><p className="text-xs font-semibold uppercase text-gray-400">Kiểm tra sau 7 ngày</p><Bullets items={mp.what_to_check_after_7_days} /></div>
              </div>
            </Section>
            </>
            )}

            <Section title="Rủi ro & việc cần làm tiếp">
              <p className="text-xs font-semibold uppercase text-gray-400">Rủi ro / kiểm soát</p>
              <Bullets items={plan.risks_and_controls} />
              <p className="mt-3 text-xs font-semibold uppercase text-gray-400">Next actions</p>
              <Bullets items={plan.next_actions} />
            </Section>
          </>
        )}

        {sources.length > 0 ? (
          <Section title="Nguồn tham khảo">
            <ul className="space-y-2 text-sm">
              {sources.map((s, i) => (
                <li key={i} className="border-b border-gray-100 pb-2 last:border-0">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">{s.title || s.url}</a>
                  ) : (
                    <span className="font-medium text-gray-800">{s.title || "—"}</span>
                  )}
                  {s.snippet ? <p className="mt-0.5 text-xs text-gray-500">{s.snippet}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
