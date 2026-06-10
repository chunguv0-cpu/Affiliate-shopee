import CopyButton from "@/components/dashboard/CopyButton";
import PostStatusBadge from "@/components/dashboard/PostStatusBadge";
import PublishPostButton from "@/components/dashboard/PublishPostButton";
import RetryPostButton from "@/components/dashboard/RetryPostButton";
import SchedulePostForm from "@/components/dashboard/SchedulePostForm";
import {
  CREATIVE_PACK_STATUS_LABELS,
  CREATIVE_STATUS_LABELS,
  type GeneratedPost,
} from "@/lib/types";
import { formatDateTimeVi, isDue } from "@/lib/utils/date";

/** Định dạng ngày dạng dd/MM/yyyy (tránh lệch locale). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Rút gọn link để hiển thị (bỏ scheme, cắt bớt nếu dài). */
function shortenLink(url: string): string {
  const noScheme = url.replace(/^https?:\/\//i, "");
  return noScheme.length > 48 ? `${noScheme.slice(0, 48)}…` : noScheme;
}

/** Nhãn trạng thái lịch đăng để người dùng dễ hiểu. */
function scheduleStateLabel(post: GeneratedPost): {
  text: string;
  className: string;
} {
  switch (post.status) {
    case "PUBLISHED":
      return { text: "Đã đăng", className: "bg-blue-50 text-blue-700" };
    case "REJECTED":
      return { text: "Bị từ chối", className: "bg-red-50 text-red-700" };
    case "READY":
      if (!post.scheduled_at) {
        return {
          text: "Sẵn sàng, chưa lên lịch",
          className: "bg-amber-50 text-amber-700",
        };
      }
      return isDue(post.scheduled_at)
        ? { text: "Đến hạn đăng", className: "bg-orange-50 text-orange-700" }
        : { text: "Đã lên lịch", className: "bg-green-50 text-green-700" };
    default:
      return { text: "", className: "" };
  }
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="text-sm font-medium text-gray-800">{children}</span>
    </div>
  );
}

export default function GeneratedPostCard({ post }: { post: GeneratedPost }) {
  const productName = post.products?.product_name ?? "Sản phẩm không xác định";
  const affiliateLink = post.products?.affiliate_link ?? null;
  const stateLabel = scheduleStateLabel(post);
  const creativeAssets = post.creative_assets ?? [];
  const readyAssets = creativeAssets.filter((a) => a.status === "READY" && a.image_url);
  const readyAssetCount = readyAssets.length;
  const productImageCount = readyAssets.filter((a) => a.source_type === "PRODUCT").length;
  const aiImageCount = readyAssets.filter((a) => a.source_type === "AI_GENERATED").length;
  const hasMockImage = readyAssets.some((a) => (a.image_url ?? "").includes("placehold.co"));
  const missingProductImage =
    post.creative_pack_status === "MISSING_PRODUCT_IMAGE" || (readyAssetCount > 0 && productImageCount === 0);

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-900">
              {productName}
            </h3>
            {affiliateLink ? (
              <a
                href={affiliateLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block max-w-full truncate text-xs text-blue-600 hover:underline"
                title={affiliateLink}
              >
                🔗 {shortenLink(affiliateLink)}
              </a>
            ) : null}
            {post.campaigns?.name || post.content_angle_variant ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {post.campaigns?.name ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                    🚀 {post.campaigns.name}
                  </span>
                ) : null}
                {post.content_angle_variant ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                    ✍️ Góc viết: {post.content_angle_variant}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stateLabel.text ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stateLabel.className}`}
              >
                {stateLabel.text}
              </span>
            ) : null}
            <PostStatusBadge status={post.status} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetaItem label="Điểm AI">{post.ai_score ?? "—"}</MetaItem>
          <MetaItem label="Nên đăng">
            {post.should_publish ? (
              <span className="text-green-600">Có</span>
            ) : (
              <span className="text-gray-400">Không</span>
            )}
          </MetaItem>
          <MetaItem label="Ngày tạo">{formatDate(post.created_at)}</MetaItem>
          <MetaItem label="Lịch đăng">
            {post.scheduled_at ? formatDateTimeVi(post.scheduled_at) : "Chưa lên lịch"}
          </MetaItem>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-4 px-5 py-4">
        {/* Phase 17 V2 — Creative pack (gallery >= 4 ảnh) */}
        {creativeAssets.length > 0 ? (
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {post.publish_mode ?? "FEED"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  post.creative_pack_status === "READY"
                    ? "bg-green-50 text-green-700"
                    : post.creative_pack_status === "FAILED"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-50 text-amber-700"
                }`}
              >
                {post.creative_pack_status ? CREATIVE_PACK_STATUS_LABELS[post.creative_pack_status] : "—"}
              </span>
              <span className="text-xs text-gray-500">
                {readyAssetCount} ảnh · {productImageCount} thật / {aiImageCount} AI{post.creative_pack_mode ? ` · ${post.creative_pack_mode}` : ""}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {creativeAssets.slice(0, 4).map((a, i) =>
                a.image_url ? (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.image_url} alt="" className="aspect-square w-full rounded-md border border-gray-200 object-cover" />
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/55 px-1 text-[10px] font-medium text-white">
                      {a.source_type === "PRODUCT" ? "Sản phẩm" : a.source_type === "FOUND" ? "Tìm" : "AI"}
                    </span>
                  </div>
                ) : (
                  <div key={i} className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-gray-300 text-gray-300">×</div>
                ),
              )}
            </div>
            <div className="mt-2 space-y-1">
              {missingProductImage ? (
                <p className="text-xs font-medium text-red-700">⛔ Thiếu ảnh thật sản phẩm</p>
              ) : null}
              {post.creative_pack_mode === "GENERATED_ONLY" ? (
                <p className="text-xs font-medium text-red-700">⛔ Chỉ có ảnh AI — không được đăng</p>
              ) : null}
              {hasMockImage ? (
                <p className="text-xs font-medium text-amber-700">⚠ Ảnh mock — không được đăng production</p>
              ) : null}
              {readyAssetCount < 4 && !missingProductImage ? (
                <p className="text-xs font-medium text-amber-700">⚠ Chưa đủ 4 ảnh</p>
              ) : null}
              {post.creative_pack_status === "FAILED" ? (
                <p className="text-xs font-medium text-red-700">Creative failed{post.creative_error ? `: ${post.creative_error}` : ""}</p>
              ) : null}
              {missingProductImage ? (
                <p className="text-xs text-gray-500">Vui lòng bổ sung image_url thật cho sản phẩm hoặc import lại link có ảnh.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Phase 17 — Creative (ảnh + hook + loại đăng) */}
        {post.creative_image_url || post.creative_hook || post.creative_type ? (
          <div className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
            {post.creative_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.creative_image_url}
                alt={productName}
                className="h-20 w-20 flex-none rounded-lg border border-gray-200 object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 flex-none items-center justify-center rounded-lg border border-dashed border-gray-300 text-2xl text-gray-300">🖼️</div>
            )}
            <div className="min-w-0">
              {post.creative_hook ? (
                <p className="text-sm font-medium text-gray-900">🪝 {post.creative_hook}</p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{post.creative_type ?? "TEXT_ONLY"}</span>
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{post.facebook_publish_type ?? "FEED"}</span>
                {post.creative_status === "MISSING_ASSET" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">⚠ Thiếu ảnh</span>
                ) : post.creative_status ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">{CREATIVE_STATUS_LABELS[post.creative_status] ?? post.creative_status}</span>
                ) : null}
              </div>
              {post.creative_brief ? <p className="mt-1 text-xs text-gray-500">{post.creative_brief}</p> : null}
            </div>
          </div>
        ) : null}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Hook
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900">
            {post.hook ?? "—"}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Caption
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
            {post.caption ?? "—"}
          </p>
        </div>

        {post.safety_notes ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
              Ghi chú an toàn
            </p>
            <p className="mt-0.5 text-sm text-amber-800">{post.safety_notes}</p>
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <CopyButton text={post.caption ?? ""} />
          {affiliateLink ? (
            <a
              href={affiliateLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              🔗 Xem link sản phẩm
            </a>
          ) : null}
        </div>
      </div>

      {/* Đăng Facebook */}
      <div className="border-t border-gray-100 px-5 py-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Đăng Facebook
        </p>
        {post.status === "PUBLISHED" ? (
          <div className="text-sm">
            <p className="text-green-700">
              ✓ Đã đăng lúc {formatDateTimeVi(post.published_at)}
            </p>
            {post.facebook_post_url ? (
              <a
                href={post.facebook_post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-blue-600 underline hover:text-blue-700"
              >
                Mở bài Facebook
              </a>
            ) : null}
          </div>
        ) : post.status === "PUBLISHING" ? (
          <p className="text-sm text-indigo-700">
            ⏳ Bài đang được hệ thống xử lý.
          </p>
        ) : post.status === "FAILED" ? (
          <div>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold text-red-700">Đăng thất bại</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-red-700">
                {post.error_log ?? "Không rõ lỗi."}
              </p>
            </div>
            <RetryPostButton postId={post.id} />
          </div>
        ) : post.status === "REJECTED" ? (
          <p className="text-sm text-gray-500">Bài bị từ chối, không thể đăng.</p>
        ) : (
          <PublishPostButton
            postId={post.id}
            status={post.status}
            shouldPublish={post.should_publish}
            aiScore={post.ai_score}
            caption={post.caption}
          />
        )}
      </div>

      {/* Lịch đăng */}
      <div className="border-t border-gray-100 px-5 py-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Lịch đăng
        </p>
        {post.status === "REJECTED" ? (
          <p className="text-sm text-red-600">
            Bài bị từ chối, cần tạo lại caption.
          </p>
        ) : post.status === "PUBLISHING" ? (
          <p className="text-sm text-gray-500">
            Bài đang được hệ thống xử lý, không thể đổi lịch.
          </p>
        ) : (
          <SchedulePostForm
            postId={post.id}
            currentScheduledAt={post.scheduled_at}
            status={post.status}
          />
        )}
      </div>
    </article>
  );
}
