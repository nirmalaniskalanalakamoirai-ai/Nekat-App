// Entry proses API. Tidak diimpor oleh tes (tes memakai `buatApp` + `inject`).
import { bacaKonfigInventory, type KonfigInventory } from "@nekat/adapters";
import { buatDb, buatPembacaSnapshotInventori, buatRepoKatalog } from "@nekat/db";
import { KONFIGURASI_HARGA_BAWAAN } from "@nekat/domain";
import { z } from "zod";
import { buatApp } from "./app.js";
import { LayananKatalog } from "./katalog/layanan.js";
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
  // Katalog (T-025). Kosong = katalog belum siap (rute katalog 503).
  DATABASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^postgres(ql)?:\/\//)
      .optional(),
  ),
  // Umur cache snapshot katalog (detik), 0 = tanpa cache.
  KATALOG_CACHE_DETIK: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().min(0).max(300).default(10),
  ),
});

const env = skemaEnv.safeParse(process.env);
if (!env.success) {
  // Sebut nama variabel saja, bukan nilainya (ADR-0001 §6).
  const nama = [...new Set(env.error.issues.map((isu) => isu.path.join(".")))].join(", ");
  console.error(`Konfigurasi API tidak valid: ${nama}`);
  process.exit(1);
}

// Toggle InventorySource (T-018/T-019): dibaca & divalidasi saat start; nilai salah → gagal start.
let konfigInventory: KonfigInventory;
try {
  konfigInventory = bacaKonfigInventory(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

let katalog: LayananKatalog | null = null;
if (env.data.DATABASE_URL !== undefined) {
  const db = buatDb(env.data.DATABASE_URL);
  katalog = new LayananKatalog({
    repo: buatRepoKatalog(db),
    // T-019: katalog membaca snapshot lokal, tidak memanggil Gudang per request (T-009 §6). Snapshot
    // diisi job sinkron worker (mode gudang) atau panel admin/CSV (mode local).
    snapshot: buatPembacaSnapshotInventori(db),
    sumber: konfigInventory.sumber,
    // Konfigurasi harga dari panel admin menyusul (T-037); bawaan: PPN belum dikonfigurasi.
    // Batas usia modal TIDAK dipakai untuk tampilan katalog: saat Gudang terganggu katalog tetap
    // tampil dari snapshot (T-009 §6) dengan stok "sedang dicek"; batas usia P-10 ditegakkan saat
    // invoice/checkout (K-15; use case invoice menyusul).
    konfigurasiHarga: KONFIGURASI_HARGA_BAWAAN,
    maksUmurDataMenit: konfigInventory.maksUmurDataMenit,
    cacheMs: env.data.KATALOG_CACHE_DETIK * 1000,
    // K-42: laporkan ke admin. Antrean tinjauan/panel admin menyusul (T-037); sementara log terstruktur.
    laporDitahan: (ditahan) => {
      const perKode: Record<string, number> = {};
      for (const d of ditahan) for (const k of d.kode) perKode[k] = (perKode[k] ?? 0) + 1;
      app.log.warn(
        { jumlah: ditahan.length, perKode, satuanJual: ditahan.slice(0, 50) },
        "katalog: satuan jual ditahan (tidak tayang)",
      );
    },
  });
}

let lokasi;
try {
  lokasi = await muatKonfigLokasi(env.data.LOKASI_CONFIG);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const app = buatApp({ lokasi, katalog });
if (!lokasi) app.log.warn("config/lokasi.json belum ada: rute zona menjawab 503");
if (!katalog) app.log.warn("DATABASE_URL belum diisi: rute katalog menjawab 503");
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
