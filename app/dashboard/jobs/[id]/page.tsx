import Link from "next/link";
import { notFound } from "next/navigation";

import AiJobProgress from "@/components/dashboard/AiJobProgress";
import PageHeader from "@/components/dashboard/PageHeader";
import { getAiJob } from "@/app/dashboard/jobs/actions";

export const dynamic = "force-dynamic";

export default async function AiJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getAiJob(id);
  if (!view) notFound();
  const { job, productName } = view;

  return (
    <div>
      <PageHeader
        title="Tiến trình tạo bài AI"
        description="AI tạo caption + 4 ảnh theo từng bước nhỏ để tránh timeout."
        action={
          <Link href="/dashboard/products" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            ← Sản phẩm
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs uppercase text-gray-400">Loại job</p>
          <p className="font-medium text-gray-800">{job.job_type}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs uppercase text-gray-400">Sản phẩm</p>
          <p className="font-medium text-gray-800">{productName ?? "—"}</p>
        </div>
      </div>

      <AiJobProgress
        jobId={job.id}
        status={job.status}
        step={job.step}
        current={job.progress_current}
        total={job.progress_total}
      />

      {job.error_message ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Lỗi:</strong> {job.error_message}
        </div>
      ) : null}

      {(() => {
        const out = job.output && typeof job.output === "object" ? (job.output as Record<string, unknown>) : {};
        const d = out.source_diagnostics && typeof out.source_diagnostics === "object" ? (out.source_diagnostics as Record<string, unknown>) : null;
        if (!d) return null;
        const rejected = Array.isArray(d.rejectedImages) ? (d.rejectedImages as Array<{ url: string; reason: string }>) : [];
        const strategies = Array.isArray(d.strategiesTried) ? (d.strategiesTried as string[]) : [];
        const showFull = (d.validImagesCount as number) === 0 || job.status === "FAILED";
        return (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <h3 className="mb-2 text-base font-semibold text-gray-900">Chẩn đoán lấy ảnh Shopee</h3>
            <dl className="grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-2">
              <div>Link gốc: <span className="break-all text-gray-800">{String(d.originalUrl ?? "—")}</span></div>
              <div>Link resolve: <span className="break-all text-gray-800">{String(d.finalUrl ?? d.resolvedUrl ?? "—")}</span></div>
              <div>HTTP: <span className="text-gray-800">{String(d.httpStatus ?? "—")}</span></div>
              <div>HTML length: <span className="text-gray-800">{String(d.htmlLength ?? 0)}</span></div>
              <div>shopId/itemId: <span className="text-gray-800">{String(d.detectedShopId ?? "—")} / {String(d.detectedItemId ?? "—")}</span></div>
              <div className="sm:col-span-2">Path: <span className="break-all text-gray-800">{Array.isArray(d.pathSegments) ? (d.pathSegments as string[]).join(" / ") : "—"}</span></div>
              <div>Ảnh ứng viên: <span className="text-gray-800">{String(d.imageCandidatesCount ?? 0)}</span> · Hợp lệ: <span className="text-gray-800">{String(d.validImagesCount ?? 0)}</span></div>
              <div className="sm:col-span-2">Chiến lược đã thử: <span className="text-gray-800">{strategies.join(", ") || "—"}</span></div>
              <div>Image provider: <span className="text-gray-800">{String(d.imageSourceProvider ?? "server_fetch")}</span></div>
              <div>Browser render: <span className="text-gray-800">{d.browserExtractionTried ? `${String(d.browserExtractionStatus ?? "?")} (hợp lệ: ${String(d.browserValidImagesCount ?? 0)})` : "chưa thử"}</span></div>
              {d.browserFinalUrl ? (
                <div className="sm:col-span-2">Browser final URL: <span className="break-all text-gray-800">{String(d.browserFinalUrl)}</span></div>
              ) : null}
              {d.browserExtractionError || d.browserError ? (
                <div className="sm:col-span-2">Browser error: <span className="break-all text-gray-800">{String(d.browserExtractionError ?? d.browserError)}</span></div>
              ) : null}
              {d.browserExtractionStage ? (
                <div>Browser stage: <span className="text-gray-800">{String(d.browserExtractionStage)}</span></div>
              ) : null}
              {d.browserlessEndpointHost ? (
                <div className="sm:col-span-2">Browserless endpoint: <span className="break-all text-gray-800">{String(d.browserlessEndpointProtocol ?? "?")}://{String(d.browserlessEndpointHost)}{String(d.browserlessEndpointPath ?? "")}</span></div>
              ) : null}
              {d.browserlessEndpointHasToken !== undefined ? (
                <div>Browserless token: <span className="text-gray-800">{d.browserlessEndpointHasToken ? "yes" : "missing"}</span></div>
              ) : null}
              {d.browserlessProxySource ? (
                <div>Proxy source: <span className="text-gray-800">{String(d.browserlessProxySource)}</span></div>
              ) : null}
              {d.browserlessProxyEnabled !== undefined ? (
                <>
                  <div>Proxy: <span className="text-gray-800">{d.browserlessProxyEnabled ? "đang bật" : "chưa bật"}</span></div>
                  <div>Proxy mode: <span className="text-gray-800">{String(d.browserlessProxyMode ?? "—")}</span></div>
                  <div>External proxy: <span className="text-gray-800">{d.browserlessExternalProxyConfigured ? "có cấu hình" : "không"}</span></div>
                  <div>Proxy auth: <span className="text-gray-800">{d.browserlessProxyAuth ? "có" : "không"}</span></div>
                </>
              ) : null}
            </dl>
            {showFull && rejected.length > 0 ? (
              <div className="mt-2">
                <p className="text-xs font-medium text-gray-500">Ảnh bị loại ({rejected.length}):</p>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto text-[11px] text-gray-500">
                  {rejected.slice(0, 8).map((r, i) => (
                    <li key={i} className="break-all">• {r.url} — {r.reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {showFull ? (
              <div className="mt-2 space-y-1 text-xs text-amber-700">
                <p>
                  Server không lấy được ảnh Shopee tự động. Nếu Browser final URL là <code>/verify/traffic/error</code>,
                  Shopee vẫn đang chặn phiên Browserless/proxy.
                </p>
                <p>Hãy kiểm tra 9proxy, thử đổi proxy sticky IP, hoặc đặt <code>BROWSERLESS_PROXY_MODE=chrome_arg</code> rồi redeploy.</p>
              </div>
            ) : null}
          </div>
        );
      })()}

      {job.related_post_id ? (
        <p className="mt-4 text-sm text-gray-500">
          Bài liên quan:{" "}
          <Link href="/dashboard/posts" className="font-medium text-blue-600 underline">
            xem trong Bài đăng AI →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
