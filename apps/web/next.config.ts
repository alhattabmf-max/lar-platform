import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * A review link exposes only the Next.js port. In that mode the browser
   * calls the API through the same HTTPS origin, while Next forwards the
   * request to the API bound to localhost. Production keeps its existing
   * two-origin topology because this rewrite exists only when the preview
   * launcher explicitly opts in.
   */
  async rewrites() {
    const api = process.env.PREVIEW_PROXY_API_URL?.replace(/\/$/, "");
    if (!api) return [];

    return [
      {
        source: "/api/v1/:path*",
        destination: `${api}/api/v1/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
