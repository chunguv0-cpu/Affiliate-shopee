import { NextResponse } from "next/server";

export function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function checkCronAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization")?.trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  const querySecret = new URL(request.url).searchParams.get("secret")?.trim();
  const ok = auth === `Bearer ${cronSecret}` || headerSecret === cronSecret || querySecret === cronSecret;
  if (!ok) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return null;
}

export function readCronSoftTimeoutMs(): number {
  return readIntEnv("CRON_SOFT_TIMEOUT_MS", 20_000, 5_000, 55_000);
}

export function readCronHardTimeoutMs(): number {
  return readIntEnv("CRON_HARD_TIMEOUT_MS", 25_000, 8_000, 60_000);
}

export function shouldStopCron(startTime: number, softTimeoutMs = readCronSoftTimeoutMs()): boolean {
  return Date.now() - startTime >= softTimeoutMs;
}

export function cronDuration(startTime: number): number {
  return Date.now() - startTime;
}
