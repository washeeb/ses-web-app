import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "https://synclyticsenterprisesystems.com";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/ops", "/portal", "/partner", "/account", "/api/", "/login", "/reset-password", "/store/cart", "/dev"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
