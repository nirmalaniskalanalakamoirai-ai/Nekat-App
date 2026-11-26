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
  type StatusStok,
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
  /**
   * Baca entri yang sudah ada (T-019, I-02: NEKAT cek dulu sebelum mengirim ulang ke Gudang).
   * null = kunci belum pernah dipakai.
   */
  ambil<T>(ruang: "konfirmasi" | "picking", kunci: string): Promise<EntriIdempotensi<T> | null>;
}

// ---- Port untuk GudangApiInventory & snapshot lokal (T-019) ----

/**
 * Pemetaan ID NEKAT ↔ ID sumber (Gudang). SKU: tabel `pemetaan_sku_sumber` (T-009 §7).
 * Lokasi: DEFAULT SEMENTARA (IG-03) `gudang.kode_konfig` dipakai sebagai kode lokasi di Gudang.
 * Hanya baca; adapter tidak menulis ke DB NEKAT.
 */
export interface PemetaanSumberInventori {
  /** skuId NEKAT → skuSumberId. SKU tanpa pemetaan tidak ada di peta. */
  skuKeSumber(skuIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** skuSumberId → skuId NEKAT. ID sumber tanpa pemetaan tidak ada di peta. */
  skuDariSumber(skuSumberIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** `gudang.id` NEKAT → kode lokasi di sumber; null bila tidak ada / nonaktif. */
  lokasiKeSumber(lokasiId: string): Promise<string | null>;
}

/**
 * Pembaca snapshot lokal stok & modal (T-009 §6): katalog, engine harga, dan reservasi SELALU
 * membaca ini, tidak pernah memanggil `InventorySource` per request (T-019, tindak lanjut T-025).
 * `dataPada` = waktu tertua antara data sumber dan sinkron terakhir (dipakai cek batas usia P-10).
 */
export interface PembacaSnapshotInventori {
  stok(skuIds: readonly string[], gudangId: string): Promise<BarisStokLokal[]>;
  modal(skuIds: readonly string[]): Promise<BarisModalLokal[]>;
}

/** Tinjauan admin dari job sinkron (T-004 §3.15 `antrean_tinjauan`). Tanpa data pribadi. */
export type TinjauanSinkron =
  | {
      readonly jenis: "MODAL_PECAHAN";
      readonly skuId: string;
      readonly satuan: string;
      /** Nilai modal apa adanya (teks), tidak dibulatkan (K-01). */
      readonly nilaiMentah: string;
    }
  | { readonly jenis: "SKU_BELUM_DIPETAKAN"; readonly skuSumberId: string; readonly nama: string };

/**
 * Penulis snapshot lokal oleh job sinkron (modul `inventori`, T-009 §1/§6). Adapter tidak menulis DB;
 * worker memanggil adapter lalu menulis lewat port ini. Modal hanya disimpan sebagai modal: harga jual &
 * margin TIDAK dihitung/diisi di sini.
 */
export interface RepoSinkronInventori {
  /** SKU NEKAT yang punya `pemetaan_sku_sumber` (dikelola Gudang), urut id. */
  skuTerpetakan(): Promise<string[]>;
  /** `gudang.id` aktif yang punya kode lokasi sumber. */
  lokasiAktif(): Promise<string[]>;
  /**
   * Terapkan status SKU dari sumber (`sku.aktif_di_sumber`). `penuh`: SKU terpetakan yang tidak
   * muncul di `listSku()` dinonaktifkan (tak dikenal / kategori terlarang → tidak tayang).
   */
  terapkanSku(
    hasil: readonly SkuSumber[],
    opsi: { readonly penuh: boolean; readonly waktu: Date },
  ): Promise<{ diubah: number; dinonaktifkan: number; satuanBeda: number }>;
  /**
   * Simpan stok satu cabang. `isiNol`: SKU diminta yang tidak dikembalikan sumber = tak dikenal →
   * stok 0 (T-009 §3); false bila ada baris tidak valid di respons (data lama dibiarkan menua →
   * "tidak diketahui", bukan "habis").
   */
  simpanStok(
    lokasiId: string,
    diminta: readonly string[],
    stok: readonly StokSumber[],
    opsi: { readonly isiNol: boolean; readonly waktu: Date },
  ): Promise<number>;
  /**
   * Simpan modal per satuan jual (K-01) untuk SKU yang diminta. Satuan jual yang tidak dikembalikan
   * atau tidak valid → modal kosong (tidak tayang; snapshot lama TIDAK dipakai, T-009 §4).
   * Penurunan modal hanya dicatat di log audit (K-02).
   */
  simpanModal(
    diminta: readonly string[],
    modal: readonly ModalSumber[],
    waktu: Date,
  ): Promise<{ disimpan: number; dikosongkan: number; turun: number }>;
  catatTinjauan(t: TinjauanSinkron): Promise<void>;
  /** `log_audit` aktor SISTEM. `data` tanpa PII/rahasia. */
  catatAudit(jenis: string, data: Readonly<Record<string, unknown>>): Promise<void>;
}

/** Entri outbox picking yang sedang diklaim worker (T-009 §5: retry berjenjang sampai 6 jam). */
export interface EntriOutboxPicking {
  readonly id: string;
  readonly kunciIdempotensi: string;
  /** Payload mentah (divalidasi ulang sebelum dikirim). */
  readonly payload: unknown;
  /** Termasuk percobaan yang sedang berjalan. */
  readonly percobaan: number;
  readonly dibuatPada: Date;
}

export interface RepoOutboxPicking {
  /** Masukkan permintaan picking ke outbox; kunci sama → tidak dobel. */
  antrekan(p: PermintaanPicking): Promise<{ baru: boolean }>;
  /** Klaim entri MENUNGGU yang jatuh tempo dengan lease (mencegah kirim ganda antar-worker). */
  klaim(batas: number, sekarang: Date, leaseMs: number): Promise<EntriOutboxPicking[]>;
  tandaiTerkirim(id: string, hasil: HasilPicking, sekarang: Date): Promise<void>;
  jadwalkanUlang(id: string, kirimSetelah: Date, kodeGalat: string): Promise<void>;
  /** Status GAGAL + antrean tinjauan admin (`PICKING_GAGAL` / `KONFLIK_IDEMPOTENSI`). */
  tandaiGagal(
    id: string,
    kodeGalat: string,
    jenisTinjauan: "PICKING_GAGAL" | "KONFLIK_IDEMPOTENSI",
  ): Promise<void>;
}

// ---- Aturan murni ----

/** T-009 §5: retry picking sampai 6 jam sejak masuk outbox, lalu `GAGAL` di panel admin. */
export const BATAS_RETRY_PICKING_MS = 6 * 60 * 60_000;
const JEDA_AWAL_PICKING_MS = 30_000;
const JEDA_MAKS_PICKING_MS = 30 * 60_000;

/**
 * Waktu kirim ulang picking (backoff eksponensial 30 dtk × 2^(n−1), maks. 30 menit, jitter ≤ 10%).
 * null = batas 6 jam terlampaui → `GAGAL`. `acak` ∈ [0, 1) diberikan pemanggil (domain murni).
 */
export function jadwalUlangPicking(
  percobaan: number,
  dibuatPada: Date,
  sekarang: Date,
  acak: number,
): Date | null {
  const n = Math.max(1, Math.trunc(percobaan));
  const dasar = Math.min(JEDA_MAKS_PICKING_MS, JEDA_AWAL_PICKING_MS * 2 ** Math.min(n - 1, 30));
  const jeda = dasar + Math.floor(Math.min(Math.max(acak, 0), 0.999) * dasar * 0.1);
  const berikut = sekarang.getTime() + jeda;
  if (berikut - dibuatPada.getTime() > BATAS_RETRY_PICKING_MS) return null;
  return new Date(berikut);
}

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

export interface MasukanStatusStok {
  readonly sumber: NamaSumberInventory;
  /** Baris snapshot stok SKU di cabang itu; undefined = tidak ada baris. */
  readonly stok: { readonly tersedia: number; readonly dataPada: Date } | undefined;
  /** Σ reservasi AKTIF SKU di cabang itu (satuan dasar). */
  readonly reservasi: number;
  readonly isiSatuanDasar: number;
  readonly sekarang: Date;
  readonly maksUmurDataMenit: number;
}

/**
 * Status stok satu satuan jual dari snapshot lokal (T-019, tindak lanjut T-025): data basi ≠ stok habis.
 * - Snapshot lewat batas usia (P-10) → `TIDAK_DIKETAHUI`, bukan `HABIS`.
 * - Tidak ada baris snapshot: `local` → `HABIS` (tabel NEKAT = sumber, T-009 §3 "tak dikenal = stok 0");
 *   `gudang` → `TIDAK_DIKETAHUI` (belum pernah disinkron). Job sinkron menulis stok 0 untuk SKU yang
 *   tidak dikenal Gudang, jadi baris yang hilang di mode Gudang memang berarti "belum ada data".
 * - Selain itu `statusStokSatuanJual` (K-20).
 */
export function statusStokSnapshot(m: MasukanStatusStok): StatusStok {
  if (m.stok === undefined) return m.sumber === "local" ? "HABIS" : "TIDAK_DIKETAHUI";
  if (!dataInventoriSegar(m.sumber, m.stok.dataPada, m.sekarang, m.maksUmurDataMenit)) {
    return "TIDAK_DIKETAHUI";
  }
  return statusStokSatuanJual(m.stok.tersedia - m.reservasi, m.isiSatuanDasar).status;
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
