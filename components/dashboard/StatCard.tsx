import type { ReactNode } from "react";

type StatCardProps = {
  /** Nhãn của chỉ số, ví dụ "Tổng sản phẩm". */
  label: string;
  /** Giá trị hiển thị (số hoặc text). */
  value: string | number;
  /** Icon dạng emoji hoặc node tùy ý. */
  icon?: ReactNode;
  /** Mô tả phụ bên dưới giá trị. */
  hint?: string;
  /** Màu nhấn của thẻ. */
  accent?: "blue" | "amber" | "green" | "red";
};

const accentMap: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  green: "bg-green-50 text-green-600",
  red: "bg-red-50 text-red-600",
};

export default function StatCard({
  label,
  value,
  icon,
  hint,
  accent = "blue",
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {icon ? (
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg ${accentMap[accent]}`}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-3xl font-semibold text-gray-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}
