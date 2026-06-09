"use client";

type TopbarProps = {
  /** Mở sidebar trên mobile. */
  onMenuClick: () => void;
};

export default function Topbar({ onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white/80 px-4 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Mở menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 lg:hidden"
        >
          ☰
        </button>
        <h1 className="text-sm font-medium text-gray-500">
          Shopee Affiliate Auto Agent
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500 sm:inline">
          Phase 1
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
          A
        </div>
      </div>
    </header>
  );
}
