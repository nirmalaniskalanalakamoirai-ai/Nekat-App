// Pencarian & penyaringan katalog (T-025). Fungsi murni atas snapshot yang sudah tersaring tayang.
import type { ProdukTampil } from "./tipe.js";

/** Huruf kecil, tanpa diakritik, selain huruf/angka → spasi tunggal. */
export function normalisasiCari(teks: string): string {
  return teks
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function kunciCari(bagian: readonly string[]): string {
  return normalisasiCari(bagian.join(" "));
}

/** Maks. kata kunci yang dipakai (sisanya diabaikan) agar biaya pencarian terbatas. */
export const MAKS_KATA_CARI = 8;

export interface SaringanKatalog {
  readonly kategori?: string | undefined;
  readonly subkategori?: string | undefined;
  /** Teks mentah dari pengguna; dinormalisasi di sini. */
  readonly cari?: string | undefined;
}

/**
 * Menyaring produk tayang. Pencarian: SEMUA kata harus muncul (awal kata) di nama produk/varian.
 * Urutan hasil pencarian: nama yang diawali kata pertama lebih dulu, lalu urutan tampil bawaan.
 */
export function saringProduk(
  produk: readonly ProdukTampil[],
  s: SaringanKatalog,
): readonly ProdukTampil[] {
  let hasil = produk.filter(
    (p) =>
      (s.kategori === undefined || p.kategori.kode === s.kategori) &&
      (s.subkategori === undefined || p.subkategori?.kode === s.subkategori),
  );
  if (s.cari === undefined) return hasil;
  const kata = [
    ...new Set(
      normalisasiCari(s.cari)
        .split(" ")
        .filter((x) => x.length > 0),
    ),
  ].slice(0, MAKS_KATA_CARI);
  if (kata.length === 0) return [];
  hasil = hasil.filter((p) => {
    const isi = ` ${p.kunciCari}`;
    return kata.every((k) => isi.includes(` ${k}`));
  });
  const pertama = kata[0] ?? "";
  return [...hasil].sort((a, b) => {
    const pa = normalisasiCari(a.nama).startsWith(pertama) ? 0 : 1;
    const pb = normalisasiCari(b.nama).startsWith(pertama) ? 0 : 1;
    return pa - pb || a.urutan - b.urutan;
  });
}

export interface Halaman<T> {
  readonly isi: readonly T[];
  readonly halaman: number;
  readonly perHalaman: number;
  readonly total: number;
  readonly totalHalaman: number;
}

/** Paginasi berbasis nomor halaman (1-based). Halaman di luar jangkauan → isi kosong. */
export function potongHalaman<T>(
  daftar: readonly T[],
  halaman: number,
  perHalaman: number,
): Halaman<T> {
  if (!Number.isSafeInteger(halaman) || halaman < 1) throw new RangeError("halaman harus >= 1");
  if (!Number.isSafeInteger(perHalaman) || perHalaman < 1) {
    throw new RangeError("perHalaman harus >= 1");
  }
  const mulai = (halaman - 1) * perHalaman;
  return {
    isi: daftar.slice(mulai, mulai + perHalaman),
    halaman,
    perHalaman,
    total: daftar.length,
    totalHalaman: Math.ceil(daftar.length / perHalaman),
  };
}
