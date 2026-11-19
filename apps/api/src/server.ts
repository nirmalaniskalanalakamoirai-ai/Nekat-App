// Entry proses API. Tidak diimpor oleh tes (tes memakai `buatApp` + `inject`).
import { bacaKonfigInventory, pastikanSumberInventoryTersedia } from "@nekat/adapters";
import { z } from "zod";
import { buatApp } from "./app.js";
import { muatKonfigLokasi } from "./lokasi.js";

const skemaEnv = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  // String kosong diperlakukan sebagai "tidak diisi" → default.
  PORT: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),
  // Path config zona (T-015). File tidak ada = zona belum diatur (rute zona 503).
  LOKASI_CONFIG: z.string().min(1).default("config/lokasi.json"),
});

const env = skemaEnv.safeParse(process.env);
if (!env.success) {
  // Sebut nama variabel saja, bukan nilainya (ADR-0001 §6).
  const nama = [...new Set(env.error.issues.map((isu) => isu.path.join(".")))].join(", ");
  console.error(`Konfigurasi API tidak valid: ${nama}`);
  process.exit(1);
}

// Toggle InventorySource (T-018): dibaca & divalidasi saat start; nilai salah → gagal start.
try {
  pastikanSumberInventoryTersedia(bacaKonfigInventory(process.env));
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

let lokasi;
try {
  lokasi = await muatKonfigLokasi(env.data.LOKASI_CONFIG);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const app = buatApp({ lokasi });
if (!lokasi) app.log.warn("config/lokasi.json belum ada: rute zona menjawab 503");
try {
  await app.listen({ host: env.data.HOST, port: env.data.PORT });
} catch (err) {
  // Mis. EADDRINUSE / ENOTFOUND: catat terstruktur lalu keluar, jangan stack mentah.
  app.log.fatal({ err }, "API gagal listen");
  process.exit(1);
}

const berhenti = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.once("SIGTERM", () => void berhenti());
process.once("SIGINT", () => void berhenti());
