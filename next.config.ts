import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Không bundle puppeteer-core vào server bundle (connect tới remote Chromium).
  serverExternalPackages: ["puppeteer-core"],
};

export default nextConfig;
