/**
 * Tiện ích định dạng ngày giờ (tiếng Việt) và kiểm tra đến hạn.
 *
 * Ghi chú timezone (Phase 5): không xử lý timezone phức tạp.
 * Dùng giờ local của môi trường đang chạy để hiển thị.
 */

function toDate(date: string | Date | null | undefined): Date | null {
  if (date === null || date === undefined) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Định dạng ngày giờ theo kiểu vi-VN: dd/MM/yyyy HH:mm.
 * Trả "Chưa có" nếu null/không hợp lệ.
 */
export function formatDateTimeVi(date: string | Date | null): string {
  const d = toDate(date);
  if (!d) return "Chưa có";

  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${datePart} ${timePart}`;
}

/**
 * Trả về true nếu thời điểm đã đến hạn (date <= bây giờ).
 * null/không hợp lệ -> false.
 */
export function isDue(date: string | Date | null): boolean {
  const d = toDate(date);
  if (!d) return false;
  return d.getTime() <= Date.now();
}
