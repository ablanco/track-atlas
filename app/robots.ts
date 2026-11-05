import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { appOrigin, indexingEnabled } from "@/seo/config";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  if (!indexingEnabled())
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
        allow: ["/_next/", "/images/", "/api/tracks/"],
      },
    };
  // Utility pages expose noindex themselves: allow crawling so it can be read.
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${appOrigin()}/sitemap.xml`,
  };
}
