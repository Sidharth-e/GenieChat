/** @type {import('next').NextConfig} */

const s3Endpoint = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT;
let s3Origin = "";
if (s3Endpoint) {
  try {
    s3Origin = new URL(s3Endpoint).origin;
  } catch {}
}

const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    // unsafe-eval required by mermaid.js rendering engine
    key: "Content-Security-Policy",
    value: `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://cdn.tailwindcss.com https://esm.sh https://unpkg.com;
      style-src 'self' 'unsafe-inline' https:;
      connect-src 'self' https://cdn.tailwindcss.com https://esm.sh https://unpkg.com ${s3Origin} ${!isProduction ? "http://localhost:* http://127.0.0.1:*" : ""};
      img-src 'self' blob: data: https: ${s3Origin} ${!isProduction ? "http://localhost:* http://127.0.0.1:*" : ""};
      font-src 'self' data: https:;
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      frame-src 'self' blob:;
      worker-src 'self' blob:;
      ${isProduction ? "upgrade-insecure-requests;" : ""}
    `
      .replace(/\s{2,}/g, " ")
      .trim(),
  },
];

const nextConfig = {
  reactStrictMode: true,
  logging: {
    incomingRequests: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    proxyClientMaxBodySize: "50mb",
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "date-fns",
      "recharts",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-tabs",
      "react-syntax-highlighter",
    ],
  },
  // next/image refuses to optimize an unlisted remote host and throws during
  // render, which is how a missing entry here escalates to global-error.tsx and
  // blanks the page. Only the two hosts the app actually feeds it are allowed:
  // GitHub's avatar_url on the session user (components/common/avatar.tsx) and
  // the favicon service the citation list uses (components/chat/sources-section.tsx).
  // A wildcard host would turn the optimizer into an open image proxy.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.google.com",
        pathname: "/s2/favicons",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // NOTE: output: "standalone" is disabled on Windows due to symlink permission issues.
  // Enable Developer Mode in Windows Settings OR run PowerShell as Admin to use it.
  output: "standalone",
  turbopack: {},
};

export default nextConfig;
