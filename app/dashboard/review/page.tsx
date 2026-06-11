import ApproveAllButton from "@/components/dashboard/review/ApproveAllButton";
import ReviewPostCard from "@/components/dashboard/review/ReviewPostCard";
import { getReviewQueue } from "@/app/dashboard/review/actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const posts = await getReviewQueue();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">✅ Chờ duyệt bài</h1>
          <p className="mt-1 text-sm text-gray-500">
            Bài do AI Autopilot tạo (đủ 4 ảnh) sẽ ở đây chờ bạn duyệt trước khi xếp lịch & đăng. Bài đã duyệt sẽ được tự động xếp lịch ở bước tiếp theo của chiến dịch.
          </p>
        </div>
        {posts.length > 0 ? <ApproveAllButton /> : null}
      </div>

      {posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          Chưa có bài nào chờ duyệt.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {posts.map((post) => (
            <ReviewPostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
