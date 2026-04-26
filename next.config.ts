import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.10"],
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
};

export default nextConfig;
