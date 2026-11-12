import { keRupiah, RupiahTidakValidError } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { tambahRupiah } from "./uang.js";

describe("tambahRupiah", () => {
  it("menjumlahkan dua nominal", () => {
    expect(tambahRupiah(keRupiah(2), keRupiah(3))).toBe(5);
  });

  it("menolak hasil di luar batas bilangan bulat aman", () => {
    expect(() => tambahRupiah(keRupiah(Number.MAX_SAFE_INTEGER), keRupiah(1))).toThrow(
      RupiahTidakValidError,
    );
  });
});
