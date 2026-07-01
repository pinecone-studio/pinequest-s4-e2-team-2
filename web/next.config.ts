import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep these server-only (don't pull them into the client/RSC bundle).
  serverExternalPackages: ["yt-search", "cheerio", "youtube-transcript"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Lets Firebase Google sign-in popups post back to the opener window.
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  },
  images: {
    // YouTube serves thumbnails from i.ytimg.com AND i1–i9.ytimg.com (playlists
    // frequently use i9), and avatars from *.ggpht.com / *.googleusercontent.com.
    // A single un-allowlisted host makes next/image THROW during render, which
    // crashes the entire search-results list — so allow the whole subdomain
    // families with wildcards instead of listing hosts one by one.
    remotePatterns: [
      { protocol: "https", hostname: "**.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "**.ggpht.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
