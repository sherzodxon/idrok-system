import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@idrok/shared"],
  poweredByHeader: false,
};

export default config;
