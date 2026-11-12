// Entry proses API. Tidak diimpor oleh tes (tes memakai `buatApp` + `inject`).
import { z } from "zod";
import { buatApp } from "./app.js";

const skemaEnv = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

const env = skemaEnv.safeParse(process.env);
if (!env.success) {
  // Sebut nama variabel saja, bukan nilainya (ADR-0001 §6).
  const nama = [...new Set(env.error.issues.map((isu) => isu.path.join(".")))].join(", ");
  console.error(`Konfigurasi API tidak valid: ${nama}`);
  process.exit(1);
}

const app = buatApp();
await app.listen({ host: env.data.HOST, port: env.data.PORT });

const berhenti = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.once("SIGTERM", () => void berhenti());
process.once("SIGINT", () => void berhenti());
