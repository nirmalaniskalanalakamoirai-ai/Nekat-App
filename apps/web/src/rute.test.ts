import { describe, expect, it } from "vitest";
import { NAVIGASI_BAWAH, RUTE_PEMBELI, atributTema, tampilkanNavigasiBawah } from "./rute";

describe("tampilkanNavigasiBawah", () => {
  it.each([
    "/",
    "/zona",
    "/p/minyak-goreng-1l",
    "/keranjang",
    "/g/AB12CD",
    "/pesanan",
    "/saldo",
    "/akun",
  ])("tampil di %s", (p) => {
    expect(tampilkanNavigasiBawah(p)).toBe(true);
  });

  it.each(["/masuk", "/persetujuan", "/checkout", "/tagihan/123"])(
    "disembunyikan di %s (fokus bayar)",
    (p) => {
      expect(tampilkanNavigasiBawah(p)).toBe(false);
    },
  );

  it("tidak salah cocok dengan awalan mirip", () => {
    expect(tampilkanNavigasiBawah("/masukan")).toBe(true);
  });
});

describe("peta rute", () => {
  it("path unik", () => {
    const paths = RUTE_PEMBELI.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("aturan tata letak konsisten dengan tampilkanNavigasiBawah", () => {
    for (const r of RUTE_PEMBELI) {
      const contoh = r.path.replace(/:[a-z]+\??/g, "x");
      expect(tampilkanNavigasiBawah(contoh)).toBe(r.tataLetak === "navigasi");
    }
  });

  it("navigasi bawah punya lima tombol yang semuanya rute terdaftar", () => {
    expect(NAVIGASI_BAWAH).toHaveLength(5);
    for (const n of NAVIGASI_BAWAH) {
      expect(RUTE_PEMBELI.some((r) => r.path === n.ke)).toBe(true);
    }
  });
});

describe("atributTema", () => {
  it("memetakan pilihan ke data-theme", () => {
    expect(atributTema("terang")).toBe("light");
    expect(atributTema("gelap")).toBe("dark");
    expect(atributTema("ikuti-hp")).toBeNull();
  });
});
