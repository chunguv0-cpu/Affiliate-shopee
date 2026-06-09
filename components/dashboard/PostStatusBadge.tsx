import {
  GENERATED_POST_STATUS_LABELS,
  type GeneratedPostStatus,
} from "@/lib/types";

const STATUS_STYLES: Record<GeneratedPostStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  READY: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  PUBLISHED: "bg-blue-50 text-blue-700",
  FAILED: "bg-red-100 text-red-700",
  SKIPPED: "bg-amber-50 text-amber-700",
  PUBLISHING: "bg-indigo-50 text-indigo-700",
};

export default function PostStatusBadge({
  status,
}: {
  status: GeneratedPostStatus;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {GENERATED_POST_STATUS_LABELS[status]}
    </span>
  );
}
