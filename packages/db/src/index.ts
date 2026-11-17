// @nekat/db — skema Drizzle, migrasi SQL, koneksi, seed (ADR-0001 §3.1).
export {
  bukaKoneksi,
  jalankanMigrasi,
  FOLDER_MIGRASI,
  type Db,
  type KoneksiDb,
} from "./koneksi.js";
export { jalankanSeed, KATEGORI_SEED, KATEGORI_TERLARANG } from "./seed.js";
export * as skema from "./skema/index.js";

export const NAMA_PAKET = "@nekat/db";
