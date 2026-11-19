// Tipe engine harga (T-020, spesifikasi docs/spec/engine-harga.md v0.6).
// Nama level & mode mengikuti skema DB T-013a (`packages/db/src/skema/katalog.ts`):
// level `SATUAN` = "INDIVIDU" di spesifikasi, mode `RUPIAH` = "HARGA" di spesifikasi.
import type { Rupiah } from "@nekat/shared";

/** Urutan = urutan pagar CLAUDE.md: harga grup individu (SATUAN) ≥ Mitra Grosir ≥ Franchise. */
export const LEVEL_HARGA = ["SATUAN", "MITRA_GROSIR", "FRANCHISE"] as const;
export type LevelHarga = (typeof LEVEL_HARGA)[number];

/** P-01: markup persen atas modal, atau harga jual Rupiah manual. */
export const MODE_HARGA = ["PERSEN", "RUPIAH"] as const;
export type ModeHarga = (typeof MODE_HARGA)[number];

/** P-03: satuan jual kanonik. */
export const KODE_SATUAN = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"] as const;
export type KodeSatuan = (typeof KODE_SATUAN)[number];

/** Isi (pcs dasar) yang tetap untuk satuan tertentu (sama dengan CHECK `satuan_jual_isi_kanonik`). */
export const ISI_KANONIK: Readonly<Partial<Record<KodeSatuan, number>>> = {
  PCS_1: 1,
  PCS_3: 3,
  LUSIN: 12,
};

/** 1 bp = 0,01 %. 10.000 bp = 100 %. */
export const BP_PER_SATU = 10_000;

/**
 * Isi sel harga dari panel/CSV/DB. Nilai sengaja `number` mentah: engine yang memvalidasi
 * (pecahan, negatif, NaN, di luar batas aman) dan memberi alasan, bukan pemanggil.
 */
export type IsiSel =
  | {
      readonly mode: "PERSEN";
      /** markup atas modal, basis poin (integer) */ readonly markupBp: number;
    }
  | {
      readonly mode: "RUPIAH";
      /** harga jual per satuan jual, termasuk PPN */ readonly hargaRp: number;
    };

/** Bilangan rasional integer, mis. faktor PPN φ = 1 + tarif × DPP. */
export interface Rasional {
  readonly pembilang: number;
  readonly penyebut: number;
}

export type TinjauanKategori = "TIDAK_PERLU" | "MENUNGGU" | "DISETUJUI";

export interface InputSatuanJual {
  readonly idSatuanJual: string;
  /** Kode mentah; di luar P-03 → `SATUAN_TIDAK_VALID`. */
  readonly kode: string;
  /** Isi dalam satuan dasar (pcs). */
  readonly isi: number;
  /** MOQ Mitra Grosir di luar grup (P-05); `null` = grosir hanya lewat grup. */
  readonly moqGrosir: number | null;
  /** P-21: tier grup (harga Mitra Grosir di grup) boleh dimatikan per produk/satuan oleh admin. */
  readonly bolehGrup: boolean;
  /** Modal per satuan jual (K-01), mentah: `null` = kosong. */
  readonly modal: number | null;
  /** Waktu data modal; hanya dipakai `cekKesegaranModal`, tidak memengaruhi harga. */
  readonly waktuDataModal: Date | null;
  readonly sel: Readonly<Partial<Record<LevelHarga, IsiSel | null>>>;
}

export interface InputProdukHarga {
  readonly idProduk: string;
  readonly kodeKategori: string;
  readonly tinjauanKategori: TinjauanKategori;
  /** G-04: produk bebas PPN → φ = 1. */
  readonly bebasPpn: boolean;
  readonly satuan: readonly InputSatuanJual[];
}

export interface KonfigurasiHarga {
  /** P-01: jenis isian sel yang diizinkan. */
  readonly jenisIsiSelDiizinkan: readonly ModeHarga[];
  /** Level yang dipakai checkout. Fase 1: SATUAN + MITRA_GROSIR (FRANCHISE disiapkan). */
  readonly levelAktif: readonly LevelHarga[];
  /** P-06: `false` = sel Mitra Grosir tidak wajib untuk tayang. */
  readonly mitraWajibUntukTayang: boolean;
  /** G-04: faktor PPN φ (harga tampil termasuk PPN). `null` = belum dikonfigurasi. */
  readonly ppnFaktor: Rasional | null;
  /**
   * Batas bawah margin sel atas modal, basis poin, dibanding harga tanpa PPN (K-28).
   * Bawaan = nilai K-16 (5 %). `null` = hanya PG-1 (harga > modal). Lihat catatan "butuh keputusan".
   */
  readonly marginMinimumBp: number | null;
  /** Penangkal salah ketik; markup di atasnya → peringatan saja. `null` = tanpa batas. */
  readonly batasAtasMarkupBp: number | null;
  /** Keputusan #7: kode kategori terlarang (diisi dari konfigurasi). */
  readonly kategoriTerlarang: readonly string[];
  /** P-10: batas umur data modal (menit). `null` = tidak dicek (mode local). */
  readonly batasUsiaModalMenit: number | null;
}

export type JenisMasalah = "ERROR" | "PERINGATAN" | "INFO";

export const KODE_MASALAH = [
  "KONFIGURASI_TIDAK_VALID",
  "KATEGORI_DILARANG",
  "PERLU_TINJAUAN_KATEGORI",
  "MODAL_KOSONG",
  "MODAL_TIDAK_VALID",
  "MODAL_PECAHAN",
  "MODAL_KEDALUWARSA",
  "SATUAN_TIDAK_VALID",
  "MOQ_TIDAK_VALID",
  "SEL_KOSONG",
  "FORMAT_PERSEN",
  "FORMAT_HARGA",
  "HARGA_PECAHAN",
  "MARGIN_NEGATIF",
  "MARGIN_NOL",
  "HARGA_DI_BAWAH_MODAL",
  "MARGIN_DI_BAWAH_MINIMUM",
  "MARKUP_DI_ATAS_BATAS",
  "PPN_BELUM_DIKONFIGURASI",
  "PAGAR_LEVEL_DILANGGAR",
  "PAGAR_LEVEL_NONAKTIF",
  "PAGAR_KEMASAN_DILANGGAR",
  "GROSIR_TIDAK_TERSEDIA",
  "GRUP_TIDAK_DIAKTIFKAN",
  "ANGKA_OVERFLOW",
  "TIDAK_TAYANG",
  "QTY_TIDAK_VALID",
] as const;
export type KodeMasalah = (typeof KODE_MASALAH)[number];

/** Satu temuan engine, dengan pesan Bahasa Indonesia yang bisa ditampilkan ke admin. */
export interface Masalah {
  readonly kode: KodeMasalah;
  readonly jenis: JenisMasalah;
  /** K-01/K-28: masuk antrean "perlu ditinjau". */
  readonly perluDitinjau: boolean;
  readonly level: LevelHarga | null;
  readonly idSatuanJual: string | null;
  readonly pesan: string;
}

export interface SelHarga {
  readonly level: LevelHarga;
  readonly isi: IsiSel | null;
  /**
   * Harga per satuan jual (termasuk PPN) yang BOLEH dipakai: terisi hanya bila `valid`.
   * Satu-satunya field harga yang boleh dibaca jalur checkout/katalog.
   */
  readonly harga: Rupiah | null;
  /**
   * Hasil hitung untuk panel admin, termasuk sel yang melanggar pagar (mis. di bawah modal).
   * `null` bila tidak bisa dihitung tanpa pembulatan. JANGAN dipakai untuk menjual.
   */
  readonly hargaTerhitung: Rupiah | null;
  /** `harga − modal`, hanya bila sel valid. */
  readonly margin: Rupiah | null;
  /** Harga boleh dipakai: terhitung, lolos PG-1, margin minimum, PG-2, pagar kemasan, PPN. */
  readonly valid: boolean;
  /** Level dipakai checkout (`levelAktif`). FRANCHISE Fase 1: disiapkan & divalidasi, tidak aktif. */
  readonly aktif: boolean;
  readonly masalah: readonly Masalah[];
}

export type StatusTayang = "TAYANG" | "TIDAK_TAYANG" | "PERLU_DITINJAU";

/**
 * Tabel harga internal (server/admin). KEAMANAN: DTO untuk pembeli WAJIB membuang `modal`,
 * `margin`, `hargaTerhitung`, `isi` sel, dan `alasanTidakTayang`/`peringatan` (memuat info admin);
 * kirim hanya harga tampil dari sel yang valid.
 */
export interface TabelHarga {
  readonly idSatuanJual: string;
  /** `null` bila kode di luar P-03. */
  readonly kode: KodeSatuan | null;
  readonly isi: number;
  readonly moqGrosir: number | null;
  readonly bolehGrup: boolean;
  readonly modal: Rupiah | null;
  readonly waktuDataModal: Date | null;
  readonly sel: Readonly<Record<LevelHarga, SelHarga>>;
  readonly tayang: boolean;
  /** `PERLU_DITINJAU` = tidak tayang dan ada alasan yang masuk antrean tinjauan. */
  readonly status: StatusTayang;
  /** Kosong ⇔ tayang. Kodenya ditulis ke `satuan_jual.alasan_tidak_tayang`. */
  readonly alasanTidakTayang: readonly Masalah[];
  /** Tidak menahan tayang, tetapi ditampilkan ke admin (mis. K-27, markup di atas batas). */
  readonly peringatan: readonly Masalah[];
}

export interface HasilHargaProduk {
  readonly idProduk: string;
  readonly satuan: readonly TabelHarga[];
}

export type JenisHargaBaris = "GRUP" | "GROSIR_MOQ" | "SATUAN";

export type Hasil<T> =
  | { readonly ok: true; readonly nilai: T }
  | { readonly ok: false; readonly masalah: readonly Masalah[] };
