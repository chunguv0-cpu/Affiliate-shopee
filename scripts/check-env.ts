/**
 * Kiểm tra biến môi trường cần thiết cho production/local.
 *
 * Chạy: npm run check:env
 *
 * BẢO MẬT: KHÔNG in giá trị key/token. Chỉ in OK / MISSING.
 */

// Nạp .env.local / .env nếu có (khi chạy ngoài Next).
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type EnvCheck = { name: string; required: boolean };

const BASE_REQUIRED: string[] = [
  "AI_PROVIDER",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
  "CRON_SECRET",
  "NEXT_PUBLIC_APP_URL",
];

function isSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function main(): void {
  const provider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();

  const checks: EnvCheck[] = BASE_REQUIRED.map((name) => ({
    name,
    required: true,
  }));

  if (provider === "v98") {
    checks.push(
      { name: "V98_API_KEY", required: true },
      { name: "V98_BASE_URL", required: true },
      { name: "V98_MODEL", required: true },
    );
  } else if (provider === "openai") {
    checks.push(
      { name: "OPENAI_API_KEY", required: true },
      { name: "OPENAI_MODEL", required: true },
    );
  }

  console.log("Kiểm tra biến môi trường (AI_PROVIDER=" + (provider || "(chưa đặt)") + ")\n");

  let missing = 0;
  for (const check of checks) {
    if (isSet(check.name)) {
      console.log("OK      " + check.name);
    } else {
      console.log("MISSING " + check.name);
      missing += 1;
    }
  }

  console.log("");
  if (missing > 0) {
    console.log(`❌ Thiếu ${missing} biến môi trường. Hãy bổ sung vào .env.local (local) hoặc Vercel Environment Variables (production).`);
    process.exitCode = 1;
  } else {
    console.log("✅ Đã có đủ các biến môi trường bắt buộc.");
  }
}

main();
