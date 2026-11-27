// Logika murni halaman katalog (dipisah dari Katalog.tsx agar bisa diuji tanpa DOM).
import { matchPath } from "react-router";
import { TEKS } from "../teks/id";
import type { KategoriApi } from "./api";

export const JEDA_CARI_MS = 300;
/** Kunci tab "Semua" (bukan kode kategori yang valid di API: pola kode hanya a-z0-9-). */
export const SEMUA = "__semua";

export type Mode =
  | { jenis: "semua" }
  | { jenis: "kategori"; kategori: string; sub: string | undefined }
  | { jenis: "cari"; q: string };

/** Baca mode dari URL (sumber kebenaran filter). */
export function bacaMode(pathname: string, search: string): Mode {
  if (pathname === "/cari") return { jenis: "cari", q: new URLSearchParams(search).get("q") ?? "" };
  const m = matchPath("/k/:kategori/:sub?", pathname);
  if (m?.params.kategori) {
    return { jenis: "kategori", kategori: m.params.kategori, sub: m.params.sub ?? undefined };
  }
  return { jenis: "semua" };
}

export type AksiCari =
  | { readonly jenis: "tetap" }
  | {
      readonly jenis: "navigasi";
      readonly ke: string;
      readonly replace: boolean;
      readonly q: string;
    };

/**
 * Apa yang dilakukan saat kata kunci (setelah debounce / Enter) diterapkan.
 * - Sama dengan kata kunci terakhir → tidak berubah.
 * - Kosong di /cari → kembali ke "/" (replace); kosong di luar /cari → tetap.
 * - Isi → /cari?q= (replace bila sudah di /cari agar riwayat tidak penuh ketikan).
 */
export function aksiCari(nilai: string, qTerakhir: string, diCari: boolean): AksiCari {
  const target = nilai.trim();
  if (target === "") {
    return diCari ? { jenis: "navigasi", ke: "/", replace: true, q: "" } : { jenis: "tetap" };
  }
  if (diCari && target === qTerakhir.trim()) return { jenis: "tetap" };
  return {
    jenis: "navigasi",
    ke: `/cari?q=${encodeURIComponent(target)}`,
    replace: diCari,
    q: target,
  };
}

export interface StatusMuatLagi {
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isFetchNextPageError: boolean;
  readonly online: boolean;
}

/**
 * Muat halaman berikutnya OTOMATIS (saat gulir) hanya bila tidak sedang memuat, online, dan
 * halaman berikutnya belum pernah gagal. Setelah gagal, hanya tombol "Muat lagi" (cegah ulang tanpa
 * henti saat server/jaringan bermasalah).
 */
export function bolehMuatOtomatis(s: StatusMuatLagi): boolean {
  return s.hasNextPage && !s.isFetchingNextPage && !s.isFetchNextPageError && s.online;
}

export interface ItemTab {
  readonly kunci: string;
  readonly label: string;
  readonly jumlah: number;
}

/** Tab kategori: "Semua (total)" + kategori berproduk (yang sedang dibuka tetap tampil). */
export function tabKategori(
  kategori: readonly KategoriApi[],
  terpilih: string | undefined,
): ItemTab[] {
  const total = kategori.reduce((n, k) => n + k.jumlahProduk, 0);
  return [
    { kunci: SEMUA, label: TEKS.semua, jumlah: total },
    ...kategori
      .filter((k) => k.jumlahProduk > 0 || k.kode === terpilih)
      .map((k) => ({ kunci: k.kode, label: k.nama, jumlah: k.jumlahProduk })),
  ];
}

/** Tab subkategori; kosong bila kategori tidak punya subkategori. */
export function tabSubkategori(
  k: KategoriApi | undefined,
  subTerpilih: string | undefined,
): ItemTab[] {
  if (!k || k.subkategori.length === 0) return [];
  return [
    { kunci: SEMUA, label: TEKS.semua, jumlah: k.jumlahProduk },
    ...k.subkategori
      .filter((s) => s.jumlahProduk > 0 || s.kode === subTerpilih)
      .map((s) => ({ kunci: s.kode, label: s.nama, jumlah: s.jumlahProduk })),
  ];
}

/** Navigasi keyboard tab (WAI-ARIA tabs): indeks tujuan, atau null bila tombol lain. */
export function indeksTabBerikut(tombol: string, i: number, n: number): number | null {
  if (n <= 0 || i < 0) return null;
  switch (tombol) {
    case "ArrowRight":
      return (i + 1) % n;
    case "ArrowLeft":
      return (i - 1 + n) % n;
    case "Home":
      return 0;
    case "End":
      return n - 1;
    default:
      return null;
  }
}
