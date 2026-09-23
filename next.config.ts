import type { NextConfig } from "next";

const securityHeaders = [
  // Nothing may frame the app (clickjacking), and only same-origin can embed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // The camera is used for photographing documents on phones; nothing else is.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The app used to have a section per business and a separate Companies page;
  // it's now one set of pages scoped by the business switcher. Old links keep
  // working by switching to the right business on the way through.
  async redirects() {
    return [
      { source: "/ipc", destination: "/scope?b=ipc&next=/invoices", permanent: false },
      { source: "/ipc/new", destination: "/scope?b=ipc&next=/invoices/new", permanent: false },
      { source: "/ipc/:id", destination: "/invoices/:id", permanent: false },
      { source: "/ipc/:id/edit", destination: "/invoices/:id/edit", permanent: false },
      { source: "/iwc", destination: "/scope?b=iwc&next=/invoices", permanent: false },
      { source: "/iwc/new", destination: "/scope?b=iwc&next=/invoices/new", permanent: false },
      { source: "/iwc/:id", destination: "/invoices/:id", permanent: false },
      { source: "/iwc/:id/edit", destination: "/invoices/:id/edit", permanent: false },
      { source: "/mulberry", destination: "/scope?b=mulberry&next=/invoices", permanent: false },
      { source: "/mulberry/new", destination: "/scope?b=mulberry&next=/invoices/new", permanent: false },
      { source: "/mulberry/:id", destination: "/invoices/:id", permanent: false },
      { source: "/mulberry/:id/edit", destination: "/invoices/:id/edit", permanent: false },
      { source: "/companies", destination: "/settings/businesses", permanent: false },
      { source: "/companies/:id", destination: "/settings/businesses/:id", permanent: false },
      { source: "/expenses", destination: "/money", permanent: false },
      { source: "/expenses/new", destination: "/money/new", permanent: false },
      { source: "/expenses/:id/edit", destination: "/money/:id/edit", permanent: false },
      { source: "/settings/users", destination: "/settings/team", permanent: false },
    ];
  },
};

export default nextConfig;
