import { defineConfig } from "drizzle-kit";

// Migrasi = file SQL ter-review di PR (ADR-0001). Hanya maju; tidak ada `drizzle-kit push`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/skema/index.ts",
  out: "./migrasi",
  casing: "snake_case",
});
