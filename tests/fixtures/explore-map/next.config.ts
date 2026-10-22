import path from "node:path";

const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../../.."),
    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
  },
  devIndicators: false,
};

export default nextConfig;
