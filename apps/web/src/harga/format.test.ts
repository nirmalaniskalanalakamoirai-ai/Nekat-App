// Angka di tes ini FIKTIF (bukan harga produk).
import { describe, expect, it } from "vitest";
import { formatRupiah, labelSatuan, satuanPendek, teksHargaKatalog } from "./format";

describe("formatRupiah (R9, TC-UI-11)", () => {
  it("rupiah penuh tanpa spasi, titik ribuan", () => {
    expect(formatRupiah(0)).toBe("Rp0");
    expect(formatRupiah(1111)).toBe("Rp1.111");
    expect(formatRupiah(9999999)).toBe("Rp9.999.999");
  });

  it("tidak pernah membulatkan / menyingkat", () => {
    const teks = formatRupiah(12345678);
    expect(teks).toBe("Rp12.345.678");
    expect(teks).not.toMatch(/rb|jt|,|\s/);
  });

  it("nilai tidak valid → null (tidak ditampilkan)", () => {
    for (const x of [1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1000", null, undefined]) {
      expect(formatRupiah(x)).toBeNull();
    }
  });
});

describe("label satuan (T-008 §1.3)", () => {
  it("label & satuan pendek", () => {
    expect(labelSatuan({ kode: "PCS_1", isi: 1 })).toBe("1 pcs");
    expect(labelSatuan({ kode: "PCS_3", isi: 3 })).toBe("3 pcs");
    expect(labelSatuan({ kode: "LUSIN", isi: 12 })).toBe("lusin (isi 12)");
    expect(labelSatuan({ kode: "DUS", isi: 24 })).toBe("dus (isi 24)");
    expect(labelSatuan({ kode: "KOLI", isi: 6 })).toBe("koli (isi 6)");
    expect(satuanPendek("PCS_1")).toBe("pcs");
    expect(satuanPendek("DUS")).toBe("dus");
  });
});

describe("teksHargaKatalog", () => {
  it("harga satuan + chip Harga Belanja Bareng (K-38)", () => {
    expect(teksHargaKatalog({ hargaSatuan: 2222, hargaBelanjaBareng: 1111 }, "PCS_1")).toEqual({
      aktif: "Rp2.222",
      perSatuan: "/pcs",
      chipGrup: "Harga Belanja Bareng Rp1.111",
      kalimat: "Rp2.222 per pcs, Harga Belanja Bareng Rp1.111.",
    });
  });

  it("tanpa harga grup (K-27) → tanpa chip & tanpa teks Belanja Bareng (TC-UI-07)", () => {
    const t = teksHargaKatalog({ hargaSatuan: 44444, hargaBelanjaBareng: null }, "DUS");
    expect(t?.chipGrup).toBeNull();
    expect(t?.kalimat).toBe("Rp44.444 per dus.");
    expect(t?.kalimat).not.toContain("Belanja Bareng");
  });

  it("harga satuan tidak valid → null (kartu tidak dirender, R5)", () => {
    expect(teksHargaKatalog({ hargaSatuan: 1.5, hargaBelanjaBareng: null }, "PCS_1")).toBeNull();
  });

  it("tidak pernah memuat kata terlarang (TC-UI-08)", () => {
    const t = teksHargaKatalog({ hargaSatuan: 2222, hargaBelanjaBareng: 1111 }, "KOLI");
    expect(JSON.stringify(t)).not.toMatch(/Mitra|drop point|modal|tier|MOQ/i);
  });
});
