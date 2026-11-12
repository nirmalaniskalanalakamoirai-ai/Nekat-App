import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

// PWA (vite-plugin-pwa: manifest + service worker) dipasang di T-014.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Paket workspace @nekat/* dibaca langsung dari src/ (lihat "exports" di package.json-nya).
    conditions: ["@nekat/source", ...defaultClientConditions],
  },
  build: {
    // "hidden": sourcemap dibuat (untuk error tracker) tapi tidak dirujuk dari bundle publik.
    sourcemap: "hidden",
  },
});
