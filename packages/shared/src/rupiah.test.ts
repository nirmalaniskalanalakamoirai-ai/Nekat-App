import { describe, expect, it } from "vitest";
import { isRupiah, keRupiah, rupiahSchema, RupiahTidakValidError, type Rupiah } from "./rupiah.js";

describe("Rupiah", () => {
  it("menerima bilangan bulat aman >= 0", () => {
    for (const nilai of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(isRupiah(nilai)).toBe(true);
      expect(keRupiah(nilai)).toBe(nilai);
    }
  });

  it("menolak pecahan, negatif, NaN, Infinity, di luar batas aman, dan bukan number", () => {
    const tidakValid: unknown[] = [
      0.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
      undefined,
      1n,
    ];
    for (const nilai of tidakValid) {
      expect(isRupiah(nilai)).toBe(false);
    }
    expect(() => keRupiah(-1)).toThrow(RupiahTidakValidError);
    expect(() => keRupiah(0.1)).toThrow(RupiahTidakValidError);
  });

  it("skema Zod konsisten dengan isRupiah", () => {
    expect(rupiahSchema.safeParse(2).success).toBe(true);
    expect(rupiahSchema.safeParse(2.5).success).toBe(false);
    expect(rupiahSchema.safeParse(-2).success).toBe(false);
  });
});

// Cek tipe saat typecheck: keluaran skema harus `Rupiah`, bukan `number` biasa.
export const _cekTipe: (n: unknown) => Rupiah | undefined = (n) => rupiahSchema.safeParse(n).data;
