// @nekat/db — skema Drizzle, migrasi SQL, repositori, seed (ADR-0001 §3.1).
// T-013a: akun & autentikasi, legal, admin & peran, lokasi, katalog, stok, modal & harga, log.
// T-013b: keranjang, grup, invoice, reservasi, pembayaran & webhook, saldo, ongkir, promo, COD, outbox,
//         job_run, idempotensi InventorySource.

export const NAMA_PAKET = "@nekat/db";

export * as skema from "./skema/index.js";
export { buatDb, jalankanMigrasi, FOLDER_MIGRASI, type Db } from "./koneksi.js";
export { jalankanSeed, SEED_KATEGORI, SEED_ARMADA, KATA_TERLARANG } from "./seed.js";
export { buatRepoInventoriLokal } from "./repo/inventori-lokal.js";
export { buatPenyimpanIdempotensiPg } from "./repo/idempotensi-inventori.js";
export { buatRepoKatalog } from "./repo/katalog.js";
// T-019: snapshot lokal inventori (pemetaan sumber, pembaca katalog, penulis job sinkron), outbox picking.
export {
  buatPemetaanSumberPg,
  buatPembacaSnapshotInventori,
  buatRepoSinkronInventori,
  uuidDariTeks,
} from "./repo/snapshot-inventori.js";
export { buatRepoOutboxPicking } from "./repo/outbox-picking.js";
