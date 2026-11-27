// Entry proses API. Tidak diimpor oleh tes (tes memakai `buatApp` + `inject`).
import { bacaKonfigInventory, type KonfigInventory } from "@nekat/adapters";
import {
  bacaStatusLokasiDb,
  buatDb,
  buatPembacaSnapshotInventori,
  buatRepoAdminKatalog,
  buatRepoAuthAdmin,
  buatRepoKatalog,
  buatRepoSaldo,
  rencanakanSinkronLokasi,
  teksPerubahanLokasi,
  type Db,
  type RepoSaldo,
} from "@nekat/db";
import { KONFIGURASI_HARGA_BAWAAN } from "@nekat/domain";
import { z } from "zod";
import { alamatAtauCidr, bacaKonfigAdmin, type KonfigAdmin } from "./admin/konfig.js";
import { LayananAuthAdmin } from "./admin/layanan-auth.js";
import type { OpsiRuteAdmin } from "./admin/rute.js";
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
  // Alamat/CIDR reverse proxy tepercaya, dipisah koma (mis. "127.0.0.1" atau "10.0.0.0/8").
  // Kosong = X-Forwarded-For diabaikan. Lihat .env.example (wajib HOST=127.0.0.1 / firewall).
  TRUST_PROXY: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x !== "")
        : [],
    z.array(z.string().refine(alamatAtauCidr)).max(16),
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

// Panel admin (T-036): aktif bila DATABASE_URL + ADMIN_TOTP_KUNCI + ADMIN_HMAC_KUNCI diisi.
let konfigAdmin: KonfigAdmin | null;
try {
  konfigAdmin = bacaKonfigAdmin(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

let katalog: LayananKatalog | null = null;
let admin: OpsiRuteAdmin | null = null;
let db: Db | null = null;
let repoSaldo: RepoSaldo | null = null;
if (env.data.DATABASE_URL !== undefined) {
  db = buatDb(env.data.DATABASE_URL);
  // T-021: rute saldo tetap 401 untuk semua permintaan sampai autentikasi pembeli (T-016) disuntikkan.
  repoSaldo = buatRepoSaldo(db);
  katalog = new LayananKatalog({
    repo: buatRepoKatalog(db),
    // T-019: katalog membaca snapshot lokal, tidak memanggil Gudang per request (T-009 §6). Snapshot
    // diisi job sinkron worker (mode gudang) atau panel admin/CSV (mode local).
    snapshot: buatPembacaSnapshotInventori(db),
    sumber: konfigInventory.sumber,
    // Konfigurasi harga dari panel admin menyusul (T-037); bawaan: PPN belum dikonfigurasi.
    // Batas usia modal SENGAJA tidak dipakai untuk tampilan katalog: saat Gudang terganggu katalog
    // tetap tampil dari snapshot (T-009 §6), stok basi = "sedang dicek" & tombol beli nonaktif.
    // TODO(invoice/checkout, K-15/P-10): penerbitan tagihan WAJIB menolak modal yang lebih tua dari
    // INVENTORY_MAKS_UMUR_DATA_MENIT. Belum ada use case invoice, jadi belum ada penjualan.
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

if (db && konfigAdmin) {
  admin = {
    auth: new LayananAuthAdmin({ repo: buatRepoAuthAdmin(db), konfig: konfigAdmin }),
    katalog: buatRepoAdminKatalog(db),
    sumberInventori: konfigInventory.sumber,
    originDiizinkan: konfigAdmin.originDiizinkan,
    batasMasukGlobalPerMenit: konfigAdmin.masukGlobalPerMenit,
  };
}

let lokasi;
try {
  lokasi = await muatKonfigLokasi(env.data.LOKASI_CONFIG);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const app = buatApp({
  lokasi,
  katalog,
  admin,
  trustProxy: env.data.TRUST_PROXY,
  saldo: { repo: repoSaldo },
});
if (!lokasi) app.log.warn("config/lokasi.json belum ada: rute zona menjawab 503");
if (!katalog) app.log.warn("DATABASE_URL belum diisi: rute katalog menjawab 503");
if (!admin) app.log.warn("Panel admin belum dikonfigurasi (DATABASE_URL/ADMIN_*): /api/admin 503");

// T-015b: koordinat tetap dibaca dari config (M7); tabel gudang/zona/drop_point hanya cerminan
// untuk FK. Saat start, peringatkan bila cerminan belum sesuai config (tidak menahan start).
if (db && lokasi) {
  const dbLokasi = db;
  const konfigLokasi = lokasi;
  void (async () => {
    try {
      const rencana = rencanakanSinkronLokasi(konfigLokasi, await bacaStatusLokasiDb(dbLokasi));
      if (rencana.langkah.length > 0 || rencana.konflik.length > 0) {
        app.log.warn(
          {
            selisih: rencana.langkah.map(teksPerubahanLokasi),
            konflik: rencana.konflik,
            konflikPemakaian: rencana.konflikPemakaian,
          },
          "lokasi: DB belum sesuai config/lokasi.json — jalankan `pnpm db:sinkron-lokasi`",
        );
      }
    } catch (err) {
      app.log.warn({ err }, "lokasi: cek sinkron config → DB gagal");
    }
  })();
}
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
