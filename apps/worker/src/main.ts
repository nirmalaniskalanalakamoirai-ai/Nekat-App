// Entry proses worker (dijalankan terpisah dari API, ADR-0001 §3.1). Tidak diimpor oleh tes.
import { buatInventorySource, type PeristiwaInventori } from "@nekat/adapters";
import {
  buatDb,
  buatPemetaanSumberPg,
  buatPenyimpanIdempotensiPg,
  buatRepoInventoriLokal,
  buatRepoOutboxPicking,
  buatRepoSinkronInventori,
} from "@nekat/db";
import type { InventorySource } from "@nekat/domain";
import { bacaKonfigurasi } from "./config.js";
import { kirimOutboxPicking } from "./inventori/picking.js";
import { PengumpulPeristiwaSinkron, sinkronInventori } from "./inventori/sinkron.js";
import { buatWorker, daftarkanJobInventori } from "./worker.js";

let konfigurasi;
try {
  konfigurasi = bacaKonfigurasi(process.env);
} catch (e) {
  // Pesan hanya menyebut nama variabel (tanpa nilai rahasia).
  console.error((e as Error).message);
  process.exit(1);
}

const db = buatDb(konfigurasi.databaseUrl);
const idempotensi = buatPenyimpanIdempotensiPg(db);

/** Log peristiwa inventori: hanya kode & ID (tanpa token/URL/PII). */
const logPeristiwa = (p: PeristiwaInventori): void => {
  if (p.kode === "PANGGILAN_DIULANG" || p.kode === "BARIS_TIDAK_VALID") {
    console.warn(`[worker] inventori ${p.kode}: ${p.keterangan}`);
  }
};
const pengumpul = new PengumpulPeristiwaSinkron(logPeristiwa);

// Toggle InventorySource (T-018/T-019): dibaca sekali saat start. Gagal → keluar dengan pesan jelas
// (pesan error adapter/konfigurasi hanya menyebut nama variabel/dependensi, tanpa nilai rahasia).
let inventory: InventorySource;
try {
  inventory = buatInventorySource(konfigurasi.inventory, {
    idempotensi,
    repo: buatRepoInventoriLokal(db),
    pemetaan: buatPemetaanSumberPg(db),
    profilBaca: "sinkron",
    catat: pengumpul.catat,
  });
} catch (e) {
  console.error(
    `[worker] InventorySource "${konfigurasi.inventory.sumber}" gagal dibuat: ${(e as Error).message}`,
  );
  await db.$client.end();
  process.exit(1);
}
const repoSinkron = buatRepoSinkronInventori(db);
const repoOutbox = buatRepoOutboxPicking(db);

const boss = buatWorker(konfigurasi);
console.info(`[worker] sumber inventori: ${konfigurasi.inventory.sumber}`);

boss.on("error", (galat: Error) => {
  // Hanya nama & pesan; jangan cetak objek mentah (bisa memuat connection string).
  console.error(`[worker] ${galat.name}: ${galat.message}`);
});

await boss.start();
await daftarkanJobInventori(boss, {
  intervalSinkronMenit: konfigurasi.inventory.intervalSinkronMenit,
  sinkron:
    inventory.nama === "gudang"
      ? async () => {
          const h = await sinkronInventori({
            inventory,
            repo: repoSinkron,
            pengumpul,
            batasNonaktif: konfigurasi.inventory.batasNonaktif,
          });
          if (h.gagal.length > 0) {
            console.warn(`[worker] sinkron Gudang sebagian gagal: ${JSON.stringify(h.gagal)}`);
          }
        }
      : null,
  kirimPicking: () => kirimOutboxPicking({ inventory, repo: repoOutbox }),
});
console.info("[worker] pg-boss berjalan");

const berhenti = async (sinyal: string): Promise<void> => {
  console.info(`[worker] ${sinyal} diterima, berhenti dengan rapi`);
  await boss.stop({ graceful: true });
  await db.$client.end();
  process.exit(0);
};
process.once("SIGTERM", () => void berhenti("SIGTERM"));
process.once("SIGINT", () => void berhenti("SIGINT"));
