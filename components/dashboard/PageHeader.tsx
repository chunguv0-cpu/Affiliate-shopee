import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Dòng nhãn nhỏ phía trên tiêu đề (tùy chọn). */
  eyebrow?: string;
  /** Nút hành động hiển thị bên phải, ví dụ "Thêm sản phẩm". */
  action?: ReactNode;
};

export default function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-slate-200/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-blue-600">{eyebrow}</p>
        ) : null}
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
