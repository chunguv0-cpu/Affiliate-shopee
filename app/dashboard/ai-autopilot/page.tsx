import Link from "next/link";

import CampaignRunActions from "@/components/dashboard/autopilot/CampaignRunActions";
import NewCampaignForm from "@/components/dashboard/autopilot/NewCampaignForm";
import { getCampaignFormOptions, getCampaignRuns } from "@/app/dashboard/ai-autopilot/actions";
import { CAMPAIGN_RUN_STATUS_LABELS, type CampaignRunStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const TIMELINE: { label: string; statuses: CampaignRunStatus[] }[] = [
  { label: "1. AI gợi ý", statuses: ["DRAFT", "AI_PLANNING", "WAITING_APPROVAL"] },
  { label: "2. Chờ duyệt chiến dịch", statuses: ["WAITING_APPROVAL"] },
  { label: "3. Tìm sản phẩm", statuses: ["APPROVED", "SOURCING_PRODUCTS"] },
  { label: "4. Chuyển link", statuses: ["CONVERTING_LINKS"] },
  { label: "5. Tạo sản phẩm", statuses: ["CREATING_PRODUCTS"] },
  { label: "6. Tạo bài + ảnh", statuses: ["CREATING_POSTS", "CREATING_CREATIVES"] },
  { label: "7. Chờ duyệt bài", statuses: ["WAITING_POST_REVIEW"] },
  { label: "8. Xếp lịch", statuses: ["SCHEDULING"] },
  { label: "9. Đăng bài", statuses: ["SCHEDULED", "RUNNING"] },
  { label: "10. Hiệu quả", statuses: ["COMPLETED"] },
];

const ORDER: CampaignRunStatus[] = [
  "DRAFT",
  "AI_PLANNING",
  "WAITING_APPROVAL",
  "APPROVED",
  "SOURCING_PRODUCTS",
  "CONVERTING_LINKS",
  "CREATING_PRODUCTS",
  "CREATING_POSTS",
  "CREATING_CREATIVES",
  "WAITING_POST_REVIEW",
  "SCHEDULING",
  "SCHEDULED",
  "RUNNING",
  "COMPLETED",
];

const CRON_ACTIVE_STATUSES: CampaignRunStatus[] = [
  "APPROVED",
  "SOURCING_PRODUCTS",
  "CONVERTING_LINKS",
  "CREATING_PRODUCTS",
  "CREATING_POSTS",
  "CREATING_CREATIVES",
  "SCHEDULING",
  "SCHEDULED",
  "RUNNING",
];

function statusRank(s: CampaignRunStatus): number {
  const i = ORDER.indexOf(s);
  return i === -1 ? 0 : i;
}

function statusBadge(s: CampaignRunStatus): string {
  if (s === "COMPLETED") return "bg-emerald-100 text-emerald-700";
  if (s === "FAILED") return "bg-red-100 text-red-700";
  if (s === "WAITING_APPROVAL") return "bg-amber-100 text-amber-700";
  if (s === "WAITING_POST_REVIEW") return "bg-purple-100 text-purple-700";
  if (s === "PAUSED") return "bg-gray-200 text-gray-700";
  return "bg-blue-100 text-blue-700";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Chưa có";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Không rõ";
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function compactJson(value: unknown): string {
  if (!value) return "Chưa có";
  try {
    return JSON.stringify(value).slice(0, 360);
  } catch {
    return "Không đọc được";
  }
}

export default async function AiAutopilotPage() {
  const [runs, formOptions] = await Promise.all([getCampaignRuns(), getCampaignFormOptions()]);
  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const activeForCron = runs
    .map((x) => x.run)
    .filter((r) => CRON_ACTIVE_STATUSES.includes(r.status) && !r.paused && r.is_autopilot_enabled);
  const lastAutoRun =
    activeForCron
      .map((r) => r.last_auto_run_at)
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .sort()
      .at(-1) ?? null;
  const lastCronHit =
    activeForCron
      .map((r) => r.last_cron_hit_at)
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .sort()
      .at(-1) ?? null;
  const nextAutoRun =
    activeForCron
      .map((r) => r.next_auto_run_at)
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .sort()[0] ?? null;
  const nowMs = Date.now();
  const lastCronMs = lastCronHit ? new Date(lastCronHit).getTime() : NaN;
  const hasRecentCronHit = Number.isFinite(lastCronMs) && nowMs - lastCronMs <= 5 * 60 * 1000;
  const hasDueCampaign = activeForCron.some((r) => {
    const nextMs = r.next_auto_run_at ? new Date(r.next_auto_run_at).getTime() : NaN;
    return !Number.isFinite(nextMs) || nextMs <= nowMs;
  });
  const cronStale = activeForCron.length > 0 && hasDueCampaign && !hasRecentCronHit;
  const totalCronRuns = activeForCron.reduce((sum, r) => sum + r.cron_run_count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">🤖 AI Autopilot</h1>
        <p className="mt-1 text-sm text-gray-500">
          Quy trình tự động: Gợi ý AI → Duyệt chiến dịch → Tự tìm sản phẩm → Chuyển link → Tạo sản phẩm → Tạo bài + ảnh →{" "}
          <Link href="/dashboard/review" className="text-blue-600 underline">
            Chờ duyệt bài
          </Link>{" "}
          → Xếp lịch → Tự đăng → Hiệu quả. Xử lý theo <strong>batch nhỏ</strong>, tránh timeout & tiết kiệm V98.
        </p>
      </div>

      <NewCampaignForm
        shopeeAccounts={formOptions.shopeeAccounts}
        facebookPages={formOptions.facebookPages}
        verticals={formOptions.verticals}
      />

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Chẩn đoán Autopilot</h2>
            <p className="mt-1 text-xs text-gray-500">Endpoint cron: <code>/api/cron/run-ai-autopilot</code></p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cronConfigured ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            CRON_SECRET: {cronConfigured ? "đã cấu hình" : "chưa cấu hình"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Counter label="Đang chờ cron" value={activeForCron.length} />
          <Counter label="Cron đã gọi" value={totalCronRuns} />
          <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
            <div className="text-xs font-semibold text-gray-900">{formatDateTime(lastCronHit)}</div>
            <div className="text-[10px] text-gray-500">Cron hit thật gần nhất</div>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
            <div className="text-xs font-semibold text-gray-900">{formatDateTime(lastAutoRun)}</div>
            <div className="text-[10px] text-gray-500">Autopilot run gần nhất</div>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
            <div className="text-xs font-semibold text-gray-900">{formatDateTime(nextAutoRun)}</div>
            <div className="text-[10px] text-gray-500">Next planned run</div>
          </div>
        </div>
        {cronStale ? (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Chưa thấy cron thật sự gọi endpoint. Next auto run chỉ là thời gian dự kiến, không phải cron đang chạy. Hãy cấu hình cron-job.org hoặc Vercel Cron gọi /api/cron/run-ai-autopilot mỗi phút.
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Chiến dịch ({runs.length})</h2>
        {runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            Chưa có chiến dịch. Tạo gợi ý đầu tiên ở trên.
          </p>
        ) : null}

        {runs.map(({ run, counters }) => {
          const rank = statusRank(run.status);
          const acceptedFromDiagnostics = run.sourcing_diagnostics.reduce((sum, d) => sum + d.accepted_count, 0);
          const rejectedFromDiagnostics = run.sourcing_diagnostics.reduce((sum, d) => sum + d.rejected_count, 0);
          const lastCronMsForRun = run.last_cron_hit_at ? new Date(run.last_cron_hit_at).getTime() : NaN;
          const nextAutoMsForRun = run.next_auto_run_at ? new Date(run.next_auto_run_at).getTime() : NaN;
          const runWaitingForNextCron =
            CRON_ACTIVE_STATUSES.includes(run.status) &&
            run.is_autopilot_enabled &&
            !run.paused &&
            Number.isFinite(lastCronMsForRun) &&
            Number.isFinite(nextAutoMsForRun) &&
            nextAutoMsForRun > nowMs;
          const runWaitingForTurn =
            CRON_ACTIVE_STATUSES.includes(run.status) &&
            run.is_autopilot_enabled &&
            !run.paused &&
            !runWaitingForNextCron &&
            hasRecentCronHit &&
            (!Number.isFinite(lastCronMsForRun) || nowMs - lastCronMsForRun > 5 * 60 * 1000);
          const runCronStale =
            CRON_ACTIVE_STATUSES.includes(run.status) &&
            run.is_autopilot_enabled &&
            !run.paused &&
            !runWaitingForNextCron &&
            !runWaitingForTurn &&
            (!Number.isFinite(lastCronMsForRun) || nowMs - lastCronMsForRun > 5 * 60 * 1000);
          return (
            <div key={run.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{run.title ?? "Chiến dịch"}</h3>
                  <p className="mt-0.5 text-xs text-gray-500">{run.objective}</p>
                  {run.current_step ? <p className="mt-0.5 text-[11px] text-gray-400">Bước hiện tại: {run.current_step}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {run.user_keyword ? <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">Từ khóa: {run.user_keyword}</span> : null}
                    {run.locked_vertical ? (
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                        Ngành: {run.locked_vertical}{run.vertical_confidence != null ? ` (${Math.round(run.vertical_confidence * 100)}%)` : ""}{run.keyword_lock_enabled ? " 🔒" : ""}
                      </span>
                    ) : null}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">Shopee: {run.shopee_account_id ? "đã chọn" : "mặc định"}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">Page: {run.facebook_page_id ? "đã chọn" : "mặc định/env"}</span>
                  </div>
                  {run.needs_clarification && run.clarification_question ? (
                    <p className="mt-1 rounded bg-orange-50 px-2 py-1 text-[11px] text-orange-700">⚠️ {run.clarification_question}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {run.paused ? <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">Tạm dừng</span> : null}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(run.status)}`}>
                    {CAMPAIGN_RUN_STATUS_LABELS[run.status]}
                  </span>
                </div>
              </div>

              {/* Timeline */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {TIMELINE.map((step) => {
                  const stepRank = Math.min(...step.statuses.map(statusRank));
                  const done = rank > stepRank;
                  const active = step.statuses.includes(run.status);
                  return (
                    <span
                      key={step.label}
                      className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                        active ? "bg-blue-600 text-white" : done ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  );
                })}
              </div>

              {/* Counters */}
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-12">
                <Counter label="Cơ hội" value={counters.opportunities} />
                <Counter label="Nhận" value={acceptedFromDiagnostics} />
                <Counter label="Loại" value={rejectedFromDiagnostics} />
                <Counter label="Đã tìm" value={counters.sourced} />
                <Counter label="Có link" value={counters.linksConverted} />
                <Counter label="Sản phẩm" value={counters.productsCreated} />
                <Counter label="Bài" value={counters.postsCreated} />
                <Counter label="Ảnh xong" value={counters.creativesReady} />
                <Counter label="Chờ duyệt" value={counters.postsWaitingReview} />
                <Counter label="Đã duyệt" value={counters.postsApproved} />
                <Counter label="Đã lịch" value={counters.postsScheduled} />
                <Counter label="Đã đăng" value={counters.postsPublished} />
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                  V98 hôm nay: {counters.v98Today ?? 0}{counters.v98PerDayLimit ? `/${counters.v98PerDayLimit}` : ""}
                </span>
                <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">Job đang chờ: {counters.jobsPending ?? 0}</span>
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">Job xong: {counters.jobsDone ?? 0}</span>
                {(counters.v98PerDayLimit ?? 0) > 0 && (counters.v98Today ?? 0) >= (counters.v98PerDayLimit ?? 0) ? (
                  <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">Đã đạt giới hạn V98 hôm nay</span>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-500 sm:grid-cols-3">
                <div>Autopilot: {run.is_autopilot_enabled && !run.paused ? "Đang bật" : "Tạm dừng"}</div>
                <div>Last cron hit: {formatDateTime(run.last_cron_hit_at)}</div>
                <div>Cron run count: {run.cron_run_count}</div>
                <div>Last auto run: {formatDateTime(run.last_auto_run_at)}</div>
                <div>Next auto run: {formatDateTime(run.next_auto_run_at)}</div>
                <div>Last cron result: {compactJson(run.last_cron_result)}</div>
              </div>

              {runCronStale ? (
                <p className="mt-2 rounded-md bg-orange-50 px-3 py-2 text-xs text-orange-700">
                  Cron chưa chạy thật. Hãy cấu hình cron-job.org hoặc Vercel Cron gọi /api/cron/run-ai-autopilot mỗi phút.
                </p>
              ) : null}

              {runWaitingForNextCron ? (
                <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  Cron da chay va dang cho batch tiep theo o moc Next auto run.
                </p>
              ) : null}

              {runWaitingForTurn ? (
                <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  Cron dang chay. Chien dich nay dang cho toi luot batch tiep theo.
                </p>
              ) : null}

              {run.error_message || run.automation_error ? (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{run.error_message ?? run.automation_error}</p>
              ) : null}

              {run.sourcing_diagnostics.length > 0 ? (
                <details className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-gray-600">
                    Chẩn đoán tìm sản phẩm ({run.sourcing_diagnostics.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {run.sourcing_diagnostics.slice(-12).map((d, i) => {
                      const reasons = Object.entries(d.rejection_reasons);
                      return (
                        <div key={`${d.opportunity_index}-${i}`} className="rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-600">
                          <div className="font-medium text-gray-800">{d.product_keyword}</div>
                          {d.queries.length > 0 ? <div className="text-gray-500">Query: {d.queries.slice(0, 5).join(" · ")}</div> : null}
                          <div>
                            Raw {d.raw_count} · Nhận {d.accepted_count} · Loại {d.rejected_count}
                            {reasons.length > 0 ? ` (${reasons.map(([k, v]) => `${k}:${v}`).join(", ")})` : ""}
                          </div>
                          {d.top_accepted.length > 0 ? <div className="text-emerald-700">Nhận: {d.top_accepted.join("; ")}</div> : null}
                          {d.top_rejected_examples.length > 0 ? <div className="text-rose-600">Loại: {d.top_rejected_examples.join("; ")}</div> : null}
                          {d.negative_keyword_hits && d.negative_keyword_hits.length > 0 ? <div className="text-red-700">Từ khóa loại: {d.negative_keyword_hits.join(", ")}</div> : null}
                          <div className="text-gray-500">{d.message}</div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ) : null}

              {/* Opportunities preview when waiting approval */}
              {run.status === "WAITING_APPROVAL" && run.product_opportunities.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-gray-600">Cơ hội sản phẩm AI đề xuất:</p>
                  <ul className="space-y-1">
                    {run.product_opportunities.slice(0, 8).map((opp, i) => (
                      <li key={i} className="text-xs text-gray-600">
                        • <strong>{opp.product_keyword}</strong>
                        {opp.category ? ` · ${opp.category}` : ""}
                        {opp.suggested_price_range ? ` · ${opp.suggested_price_range}` : ""}
                        {opp.priority ? ` · ưu tiên ${opp.priority}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <CampaignRunActions runId={run.id} status={run.status} paused={run.paused} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5 text-center">
      <div className="text-sm font-semibold text-gray-900">{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}
