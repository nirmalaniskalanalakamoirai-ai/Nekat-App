// Peta rute pembeli (docs/spec/T-007-ux-halaman.md §3.3).
// Satu sumber untuk router, judul halaman, dan aturan navigasi bawah.

export type JenisTataLetak =
  /** Navigasi bawah tampil. */
  | "navigasi"
  /** Halaman fokus bayar: navigasi bawah disembunyikan (H-07–H-10). */
  | "fokus";

export interface DefinisiRute {
  path: string;
  judul: string;
  kodeHalaman: string;
  tataLetak: JenisTataLetak;
  perluLogin: boolean;
}

export const RUTE_PEMBELI: readonly DefinisiRute[] = [
  { path: "/", judul: "Belanja", kodeHalaman: "H-02", tataLetak: "navigasi", perluLogin: false },
  {
    path: "/zona",
    judul: "Pilih zona",
    kodeHalaman: "H-01",
    tataLetak: "navigasi",
    perluLogin: false,
  },
  {
    path: "/k/:kategori/:sub?",
    judul: "Kategori",
    kodeHalaman: "H-02",
    tataLetak: "navigasi",
    perluLogin: false,
  },
  {
    path: "/cari",
    judul: "Cari produk",
    kodeHalaman: "H-02",
    tataLetak: "navigasi",
    perluLogin: false,
  },
  {
    path: "/p/:slug",
    judul: "Detail produk",
    kodeHalaman: "H-03",
    tataLetak: "navigasi",
    perluLogin: false,
  },
  {
    path: "/keranjang",
    judul: "Keranjang",
    kodeHalaman: "H-04",
    tataLetak: "navigasi",
    perluLogin: false,
  },
  {
    path: "/g/:kode",
    judul: "Belanja Bareng",
    kodeHalaman: "H-05",
    tataLetak: "navigasi",
    perluLogin: false,
  },
  { path: "/masuk", judul: "Masuk", kodeHalaman: "H-07", tataLetak: "fokus", perluLogin: false },
  {
    path: "/persetujuan",
    judul: "Syarat & privasi",
    kodeHalaman: "H-08",
    tataLetak: "fokus",
    perluLogin: true,
  },
  {
    path: "/checkout",
    judul: "Checkout",
    kodeHalaman: "H-09",
    tataLetak: "fokus",
    perluLogin: true,
  },
  {
    path: "/tagihan/:id",
    judul: "Tagihan",
    kodeHalaman: "H-10",
    tataLetak: "fokus",
    perluLogin: true,
  },
  {
    path: "/pesanan",
    judul: "Pesanan",
    kodeHalaman: "H-11",
    tataLetak: "navigasi",
    perluLogin: true,
  },
  {
    path: "/pesanan/:id",
    judul: "Detail pesanan",
    kodeHalaman: "H-11",
    tataLetak: "navigasi",
    perluLogin: true,
  },
  {
    path: "/saldo",
    judul: "Saldo NEKAT",
    kodeHalaman: "H-12",
    tataLetak: "navigasi",
    perluLogin: true,
  },
  {
    path: "/saldo/cairkan",
    judul: "Cairkan saldo",
    kodeHalaman: "H-12",
    tataLetak: "navigasi",
    perluLogin: true,
  },
  { path: "/akun", judul: "Akun", kodeHalaman: "H-13", tataLetak: "navigasi", perluLogin: true },
] as const;

/** Awalan rute fokus bayar: navigasi bawah disembunyikan (§3.3). */
const AWALAN_FOKUS = ["/masuk", "/persetujuan", "/checkout", "/tagihan"] as const;

export function tampilkanNavigasiBawah(pathname: string): boolean {
  return !AWALAN_FOKUS.some((a) => pathname === a || pathname.startsWith(`${a}/`));
}

export interface ItemNavigasi {
  ke: string;
  label: string;
  ikon: "belanja" | "keranjang" | "pesanan" | "saldo" | "akun";
}

/** Navigasi bawah: lima tombol, ikon + label teks (§3.3). */
export const NAVIGASI_BAWAH: readonly ItemNavigasi[] = [
  { ke: "/", label: "Belanja", ikon: "belanja" },
  { ke: "/keranjang", label: "Keranjang", ikon: "keranjang" },
  { ke: "/pesanan", label: "Pesanan", ikon: "pesanan" },
  { ke: "/saldo", label: "Saldo", ikon: "saldo" },
  { ke: "/akun", label: "Akun", ikon: "akun" },
] as const;

/** Tema: ikuti HP (bawaan) atau dipaksa terang/gelap (H-13). */
export type PilihanTema = "ikuti-hp" | "terang" | "gelap";

export function atributTema(pilihan: PilihanTema): "light" | "dark" | null {
  if (pilihan === "terang") return "light";
  if (pilihan === "gelap") return "dark";
  return null;
}
