import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows the local Android device to load Next.js development resources over the LAN.
  allowedDevOrigins: ["192.168.11.129"],
};

export default nextConfig;
