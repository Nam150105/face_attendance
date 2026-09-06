import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Face Attendance — Quản lý hiện diện",
    short_name: "Face Attendance",
    description:
      "Ghi nhận hiện diện bằng nhận diện khuôn mặt và định vị GPS, dùng chung cho doanh nghiệp, trường học và trung tâm đào tạo.",
    lang: "vi",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#060913",
    theme_color: "#070913",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
