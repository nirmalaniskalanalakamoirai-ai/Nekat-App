// Unit test engine harga T-020 (matriks TC-HE docs/spec/engine-harga.md §9).
// Semua angka CONTOH FIKTIF (lihat fixture.test-util.ts).
import { describe, expect, it } from "vitest";
import {
  K,
  kDengan,
  MODAL_FIKTIF,
  persen,
  PHI_FIKTIF,
  produkUji,
  rupiah,
  satuanUji,
} from "./fixture.test-util.js";
import {
  cekKesegaranModal,
  hitungHargaProduk,
  hitungHargaSel,
  kunciVersiHarga,
  validasiKonfigurasi,
} from "./hitung.js";
import type { InputSatuanJual, KodeMasalah, KonfigurasiHarga, TabelHarga } from "./tipe.js";

function satu(s: InputSatuanJual = satuanUji(), k: KonfigurasiHarga = K, bebasPpn = true) {
  const hasil = hitungHargaProduk(produkUji([s], { bebasPpn }), k);
  const t = hasil.satuan[0];
  if (!t) throw new Error("tabel kosong");
  return t;
}
const kodeAlasan = (t: TabelHarga) => t.alasanTidakTayang.map((m) => m.kode);
const kodePeringatan = (t: TabelHarga) => t.peringatan.map((m) => m.kode);

describe("harga sel: modal + margin (P-01)", () => {
  it("sel RUPIAH: harga = isian, margin = harga − modal", () => {
    const t = satu();
    expect(t.tayang).toBe(true);
    expect(t.status).toBe("TAYANG");
    expect(t.alasanTidakTayang).toEqual([]);
    expect(t.modal).toBe(MODAL_FIKTIF);
    expect(t.sel.SATUAN).toMatchObject({ harga: 12_000, margin: 2_000, valid: true, aktif: true });
    expect(t.sel.MITRA_GROSIR).toMatchObject({ harga: 11_000, margin: 1_000, valid: true });
  });

  it("TC-HE-03 sel PERSEN habis dibagi: H = M + M × bp / 10000 persis", () => {
    const t = satu(satuanUji({ sel: { SATUAN: persen(2_000), MITRA_GROSIR: persen(1_250) } }));
    expect(t.sel.SATUAN.harga).toBe(12_000);
    expect(t.sel.MITRA_GROSIR.harga).toBe(11_250);
    expect(t.tayang).toBe(true);
  });

  it("TC-HE-04 sel PERSEN menghasilkan pecahan → HARGA_PECAHAN, perlu ditinjau, tanpa pembulatan (H6, K-28)", () => {
    // 10.001 × 10 % = 1.000,1 → bukan rupiah bulat.
    const t = satu(satuanUji({ modal: 10_001, sel: { SATUAN: persen(1_000) } }));
    expect(t.sel.SATUAN.harga).toBeNull();
    expect(t.sel.SATUAN.valid).toBe(false);
    expect(t.tayang).toBe(false);
    expect(t.status).toBe("PERLU_DITINJAU");
    expect(kodeAlasan(t)).toEqual(["HARGA_PECAHAN"]);
    expect(t.alasanTidakTayang[0]?.perluDitinjau).toBe(true);
  });

  it("sel Mitra Grosir pecahan tidak menahan tayang, tetapi grup memakai harga satuan (K-27)", () => {
    const t = satu(
      satuanUji({ modal: 10_001, sel: { SATUAN: rupiah(12_000), MITRA_GROSIR: persen(1_000) } }),
    );
    expect(t.tayang).toBe(true);
    expect(t.sel.MITRA_GROSIR.masalah.map((m) => m.kode)).toEqual(["HARGA_PECAHAN"]);
    expect(kodePeringatan(t)).toContain("GROSIR_TIDAK_TERSEDIA");
  });

  it("persen bukan basis poin bulat (lebih halus dari 0,01 %) → FORMAT_PERSEN", () => {
    const t = satu(satuanUji({ sel: { SATUAN: persen(1_250.5) } }));
    expect(kodeAlasan(t)).toEqual(["FORMAT_PERSEN"]);
    expect(t.status).toBe("TIDAK_TAYANG");
  });

  it("harga rupiah pecahan / NaN / Infinity → FORMAT_HARGA, tidak dibulatkan", () => {
    for (const h of [12_000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = satu(satuanUji({ sel: { SATUAN: rupiah(h) } }));
      expect(kodeAlasan(t)).toEqual(["FORMAT_HARGA"]);
      expect(t.sel.SATUAN.harga).toBeNull();
    }
  });

  it("jenis isian yang tidak diizinkan konfigurasi ditolak", () => {
    const t = satu(
      satuanUji({ sel: { SATUAN: persen(2_000) } }),
      kDengan({ jenisIsiSelDiizinkan: ["RUPIAH"] }),
    );
    expect(kodeAlasan(t)).toEqual(["FORMAT_PERSEN"]);
  });
});

describe("tidak ada harga di bawah atau sama dengan modal (PG-1, P-16)", () => {
  it("TC-HE-05 harga = modal → MARGIN_NOL, tidak tayang", () => {
    const t = satu(satuanUji({ sel: { SATUAN: rupiah(MODAL_FIKTIF) } }));
    expect(kodeAlasan(t)).toEqual(["MARGIN_NOL"]);
    expect(t.sel.SATUAN.margin).toBeNull();
    expect(t.tayang).toBe(false);
  });

  it("persen 0 → MARGIN_NOL", () => {
    expect(kodeAlasan(satu(satuanUji({ sel: { SATUAN: persen(0) } })))).toEqual(["MARGIN_NOL"]);
  });

  it("TC-HE-06 harga < modal / persen negatif / harga negatif → MARGIN_NEGATIF", () => {
    for (const isi of [rupiah(MODAL_FIKTIF - 1), persen(-500), rupiah(-1), rupiah(0)]) {
      const t = satu(satuanUji({ sel: { SATUAN: isi } }));
      expect(kodeAlasan(t)).toEqual(["MARGIN_NEGATIF"]);
      expect(t.tayang).toBe(false);
    }
  });

  it("Mitra Grosir di bawah modal ditolak tanpa menahan Harga Satuan (P-06)", () => {
    const t = satu(
      satuanUji({ sel: { SATUAN: rupiah(12_000), MITRA_GROSIR: rupiah(MODAL_FIKTIF - 1) } }),
    );
    expect(t.sel.MITRA_GROSIR.valid).toBe(false);
    expect(t.sel.MITRA_GROSIR.masalah.map((m) => m.kode)).toEqual(["MARGIN_NEGATIF"]);
    expect(t.tayang).toBe(true);
  });
});

// Margin minimum sel: bawaan null (menunggu keputusan K-41); 5 % (contoh K-16) diset eksplisit.
const K5 = kDengan({ marginMinimumBp: 500 });

describe("batas bawah margin dari modal (konfigurasi, menunggu K-41)", () => {
  it("bawaan: margin minimum sel kosong → cukup harga > modal (PG-1)", () => {
    expect(K.marginMinimumBp).toBeNull();
    const t = satu(satuanUji({ sel: { SATUAN: rupiah(MODAL_FIKTIF + 1) } }));
    expect(t.tayang).toBe(true);
    expect(t.sel.SATUAN.margin).toBe(1);
  });

  it("margin minimum 5 %: margin tepat 5 % lolos (rupiah dan persen)", () => {
    expect(satu(satuanUji({ sel: { SATUAN: rupiah(10_500) } }), K5).tayang).toBe(true);
    const t = satu(satuanUji({ sel: { SATUAN: persen(500) } }), K5);
    expect(t.sel.SATUAN.harga).toBe(10_500);
    expect(t.tayang).toBe(true);
  });

  it("margin minimum 5 %: di bawah 5 % (tetapi > 0) → MARGIN_DI_BAWAH_MINIMUM, tidak tayang", () => {
    for (const isi of [rupiah(10_499), persen(499), rupiah(MODAL_FIKTIF + 1)]) {
      const t = satu(satuanUji({ sel: { SATUAN: isi } }), K5);
      expect(kodeAlasan(t)).toEqual(["MARGIN_DI_BAWAH_MINIMUM"]);
      expect(t.sel.SATUAN.harga).toBeNull(); // sel tidak valid tidak punya harga jual
      expect(t.sel.SATUAN.hargaTerhitung).not.toBeNull(); // tetap ditampilkan ke admin
      expect(t.sel.SATUAN.margin).toBeNull();
    }
  });
});

describe("PPN: cek modal memakai harga tanpa PPN (K-28, G-04)", () => {
  const kPpn = kDengan({ ppnFaktor: PHI_FIKTIF });
  const kPpn5 = kDengan({ ppnFaktor: PHI_FIKTIF, marginMinimumBp: 500 });
  const ppn = (h: number, k: KonfigurasiHarga = kPpn) =>
    satu(satuanUji({ sel: { SATUAN: rupiah(h) } }), k, false);

  it("TC-HE-12 harga termasuk PPN > modal tetapi harga tanpa PPN = modal → HARGA_DI_BAWAH_MODAL", () => {
    // 11.100 / (111/100) = 10.000 = modal (fiktif).
    const t = ppn(11_100);
    expect(kodeAlasan(t)).toEqual(["HARGA_DI_BAWAH_MODAL"]);
    expect(t.tayang).toBe(false);
  });

  it("batas 5 % juga tanpa PPN: tepat 5 % lolos, kurang 1 rupiah ditolak", () => {
    // 11.655 / 1,11 = 10.500 = modal × 1,05 (fiktif).
    expect(ppn(11_655, kPpn5).tayang).toBe(true);
    expect(kodeAlasan(ppn(11_654, kPpn5))).toEqual(["MARGIN_DI_BAWAH_MINIMUM"]);
    expect(kodeAlasan(ppn(11_101, kPpn5))).toEqual(["MARGIN_DI_BAWAH_MINIMUM"]);
    expect(ppn(11_101).tayang).toBe(true); // tanpa margin minimum: cukup > modal tanpa PPN
  });

  it("TC-HE-13 PPN belum dikonfigurasi: produk kena PPN tidak tayang, produk bebas PPN tayang", () => {
    const kena = ppn(12_000, K);
    expect(kodeAlasan(kena)).toEqual(["PPN_BELUM_DIKONFIGURASI"]);
    expect(kena.sel.SATUAN.valid).toBe(false);
    expect(satu(satuanUji({ sel: { SATUAN: rupiah(12_000) } }), K, true).tayang).toBe(true);
  });
});

describe("modal per satuan jual (K-01)", () => {
  const kasus: [number | null, KodeMasalah][] = [
    [null, "MODAL_KOSONG"],
    [0, "MODAL_TIDAK_VALID"],
    [-5, "MODAL_TIDAK_VALID"],
    [Number.NaN, "MODAL_TIDAK_VALID"],
    [10_000.5, "MODAL_PECAHAN"],
    [Number.POSITIVE_INFINITY, "ANGKA_OVERFLOW"],
    [2 ** 53 + 2, "ANGKA_OVERFLOW"],
  ];
  it.each(kasus)("TC-HE-01 modal %s → %s, tidak tayang, tidak ada harga", (modal, kode) => {
    const t = satu(satuanUji({ modal }));
    expect(kodeAlasan(t)).toEqual([kode]);
    expect(t.tayang).toBe(false);
    expect(t.modal).toBeNull();
    expect(t.sel.SATUAN.harga).toBeNull();
    expect(t.sel.MITRA_GROSIR.harga).toBeNull();
  });

  it("modal pecahan masuk antrean perlu ditinjau", () => {
    expect(satu(satuanUji({ modal: 10_000.5 })).status).toBe("PERLU_DITINJAU");
  });

  it("TC-HE-45 hasil markup melewati batas integer aman → ANGKA_OVERFLOW, bukan hasil salah", () => {
    const t = satu(
      satuanUji({ modal: Number.MAX_SAFE_INTEGER - 1, sel: { SATUAN: persen(10_000) } }),
    );
    expect(kodeAlasan(t)).toEqual(["ANGKA_OVERFLOW"]);
    expect(t.sel.SATUAN.harga).toBeNull();
  });
});

describe("produk tanpa harga tidak tayang (PG-5, keputusan #6, T-003 field margin kosong)", () => {
  it("TC-HE-07 sel Harga Satuan kosong → SEL_KOSONG, tidak tayang", () => {
    for (const sel of [{}, { SATUAN: null }, { MITRA_GROSIR: rupiah(11_000) }]) {
      const t = satu(satuanUji({ sel }));
      expect(kodeAlasan(t)).toEqual(["SEL_KOSONG"]);
      expect(t.tayang).toBe(false);
      expect(t.status).toBe("TIDAK_TAYANG");
      expect(t.alasanTidakTayang[0]?.pesan).toContain("Harga belum diisi");
    }
  });

  it("produk baru dengan semua field harga & modal kosong → tidak tayang", () => {
    const t = satu(satuanUji({ modal: null, sel: {} }));
    expect(t.tayang).toBe(false);
    expect(kodeAlasan(t)).toEqual(["MODAL_KOSONG"]);
  });

  it("satuan lain pada produk yang sama dinilai sendiri", () => {
    const hasil = hitungHargaProduk(
      produkUji([
        satuanUji({ idSatuanJual: "a", sel: {} }),
        satuanUji({
          idSatuanJual: "b",
          kode: "LUSIN",
          isi: 12,
          modal: 120_000,
          sel: { SATUAN: rupiah(140_000) },
        }),
      ]),
      K,
    );
    expect(hasil.satuan.map((t) => t.tayang)).toEqual([false, true]);
  });

  it("produk tanpa satuan jual → tidak ada yang tayang", () => {
    expect(hitungHargaProduk(produkUji([]), K).satuan).toEqual([]);
  });
});

describe("pagar level: Satuan ≥ Mitra Grosir ≥ Franchise (PG-2, P-22, K-14)", () => {
  it("TC-HE-08 Mitra Grosir > Harga Satuan → PAGAR_LEVEL_DILANGGAR, tidak tayang", () => {
    const t = satu(satuanUji({ sel: { SATUAN: rupiah(11_000), MITRA_GROSIR: rupiah(12_000) } }));
    expect(kodeAlasan(t)).toEqual(["PAGAR_LEVEL_DILANGGAR"]);
    expect(t.tayang).toBe(false);
    expect(t.sel.SATUAN.valid).toBe(false);
    expect(t.sel.MITRA_GROSIR.valid).toBe(false);
  });

  it("TC-HE-09 Mitra Grosir = Harga Satuan → lolos (K-14)", () => {
    const t = satu(satuanUji({ sel: { SATUAN: rupiah(11_000), MITRA_GROSIR: rupiah(11_000) } }));
    expect(t.tayang).toBe(true);
    expect(t.sel.MITRA_GROSIR.valid).toBe(true);
  });

  it("TC-HE-10 Franchise > Mitra Grosir, Franchise nonaktif → peringatan, tetap tayang", () => {
    const t = satu(
      satuanUji({
        sel: { SATUAN: rupiah(12_000), MITRA_GROSIR: rupiah(11_000), FRANCHISE: rupiah(11_500) },
      }),
    );
    expect(t.tayang).toBe(true);
    expect(kodePeringatan(t)).toEqual(["PAGAR_LEVEL_NONAKTIF"]);
    expect(t.sel.FRANCHISE).toMatchObject({ valid: false, aktif: false });
    expect(t.sel.MITRA_GROSIR.valid).toBe(true);
  });

  it("Franchise aktif dan > Mitra Grosir → keduanya tidak valid, Harga Satuan tetap tayang", () => {
    const t = satu(
      satuanUji({
        sel: { SATUAN: rupiah(12_000), MITRA_GROSIR: rupiah(11_000), FRANCHISE: rupiah(11_500) },
      }),
      kDengan({ levelAktif: ["SATUAN", "MITRA_GROSIR", "FRANCHISE"] }),
    );
    expect(t.tayang).toBe(true);
    expect(t.sel.MITRA_GROSIR.valid).toBe(false);
    expect(t.sel.FRANCHISE.valid).toBe(false);
    expect(t.sel.MITRA_GROSIR.masalah.map((m) => m.kode)).toEqual(["PAGAR_LEVEL_DILANGGAR"]);
  });

  it("Mitra Grosir kosong: Franchise tetap dibanding langsung dengan Harga Satuan", () => {
    const t = satu(
      satuanUji({ sel: { SATUAN: rupiah(11_000), FRANCHISE: rupiah(12_000) } }),
      kDengan({ levelAktif: ["SATUAN", "MITRA_GROSIR", "FRANCHISE"] }),
    );
    expect(kodeAlasan(t)).toEqual(["PAGAR_LEVEL_DILANGGAR"]);
  });

  it("pelanggaran pagar level + harga di bawah minimum dilaporkan sekaligus", () => {
    const t = satu(
      satuanUji({ sel: { SATUAN: rupiah(10_400), MITRA_GROSIR: rupiah(11_000) } }),
      K5,
    );
    expect(kodeAlasan(t)).toEqual(["MARGIN_DI_BAWAH_MINIMUM", "PAGAR_LEVEL_DILANGGAR"]);
  });
});

describe("tier grup opsional & satuan tanpa harga Mitra Grosir (P-21, P-06, K-27)", () => {
  it("TC-HE-11 Mitra Grosir kosong → tayang + tanda admin GROSIR_TIDAK_TERSEDIA", () => {
    const t = satu(satuanUji({ sel: { SATUAN: rupiah(12_000) } }));
    expect(t.tayang).toBe(true);
    expect(kodePeringatan(t)).toEqual(["GROSIR_TIDAK_TERSEDIA"]);
    expect(t.peringatan[0]?.jenis).toBe("INFO");
  });

  it("tier grup dimatikan admin (bolehGrup = false) → tidak ada tanda K-27", () => {
    const t = satu(satuanUji({ bolehGrup: false, sel: { SATUAN: rupiah(12_000) } }));
    expect(t.tayang).toBe(true);
    expect(t.peringatan).toEqual([]);
  });

  it("mitraWajibUntukTayang = true dan Mitra Grosir kosong → tidak tayang", () => {
    const t = satu(
      satuanUji({ sel: { SATUAN: rupiah(12_000) } }),
      kDengan({ mitraWajibUntukTayang: true }),
    );
    expect(kodeAlasan(t)).toEqual(["GROSIR_TIDAK_TERSEDIA"]);
    expect(t.alasanTidakTayang[0]?.jenis).toBe("ERROR");
  });
});

describe("pagar antar kemasan (P-14)", () => {
  const pcs = (sel: InputSatuanJual["sel"]) => satuanUji({ idSatuanJual: "pcs", sel });
  const lusin = (sel: InputSatuanJual["sel"]) =>
    satuanUji({ idSatuanJual: "lusin", kode: "LUSIN", isi: 12, modal: 120_000, sel });
  const hitung = (...s: InputSatuanJual[]) => hitungHargaProduk(produkUji(s), K).satuan;

  it("harga per pcs lusin sama atau lebih murah → lolos", () => {
    for (const h of [144_000, 140_000]) {
      const [a, b] = hitung(pcs({ SATUAN: rupiah(12_000) }), lusin({ SATUAN: rupiah(h) }));
      expect([a?.tayang, b?.tayang]).toEqual([true, true]);
    }
  });

  it("harga per pcs lusin lebih mahal dari 1 pcs → kedua satuan tidak tayang", () => {
    const [a, b] = hitung(pcs({ SATUAN: rupiah(12_000) }), lusin({ SATUAN: rupiah(144_001) }));
    expect(a && kodeAlasan(a)).toEqual(["PAGAR_KEMASAN_DILANGGAR"]);
    expect(b && kodeAlasan(b)).toEqual(["PAGAR_KEMASAN_DILANGGAR"]);
    expect(a?.alasanTidakTayang[0]?.pesan).toContain("lusin");
  });

  it("pelanggaran hanya pada Mitra Grosir → tetap tayang, harga grup tidak dipakai (K-27)", () => {
    const [a, b] = hitung(
      pcs({ SATUAN: rupiah(12_000), MITRA_GROSIR: rupiah(11_000) }),
      lusin({ SATUAN: rupiah(140_000), MITRA_GROSIR: rupiah(132_001) }),
    );
    for (const t of [a, b]) {
      expect(t?.tayang).toBe(true);
      expect(t?.sel.MITRA_GROSIR.valid).toBe(false);
      expect(t && kodePeringatan(t)).toEqual(["GROSIR_TIDAK_TERSEDIA"]);
    }
  });

  it("pelanggaran pada level nonaktif (Franchise) hanya peringatan", () => {
    const [a] = hitung(
      pcs({ SATUAN: rupiah(12_000), FRANCHISE: rupiah(10_600) }),
      lusin({ SATUAN: rupiah(140_000), FRANCHISE: rupiah(128_000) }),
    );
    expect(a?.tayang).toBe(true);
    expect(a?.sel.FRANCHISE.masalah.map((m) => [m.kode, m.jenis])).toEqual([
      ["PAGAR_KEMASAN_DILANGGAR", "PERINGATAN"],
    ]);
  });
});

describe("satuan jual (P-03), kategori (#7), konfigurasi", () => {
  it("TC-HE-02 kode di luar P-03 / isi 0 / isi tidak kanonik / kode ganda → SATUAN_TIDAK_VALID", () => {
    expect(kodeAlasan(satu(satuanUji({ kode: "BATANG" })))).toEqual(["SATUAN_TIDAK_VALID"]);
    expect(satu(satuanUji({ kode: "BATANG" })).kode).toBeNull();
    expect(kodeAlasan(satu(satuanUji({ kode: "DUS", isi: 0 })))).toEqual(["SATUAN_TIDAK_VALID"]);
    expect(kodeAlasan(satu(satuanUji({ kode: "PCS_3", isi: 2 })))).toEqual(["SATUAN_TIDAK_VALID"]);
    const ganda = hitungHargaProduk(
      produkUji([
        satuanUji({ idSatuanJual: "a", kode: "DUS", isi: 24, modal: 240_000 }),
        satuanUji({ idSatuanJual: "b", kode: "DUS", isi: 24, modal: 240_000 }),
      ]),
      K,
    );
    expect(ganda.satuan.map((t) => kodeAlasan(t))).toEqual([
      ["SATUAN_TIDAK_VALID"],
      ["SATUAN_TIDAK_VALID"],
    ]);
  });

  it("MOQ Mitra Grosir tidak valid → peringatan, MOQ dianggap kosong, tetap tayang", () => {
    const t = satu(satuanUji({ moqGrosir: 0 }));
    expect(t.tayang).toBe(true);
    expect(t.moqGrosir).toBeNull();
    expect(kodePeringatan(t)).toEqual(["MOQ_TIDAK_VALID"]);
  });

  it("kategori terlarang → KATEGORI_DILARANG; menunggu tinjauan kategori → PERLU_DITINJAU", () => {
    const dilarang = hitungHargaProduk(produkUji(undefined, { kodeKategori: "rokok" }), K)
      .satuan[0];
    expect(dilarang && kodeAlasan(dilarang)).toEqual(["KATEGORI_DILARANG"]);
    const tinjau = hitungHargaProduk(produkUji(undefined, { tinjauanKategori: "MENUNGGU" }), K)
      .satuan[0];
    expect(tinjau?.status).toBe("PERLU_DITINJAU");
    const disetujui = hitungHargaProduk(produkUji(undefined, { tinjauanKategori: "DISETUJUI" }), K)
      .satuan[0];
    expect(disetujui?.tayang).toBe(true);
  });

  it("konfigurasi tidak valid → semua satuan tidak tayang", () => {
    const salah: Partial<KonfigurasiHarga>[] = [
      { ppnFaktor: { pembilang: 111, penyebut: 0 } },
      { ppnFaktor: { pembilang: 99, penyebut: 100 } },
      { levelAktif: ["MITRA_GROSIR"] },
      { jenisIsiSelDiizinkan: [] },
      { marginMinimumBp: -1 },
      { marginMinimumBp: 0.5 },
      { batasAtasMarkupBp: 0 },
      { batasUsiaModalMenit: 0 },
    ];
    for (const ubah of salah) {
      expect(validasiKonfigurasi(kDengan(ubah)).length).toBe(1);
      const t = satu(satuanUji(), kDengan(ubah));
      expect(t.tayang).toBe(false);
      expect(kodeAlasan(t)).toEqual(["KONFIGURASI_TIDAK_VALID"]);
    }
    expect(validasiKonfigurasi(K)).toEqual([]);
  });

  it("markup di atas batas wajar → peringatan saja, tetap tayang", () => {
    const t = satu(
      satuanUji({ sel: { SATUAN: rupiah(30_000) } }),
      kDengan({ batasAtasMarkupBp: 10_000 }),
    );
    expect(t.tayang).toBe(true);
    expect(kodePeringatan(t)).toContain("MARKUP_DI_ATAS_BATAS");
  });
});

describe("pesan admin", () => {
  it("Bahasa Indonesia, menyebut satuan & level, tanpa nominal modal/harga", () => {
    const t = satu(satuanUji({ sel: { SATUAN: rupiah(MODAL_FIKTIF) } }));
    const pesan = t.alasanTidakTayang[0]?.pesan ?? "";
    expect(pesan).toBe(
      "Satuan 1 pcs · Harga Satuan: Harga sama dengan modal. Margin 0 tidak diizinkan.",
    );
    expect(pesan).not.toMatch(/10[.,]?000/);
    expect(t.alasanTidakTayang[0]).toMatchObject({ level: "SATUAN", idSatuanJual: "sj-fiktif-1" });
  });
});

describe("hitungHargaSel (pratinjau panel)", () => {
  it("menghitung satu sel dengan aturan yang sama", () => {
    expect(hitungHargaSel(MODAL_FIKTIF, persen(2_000), "SATUAN", true, K)).toMatchObject({
      harga: 12_000,
      valid: true,
    });
    expect(
      hitungHargaSel(MODAL_FIKTIF, rupiah(10_499), "MITRA_GROSIR", true, K5).masalah[0]?.kode,
    ).toBe("MARGIN_DI_BAWAH_MINIMUM");
    expect(hitungHargaSel(10_000.5, persen(2_000), "SATUAN", true, K).masalah[0]?.kode).toBe(
      "MODAL_PECAHAN",
    );
    const tanpaPpn = hitungHargaSel(MODAL_FIKTIF, rupiah(12_000), "SATUAN", false, K);
    expect(tanpaPpn.valid).toBe(false);
    expect(tanpaPpn.masalah.map((m) => m.kode)).toEqual(["PPN_BELUM_DIKONFIGURASI"]);
    expect(hitungHargaSel(MODAL_FIKTIF, null, "SATUAN", true, K).masalah[0]?.kode).toBe(
      "SEL_KOSONG",
    );
  });
});

describe("kesegaran modal (P-10)", () => {
  const t = satu();
  const k15 = kDengan({ batasUsiaModalMenit: 15 });
  const waktu = t.waktuDataModal?.getTime() ?? 0;

  it("tanpa batas → tidak dicek", () => {
    expect(cekKesegaranModal(t, K, new Date(waktu + 10 ** 9))).toEqual([]);
  });
  it("tepat 15 menit masih segar; lewat 1 ms → MODAL_KEDALUWARSA", () => {
    expect(cekKesegaranModal(t, k15, new Date(waktu + 15 * 60_000))).toEqual([]);
    expect(cekKesegaranModal(t, k15, new Date(waktu + 15 * 60_000 + 1))[0]?.kode).toBe(
      "MODAL_KEDALUWARSA",
    );
  });
  it("waktu data kosong → kedaluwarsa", () => {
    const tanpaWaktu = satu(satuanUji({ waktuDataModal: null }));
    expect(cekKesegaranModal(tanpaWaktu, k15, new Date(waktu))[0]?.kode).toBe("MODAL_KEDALUWARSA");
  });
});

describe("determinisme & kunci versi harga (TC-HE-46)", () => {
  const p = produkUji();
  const s = satuanUji();
  it("input sama → hasil & kunci identik; waktu data tidak memengaruhi", () => {
    expect(hitungHargaProduk(p, K)).toEqual(hitungHargaProduk(p, K));
    const sLain = satuanUji({ waktuDataModal: new Date("2030-01-01T00:00:00Z") });
    expect(kunciVersiHarga(p, sLain, K)).toBe(kunciVersiHarga(p, s, K));
  });
  it("sel, modal, atau konfigurasi berubah → kunci berubah", () => {
    const awal = kunciVersiHarga(p, s, K);
    expect(kunciVersiHarga(p, satuanUji({ sel: { SATUAN: rupiah(12_001) } }), K)).not.toBe(awal);
    expect(kunciVersiHarga(p, satuanUji({ modal: 10_001 }), K)).not.toBe(awal);
    expect(kunciVersiHarga(p, s, kDengan({ ppnFaktor: PHI_FIKTIF }))).not.toBe(awal);
  });
});

describe("properti acak (TC-HE-47, generator deterministik)", () => {
  // LCG sederhana agar tes bisa diulang tanpa dependensi tambahan.
  let benih = 20_201_119;
  const acak = (maks: number) => {
    benih = (benih * 1_103_515_245 + 12_345) % 2_147_483_648;
    return benih % maks;
  };
  const isiAcak = (modal: number) => {
    const pilih = acak(4);
    if (pilih === 0) return null;
    if (pilih === 1) return persen(acak(4_000) - 200);
    return rupiah(modal + acak(modal) - Math.floor(modal / 10));
  };

  it("setiap harga valid > modal, bulat, pagar level & kemasan terjaga, tayang ⇒ Harga Satuan valid", () => {
    for (let n = 0; n < 2_000; n++) {
      const modalPcs = 1 + acak(50_000);
      const modalLusin = modalPcs * 12 - acak(modalPcs);
      const k = kDengan({
        marginMinimumBp: acak(2) === 0 ? null : 500,
        ppnFaktor: acak(2) === 0 ? null : PHI_FIKTIF,
      });
      const bebasPpn = acak(2) === 0;
      const hasil = hitungHargaProduk(
        produkUji(
          [
            satuanUji({
              idSatuanJual: "pcs",
              modal: modalPcs,
              sel: { SATUAN: isiAcak(modalPcs), MITRA_GROSIR: isiAcak(modalPcs) },
            }),
            satuanUji({
              idSatuanJual: "lusin",
              kode: "LUSIN",
              isi: 12,
              modal: modalLusin,
              sel: { SATUAN: isiAcak(modalLusin), MITRA_GROSIR: isiAcak(modalLusin) },
            }),
          ],
          { bebasPpn },
        ),
        k,
      );
      for (const t of hasil.satuan) {
        for (const sel of Object.values(t.sel)) {
          if (sel.harga !== null) expect(Number.isSafeInteger(sel.harga)).toBe(true);
          if (sel.hargaTerhitung !== null) {
            expect(Number.isSafeInteger(sel.hargaTerhitung)).toBe(true);
          }
          expect(sel.harga !== null).toBe(sel.valid); // harga jual hanya dari sel valid
          if (sel.valid) {
            expect(sel.harga).not.toBeNull();
            expect(sel.harga ?? 0).toBeGreaterThan(t.modal ?? Infinity);
          }
        }
        const { SATUAN: s, MITRA_GROSIR: m } = t.sel;
        if (s.valid && m.valid) expect(s.harga ?? 0).toBeGreaterThanOrEqual(m.harga ?? 0);
        expect(t.tayang).toBe(t.alasanTidakTayang.length === 0);
        if (t.tayang) expect(s.valid).toBe(true);
      }
      const [pcs, lusin] = hasil.satuan;
      for (const level of ["SATUAN", "MITRA_GROSIR"] as const) {
        const a = pcs?.sel[level];
        const b = lusin?.sel[level];
        if (a?.valid && b?.valid) {
          expect((b.harga ?? 0) <= (a.harga ?? 0) * 12).toBe(true);
        }
      }
    }
  });
});

describe("putaran perbaikan 1 (review + audit keamanan)", () => {
  it("hitungHargaSel dengan konfigurasi rusak → sel tidak valid + KONFIGURASI_TIDAK_VALID, tanpa melempar", () => {
    for (const ppnFaktor of [
      { pembilang: 1.5, penyebut: 1 },
      { pembilang: 111, penyebut: 0 },
    ]) {
      const k = kDengan({ ppnFaktor });
      const sel = hitungHargaSel(MODAL_FIKTIF, rupiah(12_000), "SATUAN", false, k);
      expect(sel).toMatchObject({ valid: false, harga: null, hargaTerhitung: null });
      expect(sel.masalah.map((m) => m.kode)).toEqual(["KONFIGURASI_TIDAK_VALID"]);
    }
  });

  it("sel tidak valid: harga = null, nilai terhitung hanya di hargaTerhitung", () => {
    const t = satu(satuanUji({ sel: { SATUAN: rupiah(11_000), MITRA_GROSIR: rupiah(12_000) } }));
    expect(t.sel.SATUAN).toMatchObject({ valid: false, harga: null, hargaTerhitung: 11_000 });
    expect(t.sel.MITRA_GROSIR).toMatchObject({ valid: false, harga: null, hargaTerhitung: 12_000 });
    const negatif = satu(satuanUji({ sel: { SATUAN: rupiah(MODAL_FIKTIF - 1) } }));
    expect(negatif.sel.SATUAN).toMatchObject({ harga: null, hargaTerhitung: MODAL_FIKTIF - 1 });
  });

  it("kode kategori terlarang dinormalisasi (huruf besar, spasi, NFKC) di kedua sisi", () => {
    for (const kodeKategori of ["Rokok", "  ROKOK ", "ｒｏｋｏｋ"]) {
      const t = hitungHargaProduk(produkUji(undefined, { kodeKategori }), K).satuan[0];
      expect(t && kodeAlasan(t)).toEqual(["KATEGORI_DILARANG"]);
    }
    const k = kDengan({ kategoriTerlarang: [" Minuman-Beralkohol "] });
    const t = hitungHargaProduk(produkUji(undefined, { kodeKategori: "minuman-beralkohol" }), k)
      .satuan[0];
    expect(t && kodeAlasan(t)).toEqual(["KATEGORI_DILARANG"]);
  });

  it("pagar kemasan hanya membandingkan sel valid: 1 pcs di bawah modal tidak menjatuhkan lusin", () => {
    const [pcs, lusin] = hitungHargaProduk(
      produkUji([
        satuanUji({ idSatuanJual: "pcs", sel: { SATUAN: rupiah(MODAL_FIKTIF - 1) } }),
        satuanUji({
          idSatuanJual: "lusin",
          kode: "LUSIN",
          isi: 12,
          modal: 120_000,
          sel: { SATUAN: rupiah(140_000) },
        }),
      ]),
      K,
    ).satuan;
    expect(pcs && kodeAlasan(pcs)).toEqual(["MARGIN_NEGATIF"]);
    expect(lusin?.tayang).toBe(true);
  });

  it("mitraWajibUntukTayang tanpa level MITRA_GROSIR aktif → konfigurasi tidak valid", () => {
    const k = kDengan({ mitraWajibUntukTayang: true, levelAktif: ["SATUAN"] });
    expect(validasiKonfigurasi(k).map((m) => m.kode)).toEqual(["KONFIGURASI_TIDAK_VALID"]);
    expect(satu(satuanUji(), k).tayang).toBe(false);
  });

  it("modal bertanggal masa depan tidak dianggap segar", () => {
    const t = satu();
    const waktu = t.waktuDataModal?.getTime() ?? 0;
    const r = cekKesegaranModal(t, kDengan({ batasUsiaModalMenit: 15 }), new Date(waktu - 1));
    expect(r.map((m) => m.kode)).toEqual(["MODAL_KEDALUWARSA"]);
  });

  it("kunci versi: NaN/Infinity diberi penanda tipe, berbeda dari string atau null", () => {
    const p = produkUji();
    const kNaN = kunciVersiHarga(p, satuanUji({ modal: Number.NaN }), K);
    const kInf = kunciVersiHarga(p, satuanUji({ modal: Number.POSITIVE_INFINITY }), K);
    const kNull = kunciVersiHarga(p, satuanUji({ modal: null }), K);
    expect(kNaN).toContain('"modal":{"$angka":"NaN"}');
    expect(new Set([kNaN, kInf, kNull]).size).toBe(3);
  });
});
