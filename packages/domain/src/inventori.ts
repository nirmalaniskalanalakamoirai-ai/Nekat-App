// Port `InventorySource` (T-009 §3, ADR-0001 §4.1) + port pendukung + aturan murni stok.
// Implementasi ada di @nekat/adapters (LocalInventory; GudangApiInventory di T-019).
// Repositori DB untuk LocalInventory ada di @nekat/db. Domain hanya mendefinisikan bentuknya.
import {
  BATAS_SKU_PER_PANGGILAN,
  type HasilPicking,
  type KonfirmasiStok,
  type ModalSumber,
  type NamaSumberInventory,
  type PermintaanPicking,
  type SkuSumber,
  type StokSumber,
  type StokTerkonfirmasi,
} from "@nekat/shared";

export type SkuId = string;

/**
 * Satu-satunya pintu NEKAT ke data SKU, stok, dan harga modal. Modul lain membaca snapshot lokal,
 * bukan memanggil Gudang langsung (T-009 §1). Aturan umum:
 * - `skuIds` maks. `BATAS_SKU_PER_PANGGILAN` (200); pemanggil memecah batch (`pecahBatch`).
 * - SKU tak dikenal TIDAK dilempar sebagai error; SKU itu tidak muncul di hasil
 *   (pemanggil memperlakukannya sebagai stok 0 & modal kosong → tidak tayang).
 * - `konfirmasiStok` & `kirimPermintaanPicking` idempoten per `kunciIdempotensi`;
 *   kunci sama + isi beda → `InventoryError("KONFLIK_IDEMPOTENSI")`.
 * - Adapter tidak menulis snapshot/reservasi ke DB NEKAT; itu tugas modul `inventori`.
 * - Error selalu `InventoryError` (kode tetap, T-009 §4).
 */
export interface InventorySource {
  readonly nama: NamaSumberInventory;
  listSku(sejak?: Date): Promise<SkuSumber[]>;
  getStok(skuIds: readonly SkuId[], lokasiId: string): Promise<StokSumber[]>;
  getHargaModal(skuIds: readonly SkuId[]): Promise<ModalSumber[]>;
  konfirmasiStok(req: KonfirmasiStok): Promise<StokTerkonfirmasi>;
  kirimPermintaanPicking(req: PermintaanPicking): Promise<HasilPicking>;
}

// ---- Port repositori untuk LocalInventory (diimplementasi @nekat/db) ----

export interface BarisSkuLokal {
  readonly skuId: string;
  readonly namaProduk: string;
  readonly namaVarian: string | null;
  /** Kode subkategori produk. */
  readonly kategoriKode: string;
  /** Kode kategori induk (null bila produk menempel di kategori akar). */
  readonly indukKategoriKode: string | null;
  readonly satuanDasar: string;
  readonly barcode: string | null;
  /** `sku.aktif_di_sumber` DAN `produk.aktif`. */
  readonly aktif: boolean;
  /** Perubahan terakhir SKU, produk, atau satuan jualnya. */
  readonly diubahPada: Date;
  readonly satuanJual: readonly { jenis: string; isi: number; beratGram: number }[];
}

export interface BarisStokLokal {
  readonly skuId: string;
  readonly gudangId: string;
  readonly tersedia: number;
  readonly dataPada: Date;
}

export interface BarisModalLokal {
  readonly skuId: string;
  readonly jenis: string;
  /** `modal_satuan_jual.modal_rp`; null bila kosong atau belum ada baris modal. */
  readonly modalRp: number | null;
  readonly dataPada: Date;
}

/** Bacaan tabel NEKAT untuk LocalInventory. Hanya baca; ID yang diterima sudah berformat UUID. */
export interface RepoInventoriLokal {
  daftarSku(sejak?: Date): Promise<BarisSkuLokal[]>;
  stok(skuIds: readonly string[], gudangId: string): Promise<BarisStokLokal[]>;
  modal(skuIds: readonly string[]): Promise<BarisModalLokal[]>;
}

/**
 * Penyimpan hasil operasi idempoten (konfirmasi stok, picking). `simpanBilaBelumAda` atomik:
 * bila kunci sudah ada, mengembalikan entri lama (hash & hasil pertama) tanpa menimpa.
 */
export interface EntriIdempotensi<T> {
  readonly hash: string;
  readonly hasil: T;
}
export interface PenyimpanIdempotensi {
  simpanBilaBelumAda<T>(
    ruang: "konfirmasi" | "picking",
    kunci: string,
    entri: EntriIdempotensi<T>,
  ): Promise<{ baru: boolean; entri: EntriIdempotensi<T> }>;
}

// ---- Aturan murni ----

/** Memecah daftar menjadi potongan maks. `ukuran` (bawaan 200, T-009 §3). */
export function pecahBatch<T>(daftar: readonly T[], ukuran = BATAS_SKU_PER_PANGGILAN): T[][] {
  if (!Number.isInteger(ukuran) || ukuran < 1) throw new RangeError("ukuran batch harus >= 1");
  const hasil: T[][] = [];
  for (let i = 0; i < daftar.length; i += ukuran) hasil.push(daftar.slice(i, i + ukuran));
  return hasil;
}

export type StatusStokSatuanJual =
  | { readonly status: "TERSEDIA"; readonly bolehDibeli: true; readonly maksQty: number }
  | { readonly status: "HABIS"; readonly bolehDibeli: false; readonly maksQty: 0 };

/**
 * Status stok satu satuan jual (K-20): produk stok habis TETAP tampil berlabel `LABEL_STOK_HABIS`,
 * tombol beli nonaktif. `stokBebas` = stok snapshot − reservasi aktif (satuan dasar).
 * Masuk keranjang tidak memotong stok (P-08); pemotongan terjadi saat invoice terbit.
 */
export function statusStokSatuanJual(
  stokBebas: number,
  isiSatuanDasar: number,
): StatusStokSatuanJual {
  if (!Number.isInteger(isiSatuanDasar) || isiSatuanDasar < 1) {
    throw new RangeError("isi satuan jual harus bilangan bulat >= 1");
  }
  const bebas = Number.isFinite(stokBebas) ? Math.max(0, Math.trunc(stokBebas)) : 0;
  const maksQty = Math.floor(bebas / isiSatuanDasar);
  return maksQty >= 1
    ? { status: "TERSEDIA", bolehDibeli: true, maksQty }
    : { status: "HABIS", bolehDibeli: false, maksQty: 0 };
}

/**
 * Apakah data inventori masih dalam batas usia (P-10, bawaan 15 menit). `LocalInventory` tidak
 * pernah kedaluwarsa (T-009 §6). Data dari masa depan (jam sumber maju) dianggap segar.
 */
export function dataInventoriSegar(
  sumber: NamaSumberInventory,
  dataPada: Date,
  sekarang: Date,
  maksUmurMenit: number,
): boolean {
  if (sumber === "local") return true;
  const umurMs = sekarang.getTime() - dataPada.getTime();
  if (Number.isNaN(umurMs)) return false;
  return umurMs <= maksUmurMenit * 60_000;
}

/** Kata kategori terlarang Fase 1 (keputusan #7). Dicocokkan per segmen kode kategori. */
export const KATA_KATEGORI_TERLARANG = [
  "rokok",
  "tembakau",
  "vape",
  "bir",
  "alkohol",
  "miras",
  "anggur",
] as const;

/** true bila salah satu segmen kode (pisah `-`) adalah kata terlarang, mis. `minuman-bir`. */
export function kodeKategoriTerlarang(
  kode: string,
  kataTerlarang: readonly string[] = KATA_KATEGORI_TERLARANG,
): boolean {
  const segmen = kode.toLowerCase().split(/[^a-z0-9]+/);
  return segmen.some((s) => kataTerlarang.includes(s));
}
