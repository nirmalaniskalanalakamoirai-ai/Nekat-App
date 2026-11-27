// Validasi respons katalog di klien. Bentuk data = skema respons NYATA apps/api/src/katalog/rute.ts.
// Angka FIKTIF.
import { afterEach, describe, expect, it, vi } from "vitest";
import { keKartu, normalisasiCari } from "./api";

const satuan = {
  id: "sj-1",
  kode: "PCS_1",
  label: "1 pcs",
  isi: 1,
  harga: { hargaSatuan: 2222, hargaBelanjaBareng: 1111 },
  tersedia: true,
  statusStok: "TERSEDIA",
  labelStok: null,
};
const kartu = {
  id: "p-1",
  nama: "Minyak Contoh 1 L",
  gambarUrl: null,
  kategori: { kode: "sembako", nama: "Sembako" },
  subkategori: { kode: "minyak-goreng", nama: "Minyak Goreng" },
  satuan,
  jumlahPilihanSatuan: 2,
  tersedia: true,
  statusStok: "TERSEDIA",
  labelStok: null,
  promo: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("keKartu", () => {
  it("menerima bentuk respons API apa adanya", () => {
    const k = keKartu(kartu);
    expect(k?.satuan.harga).toEqual({ hargaSatuan: 2222, hargaBelanjaBareng: 1111 });
    expect(k?.satuan.tersedia).toBe(true);
    expect(k?.subkategori?.kode).toBe("minyak-goreng");
  });

  it("subkategori null boleh", () => {
    expect(keKartu({ ...kartu, subkategori: null })?.subkategori).toBeNull();
  });

  it("harga tidak valid → kartu dibuang (R5, TC-UI-09) dan dicatat tanpa PII", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const harga of [
      { hargaSatuan: null, hargaBelanjaBareng: null },
      { hargaSatuan: 12.5, hargaBelanjaBareng: null },
      { hargaSatuan: -1, hargaBelanjaBareng: null },
      { hargaSatuan: 1000, hargaBelanjaBareng: 1.5 },
    ]) {
      expect(keKartu({ ...kartu, satuan: { ...satuan, harga } })).toBeNull();
    }
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("Minyak");
  });

  it("kode satuan di luar P-03 → dibuang (TC-UI-28)", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(keKartu({ ...kartu, satuan: { ...satuan, kode: "KARTON" } })).toBeNull();
  });

  it("statusStok bukan TERSEDIA tidak pernah bisa dibeli walau `tersedia` true (K-20, IG-02)", () => {
    for (const statusStok of ["HABIS", "TIDAK_DIKETAHUI"]) {
      const k = keKartu({
        ...kartu,
        statusStok,
        satuan: { ...satuan, statusStok, tersedia: true },
        tersedia: true,
      });
      expect(k?.satuan.tersedia).toBe(false);
      expect(k?.tersedia).toBe(false);
    }
  });

  it("status stok tak dikenal → dibuang", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(keKartu({ ...kartu, satuan: { ...satuan, statusStok: "TERBATAS" } })).toBeNull();
  });
});

describe("normalisasiCari", () => {
  it("pangkas spasi; < 2 karakter = tidak mencari; ≤ 100 karakter", () => {
    expect(normalisasiCari("  beras   pandan ")).toBe("beras pandan");
    expect(normalisasiCari("a")).toBeUndefined();
    expect(normalisasiCari("   ")).toBeUndefined();
    expect(normalisasiCari("x".repeat(150))?.length).toBe(100);
  });
});
