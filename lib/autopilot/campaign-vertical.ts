/**
 * Phase 21 — Universal vertical / keyword-lock engine.
 *
 * Pure (no DB, no server-only). The USER KEYWORD is a HARD constraint.
 * Classifies a campaign keyword/objective into a vertical, then provides
 * per-vertical allowed/negative terms, blocked categories, and SPECIFIC
 * product seed queries. Used by sourcing so "Quần Áo" never returns kitchen/tech.
 */

export type Vertical =
  | "FASHION_CLOTHING"
  | "TECH_GADGET"
  | "HOME_LIVING"
  | "KITCHEN"
  | "BEAUTY_COSMETICS"
  | "MOM_BABY"
  | "PET_SUPPLIES"
  | "HEALTH_PERSONAL_CARE"
  | "SPORTS_OUTDOOR"
  | "STATIONERY_OFFICE"
  | "CAR_MOTORBIKE_ACCESSORIES"
  | "TOYS_HOBBY"
  | "FOOD_BEVERAGE"
  | "JEWELRY_ACCESSORIES"
  | "BAG_SHOES"
  | "UNKNOWN";

export const VERTICAL_LABELS: Record<Vertical, string> = {
  FASHION_CLOTHING: "Thời trang / Quần áo",
  TECH_GADGET: "Công nghệ / Thiết bị",
  HOME_LIVING: "Nhà cửa / Đời sống",
  KITCHEN: "Nhà bếp",
  BEAUTY_COSMETICS: "Làm đẹp / Mỹ phẩm",
  MOM_BABY: "Mẹ & Bé",
  PET_SUPPLIES: "Thú cưng",
  HEALTH_PERSONAL_CARE: "Sức khỏe / Chăm sóc cá nhân",
  SPORTS_OUTDOOR: "Thể thao / Dã ngoại",
  STATIONERY_OFFICE: "Văn phòng phẩm",
  CAR_MOTORBIKE_ACCESSORIES: "Phụ kiện ô tô / xe máy",
  TOYS_HOBBY: "Đồ chơi / Sở thích",
  FOOD_BEVERAGE: "Thực phẩm / Đồ uống",
  JEWELRY_ACCESSORIES: "Trang sức / Phụ kiện",
  BAG_SHOES: "Túi / Giày dép",
  UNKNOWN: "Chưa xác định",
};

export type VerticalProfile = {
  key: Vertical;
  label: string;
  /** Tín hiệu nhận diện ngành từ KEYWORD người dùng (đã bỏ dấu). */
  signals: string[];
  /** Từ tích cực xác nhận sản phẩm thuộc ngành (trong tiêu đề sản phẩm). */
  allowed: string[];
  /** Từ loại trừ tuyệt đối cho ngành này. */
  negative: string[];
  /** Query sản phẩm CỤ THỂ khi keyword quá rộng. */
  seeds: string[];
};

// --------------------------------------------------------------------------
// Chuẩn hóa tiếng Việt (bỏ dấu) + token hóa.
// --------------------------------------------------------------------------
export function vNorm(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function vTokens(input: string | null | undefined): string[] {
  return vNorm(input)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// --------------------------------------------------------------------------
// 16 hồ sơ ngành hàng.
// --------------------------------------------------------------------------
export const VERTICAL_PROFILES: Record<Exclude<Vertical, "UNKNOWN">, VerticalProfile> = {
  FASHION_CLOTHING: {
    key: "FASHION_CLOTHING",
    label: VERTICAL_LABELS.FASHION_CLOTHING,
    signals: ["quan ao", "thoi trang", "ao", "quan", "vay", "dam", "do mac", "set bo", "fashion", "outfit", "ao khoac", "ao thun", "so mi", "jean", "hoodie", "polo", "do nu", "do nam"],
    allowed: ["ao", "quan", "vay", "dam", "set bo", "ao thun", "ao so mi", "quan jean", "quan short", "ao khoac", "ao polo", "hoodie", "ao len", "chan vay", "do mac nha", "ao croptop", "ao kieu", "do bo"],
    negative: ["den led", "cam bien", "sac", "may xay", "hut bui", "dao got", "hop dung thuc pham", "kim cuong", "cat ve sinh", "thuc an", "kem chong nang", "binh sua"],
    seeds: ["ao thun nu basic", "ao so mi cong so", "quan jean nu", "quan short nam", "vay suong nu", "dam di choi", "set bo mac nha", "ao khoac chong nang", "ao polo nam", "hoodie unisex"],
  },
  TECH_GADGET: {
    key: "TECH_GADGET",
    label: VERTICAL_LABELS.TECH_GADGET,
    signals: ["cong nghe", "dien tu", "thong minh", "gadget", "den cam bien", "sac", "usb", "bluetooth", "led", "thiet bi", "phu kien dien thoai", "do choi cong nghe"],
    allowed: ["den cam bien", "den led", "led", "sac", "cap sac", "gia do", "may mini", "may xay", "may hut bui", "thiet bi thong minh", "usb", "tu dong", "bluetooth", "o cam", "den ngu", "quat mini", "pin sac", "tai nghe", "loa"],
    negative: ["ao", "quan", "vay", "dam", "kem chong nang", "son", "binh sua", "cat ve sinh", "thuc an", "thuc pham"],
    seeds: ["den cam bien chuyen dong", "den led tu quan ao cam bien", "may xay mini sac usb", "may hut bui mini ban lam viec", "gia do dien thoai gap gon", "o cam thong minh", "den ngu cam bien", "quat mini usb"],
  },
  HOME_LIVING: {
    key: "HOME_LIVING",
    label: VERTICAL_LABELS.HOME_LIVING,
    signals: ["nha cua", "gia dung", "noi that", "sap xep", "luu tru", "trang tri nha", "do gia dung", "moc treo", "ke"],
    allowed: ["moc", "ke", "hop dung", "gia treo", "luoi loc", "kep", "treo tuong", "gap gon", "tui hut chan khong", "thanh treo", "khay", "gio", "ri do", "tham", "rem"],
    negative: ["ao", "quan", "vay", "kem chong nang", "son", "binh sua", "cat ve sinh", "thuc an", "tai nghe"],
    seeds: ["moc dan tuong chiu luc", "ke nha tam dan tuong", "hop dung do gap gon", "gia treo do da nang", "tui hut chan khong quan ao", "thanh treo do nha tam", "khay dung do bo bep"],
  },
  KITCHEN: {
    key: "KITCHEN",
    label: VERTICAL_LABELS.KITCHEN,
    signals: ["nha bep", "bep", "do bep", "nau an", "dung cu bep", "do dung nha bep"],
    allowed: ["khan lau bep", "dao", "thot", "hop dung thuc pham", "may xay", "loc", "luoi loc", "ve sinh bep", "ron kin", "ke gia vi", "may han mieng tui", "dung cu bep", "chai xit", "mieng rua bat"],
    negative: ["ao", "quan", "vay", "kem chong nang", "son", "binh sua", "cat ve sinh", "den led", "sac du phong"],
    seeds: ["khan lau bep", "hop dung thuc pham co ron kin", "dao got trai cay", "thot khang khuan", "ke gia vi", "may han mieng tui mini", "loc rac bon rua", "dung cu ve sinh bep"],
  },
  BEAUTY_COSMETICS: {
    key: "BEAUTY_COSMETICS",
    label: VERTICAL_LABELS.BEAUTY_COSMETICS,
    signals: ["lam dep", "my pham", "duong da", "skincare", "trang diem", "son", "kem chong nang", "serum"],
    allowed: ["kem chong nang", "son", "son tint", "tay trang", "sua rua mat", "serum", "mat na", "kem duong", "toner", "phan", "mascara", "kem nen", "tay te bao chet"],
    negative: ["ao", "quan", "den led", "sac", "may xay", "binh sua", "cat ve sinh", "dao got"],
    seeds: ["kem chong nang", "son tint li", "nuoc tay trang", "sua rua mat", "serum duong da", "mat na duong da", "kem duong am"],
  },
  MOM_BABY: {
    key: "MOM_BABY",
    label: VERTICAL_LABELS.MOM_BABY,
    signals: ["me va be", "me be", "em be", "tre so sinh", "do so sinh", "bim sua", "mom baby"],
    allowed: ["khan uot", "bim", "bim quan", "binh sua", "may tiet trung", "mieng lot tham sua", "tui tru sua", "khan sua", "yem", "ti gia", "noi com be"],
    negative: ["ao nam", "den led", "sac", "may xay sinh to", "cat ve sinh meo", "son", "dao got"],
    seeds: ["khan uot em be", "bim quan", "binh sua chong say", "may tiet trung binh sua", "mieng lot tham sua", "tui tru sua", "khan sua em be"],
  },
  PET_SUPPLIES: {
    key: "PET_SUPPLIES",
    label: VERTICAL_LABELS.PET_SUPPLIES,
    signals: ["thu cung", "cho meo", "cho", "meo", "pet", "do cho thu cung"],
    allowed: ["cat ve sinh", "nha ve sinh meo", "bat an", "vong co", "do choi meo", "do choi cho", "luoc chai long", "day dat", "chuong", "hat cho meo"],
    negative: ["ao nguoi", "den led", "sac", "kem chong nang", "binh sua em be", "dao got"],
    seeds: ["cat ve sinh meo", "nha ve sinh meo", "bat an cho meo doi", "vong co thu cung", "do choi cho meo", "luoc chai long cho meo"],
  },
  HEALTH_PERSONAL_CARE: {
    key: "HEALTH_PERSONAL_CARE",
    label: VERTICAL_LABELS.HEALTH_PERSONAL_CARE,
    signals: ["suc khoe", "cham soc ca nhan", "y te", "vitamin", "thuc pham chuc nang", "ve sinh ca nhan"],
    allowed: ["may massage", "nhiet ke", "may do huyet ap", "vitamin", "thuc pham chuc nang", "khau trang", "ban chai dien", "may xong", "bang gac", "dau goi", "sua tam"],
    negative: ["ao", "quan", "den led", "may xay", "cat ve sinh meo", "dao got bep"],
    seeds: ["may massage cam tay", "nhiet ke dien tu", "may do huyet ap", "ban chai danh rang dien", "vien uong vitamin tong hop", "may xong tinh dau"],
  },
  SPORTS_OUTDOOR: {
    key: "SPORTS_OUTDOOR",
    label: VERTICAL_LABELS.SPORTS_OUTDOOR,
    signals: ["the thao", "gym", "da ngoai", "tap luyen", "outdoor", "the duc"],
    allowed: ["tham yoga", "day khang luc", "binh nuoc the thao", "gang tay tap gym", "day nhay", "bong", "lieu cam trai", "balo the thao", "ao the thao", "dai lung tap"],
    negative: ["den led nha", "may xay bep", "cat ve sinh", "kem chong nang", "binh sua em be"],
    seeds: ["tham tap yoga", "day khang luc tap gym", "binh nuoc the thao", "gang tay tap gym", "day nhay the duc", "balo the thao chong nuoc"],
  },
  STATIONERY_OFFICE: {
    key: "STATIONERY_OFFICE",
    label: VERTICAL_LABELS.STATIONERY_OFFICE,
    signals: ["van phong pham", "but", "so tay", "hoc sinh", "office", "dung cu hoc tap"],
    allowed: ["but", "so tay", "but bi", "but day", "kep giay", "bang dinh", "hop but", "giay note", "may tinh cam tay", "ke sach", "tui dung but"],
    negative: ["ao", "quan", "den led nha", "may xay", "cat ve sinh", "kem chong nang"],
    seeds: ["but bi gel mau", "so tay ke hoach", "hop but de ban", "giay note ghi chu", "ke sach de ban", "may tinh cam tay hoc sinh"],
  },
  CAR_MOTORBIKE_ACCESSORIES: {
    key: "CAR_MOTORBIKE_ACCESSORIES",
    label: VERTICAL_LABELS.CAR_MOTORBIKE_ACCESSORIES,
    signals: ["o to", "xe may", "phu kien xe", "do xe", "moto", "xe hoi"],
    allowed: ["gia do dien thoai xe may", "ao mua", "bom lop", "camera hanh trinh", "khan lau xe", "den tro sang", "moc treo do xe", "sac xe may", "op po", "tham lot san o to"],
    negative: ["ao thoi trang", "kem chong nang", "binh sua", "cat ve sinh", "may xay bep"],
    seeds: ["gia do dien thoai xe may", "ao mua xe may", "bom lop mini", "camera hanh trinh xe may", "khan lau xe o to", "den tro sang xe may"],
  },
  TOYS_HOBBY: {
    key: "TOYS_HOBBY",
    label: VERTICAL_LABELS.TOYS_HOBBY,
    signals: ["do choi", "mo hinh", "lego", "so thich", "toy", "do choi tre em"],
    allowed: ["do choi", "mo hinh", "lap rap", "bup be", "xe do choi", "puzzle", "thu nhoi bong", "bo lego", "do choi giao duc", "dat nan"],
    negative: ["ao nguoi lon", "den led nha", "may xay", "cat ve sinh", "kem chong nang"],
    seeds: ["do choi lap rap tre em", "mo hinh lego mini", "bup be cho be", "xe o to do choi", "do choi giao duc montessori", "dat nan an toan"],
  },
  FOOD_BEVERAGE: {
    key: "FOOD_BEVERAGE",
    label: VERTICAL_LABELS.FOOD_BEVERAGE,
    signals: ["thuc pham", "do an", "do uong", "banh keo", "an vat", "food", "snack"],
    allowed: ["banh", "keo", "tra", "ca phe", "hat", "do an vat", "mi", "gia vi", "nuoc uong", "snack", "do kho", "ngu coc"],
    negative: ["ao", "quan", "den led", "sac", "may xay dien", "cat ve sinh"],
    seeds: ["banh trang tron an vat", "ca phe hoa tan", "tra sua tu pha", "hat dinh duong mix", "do an vat healthy", "ngu coc an sang"],
  },
  JEWELRY_ACCESSORIES: {
    key: "JEWELRY_ACCESSORIES",
    label: VERTICAL_LABELS.JEWELRY_ACCESSORIES,
    signals: ["trang suc", "phu kien thoi trang", "vong tay", "day chuyen", "khuyen tai", "jewelry", "lac tay"],
    allowed: ["vong tay", "day chuyen", "khuyen tai", "bong tai", "lac tay", "nhan", "kep toc", "day chuyen bac", "vong co", "charm"],
    negative: ["ao", "quan", "den led", "may xay", "cat ve sinh", "binh sua"],
    seeds: ["vong tay nu thoi trang", "day chuyen bac nu", "khuyen tai bac", "lac tay handmade", "kep toc thoi trang", "nhan bac nu"],
  },
  BAG_SHOES: {
    key: "BAG_SHOES",
    label: VERTICAL_LABELS.BAG_SHOES,
    signals: ["tui", "giay", "dep", "balo", "vi", "tui xach", "giay dep", "bag", "shoes"],
    allowed: ["tui xach", "balo", "giay", "dep", "vi", "tui deo cheo", "giay the thao", "giay cao got", "dep le", "sandal", "tui tote"],
    negative: ["den led", "may xay", "cat ve sinh", "kem chong nang", "binh sua", "thuc pham"],
    seeds: ["tui xach nu cong so", "balo lap top", "giay the thao nu", "dep le di hoc", "vi cam tay nu", "tui deo cheo unisex"],
  },
};

const ALL_VERTICALS = Object.keys(VERTICAL_PROFILES) as Exclude<Vertical, "UNKNOWN">[];

export function profileFor(v: Vertical): VerticalProfile | null {
  if (v === "UNKNOWN") return null;
  return VERTICAL_PROFILES[v] ?? null;
}

// Cụm rộng — không được search trực tiếp.
const BROAD_TERMS = [
  "do cong nghe", "cong nghe", "do gia dung", "gia dung", "san pham hot", "san pham",
  "tien ich", "phu kien", "do dung", "hot trend", "quan ao", "thoi trang", "me va be",
  "do nha bep", "nha bep", "do nha cua", "thu cung", "lam dep", "the thao", "do choi",
  "thuc pham", "trang suc", "tui giay", "do dung gia dinh", "do moi la", "do doc la",
];

export function isBroadKeyword(keyword: string): boolean {
  const norm = vNorm(keyword);
  if (!norm) return true;
  if (BROAD_TERMS.includes(norm)) return true;
  const meaningful = vTokens(norm).filter((t) => t.length >= 2);
  // 1-2 token chung chung -> coi là rộng nếu khớp 1 broad term.
  if (meaningful.length <= 2 && BROAD_TERMS.some((b) => norm.includes(b))) return true;
  return false;
}

export type VerticalClassification = {
  vertical: Vertical;
  confidence: number;
  scores: Partial<Record<Vertical, number>>;
};

/** Phân loại ngành từ keyword + objective. confidence 0..1. */
export function classifyVertical(text: string): VerticalClassification {
  const norm = vNorm(text);
  const scores: Partial<Record<Vertical, number>> = {};
  let best: Exclude<Vertical, "UNKNOWN"> | null = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const v of ALL_VERTICALS) {
    const profile = VERTICAL_PROFILES[v];
    let s = 0;
    for (const sig of profile.signals) {
      if (!sig) continue;
      if (norm === sig) s += 5; // khớp tuyệt đối keyword
      else if (norm.includes(sig)) s += sig.includes(" ") ? 3 : 2; // cụm dài tin cậy hơn
    }
    if (s > 0) scores[v] = s;
    if (s > bestScore) {
      secondScore = bestScore;
      bestScore = s;
      best = v;
    } else if (s > secondScore) {
      secondScore = s;
    }
  }

  if (!best || bestScore === 0) {
    return { vertical: "UNKNOWN", confidence: 0, scores };
  }
  // confidence: dựa trên độ mạnh tuyệt đối + khoảng cách với á quân.
  const dominance = bestScore / (bestScore + secondScore);
  const strength = Math.min(1, bestScore / 5);
  const confidence = Math.round(Math.min(1, 0.45 * strength + 0.55 * dominance) * 100) / 100;
  return { vertical: best, confidence, scores };
}

/** Phân loại 1 tiêu đề sản phẩm về ngành mạnh nhất (dùng để phát hiện lệch ngành). */
export function classifyProductVertical(title: string): { vertical: Vertical; score: number } {
  const norm = vNorm(title);
  let best: Vertical = "UNKNOWN";
  let bestScore = 0;
  for (const v of ALL_VERTICALS) {
    const profile = VERTICAL_PROFILES[v];
    let s = 0;
    for (const term of profile.allowed) {
      if (term && norm.includes(term)) s += term.includes(" ") ? 2 : 1;
    }
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return { vertical: best, score: bestScore };
}
