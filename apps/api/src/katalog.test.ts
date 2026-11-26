// Tes API katalog (T-025) dengan repo palsu + pembaca snapshot lokal di memori (T-019).
// SEMUA ANGKA CONTOH FIKTIF (keputusan #6). Tidak ada produk rokok/bir nyata.
import { readFileSync } from "node:fs";
import {
  KONFIGURASI_HARGA_BAWAAN,
  type BarisModalLokal,
  type BarisStokLokal,
  type DataKatalog,
  type PembacaSnapshotInventori,
  type RepoKatalog,
  type SatuanDitahan,
} from "@nekat/domain";
import { LABEL_STOK_HABIS, LABEL_STOK_TIDAK_DIKETAHUI } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { buatApp } from "./app.js";
import { LayananKatalog } from "./katalog/layanan.js";
import { bacaKonfigLokasi } from "./lokasi.js";

const lokasi = bacaKonfigLokasi(
  JSON.parse(
    readFileSync(new URL("../../../config/lokasi.example.json", import.meta.url), "utf8"),
  ) as unknown,
);
const KODE_GUDANG = lokasi.zona[0]?.gudang ?? "";
const KODE_ZONA = lokasi.zona[0]?.kode ?? "";

const uid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const GUDANG = uid(99);
const WAKTU = new Date("2026-11-19T04:00:00Z");
/** Modal fiktif dengan angka unik agar mudah dicari di body respons. */
const MODAL_PENANDA = 987_653;

interface Satuan {
  id: string;
  skuId: string;
  jenis: string;
  isi: number;
  modal: number | null;
  satuan: number | null;
  mitra?: number | null;
}

function buatData(
  satuan: readonly Satuan[],
  nama: Record<string, string>,
  stok: Record<string, number>,
) {
  const skuIds = [...new Set(satuan.map((s) => s.skuId))];
  const data: DataKatalog = {
    kategori: [
      { id: uid(1), indukId: null, kode: "sembako", nama: "Sembako", urutan: 1, aktif: true },
      { id: uid(2), indukId: uid(1), kode: "beras", nama: "Beras", urutan: 1, aktif: true },
      { id: uid(3), indukId: null, kode: "minuman", nama: "Minuman", urutan: 2, aktif: true },
      { id: uid(4), indukId: uid(3), kode: "susu", nama: "Susu", urutan: 1, aktif: true },
    ],
    produk: skuIds.map((skuId) => ({
      id: produkDari(skuId),
      // SKU 205 & 206 di subkategori susu; lainnya beras.
      kategoriId: skuId === uid(205) || skuId === uid(206) ? uid(4) : uid(2),
      nama: nama[skuId] ?? "Tanpa Nama",
      deskripsi: "Deskripsi uji",
      gambarUrl: null,
      bebasPpn: true,
      tinjauanKategori: "TIDAK_PERLU",
      aktif: true,
    })),
    sku: skuIds.map((skuId) => ({
      id: skuId,
      produkId: produkDari(skuId),
      kodeSku: `KODE-${skuId.slice(-4)}`,
      namaVarian: null,
      satuanDasar: "pcs",
      aktifDiSumber: true,
    })),
    satuanJual: satuan.map((s) => ({
      id: s.id,
      skuId: s.skuId,
      jenis: s.jenis,
      isiSatuanDasar: s.isi,
      moqMitraGrosir: null,
      bolehGrup: true,
    })),
    hargaLevel: satuan.flatMap((s) => [
      ...(s.satuan === null
        ? []
        : [
            {
              satuanJualId: s.id,
              level: "SATUAN",
              mode: "RUPIAH",
              marginPersen: null,
              hargaJualRp: s.satuan,
            },
          ]),
      ...(s.mitra == null
        ? []
        : [
            {
              satuanJualId: s.id,
              level: "MITRA_GROSIR",
              mode: "RUPIAH",
              marginPersen: null,
              hargaJualRp: s.mitra,
            },
          ]),
    ]),
    timpaanModal: [],
  };
  const repoKatalog: RepoKatalog & { jumlahMuat: number } = {
    jumlahMuat: 0,
    muatData() {
      this.jumlahMuat++;
      return Promise.resolve(data);
    },
    idGudang: (kode) => Promise.resolve(kode === KODE_GUDANG ? GUDANG : null),
  };
  const repoInventori: PembacaSnapshotInventori = {
    stok: (ids, gudangId): Promise<BarisStokLokal[]> =>
      Promise.resolve(
        ids
          .filter((id) => stok[id] !== undefined)
          .map((id) => ({ skuId: id, gudangId, tersedia: stok[id] ?? 0, dataPada: WAKTU })),
      ),
    modal: (ids): Promise<BarisModalLokal[]> =>
      Promise.resolve(
        satuan
          .filter((s) => ids.includes(s.skuId))
          .map((s) => ({ skuId: s.skuId, jenis: s.jenis, modalRp: s.modal, dataPada: WAKTU })),
      ),
  };
  return { repoKatalog, repoInventori };
}

function produkDari(skuId: string): string {
  return uid(5000 + Number(skuId.slice(-4)));
}

// Katalog uji: A tayang berstok (pcs + dus), B tanpa harga, C harga di bawah modal,
// D stok habis, E pagar dilanggar (Mitra Grosir > Satuan), F tayang (kategori susu).
const SATUAN: Satuan[] = [
  {
    id: uid(301),
    skuId: uid(201),
    jenis: "PCS_1",
    isi: 1,
    modal: MODAL_PENANDA,
    satuan: 1_000_000,
    mitra: 990_000,
  },
  {
    id: uid(302),
    skuId: uid(201),
    jenis: "DUS",
    isi: 10,
    modal: 9_000_000,
    satuan: 9_900_000,
    mitra: 9_800_000,
  },
  { id: uid(303), skuId: uid(202), jenis: "PCS_1", isi: 1, modal: 5_000, satuan: null },
  { id: uid(304), skuId: uid(203), jenis: "PCS_1", isi: 1, modal: 5_000, satuan: 4_000 },
  {
    id: uid(305),
    skuId: uid(204),
    jenis: "PCS_1",
    isi: 1,
    modal: 5_000,
    satuan: 6_000,
    mitra: 5_500,
  },
  {
    id: uid(306),
    skuId: uid(205),
    jenis: "PCS_1",
    isi: 1,
    modal: 5_000,
    satuan: 6_000,
    mitra: 6_500,
  },
  { id: uid(307), skuId: uid(206), jenis: "PCS_1", isi: 1, modal: 5_000, satuan: 7_000 },
];
const NAMA: Record<string, string> = {
  [uid(201)]: "Beras Uji Wangi",
  [uid(202)]: "Produk Tanpa Harga",
  [uid(203)]: "Produk Di Bawah Modal",
  [uid(204)]: "Beras Uji Habis",
  [uid(205)]: "Produk Pagar Dilanggar",
  [uid(206)]: "Susu Uji",
};
const STOK: Record<string, number> = { [uid(201)]: 15, [uid(204)]: 0, [uid(206)]: 3 };

function siapkan(
  opsi: {
    cacheMs?: number;
    ditahan?: SatuanDitahan[][];
    sumber?: "local" | "gudang";
    sekarang?: Date;
  } = {},
) {
  const { repoKatalog, repoInventori } = buatData(SATUAN, NAMA, STOK);
  const layanan = new LayananKatalog({
    repo: repoKatalog,
    snapshot: repoInventori,
    sumber: opsi.sumber ?? "local",
    ...(opsi.sekarang ? { sekarang: () => opsi.sekarang ?? WAKTU } : {}),
    konfigurasiHarga: KONFIGURASI_HARGA_BAWAAN,
    maksUmurDataMenit: 15,
    cacheMs: opsi.cacheMs ?? 0,
    laporDitahan: (d) => opsi.ditahan?.push([...d]),
  });
  return { app: buatApp({ logger: false, lokasi, katalog: layanan }), repoKatalog };
}

interface Kartu {
  id: string;
  nama: string;
  statusStok: string;
  satuan: { id: string; harga: unknown; tersedia: boolean; labelStok: string | null };
  tersedia: boolean;
  labelStok: string | null;
  promo: null;
}
interface Daftar {
  produk: Kartu[];
  total: number;
  totalHalaman: number;
  halaman: number;
  perHalaman: number;
}
interface Detail {
  id: string;
  satuanUtamaId: string;
  varian: { satuan: { id: string; kode: string; harga: unknown; tersedia: boolean }[] }[];
}

describe("API katalog (T-025)", () => {
  it("tanpa layanan katalog: 503 KATALOG_BELUM_SIAP", async () => {
    const app = buatApp({ logger: false, lokasi });
    for (const url of [
      "/api/katalog/kategori",
      "/api/katalog/produk",
      `/api/katalog/produk/${uid(5201)}`,
    ]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({ kode: "KATALOG_BELUM_SIAP", pesan: expect.any(String) as string });
    }
    await app.close();
  });

  it("kategori + subkategori dengan jumlah produk tayang (stok habis ikut, tanpa harga tidak)", async () => {
    const { app } = siapkan();
    const r = await app.inject({ method: "GET", url: "/api/katalog/kategori" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      kategori: [
        {
          kode: "sembako",
          nama: "Sembako",
          jumlahProduk: 2,
          subkategori: [{ kode: "beras", nama: "Beras", jumlahProduk: 2 }],
        },
        {
          kode: "minuman",
          nama: "Minuman",
          jumlahProduk: 1,
          subkategori: [{ kode: "susu", nama: "Susu", jumlahProduk: 1 }],
        },
      ],
    });
    // Konsisten dengan daftar per kategori.
    const d = (
      await app.inject({ method: "GET", url: "/api/katalog/produk?kategori=sembako" })
    ).json<Daftar>();
    expect(d.total).toBe(2);
    await app.close();
  });

  it("daftar: hanya produk berharga; tanpa harga / di bawah modal / pagar dilanggar tidak tayang", async () => {
    const ditahan: SatuanDitahan[][] = [];
    const { app } = siapkan({ ditahan });
    const r = await app.inject({ method: "GET", url: "/api/katalog/produk" });
    expect(r.statusCode).toBe(200);
    const d = r.json<Daftar>();
    expect(d.produk.map((p) => p.nama)).toEqual(["Beras Uji Habis", "Beras Uji Wangi", "Susu Uji"]);
    expect(d).toMatchObject({ halaman: 1, perHalaman: 20, total: 3, totalHalaman: 1 });
    // K-42: dilaporkan (tanpa nominal), sekali per perubahan.
    expect(ditahan).toHaveLength(1);
    expect(ditahan[0]?.map((x) => x.idSatuanJual).sort()).toEqual([uid(303), uid(304), uid(306)]);
    await app.inject({ method: "GET", url: "/api/katalog/produk" });
    expect(ditahan).toHaveLength(1);

    for (const id of [uid(5202), uid(5203), uid(5205)]) {
      const det = await app.inject({ method: "GET", url: `/api/katalog/produk/${id}` });
      expect(det.statusCode).toBe(404);
      expect(det.json()).toMatchObject({ kode: "PRODUK_TIDAK_ADA" });
    }
    await app.close();
  });

  it("K-20: stok habis tampil berlabel, tersedia false", async () => {
    const { app } = siapkan();
    const d = (
      await app.inject({ method: "GET", url: "/api/katalog/produk?q=habis" })
    ).json<Daftar>();
    expect(d.produk).toHaveLength(1);
    expect(d.produk[0]).toMatchObject({
      tersedia: false,
      statusStok: "HABIS",
      labelStok: LABEL_STOK_HABIS,
      satuan: { tersedia: false, statusStok: "HABIS", labelStok: LABEL_STOK_HABIS },
    });
    const det = (
      await app.inject({ method: "GET", url: `/api/katalog/produk/${uid(5204)}` })
    ).json<Detail>();
    expect(det.varian[0]?.satuan[0]?.tersedia).toBe(false);
    await app.close();
  });

  it("T-019: mode gudang, snapshot stok basi → 'tidak diketahui', BUKAN 'stok habis'", async () => {
    // 20 menit setelah data snapshot > batas usia 15 menit (P-10).
    const { app } = siapkan({
      sumber: "gudang",
      sekarang: new Date(WAKTU.getTime() + 20 * 60_000),
    });
    const d = (await app.inject({ method: "GET", url: "/api/katalog/produk" })).json<Daftar>();
    expect(d.produk.length).toBeGreaterThan(0);
    for (const p of d.produk) {
      expect(p).toMatchObject({
        tersedia: false,
        statusStok: "TIDAK_DIKETAHUI",
        labelStok: LABEL_STOK_TIDAK_DIKETAHUI,
      });
      expect(p.labelStok).not.toBe(LABEL_STOK_HABIS);
    }
    // Data segar di mode gudang: stok habis tetap "habis", yang berstok tetap tersedia.
    const segar = siapkan({ sumber: "gudang", sekarang: new Date(WAKTU.getTime() + 60_000) }).app;
    const s = (await segar.inject({ method: "GET", url: "/api/katalog/produk" })).json<Daftar>();
    expect(s.produk.find((p) => p.nama === "Beras Uji Habis")?.statusStok).toBe("HABIS");
    expect(s.produk.find((p) => p.nama === "Beras Uji Wangi")?.statusStok).toBe("TERSEDIA");
    await app.close();
    await segar.close();
  });

  it("harga kartu = harga detail untuk satuan yang sama; promo terpisah (null)", async () => {
    const { app } = siapkan();
    const d = (await app.inject({ method: "GET", url: "/api/katalog/produk" })).json<Daftar>();
    for (const kartu of d.produk) {
      const det = (
        await app.inject({ method: "GET", url: `/api/katalog/produk/${kartu.id}` })
      ).json<Detail>();
      expect(det.satuanUtamaId).toBe(kartu.satuan.id);
      const sama = det.varian.flatMap((v) => v.satuan).find((s) => s.id === kartu.satuan.id);
      expect(sama?.harga).toEqual(kartu.satuan.harga);
      expect(kartu.promo).toBeNull();
    }
    const beras = d.produk.find((p) => p.nama === "Beras Uji Wangi");
    expect(beras?.satuan.harga).toEqual({ hargaSatuan: 1_000_000, hargaBelanjaBareng: 990_000 });
    await app.close();
  });

  it("detail: semua satuan jual tayang dengan stok per satuan", async () => {
    const { app } = siapkan();
    const r = await app.inject({ method: "GET", url: `/api/katalog/produk/${uid(5201)}` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      id: uid(5201),
      nama: "Beras Uji Wangi",
      deskripsi: "Deskripsi uji",
      gambarUrl: null,
      kategori: { kode: "sembako", nama: "Sembako" },
      subkategori: { kode: "beras", nama: "Beras" },
      satuanUtamaId: uid(301),
      tersedia: true,
      statusStok: "TERSEDIA",
      labelStok: null,
      varian: [
        {
          skuId: uid(201),
          nama: null,
          satuanDasar: "pcs",
          satuan: [
            {
              id: uid(301),
              kode: "PCS_1",
              label: "1 pcs",
              isi: 1,
              harga: { hargaSatuan: 1_000_000, hargaBelanjaBareng: 990_000 },
              tersedia: true,
              statusStok: "TERSEDIA",
              labelStok: null,
            },
            {
              id: uid(302),
              kode: "DUS",
              label: "dus",
              isi: 10,
              harga: { hargaSatuan: 9_900_000, hargaBelanjaBareng: 9_800_000 },
              tersedia: true,
              statusStok: "TERSEDIA",
              labelStok: null,
            },
          ],
        },
      ],
      promo: null,
    });
    // ID huruf besar diterima (dinormalisasi).
    const besar = await app.inject({
      method: "GET",
      url: `/api/katalog/produk/${uid(5201).toUpperCase()}`,
    });
    expect(besar.statusCode).toBe(200);
    await app.close();
  });

  it("modal tidak pernah bocor ke respons publik", async () => {
    const { app } = siapkan();
    const bodi = [
      (await app.inject({ method: "GET", url: "/api/katalog/kategori" })).body,
      (await app.inject({ method: "GET", url: "/api/katalog/produk" })).body,
      (await app.inject({ method: "GET", url: `/api/katalog/produk/${uid(5201)}` })).body,
    ].join("\n");
    expect(bodi).not.toContain(String(MODAL_PENANDA));
    expect(bodi).not.toContain("9000000");
    expect(bodi).not.toMatch(/modal|margin|markup|alasan|hargaTerhitung|versi/i);
    await app.close();
  });

  it("pencarian & paginasi", async () => {
    const { app } = siapkan();
    const cari = (q: string) =>
      app.inject({ method: "GET", url: `/api/katalog/produk?q=${encodeURIComponent(q)}` });
    expect((await cari("beras")).json<Daftar>().produk.map((p) => p.nama)).toEqual([
      "Beras Uji Habis",
      "Beras Uji Wangi",
    ]);
    expect((await cari("  BERAS   wangi ")).json<Daftar>().total).toBe(1);
    expect((await cari("tanpa harga")).json<Daftar>().total).toBe(0);

    const h1 = (
      await app.inject({ method: "GET", url: "/api/katalog/produk?perHalaman=2&halaman=1" })
    ).json<Daftar>();
    const h2 = (
      await app.inject({ method: "GET", url: "/api/katalog/produk?perHalaman=2&halaman=2" })
    ).json<Daftar>();
    expect(h1).toMatchObject({ total: 3, totalHalaman: 2, perHalaman: 2 });
    expect(h1.produk).toHaveLength(2);
    expect(h2.produk.map((p) => p.nama)).toEqual(["Susu Uji"]);
    const lewat = (
      await app.inject({ method: "GET", url: "/api/katalog/produk?perHalaman=2&halaman=9" })
    ).json<Daftar>();
    expect(lewat.produk).toEqual([]);

    const sub = (
      await app.inject({ method: "GET", url: "/api/katalog/produk?subkategori=susu" })
    ).json<Daftar>();
    expect(sub.produk.map((p) => p.nama)).toEqual(["Susu Uji"]);
    // Parameter kosong = tidak diisi.
    expect(
      (await app.inject({ method: "GET", url: "/api/katalog/produk?q=&kategori=" })).json<Daftar>()
        .total,
    ).toBe(3);
    await app.close();
  });

  it("validasi input: 400 untuk query/parameter tidak valid", async () => {
    const { app } = siapkan();
    for (const url of [
      "/api/katalog/produk?q=a",
      `/api/katalog/produk?q=${"x".repeat(101)}`,
      "/api/katalog/produk?perHalaman=51",
      "/api/katalog/produk?perHalaman=0",
      "/api/katalog/produk?halaman=0",
      "/api/katalog/produk?halaman=1001",
      "/api/katalog/produk?halaman=1.5",
      "/api/katalog/produk?halaman=abc",
      "/api/katalog/produk?kategori=Sembako%20X",
      "/api/katalog/produk?subkategori=';drop",
      "/api/katalog/produk/bukan-uuid",
      "/api/katalog/kategori?zona=ZONA!",
    ]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(400);
      expect(r.json(), url).toMatchObject({ kode: "INPUT_TIDAK_VALID" });
    }
    const zona = await app.inject({ method: "GET", url: "/api/katalog/produk?zona=zona-lain" });
    expect(zona.statusCode).toBe(400);
    expect(zona.json()).toMatchObject({ kode: "ZONA_TIDAK_DIKENAL" });
    const zonaOk = await app.inject({
      method: "GET",
      url: `/api/katalog/produk?zona=${KODE_ZONA}`,
    });
    expect(zonaOk.statusCode).toBe(200);
    await app.close();
  });

  it("sumber tak terjangkau: 503 tanpa membocorkan detail error", async () => {
    const layanan = new LayananKatalog({
      repo: {
        muatData: () => Promise.reject(new Error("koneksi postgres://rahasia@db gagal")),
        idGudang: () => Promise.resolve(GUDANG),
      },
      snapshot: { stok: () => Promise.resolve([]), modal: () => Promise.resolve([]) },
      sumber: "local",
      konfigurasiHarga: KONFIGURASI_HARGA_BAWAAN,
      maksUmurDataMenit: 15,
      cacheMs: 10_000,
    });
    const app = buatApp({ logger: false, lokasi, katalog: layanan });
    const r = await app.inject({ method: "GET", url: "/api/katalog/produk" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ kode: "KATALOG_TIDAK_TERSEDIA" });
    expect(r.body).not.toContain("rahasia");
    await app.close();
  });

  it("cache snapshot: dipakai bersama daftar, kategori, detail dalam masa cache", async () => {
    const { app, repoKatalog } = siapkan({ cacheMs: 60_000 });
    await Promise.all([
      app.inject({ method: "GET", url: "/api/katalog/kategori" }),
      app.inject({ method: "GET", url: "/api/katalog/produk" }),
      app.inject({ method: "GET", url: `/api/katalog/produk/${uid(5201)}` }),
    ]);
    expect(repoKatalog.jumlahMuat).toBe(1);
    await app.close();
  });
});
