/**
 * Helper phân tích báo cáo Affiliate (Phase 12) — thuần, dùng cả client & server.
 */

/** Dòng báo cáo (giá trị thô dạng string) gửi từ client lên server. */
export type ReportRowInput = {
  report_date: string | null;
  sub_id: string | null;
  affiliate_link: string | null;
  product_name: string | null;
  clicks: string | null;
  orders: string | null;
  commission: string | null;
  revenue: string | null;
  status: string | null;
  raw_row: Record<string, string>;
};

export type MapReportResult = {
  rows: ReportRowInput[];
  warnings: string[];
};

/** Các alias tên cột có thể gặp trong báo cáo Shopee Affiliate. */
const COLUMN_ALIASES: Record<string, string[]> = {
  sub_id: ["sub_id", "subid", "sub id", "sub_id1", "sub_id_1"],
  affiliate_link: ["affiliate_link", "link", "tracking_link"],
  clicks: ["clicks", "click", "lượt click", "luot click", "clicks_count"],
  orders: ["orders", "order", "đơn hàng", "don hang", "conversions"],
  commission: ["commission", "hoa hồng", "hoa hong", "payout", "estimated_commission"],
  revenue: ["revenue", "doanh thu", "order_amount", "sales"],
  report_date: ["date", "report_date", "ngày", "ngay"],
  product_name: ["product_name", "product", "tên sản phẩm", "ten san pham", "item_name"],
  status: ["status", "trạng thái", "trang thai"],
};

/** Tách CSV (hỗ trợ field bọc dấu nháy kép). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Map header -> chỉ số cột theo alias. */
function detectColumns(header: string[]): Record<string, number> {
  const norm = header.map((h) => h.trim().toLowerCase());
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

/** Chuẩn hóa chuỗi số (xử lý dấu phẩy/chấm kiểu VN & EN). */
export function toNumberSafe(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      s = `${parts[0]}.${parts[1]}`;
    } else {
      s = s.replace(/,/g, "");
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function toIntSafe(v: string | number | null | undefined): number {
  return Math.round(toNumberSafe(v));
}

/** Chuẩn hóa report_date về YYYY-MM-DD, hoặc null nếu không parse được. */
export function normalizeReportDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  const pad = (x: string) => x.padStart(2, "0");

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Parse CSV báo cáo Shopee thành các dòng chuẩn hóa + cảnh báo.
 */
export function mapReportRows(csvText: string): MapReportResult {
  const warnings: string[] = [];
  const all = parseCsv((csvText ?? "").trim()).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );

  if (all.length < 2) {
    return { rows: [], warnings: ["CSV cần dòng tiêu đề và ít nhất 1 dòng dữ liệu."] };
  }

  const header = all[0];
  const cols = detectColumns(header);

  if (cols.sub_id === undefined && cols.affiliate_link === undefined) {
    warnings.push("Không có sub_id hoặc affiliate_link, khó map về bài đăng.");
  }

  const pick = (r: string[], field: string): string | null => {
    const idx = cols[field];
    if (idx === undefined) return null;
    const v = (r[idx] ?? "").trim();
    return v.length > 0 ? v : null;
  };

  const rows: ReportRowInput[] = [];
  for (let i = 1; i < all.length; i += 1) {
    const r = all[i];
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => {
      raw[h.trim() || `col${idx}`] = (r[idx] ?? "").trim();
    });

    rows.push({
      report_date: pick(r, "report_date"),
      sub_id: pick(r, "sub_id"),
      affiliate_link: pick(r, "affiliate_link"),
      product_name: pick(r, "product_name"),
      clicks: pick(r, "clicks"),
      orders: pick(r, "orders"),
      commission: pick(r, "commission"),
      revenue: pick(r, "revenue"),
      status: pick(r, "status"),
      raw_row: raw,
    });
  }

  return { rows, warnings };
}
