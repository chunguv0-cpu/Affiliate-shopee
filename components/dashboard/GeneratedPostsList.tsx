import Link from "next/link";

import GeneratedPostCard from "@/components/dashboard/GeneratedPostCard";
import type { GeneratedPost } from "@/lib/types";

export default function GeneratedPostsList({
  posts,
}: {
  posts: GeneratedPost[];
}) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
        <div className="mb-3 text-4xl">📝</div>
        <h3 className="text-base font-semibold text-gray-900">
          Chưa có bài AI nào
        </h3>
        <p className="mt-1 max-w-sm text-sm text-gray-500">
          Hãy sang mục Sản phẩm và bấm Tạo bài AI để sinh caption đầu tiên.
        </p>
        <Link
          href="/dashboard/products"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Đi tới Sản phẩm
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <GeneratedPostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
