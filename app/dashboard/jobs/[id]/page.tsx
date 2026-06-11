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
