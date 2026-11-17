import { defineConfig } from "drizzle-kit";

// Migrasi = file SQL yang di-review di PR (ADR-0001). Hanya maju.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/skema/index.ts",
  out: "./migrasi",
  strict: true,
  verbose: true,
});
