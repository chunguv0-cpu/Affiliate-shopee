import Link from "next/link";

import CampaignRunActions from "@/components/dashboard/autopilot/CampaignRunActions";
import NewCampaignForm from "@/components/dashboard/autopilot/NewCampaignForm";
import { getCampaignRuns } from "@/app/dashboard/ai-autopilot/actions";
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

export default async function AiAutopilotPage() {
  const runs = await getCampaignRuns();

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

      <NewCampaignForm />

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Chiến dịch ({runs.length})</h2>
        {runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            Chưa có chiến dịch. Tạo gợi ý đầu tiên ở trên.
          </p>
        ) : null}

        {runs.map(({ run, counters }) => {
          const rank = statusRank(run.status);
          return (
            <div key={run.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{run.title ?? "Chiến dịch"}</h3>
                  <p className="mt-0.5 text-xs text-gray-500">{run.objective}</p>
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
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
                <Counter label="Cơ hội" value={counters.opportunities} />
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

              {run.error_message ? (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{run.error_message}</p>
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
