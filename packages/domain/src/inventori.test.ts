import { describe, expect, it } from "vitest";
import {
  dataInventoriSegar,
  kodeKategoriTerlarang,
  pecahBatch,
  statusStokSatuanJual,
  statusStokSnapshot,
  jadwalUlangPicking,
  BATAS_RETRY_PICKING_MS,
} from "./inventori.js";

describe("pecahBatch", () => {
  it("memecah per 200 secara bawaan", () => {
    const daftar = Array.from({ length: 401 }, (_, i) => i);
    expect(pecahBatch(daftar).map((b) => b.length)).toEqual([200, 200, 1]);
    expect(pecahBatch([])).toEqual([]);
  });

  it("menolak ukuran tidak valid", () => {
    expect(() => pecahBatch([1], 0)).toThrow(RangeError);
  });
});

describe("statusStokSatuanJual (K-20)", () => {
  it("stok cukup untuk minimal 1 satuan → TERSEDIA dengan maksQty", () => {
    expect(statusStokSatuanJual(50, 24)).toEqual({
      status: "TERSEDIA",
      bolehDibeli: true,
      maksQty: 2,
    });
  });

  it("stok kurang dari isi satuan / nol / negatif → HABIS, tidak bisa dibeli", () => {
    for (const stok of [23, 0, -5, Number.NaN]) {
      expect(statusStokSatuanJual(stok, 24)).toEqual({
        status: "HABIS",
        bolehDibeli: false,
        maksQty: 0,
      });
    }
  });

  it("isi satuan harus bulat >= 1", () => {
    expect(() => statusStokSatuanJual(10, 0)).toThrow(RangeError);
    expect(() => statusStokSatuanJual(10, 1.5)).toThrow(RangeError);
  });
});

describe("dataInventoriSegar (P-10)", () => {
  const sekarang = new Date("2026-11-19T10:00:00Z");
  const menitLalu = (m: number) => new Date(sekarang.getTime() - m * 60_000);

  it("gudang: segar sampai tepat batas usia, lewat batas tidak", () => {
    expect(dataInventoriSegar("gudang", menitLalu(15), sekarang, 15)).toBe(true);
    expect(dataInventoriSegar("gudang", menitLalu(15.01), sekarang, 15)).toBe(false);
    expect(dataInventoriSegar("gudang", new Date(Number.NaN), sekarang, 15)).toBe(false);
  });

  it("local tidak pernah kedaluwarsa", () => {
    expect(dataInventoriSegar("local", menitLalu(10_000), sekarang, 15)).toBe(true);
  });
});

describe("statusStokSnapshot (T-019: data basi ≠ stok habis)", () => {
  const kini = new Date("2026-11-26T05:00:00Z");
  const dasar = {
    sumber: "gudang" as const,
    reservasi: 0,
    isiSatuanDasar: 1,
    sekarang: kini,
    maksUmurDataMenit: 15,
  };
  const segar = new Date("2026-11-26T04:50:00Z");
  const basi = new Date("2026-11-26T04:44:59Z");

  it("data segar: stok cukup → TERSEDIA, stok 0 → HABIS", () => {
    expect(statusStokSnapshot({ ...dasar, stok: { tersedia: 3, dataPada: segar } })).toBe(
      "TERSEDIA",
    );
    expect(statusStokSnapshot({ ...dasar, stok: { tersedia: 0, dataPada: segar } })).toBe("HABIS");
  });

  it("data basi → TIDAK_DIKETAHUI walau stok snapshot 0 atau banyak", () => {
    expect(statusStokSnapshot({ ...dasar, stok: { tersedia: 0, dataPada: basi } })).toBe(
      "TIDAK_DIKETAHUI",
    );
    expect(statusStokSnapshot({ ...dasar, stok: { tersedia: 99, dataPada: basi } })).toBe(
      "TIDAK_DIKETAHUI",
    );
  });

  it("tanpa baris: gudang → TIDAK_DIKETAHUI, local → HABIS", () => {
    expect(statusStokSnapshot({ ...dasar, stok: undefined })).toBe("TIDAK_DIKETAHUI");
    expect(statusStokSnapshot({ ...dasar, sumber: "local", stok: undefined })).toBe("HABIS");
  });

  it("local tidak pernah basi; reservasi mengurangi stok bebas", () => {
    const lama = { tersedia: 5, dataPada: new Date("2020-01-01T00:00:00Z") };
    expect(statusStokSnapshot({ ...dasar, sumber: "local", stok: lama })).toBe("TERSEDIA");
    expect(statusStokSnapshot({ ...dasar, sumber: "local", stok: lama, reservasi: 5 })).toBe(
      "HABIS",
    );
  });
});

describe("jadwalUlangPicking (T-009 §5: sampai 6 jam)", () => {
  const dibuat = new Date("2026-11-26T00:00:00Z");
  const jeda = (n: number, kini = dibuat, acak = 0) =>
    (jadwalUlangPicking(n, dibuat, kini, acak)?.getTime() ?? Number.NaN) - kini.getTime();

  it("eksponensial 30 dtk × 2^(n−1), maks. 30 menit, jitter ≤ 10%", () => {
    expect([1, 2, 3, 6, 7, 20].map((n) => jeda(n))).toEqual([
      30_000, 60_000, 120_000, 960_000, 1_800_000, 1_800_000,
    ]);
    expect(jeda(1, dibuat, 0.999)).toBe(32_997);
  });

  it("lewat 6 jam sejak masuk outbox → null (GAGAL)", () => {
    const hampir = new Date(dibuat.getTime() + BATAS_RETRY_PICKING_MS - 40_000);
    expect(jadwalUlangPicking(1, dibuat, hampir, 0)).not.toBeNull();
    expect(jadwalUlangPicking(2, dibuat, hampir, 0)).toBeNull();
  });
});

describe("kodeKategoriTerlarang", () => {
  it("cocok per segmen kode, bukan substring", () => {
    expect(kodeKategoriTerlarang("rokok")).toBe(true);
    expect(kodeKategoriTerlarang("minuman-bir")).toBe(true);
    expect(kodeKategoriTerlarang("minuman-ringan")).toBe(false);
    expect(kodeKategoriTerlarang("biskuit")).toBe(false); // mengandung "bi", bukan "bir"
  });
});
