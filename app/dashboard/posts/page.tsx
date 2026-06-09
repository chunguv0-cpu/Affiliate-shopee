import GeneratedPostsList from "@/components/dashboard/GeneratedPostsList";
import PageHeader from "@/components/dashboard/PageHeader";
import { getGeneratedPosts } from "@/app/dashboard/posts/actions";

// Luôn lấy dữ liệu mới từ database.
export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const result = await getGeneratedPosts();
  const posts = result.ok ? result.posts : [];

  return (
    <div>
      <PageHeader
        title="Bài đăng AI"
        description="Các caption do AI sinh ra từ sản phẩm, kèm điểm và trạng thái duyệt."
      />

      {!result.ok ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {result.error}
        </div>
      ) : null}

      <GeneratedPostsList posts={posts} />
    </div>
  );
}
