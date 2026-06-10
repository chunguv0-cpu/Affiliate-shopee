import { LINK_STATUS_LABELS, type LinkStatus } from "@/lib/types";

const STYLES: Record<LinkStatus, string> = {
  NEED_CONVERT: "bg-amber-50 text-amber-700",
  READY: "bg-green-50 text-green-700",
  INVALID: "bg-red-50 text-red-700",
};

export default function LinkStatusBadge({ status }: { status: LinkStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {LINK_STATUS_LABELS[status] ?? status}
    </span>
  );
}
