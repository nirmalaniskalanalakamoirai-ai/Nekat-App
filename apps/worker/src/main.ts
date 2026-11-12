// Entry proses worker (dijalankan terpisah dari API, ADR-0001 §3.1). Tidak diimpor oleh tes.
import { bacaKonfigurasi } from "./config.js";
import { buatWorker } from "./worker.js";

const boss = buatWorker(bacaKonfigurasi(process.env));

boss.on("error", (galat: Error) => {
  // Hanya nama & pesan; jangan cetak objek mentah (bisa memuat connection string).
  console.error(`[worker] ${galat.name}: ${galat.message}`);
});

await boss.start();
console.info("[worker] pg-boss berjalan");

const berhenti = async (sinyal: string): Promise<void> => {
  console.info(`[worker] ${sinyal} diterima, berhenti dengan rapi`);
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.once("SIGTERM", () => void berhenti("SIGTERM"));
process.once("SIGINT", () => void berhenti("SIGINT"));
