// T-036 panel admin: aturan bisnis CRUD produk / SKU / satuan jual (fungsi murni).
// Bentuk & panjang input divalidasi Zod di API; di sini aturan yang butuh konteks (kategori, nama).
// Harga, modal, margin, MOQ, dan `bebas_ppn` TIDAK diatur di sini (T-037).
import { normalisasiKodeKategori, KONFIGURASI_HARGA_BAWAAN } from "../harga/hitung.js";
import { KATA_KATEGORI_TERLARANG, kodeKategoriTerlarang } from "../inventori.js";

/**
 * P-24 (keputusan §15): kategori terlarang Fase 1 = SEMUA tembakau/nikotin & alkohol.
 * Kata di NAMA produk yang memicu tinjauan kategori (bukan penolakan langsung: "anggur" bisa buah,
 * "bir pletok" tanpa alkohol). Produk `MENUNGGU` tidak tayang sampai ditinjau (engine harga §8.3).
 */
export const KATA_NAMA_PERLU_TINJAUAN = [
  "rokok",
  "kretek",
  "cerutu",
  "tembakau",
  "nikotin",
  "vape",
  "vapor",
  "shisha",
  "snus",
  "bir",
  "beer",
  "alkohol",
  "alcohol",
  "miras",
  "arak",
  "tuak",
  "ciu",
  "anggur",
  "wine",
  "whisky",
  "whiskey",
  "vodka",
  "rum",
  "gin",
  "soju",
  "sake",
  "brandy",
  "tequila",
  "cognac",
  "liquor",
  "likeur",
] as const;

/** Kata kunci kode kategori terlarang (gabungan daftar inventori + engine harga + nikotin). */
const KATA_KODE_TERLARANG: readonly string[] = [
  ...new Set([...KATA_KATEGORI_TERLARANG, "nikotin", "cerutu", "kretek", "arak", "tuak"]),
];

/** true bila kode kategori (atau salah satu segmennya) termasuk terlarang (P-24). */
export function kategoriTerlarangAdmin(kode: string): boolean {
  const norm = normalisasiKodeKategori(kode);
  if (KONFIGURASI_HARGA_BAWAAN.kategoriTerlarang.map(normalisasiKodeKategori).includes(norm)) {
    return true;
  }
  return kodeKategoriTerlarang(norm, KATA_KODE_TERLARANG);
}

/** Pecah nama jadi kata (huruf/angka), huruf kecil, NFKC. */
function kataNama(nama: string): string[] {
  return nama
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((k) => k.length > 0);
}

/** Kata mencurigakan yang ditemukan di nama produk (kosong = aman). */
export function kataTerlarangDiNama(nama: string): string[] {
  const daftar: readonly string[] = KATA_NAMA_PERLU_TINJAUAN;
  return [...new Set(kataNama(nama).filter((k) => daftar.includes(k)))];
}

export interface KategoriUntukProduk {
  readonly id: string;
  readonly kode: string;
  readonly aktif: boolean;
  /** NULL = kategori tingkat atas (bukan subkategori). */
  readonly induk: { readonly kode: string; readonly aktif: boolean } | null;
}

export type TinjauanKategoriProduk = "TIDAK_PERLU" | "MENUNGGU" | "DISETUJUI";

export type GalatProduk =
  "KATEGORI_TIDAK_ADA" | "KATEGORI_BUKAN_SUBKATEGORI" | "KATEGORI_NONAKTIF" | "KATEGORI_TERLARANG";

export const PESAN_GALAT_PRODUK: Readonly<Record<GalatProduk, string>> = {
  KATEGORI_TIDAK_ADA: "Kategori tidak ditemukan.",
  KATEGORI_BUKAN_SUBKATEGORI: "Pilih subkategori, bukan kategori utama.",
  KATEGORI_NONAKTIF: "Kategori ini sedang nonaktif.",
  KATEGORI_TERLARANG:
    "Kategori ini dilarang dijual di Fase 1 (tembakau/nikotin & alkohol, keputusan P-24).",
};

export type HasilCekProduk =
  | {
      readonly ok: true;
      readonly tinjauanKategori: TinjauanKategoriProduk;
      /** Kata mencurigakan di nama → masuk antrean tinjauan `KATEGORI`. */
      readonly kataMencurigakan: readonly string[];
    }
  | { readonly ok: false; readonly galat: GalatProduk };

/**
 * Cek aturan produk saat dibuat/diubah.
 * - Kategori wajib subkategori aktif dengan induk aktif; kode kategori/induk terlarang → ditolak.
 * - Nama berisi kata mencurigakan → `MENUNGGU` (tidak tayang). Status `DISETUJUI` hanya
 *   dipertahankan bila nama tidak berubah; nama baru yang aman → `TIDAK_PERLU`.
 */
export function cekProduk(input: {
  readonly nama: string;
  readonly kategori: KategoriUntukProduk | null;
  readonly sebelum?: {
    readonly nama: string;
    readonly tinjauanKategori: TinjauanKategoriProduk;
  };
}): HasilCekProduk {
  const k = input.kategori;
  if (!k) return { ok: false, galat: "KATEGORI_TIDAK_ADA" };
  if (kategoriTerlarangAdmin(k.kode) || (k.induk && kategoriTerlarangAdmin(k.induk.kode))) {
    return { ok: false, galat: "KATEGORI_TERLARANG" };
  }
  if (!k.induk) return { ok: false, galat: "KATEGORI_BUKAN_SUBKATEGORI" };
  if (!k.aktif || !k.induk.aktif) return { ok: false, galat: "KATEGORI_NONAKTIF" };

  const kataMencurigakan = kataTerlarangDiNama(input.nama);
  const sebelum = input.sebelum?.nama === input.nama ? input.sebelum : undefined;
  const namaSama = sebelum !== undefined;
  let tinjauanKategori: TinjauanKategoriProduk;
  if (sebelum) {
    tinjauanKategori = sebelum.tinjauanKategori;
  } else if (kataMencurigakan.length > 0) {
    tinjauanKategori = "MENUNGGU";
  } else {
    tinjauanKategori = "TIDAK_PERLU";
  }
  return { ok: true, tinjauanKategori, kataMencurigakan: namaSama ? [] : kataMencurigakan };
}

export const JENIS_SATUAN_JUAL_ADMIN = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"] as const;
export type JenisSatuanJualAdmin = (typeof JENIS_SATUAN_JUAL_ADMIN)[number];

/** Isi kanonik (P-03, CHECK `satuan_jual_isi_kanonik`); DUS/KOLI diisi admin. */
const ISI_TETAP: Partial<Record<JenisSatuanJualAdmin, number>> = { PCS_1: 1, PCS_3: 3, LUSIN: 12 };

export const ISI_DUS_KOLI_MIN = 2;
export const ISI_DUS_KOLI_MAKS = 1_000_000;

export type HasilIsiSatuan =
  { readonly ok: true; readonly isi: number } | { readonly ok: false; readonly pesan: string };

/** Tentukan isi satuan dasar per jenis satuan jual. */
export function tentukanIsiSatuan(
  jenis: JenisSatuanJualAdmin,
  isi: number | null | undefined,
): HasilIsiSatuan {
  const tetap = ISI_TETAP[jenis];
  if (tetap !== undefined) {
    if (isi !== null && isi !== undefined && isi !== tetap) {
      return { ok: false, pesan: `Isi ${jenis} selalu ${String(tetap)}.` };
    }
    return { ok: true, isi: tetap };
  }
  if (
    isi === null ||
    isi === undefined ||
    !Number.isSafeInteger(isi) ||
    isi < ISI_DUS_KOLI_MIN ||
    isi > ISI_DUS_KOLI_MAKS
  ) {
    return {
      ok: false,
      pesan: `Isi ${jenis} wajib bilangan bulat ${String(ISI_DUS_KOLI_MIN)}–${String(ISI_DUS_KOLI_MAKS)}.`,
    };
  }
  return { ok: true, isi };
}
