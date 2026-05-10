import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "환경순찰 통합플랫폼",
    short_name: "환경순찰",
    description: "후암동 환경순찰 통합 관리 플랫폼",
    start_url: "/",
    display: "standalone",
    background_color: "#ecfdf5",
    theme_color: "#059669",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
