import type { NextConfig } from "next";

// Security ("firewall") headers applied to every response. These harden the app
// against clickjacking, MIME sniffing, referrer leakage and insecure transport.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Server Actions cap request bodies at 1 MB by default, which silently fails any
  // real document upload. Raise it to match the 25 MB storage limit. (On Vercel the
  // platform also caps serverless bodies at ~4.5 MB, which is why portal document
  // uploads go BROWSER → Supabase Storage directly via a signed URL — see
  // createDocUploadUrl/finalizeDocUpload — bypassing the request body entirely.)
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
