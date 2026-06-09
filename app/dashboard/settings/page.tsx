import AITestPanel from "@/components/dashboard/AITestPanel";
import PageHeader from "@/components/dashboard/PageHeader";
import { getAIProvider } from "@/lib/ai/client";

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
