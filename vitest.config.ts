import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

const kondisi = ["@nekat/source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions: kondisi },
  ssr: { resolve: { conditions: kondisi } },
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
    // Tes integrasi PostgreSQL (service container di CI) ditambahkan di T-013.
  },
});
