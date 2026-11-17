import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// PWA (ADR-0001: vite-plugin-pwa/Workbox). Hanya aset statis yang di-cache;
// data harga/stok/API selalu lewat jaringan (tidak ada runtimeCaching untuk /api).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "NEKAT — Belanja Bareng",
        short_name: "NEKAT",
        description: "Belanja bareng tetangga, makin banyak yang ikut makin murah.",
        lang: "id",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0B6B5F",
        background_color: "#F6F7F5",
        icons: [
          { src: "/icons/ikon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/ikon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/ikon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    // Paket workspace @nekat/* dibaca langsung dari src/ (lihat "exports" di package.json-nya).
    conditions: ["@nekat/source", ...defaultClientConditions],
  },
  build: {
    // "hidden": sourcemap dibuat (untuk error tracker) tapi tidak dirujuk dari bundle publik.
    sourcemap: "hidden",
  },
});
