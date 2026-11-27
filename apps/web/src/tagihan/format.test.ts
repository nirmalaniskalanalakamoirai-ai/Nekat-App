import { describe, expect, it } from "vitest";
import {
  jamWib,
  kelompokDigit,
  labelDigit,
  mmss,
  rupiah,
  selisihJamMs,
  sisaDetik,
  tingkatHitungMundur,
} from "./format";

describe("format tagihan", () => {
  it("rupiah tanpa pembulatan", () => {
    expect(rupiah(130_000)).toBe("Rp130.000");
    expect(rupiah(1_234_567)).toBe("Rp1.234.567");
  });

  it("hitung mundur memakai jam server, bukan jam HP", () => {
    // Jam HP terlambat 5 menit dibanding server.
    const hp = Date.parse("2026-11-27T09:25:00Z");
    const selisih = selisihJamMs("2026-11-27T09:30:00Z", hp);
    expect(selisih).toBe(300_000);
    expect(sisaDetik("2026-11-27T10:00:00Z", hp, selisih)).toBe(1800);
    expect(sisaDetik("2026-11-27T09:00:00Z", hp, selisih)).toBe(0);
    expect(mmss(1800)).toBe("30:00");
    expect(mmss(3600)).toBe("60:00");
    expect(mmss(65)).toBe("01:05");
  });

  it("tingkat peringatan T-007 §4.5", () => {
    expect(tingkatHitungMundur(601)).toBe("normal");
    expect(tingkatHitungMundur(600)).toBe("warning");
    expect(tingkatHitungMundur(120)).toBe("danger");
  });

  it("jam WIB dan nomor VA berkelompok", () => {
    expect(jamWib("2026-11-27T10:00:00Z")).toBe("17.00");
    expect(kelompokDigit("8808123456789012")).toBe("8808 1234 5678 9012");
    expect(labelDigit("880812")).toBe("8 8 0 8, 1 2");
  });
});
