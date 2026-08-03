import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) resolves its worker script through a real
  // Node `require` at runtime — bundling it breaks that resolution.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
