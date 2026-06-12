import AITestPanel from "@/components/dashboard/AITestPanel";
import PageHeader from "@/components/dashboard/PageHeader";
import RepairStatesButton from "@/components/dashboard/RepairStatesButton";
import SearchTestPanel from "@/components/dashboard/SearchTestPanel";
import { getAIProvider } from "@/lib/ai/client";
import { getSearchProvider } from "@/lib/research/search-client";

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// Đảm bảo trang luôn đọc env server-side tại thời điểm chạy.
export const dynamic = "force-dynamic";

const providerLabel: Record<string, string> = {
  mock: "Mock (giả lập — chạy local không cần key)",
  v98: "V98",
  openai: "OpenAI",
};

export default function SettingsPage() {
  // Đọc AI Provider phía SERVER (an toàn, không lộ key nhạy cảm ra client).
  let aiProvider = "mock";
  let providerError: string | null = null;
  try {
    aiProvider = getAIProvider();
  } catch (err) {
    providerError = err instanceof Error ? err.message : "Lỗi cấu hình AI_PROVIDER.";
  }

  return (
    <div>
      <PageHeader
        title="Cấu hình hệ thống"
        description="Thông tin cấu hình hiện tại và công cụ kiểm tra AI Agent."
      />

      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">AI Provider</h3>
          <p className="mt-1 text-sm text-gray-500">
            Provider được đọc từ biến môi trường <code>AI_PROVIDER</code> phía
            server.
          </p>
          {providerError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {providerError}
            </div>
          ) : (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
              <span aria-hidden="true">🤖</span>
              {providerLabel[aiProvider] ?? aiProvider}
            </div>
          )}
        </div>

        {/* Khu vực kiểm tra AI Agent (Phase 3) */}
        <AITestPanel provider={aiProvider} />

        {/* Khu vực kiểm tra Search (Phase 13.1) */}
        <SearchTestPanel provider={getSearchProvider()} />

        {/* Hiệu năng + bảo trì Autopilot */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">Hiệu năng Autopilot</h3>
          <p className="mt-1 text-sm text-gray-500">
            Giá trị hiện tại (đọc từ biến môi trường). Tăng → nhanh hơn nhưng dễ tốn API/timeout; giảm → chậm hơn nhưng ổn định hơn.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[
              ["Chiến dịch / cron", "MAX_CAMPAIGNS_PER_CRON_RUN", 3],
              ["Micro-step / chiến dịch", "MAX_MICRO_STEPS_PER_CAMPAIGN_PER_RUN", 2],
              ["Tổng micro-step / cron", "MAX_TOTAL_MICRO_STEPS_PER_CRON_RUN", 8],
              ["Giây tối đa / cron", "MAX_SECONDS_PER_CRON_RUN", 45],
              ["Creative jobs / run", "MAX_CREATIVE_JOBS_STARTED_PER_RUN", 2],
              ["AI job steps / run", "MAX_AI_JOB_STEPS_PER_RUN", 4],
              ["V98 ảnh / cron", "MAX_IMAGE_CALLS_PER_CRON_RUN", 4],
              ["V98 ảnh / bài", "V98_MAX_IMAGE_CALLS_PER_POST", 2],
              ["V98 / chiến dịch / ngày", "V98_MAX_IMAGE_CALLS_PER_CAMPAIGN_PER_DAY", 20],
              ["V98 toàn hệ thống / ngày", "V98_MAX_IMAGE_CALLS_GLOBAL_PER_DAY", 80],
            ].map(([label, key, def]) => (
              <div key={key as string} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="font-semibold text-gray-900">{envNum(key as string, def as number)}</div>
                <div className="text-[11px] text-gray-500">{label as string}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">Đổi giá trị bằng biến môi trường (Vercel/host) rồi deploy lại.</p>
        </div>

        {/* Bảo trì: sửa trạng thái sai an toàn */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">Bảo trì &amp; sửa trạng thái</h3>
          <p className="mt-1 mb-3 text-sm text-gray-500">
            Tự động sửa các trạng thái sai mà KHÔNG xóa dữ liệu: mở khóa job kẹt, hạ bài chưa đủ chuẩn khỏi “Chờ duyệt”, đưa bài đủ chuẩn vào “Chờ duyệt”, gỡ chiến dịch kẹt ở “Chờ duyệt bài”.
          </p>
          <RepairStatesButton />
        </div>

        {/* Cron health */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Cron cần cấu hình (cron-job.org / Vercel Cron)</h3>
          <ul className="space-y-1 text-xs">
            <li>1. <code>GET /api/cron/run-ai-autopilot</code> — mỗi 1 phút — <code>Authorization: Bearer CRON_SECRET</code></li>
            <li>2. <code>GET /api/cron/publish-due-posts</code> — mỗi 1–5 phút — <code>Authorization: Bearer CRON_SECRET</code></li>
          </ul>
          <p className="mt-2 text-[11px] text-gray-400">Trạng thái cron thật xem ở mục AI Autopilot (cảnh báo nếu &gt; 5 phút không có lượt chạy thật).</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">
            Các khóa nhạy cảm
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Vì lý do bảo mật, các khóa như <code>SUPABASE_SERVICE_ROLE_KEY</code>,{" "}
            <code>V98_API_KEY</code>, <code>OPENAI_API_KEY</code>,{" "}
            <code>FACEBOOK_PAGE_ACCESS_TOKEN</code> chỉ được sử dụng phía server và{" "}
            <strong>không bao giờ</strong> hiển thị tại đây.
          </p>
        </div>
      </div>
    </div>
  );
}
