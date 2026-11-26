import { describe, expect, it } from "vitest";
import {
  bedaField,
  KEBIJAKAN_KUNCI_BAWAAN,
  punyaIzin,
  redaksiUntukLog,
  sedangDikunci,
  setelahGagal,
  TEKS_REDAKSI,
} from "./akses.js";
import {
  cekProduk,
  kataTerlarangDiNama,
  kategoriTerlarangAdmin,
  tentukanIsiSatuan,
  type KategoriUntukProduk,
} from "./katalog.js";

const sub = (kode: string, indukKode = "sembako"): KategoriUntukProduk => ({
  id: "k1",
  kode,
  aktif: true,
  induk: { kode: indukKode, aktif: true },
});

describe("kategori terlarang P-24 (semua tembakau/nikotin & alkohol)", () => {
  it.each([
    "rokok",
    "tembakau",
    "nikotin",
    "vape",
    "bir",
    "alkohol",
    "minuman-beralkohol",
    "rokok-kretek",
    "minuman-bir",
    "cerutu",
    " ROKOK ",
  ])("%s terlarang", (kode) => {
    expect(kategoriTerlarangAdmin(kode)).toBe(true);
  });
  it.each(["beras", "minuman-ringan", "teh-kopi", "susu"])("%s boleh", (kode) => {
    expect(kategoriTerlarangAdmin(kode)).toBe(false);
  });

  it("produk di subkategori/induk terlarang ditolak", () => {
    expect(cekProduk({ nama: "Apa saja", kategori: sub("kretek") })).toEqual({
      ok: false,
      galat: "KATEGORI_TERLARANG",
    });
    expect(cekProduk({ nama: "Apa saja", kategori: sub("lain", "minuman-beralkohol") })).toEqual({
      ok: false,
      galat: "KATEGORI_TERLARANG",
    });
    // Kategori utama terlarang tanpa induk tetap "terlarang" (bukan sekadar "bukan subkategori").
    expect(
      cekProduk({ nama: "x", kategori: { id: "k", kode: "rokok", aktif: true, induk: null } }),
    ).toEqual({ ok: false, galat: "KATEGORI_TERLARANG" });
  });

  it("kategori wajib subkategori aktif", () => {
    expect(cekProduk({ nama: "x", kategori: null })).toMatchObject({ galat: "KATEGORI_TIDAK_ADA" });
    expect(
      cekProduk({ nama: "x", kategori: { id: "k", kode: "sembako", aktif: true, induk: null } }),
    ).toMatchObject({ galat: "KATEGORI_BUKAN_SUBKATEGORI" });
    expect(
      cekProduk({ nama: "x", kategori: { ...sub("beras"), induk: { kode: "s", aktif: false } } }),
    ).toMatchObject({ galat: "KATEGORI_NONAKTIF" });
  });
});

describe("nama mencurigakan → tinjauan kategori (tidak tayang)", () => {
  it("kata utuh saja, tak peka huruf", () => {
    expect(kataTerlarangDiNama("Bir Pletok Betawi")).toEqual(["bir"]);
    expect(kataTerlarangDiNama("Sirup ANGGUR 600ml")).toEqual(["anggur"]);
    expect(kataTerlarangDiNama("Biskuit Kelapa")).toEqual([]); // "bir" bukan kata utuh
    expect(kataTerlarangDiNama("Rumput laut")).toEqual([]); // "rum" bukan kata utuh
  });

  it("produk baru bernama mencurigakan → MENUNGGU", () => {
    expect(cekProduk({ nama: "Rokok Filter 12", kategori: sub("beras") })).toEqual({
      ok: true,
      tinjauanKategori: "MENUNGGU",
      kataMencurigakan: ["rokok"],
    });
    expect(cekProduk({ nama: "Beras Pandan 5 kg", kategori: sub("beras") })).toEqual({
      ok: true,
      tinjauanKategori: "TIDAK_PERLU",
      kataMencurigakan: [],
    });
  });

  it("DISETUJUI bertahan hanya bila nama tidak berubah", () => {
    const sebelum = { nama: "Bir Pletok", tinjauanKategori: "DISETUJUI" as const };
    expect(cekProduk({ nama: "Bir Pletok", kategori: sub("beras"), sebelum })).toMatchObject({
      tinjauanKategori: "DISETUJUI",
      kataMencurigakan: [],
    });
    expect(cekProduk({ nama: "Bir Pletok Besar", kategori: sub("beras"), sebelum })).toMatchObject({
      tinjauanKategori: "MENUNGGU",
    });
    expect(cekProduk({ nama: "Wedang Jahe", kategori: sub("beras"), sebelum })).toMatchObject({
      tinjauanKategori: "TIDAK_PERLU",
    });
  });
});

describe("isi satuan jual", () => {
  it("PCS_1/PCS_3/LUSIN tetap; DUS/KOLI wajib diisi", () => {
    expect(tentukanIsiSatuan("PCS_1", undefined)).toEqual({ ok: true, isi: 1 });
    expect(tentukanIsiSatuan("LUSIN", 12)).toEqual({ ok: true, isi: 12 });
    expect(tentukanIsiSatuan("PCS_3", 4).ok).toBe(false);
    expect(tentukanIsiSatuan("DUS", undefined).ok).toBe(false);
    expect(tentukanIsiSatuan("DUS", 1).ok).toBe(false);
    expect(tentukanIsiSatuan("KOLI", 1.5).ok).toBe(false);
    expect(tentukanIsiSatuan("DUS", 40)).toEqual({ ok: true, isi: 40 });
  });
});

describe("akses: RBAC, penguncian, redaksi log", () => {
  it("punyaIzin tanpa wildcard", () => {
    expect(punyaIzin(new Set(["produk.ubah"]), "produk.ubah")).toBe(true);
    expect(punyaIzin(new Set(["produk.ubah"]), "stok.ubah")).toBe(false);
    expect(punyaIzin(new Set(["*"]), "stok.ubah")).toBe(false);
  });

  it("5 gagal → dikunci 15 menit; setelah lewat penghitung mulai dari 1", () => {
    const t0 = new Date("2026-11-27T00:00:00Z");
    let s = { gagalBeruntun: 0, dikunciSampai: null as Date | null };
    for (let i = 0; i < 4; i++) s = setelahGagal(s, t0, KEBIJAKAN_KUNCI_BAWAAN);
    expect(sedangDikunci(s, t0)).toBe(false);
    s = setelahGagal(s, t0, KEBIJAKAN_KUNCI_BAWAAN);
    expect(s.gagalBeruntun).toBe(5);
    expect(s.dikunciSampai?.toISOString()).toBe("2026-11-27T00:15:00.000Z");
    expect(sedangDikunci(s, new Date("2026-11-27T00:14:59Z"))).toBe(true);
    const lewat = new Date("2026-11-27T00:15:00Z");
    expect(sedangDikunci(s, lewat)).toBe(false);
    expect(setelahGagal(s, lewat, KEBIJAKAN_KUNCI_BAWAAN)).toEqual({
      gagalBeruntun: 1,
      dikunciSampai: null,
    });
  });

  it("redaksi rahasia & PII bersarang; field biasa utuh", () => {
    const hasil = redaksiUntukLog({
      nama: "Beras",
      deskripsi: "boleh",
      kataSandiHash: "scrypt$...",
      nested: { totpRahasiaEnc: "x", nomorHp: "+62812", ipHmac: "ab", tipe: "pcs" },
      daftar: [{ token: "t" }],
      waktu: new Date("2026-01-01T00:00:00Z"),
    });
    expect(hasil).toEqual({
      nama: "Beras",
      deskripsi: "boleh",
      kataSandiHash: TEKS_REDAKSI,
      nested: {
        totpRahasiaEnc: TEKS_REDAKSI,
        nomorHp: TEKS_REDAKSI,
        ipHmac: TEKS_REDAKSI,
        tipe: "pcs",
      },
      daftar: [{ token: TEKS_REDAKSI }],
      waktu: "2026-01-01T00:00:00.000Z",
    });
  });

  it("bedaField", () => {
    expect(bedaField({ a: 1, b: "x" }, { a: 2, b: "x", c: null })).toEqual(["a", "c"]);
  });
});

describe("periksaKategori (ubah tanpa ganti kategori)", () => {
  it("kategori nonaktif/terlarang dilewati bila periksaKategori=false; nama tetap dicek", () => {
    const mati = { ...sub("beras"), aktif: false };
    expect(cekProduk({ nama: "Beras", kategori: mati })).toMatchObject({ ok: false });
    expect(cekProduk({ nama: "Beras", kategori: mati, periksaKategori: false })).toMatchObject({
      ok: true,
      tinjauanKategori: "TIDAK_PERLU",
    });
    expect(
      cekProduk({ nama: "Rokok X", kategori: sub("kretek"), periksaKategori: false }),
    ).toMatchObject({ ok: true, tinjauanKategori: "MENUNGGU" });
  });
});
