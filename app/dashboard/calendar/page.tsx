import Link from "next/link";

import EmptyState from "@/components/dashboard/EmptyState";
import PostStatusBadge from "@/components/dashboard/PostStatusBadge";
import { getScheduledPosts } from "@/app/dashboard/posts/actions";
import type { GeneratedPost } from "@/lib/types";
import { formatDateTimeVi, isDue } from "@/lib/utils/date";

// Luôn lấy dữ liệu mới từ database.
export const dynamic = "force-dynamic";

function ScheduledItem({ post }: { post: GeneratedPost }) {
  const due = isDue(post.scheduled_at);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          {post.creative_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.creative_image_url} alt="" className="h-14 w-14 flex-none rounded-lg border border-gray-200 object-cover" />
          ) : null}
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${
                due ? "bg-orange-50 text-orange-700" : "bg-green-50 text-green-700"
              }`}
            >
              🕒 {formatDateTimeVi(post.scheduled_at)}
            </span>
            <PostStatusBadge status={post.status} />
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
              {post.facebook_publish_type ?? "FEED"}
            </span>
            {post.creative_status === "MISSING_ASSET" ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">⚠ Thiếu ảnh</span>
            ) : null}
          </div>
          <p className="mt-2 font-medium text-gray-900">
            {post.products?.product_name ?? "Sản phẩm không xác định"}
            {post.campaigns?.name ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                🚀 {post.campaigns.name}
              </span>
            ) : null}
            {post.content_angle_variant ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                ✍️ {post.content_angle_variant}
              </span>
            ) : null}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">
            {post.caption ?? "—"}
          </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <span className="text-xs text-gray-500">Điểm AI: {post.ai_score ?? "—"}</span>
          {post.products?.affiliate_link ? (
            <a
              href={post.products.affiliate_link}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[180px] truncate text-xs text-blue-600 hover:underline"
              title={post.products.affiliate_link}
            >
              🔗 Link sản phẩm
            </a>
          ) : null}
          <Link
            href="/dashboard/posts"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Xem / sửa →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, posts }: { title: string; posts: GeneratedPost[] }) {
  if (posts.length === 0) return null;
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        {title}{" "}
        <span className="font-normal text-gray-400">({posts.length})</span>
      </h3>
      <div className="space-y-3">
        {posts.map((post) => (
          <ScheduledItem key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}

export default async function CalendarPage() {
  const result = await getScheduledPosts();
  const posts = result.ok ? result.posts : [];

  // Tách rõ 3 nhóm để không "ẩn" bài campaign đã đăng vào nhóm quá hạn.
  const publishedPosts = posts.filter((p) => p.status === "PUBLISHED");
  const duePosts = posts.filter(
    (p) => p.status !== "PUBLISHED" && isDue(p.scheduled_at),
  );
  const upcomingPosts = posts.filter(
    (p) => p.status !== "PUBLISHED" && !isDue(p.scheduled_at),
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Lịch đăng bài</h2>
        <p className="mt-1 text-sm text-gray-500">
          Các bài AI đã được gán thời gian đăng. Phase sau hệ thống sẽ tự đăng khi
          đến giờ.
        </p>
      </div>

      {!result.ok ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {result.error}
        </div>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState
          icon="🗓️"
          title="Chưa có bài nào được lên lịch"
          description="Chưa có bài nào được lên lịch. Kiểm tra generated_posts.scheduled_at."
          action={
            <Link
              href="/dashboard/posts"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Đi tới Bài đăng AI
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          <Section title="Đến hạn hoặc quá hạn" posts={duePosts} />
          <Section title="Sắp tới" posts={upcomingPosts} />
          <Section title="Đã đăng" posts={publishedPosts} />
        </div>
      )}
    </div>
  );
}
