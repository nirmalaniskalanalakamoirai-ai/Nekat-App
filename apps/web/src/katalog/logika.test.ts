// Logika halaman katalog tanpa DOM (repo belum memakai jsdom): mode URL, pencarian, muat lagi, tab.
import { describe, expect, it } from "vitest";
import type { KategoriApi } from "./api";
import {
  aksiCari,
  bacaMode,
  bolehMuatOtomatis,
  indeksTabBerikut,
  SEMUA,
  tabKategori,
  tabSubkategori,
} from "./logika";

describe("bacaMode", () => {
  it("memetakan URL ke filter", () => {
    expect(bacaMode("/", "")).toEqual({ jenis: "semua" });
    expect(bacaMode("/k/sembako", "")).toEqual({
      jenis: "kategori",
      kategori: "sembako",
      sub: undefined,
    });
    expect(bacaMode("/k/sembako/beras", "")).toEqual({
      jenis: "kategori",
      kategori: "sembako",
      sub: "beras",
    });
    expect(bacaMode("/cari", "?q=minyak%20goreng")).toEqual({ jenis: "cari", q: "minyak goreng" });
    expect(bacaMode("/cari", "")).toEqual({ jenis: "cari", q: "" });
  });
});

describe("aksiCari (setelah debounce / Enter)", () => {
  it("dari luar /cari: kata kunci → /cari?q= sebagai entri riwayat baru", () => {
    expect(aksiCari("  beras ", "", false)).toEqual({
      jenis: "navigasi",
      ke: "/cari?q=beras",
      replace: false,
      q: "beras",
    });
  });

  it("di /cari: ketikan berikutnya mengganti entri riwayat (replace)", () => {
    expect(aksiCari("beras pandan", "beras", true)).toMatchObject({
      ke: "/cari?q=beras%20pandan",
      replace: true,
    });
  });

  it("kata kunci sama di /cari → tetap (tidak navigasi ulang)", () => {
    expect(aksiCari("beras ", "beras", true)).toEqual({ jenis: "tetap" });
  });

  it("dikosongkan di /cari → kembali ke / (replace); kosong di luar /cari → tetap", () => {
    expect(aksiCari("   ", "beras", true)).toEqual({
      jenis: "navigasi",
      ke: "/",
      replace: true,
      q: "",
    });
    expect(aksiCari("", "", false)).toEqual({ jenis: "tetap" });
  });

  it("karakter khusus di-encode", () => {
    expect(aksiCari("kecap & saus", "", false)).toMatchObject({ ke: "/cari?q=kecap%20%26%20saus" });
  });
});

describe("bolehMuatOtomatis (gulir vs tombol Muat lagi)", () => {
  const dasar = {
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    online: true,
  };
  it("otomatis bila ada halaman berikut, tidak sedang memuat, online", () => {
    expect(bolehMuatOtomatis(dasar)).toBe(true);
  });
  it("setelah halaman berikut GAGAL: tidak otomatis lagi (hanya tombol)", () => {
    expect(bolehMuatOtomatis({ ...dasar, isFetchNextPageError: true })).toBe(false);
  });
  it("tidak otomatis saat sedang memuat, offline, atau tidak ada halaman berikut", () => {
    expect(bolehMuatOtomatis({ ...dasar, isFetchingNextPage: true })).toBe(false);
    expect(bolehMuatOtomatis({ ...dasar, online: false })).toBe(false);
    expect(bolehMuatOtomatis({ ...dasar, hasNextPage: false })).toBe(false);
  });
});

describe("tab kategori & subkategori", () => {
  const kategori: KategoriApi[] = [
    {
      kode: "sembako",
      nama: "Sembako",
      jumlahProduk: 5,
      subkategori: [
        { kode: "beras", nama: "Beras", jumlahProduk: 5 },
        { kode: "gula", nama: "Gula", jumlahProduk: 0 },
      ],
    },
    { kode: "ibu-anak", nama: "Ibu & Anak", jumlahProduk: 0, subkategori: [] },
    { kode: "minuman", nama: "Minuman", jumlahProduk: 3, subkategori: [] },
  ];

  it("Semua = total jumlah dari API; kategori 0 produk disembunyikan", () => {
    expect(tabKategori(kategori, undefined)).toEqual([
      { kunci: SEMUA, label: "Semua", jumlah: 8 },
      { kunci: "sembako", label: "Sembako", jumlah: 5 },
      { kunci: "minuman", label: "Minuman", jumlah: 3 },
    ]);
  });

  it("kategori 0 produk tetap tampil bila sedang dibuka (tautan langsung)", () => {
    expect(tabKategori(kategori, "ibu-anak").map((t) => t.kunci)).toContain("ibu-anak");
  });

  it("subkategori: Semua (jumlah kategori) + sub berproduk / sedang dibuka", () => {
    const sembako = kategori[0];
    expect(tabSubkategori(sembako, undefined).map((t) => t.kunci)).toEqual([SEMUA, "beras"]);
    expect(tabSubkategori(sembako, "gula").map((t) => t.kunci)).toEqual([SEMUA, "beras", "gula"]);
    expect(tabSubkategori(kategori[2], undefined)).toEqual([]);
    expect(tabSubkategori(undefined, undefined)).toEqual([]);
  });
});

describe("indeksTabBerikut (panah/Home/End)", () => {
  it("panah melingkar, Home/End ke ujung, tombol lain diabaikan", () => {
    expect(indeksTabBerikut("ArrowRight", 0, 3)).toBe(1);
    expect(indeksTabBerikut("ArrowRight", 2, 3)).toBe(0);
    expect(indeksTabBerikut("ArrowLeft", 0, 3)).toBe(2);
    expect(indeksTabBerikut("Home", 2, 3)).toBe(0);
    expect(indeksTabBerikut("End", 0, 3)).toBe(2);
    expect(indeksTabBerikut("Enter", 0, 3)).toBeNull();
    expect(indeksTabBerikut("ArrowRight", -1, 3)).toBeNull();
    expect(indeksTabBerikut("ArrowRight", 0, 0)).toBeNull();
  });
});
