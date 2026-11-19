// Jenis harga baris (spesifikasi §5.2). Semua angka CONTOH FIKTIF.
import { describe, expect, it } from "vitest";
import { jenisHargaBaris } from "./baris.js";
import { K, kDengan, MODAL_FIKTIF, produkUji, rupiah, satuanUji } from "./fixture.test-util.js";
import { hitungHargaProduk } from "./hitung.js";
import type { InputSatuanJual, KonfigurasiHarga, TabelHarga } from "./tipe.js";

function tabel(s: InputSatuanJual = satuanUji(), k: KonfigurasiHarga = K): TabelHarga {
  const t = hitungHargaProduk(produkUji([s]), k).satuan[0];
  if (!t) throw new Error("tabel kosong");
  return t;
}

describe("jenisHargaBaris", () => {
  it("TC-HE-20 syarat grup terpenuhi, 1 pcs → GRUP dengan Harga Mitra Grosir (K-09, K-14)", () => {
    expect(jenisHargaBaris(tabel(), 1, true)).toEqual({
      ok: true,
      nilai: { jenis: "GRUP", harga: 11_000, info: [] },
    });
  });

  it("syarat grup belum terpenuhi, tanpa MOQ → SATUAN tanpa info", () => {
    expect(jenisHargaBaris(tabel(), 50, false)).toEqual({
      ok: true,
      nilai: { jenis: "SATUAN", harga: 12_000, info: [] },
    });
  });

  it("TC-HE-19 qty ≥ MOQ grosir di luar grup → GROSIR_MOQ; qty < MOQ → SATUAN (P-05)", () => {
    const t = tabel(satuanUji({ moqGrosir: 6 }));
    expect(jenisHargaBaris(t, 6, false)).toMatchObject({
      ok: true,
      nilai: { jenis: "GROSIR_MOQ", harga: 11_000 },
    });
    expect(jenisHargaBaris(t, 5, false)).toMatchObject({
      ok: true,
      nilai: { jenis: "SATUAN", harga: 12_000 },
    });
  });

  it("K-27 syarat grup terpenuhi tetapi Harga Mitra Grosir kosong → SATUAN + GROSIR_TIDAK_TERSEDIA", () => {
    const r = jenisHargaBaris(tabel(satuanUji({ sel: { SATUAN: rupiah(12_000) } })), 1, true);
    expect(r.ok && r.nilai.jenis).toBe("SATUAN");
    expect(r.ok && r.nilai.harga).toBe(12_000);
    expect(r.ok && r.nilai.info.map((m) => m.kode)).toEqual(["GROSIR_TIDAK_TERSEDIA"]);
  });

  it("K-27 Harga Mitra Grosir tidak valid (di bawah modal) → tidak dipakai, juga untuk MOQ", () => {
    const t = tabel(
      satuanUji({ moqGrosir: 2, sel: { SATUAN: rupiah(12_000), MITRA_GROSIR: rupiah(9_000) } }),
    );
    expect(jenisHargaBaris(t, 10, true)).toMatchObject({
      ok: true,
      nilai: { jenis: "SATUAN", harga: 12_000 },
    });
    expect(jenisHargaBaris(t, 10, false)).toMatchObject({ ok: true, nilai: { jenis: "SATUAN" } });
  });

  it("P-21 tier grup dimatikan → SATUAN + GRUP_TIDAK_DIAKTIFKAN; MOQ grosir tetap berlaku", () => {
    const t = tabel(satuanUji({ bolehGrup: false, moqGrosir: 6 }));
    const r = jenisHargaBaris(t, 1, true);
    expect(r.ok && r.nilai.jenis).toBe("SATUAN");
    expect(r.ok && r.nilai.info.map((m) => m.kode)).toEqual(["GRUP_TIDAK_DIAKTIFKAN"]);
    expect(jenisHargaBaris(t, 6, true)).toMatchObject({
      ok: true,
      nilai: { jenis: "GROSIR_MOQ", harga: 11_000 },
    });
  });

  it("level Mitra Grosir dinonaktifkan konfigurasi → harga Mitra tidak dipakai", () => {
    const t = tabel(satuanUji(), kDengan({ levelAktif: ["SATUAN"] }));
    expect(jenisHargaBaris(t, 1, true)).toMatchObject({ ok: true, nilai: { jenis: "SATUAN" } });
  });

  it("satuan tidak tayang → ditolak dengan alasannya", () => {
    const r = jenisHargaBaris(tabel(satuanUji({ sel: {} })), 1, true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.masalah.map((m) => m.kode)).toEqual(["TIDAK_TAYANG", "SEL_KOSONG"]);
  });

  it("qty tidak valid → QTY_TIDAK_VALID", () => {
    for (const q of [0, -1, 1.5, Number.NaN]) {
      const r = jenisHargaBaris(tabel(), q, true);
      expect(!r.ok && r.masalah[0]?.kode).toBe("QTY_TIDAK_VALID");
    }
  });
});

describe("jenisHargaBaris: verifikasi ulang TabelHarga (CWE-602)", () => {
  // TabelHarga palsu/rusak (mis. cache diubah) yang flag-nya mengaku tayang & valid.
  const asli = tabel(satuanUji({ moqGrosir: 6 }));
  const palsu = (ubah: { modal?: number | null; satuan?: number; mitra?: number }): TabelHarga =>
    ({
      ...asli,
      modal: ubah.modal === undefined ? asli.modal : ubah.modal,
      sel: {
        ...asli.sel,
        SATUAN: { ...asli.sel.SATUAN, harga: ubah.satuan ?? asli.sel.SATUAN.harga },
        MITRA_GROSIR: {
          ...asli.sel.MITRA_GROSIR,
          harga: ubah.mitra ?? asli.sel.MITRA_GROSIR.harga,
        },
      },
    }) as TabelHarga;
  const kode = (r: ReturnType<typeof jenisHargaBaris>) =>
    r.ok ? [] : r.masalah.map((m) => m.kode);

  it("modal null → ditolak", () => {
    expect(kode(jenisHargaBaris(palsu({ modal: null }), 1, false))).toContain("MODAL_KOSONG");
  });

  it("harga satuan ≤ modal → ditolak", () => {
    for (const satuan of [MODAL_FIKTIF, MODAL_FIKTIF - 1]) {
      expect(kode(jenisHargaBaris(palsu({ satuan }), 1, false))).toEqual(["HARGA_DI_BAWAH_MODAL"]);
    }
  });

  it("harga Mitra ≤ modal untuk GRUP / GROSIR_MOQ → ditolak", () => {
    const t = palsu({ mitra: MODAL_FIKTIF });
    expect(kode(jenisHargaBaris(t, 1, true))).toEqual(["HARGA_DI_BAWAH_MODAL"]);
    expect(kode(jenisHargaBaris(t, 6, false))).toEqual(["HARGA_DI_BAWAH_MODAL"]);
  });

  it("harga Mitra > harga satuan untuk GRUP / GROSIR_MOQ → ditolak", () => {
    const t = palsu({ mitra: 13_000 });
    expect(kode(jenisHargaBaris(t, 1, true))).toEqual(["PAGAR_LEVEL_DILANGGAR"]);
    expect(kode(jenisHargaBaris(t, 6, false))).toEqual(["PAGAR_LEVEL_DILANGGAR"]);
  });

  it("tabel asli tetap lolos", () => {
    expect(jenisHargaBaris(asli, 1, true)).toMatchObject({ ok: true, nilai: { jenis: "GRUP" } });
  });
});
