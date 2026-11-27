// @nekat/db — skema Drizzle, migrasi SQL, repositori, seed (ADR-0001 §3.1).
// T-013a: akun & autentikasi, legal, admin & peran, lokasi, katalog, stok, modal & harga, log.
// T-013b: keranjang, grup, invoice, reservasi, pembayaran & webhook, saldo, ongkir, promo, COD, outbox,
//         job_run, idempotensi InventorySource.
// T-015b: sinkron config/lokasi.json → gudang/zona/drop_point.

export const NAMA_PAKET = "@nekat/db";

export * as skema from "./skema/index.js";
export { buatDb, jalankanMigrasi, FOLDER_MIGRASI, type Db } from "./koneksi.js";
export { jalankanSeed, SEED_KATEGORI, SEED_ARMADA, KATA_TERLARANG } from "./seed.js";
export { buatRepoInventoriLokal } from "./repo/inventori-lokal.js";
export { buatPenyimpanIdempotensiPg } from "./repo/idempotensi-inventori.js";
export { buatRepoKatalog } from "./repo/katalog.js";
export {
  sinkronLokasi,
  rencanakanSinkronLokasi,
  bacaStatusLokasiDb,
  teksPerubahanLokasi,
  sidikIsiKonfig,
  periksaFkLokasi,
  STATUS_GRUP_FINAL,
  GalatSinkronLokasi,
  JENIS_LOG_SINKRON,
  type HasilSinkronLokasi,
  type LangkahSinkronLokasi,
  type OpsiSinkronLokasi,
  type PemakaianAktifLokasi,
  type PerubahanLokasi,
  type RencanaSinkronLokasi,
  type StatusLokasiDb,
} from "./sinkron-lokasi.js";
export {
  buatRepoAuthAdmin,
  type AdminUntukMasuk,
  type DataAdminBaru,
  type RepoAuthAdmin,
  type SesiAdminAktif,
} from "./repo/admin-auth.js";
export {
  buatRepoAdminKatalog,
  GalatRepoAdmin,
  type BarisLogAdmin,
  type BarisStokAdmin,
  type CekProdukRepo,
  type DataProduk,
  type DataSku,
  type Halaman,
  type KategoriAdmin,
  type KodeGalatRepoAdmin,
  type KonteksLog,
  type ProdukAdmin,
  type RepoAdminKatalog,
  type SatuanAdmin,
  type SkuAdmin,
} from "./repo/admin-katalog.js";
// T-019: snapshot lokal inventori (pemetaan sumber, pembaca katalog, penulis job sinkron), outbox picking.
export {
  buatPemetaanSumberPg,
  buatPembacaSnapshotInventori,
  buatRepoSinkronInventori,
  uuidDariTeks,
} from "./repo/snapshot-inventori.js";
export { buatRepoOutboxPicking } from "./repo/outbox-picking.js";
// T-029: pembayaran Xendit (siapkan/simpan instruksi/gagal/ganti metode).
export { buatRepoPembayaran } from "./repo/pembayaran.js";
