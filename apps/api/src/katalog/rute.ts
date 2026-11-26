// Rute katalog pembeli (T-025). Publik (tanpa login), hanya baca.
//
// KEAMANAN: DTO dibentuk eksplisit dari `ProdukTampil` (domain sudah membuang modal, margin, isian
// sel, alasan admin) dan skema respons Zod membuang field lain. Error internal tidak diteruskan.
import {
  KODE_SATUAN,
  potongHalaman,
  saringProduk,
  type ProdukTampil,
  type SatuanTampil,
  type SnapshotKatalog,
} from "@nekat/domain";
import { STATUS_STOK_TAMPIL } from "@nekat/shared";
import type { FastifyBaseLogger } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  type FastifyPluginCallbackZod,
} from "fastify-type-provider-zod";
import { z } from "zod";
import type { KonfigLokasi } from "../lokasi.js";
import type { LayananKatalog } from "./layanan.js";

/** Batas paginasi. */
export const PER_HALAMAN_BAWAAN = 20;
export const PER_HALAMAN_MAKS = 50;
export const HALAMAN_MAKS = 1_000;
export const PANJANG_CARI_MIN = 2;
export const PANJANG_CARI_MAKS = 100;

const POLA_KODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const POLA_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const kode = z.string().max(64).regex(POLA_KODE);
/** Query string kosong (`?kategori=`) = tidak diisi. */
const kosongJadiUndefined = (v: unknown) => (v === "" ? undefined : v);
const opsional = <T extends z.ZodType>(s: T) => z.preprocess(kosongJadiUndefined, s.optional());

const skemaZonaQuery = { zona: opsional(kode) };

export const skemaQueryDaftar = z.object({
  ...skemaZonaQuery,
  kategori: opsional(kode),
  subkategori: opsional(kode),
  q: opsional(z.string().trim().min(PANJANG_CARI_MIN).max(PANJANG_CARI_MAKS)),
  halaman: opsional(z.coerce.number().int().min(1).max(HALAMAN_MAKS)).default(1),
  perHalaman: opsional(z.coerce.number().int().min(1).max(PER_HALAMAN_MAKS)).default(
    PER_HALAMAN_BAWAAN,
  ),
});

const skemaRingkasKategori = z.object({ kode: z.string(), nama: z.string() });

const skemaHarga = z.object({
  /** Harga Satuan (termasuk PPN). */
  hargaSatuan: z.number().int().nonnegative(),
  /** K-38: "Harga Belanja Bareng"; null = tidak berlaku untuk satuan ini. */
  hargaBelanjaBareng: z.number().int().nonnegative().nullable(),
});

const skemaSatuan = z.object({
  id: z.string(),
  kode: z.enum(KODE_SATUAN),
  label: z.string(),
  isi: z.number().int().positive(),
  harga: skemaHarga,
  /** K-20: false = tombol beli nonaktif, tidak bisa masuk keranjang/grup. */
  tersedia: z.boolean(),
  /** T-019: `HABIS` (stok 0) dibedakan dari `TIDAK_DIKETAHUI` (data stok basi / belum disinkron). */
  statusStok: z.enum(STATUS_STOK_TAMPIL),
  labelStok: z.string().nullable(),
});

const skemaKartu = z.object({
  id: z.string(),
  nama: z.string(),
  gambarUrl: z.string().nullable(),
  kategori: skemaRingkasKategori,
  subkategori: skemaRingkasKategori.nullable(),
  /** Satuan yang hargaya tampil di kartu; harga identik dengan entri yang sama di detail (PG-6). */
  satuan: skemaSatuan,
  jumlahPilihanSatuan: z.number().int().positive(),
  tersedia: z.boolean(),
  statusStok: z.enum(STATUS_STOK_TAMPIL),
  labelStok: z.string().nullable(),
  /** Promo terpisah dari harga (T-032). Belum ada aturan promo → null. */
  promo: z.null(),
});

const skemaDetail = z.object({
  id: z.string(),
  nama: z.string(),
  deskripsi: z.string().nullable(),
  gambarUrl: z.string().nullable(),
  kategori: skemaRingkasKategori,
  subkategori: skemaRingkasKategori.nullable(),
  satuanUtamaId: z.string(),
  tersedia: z.boolean(),
  statusStok: z.enum(STATUS_STOK_TAMPIL),
  labelStok: z.string().nullable(),
  varian: z.array(
    z.object({
      skuId: z.string(),
      nama: z.string().nullable(),
      satuanDasar: z.string(),
      satuan: z.array(skemaSatuan),
    }),
  ),
  promo: z.null(),
});

const skemaDaftar = z.object({
  produk: z.array(skemaKartu),
  halaman: z.number().int(),
  perHalaman: z.number().int(),
  total: z.number().int(),
  totalHalaman: z.number().int(),
});

const skemaKategori = z.object({
  kategori: z.array(
    z.object({
      kode: z.string(),
      nama: z.string(),
      jumlahProduk: z.number().int(),
      subkategori: z.array(
        z.object({ kode: z.string(), nama: z.string(), jumlahProduk: z.number().int() }),
      ),
    }),
  ),
});

const skemaGalat = z.object({ kode: z.string(), pesan: z.string() });

const GALAT = {
  BELUM_SIAP: { kode: "KATALOG_BELUM_SIAP", pesan: "Katalog belum siap. Coba lagi nanti." },
  TIDAK_TERSEDIA: {
    kode: "KATALOG_TIDAK_TERSEDIA",
    pesan: "Katalog sedang tidak bisa dimuat. Coba lagi sebentar lagi.",
  },
  ZONA_TIDAK_DIKENAL: { kode: "ZONA_TIDAK_DIKENAL", pesan: "Zona tidak dikenal." },
  PRODUK_TIDAK_ADA: { kode: "PRODUK_TIDAK_ADA", pesan: "Produk tidak ditemukan." },
  INPUT_TIDAK_VALID: {
    kode: "INPUT_TIDAK_VALID",
    pesan: "Permintaan tidak valid. Periksa kata kunci, kategori, atau halaman.",
  },
  INTERNAL: { kode: "GALAT_INTERNAL", pesan: "Terjadi kesalahan. Coba lagi." },
} as const;

function keSatuan(s: SatuanTampil) {
  return {
    id: s.id,
    kode: s.kode,
    label: s.label,
    isi: s.isi,
    harga: { hargaSatuan: s.harga.hargaSatuan, hargaBelanjaBareng: s.harga.hargaBelanjaBareng },
    tersedia: s.stok.tersedia,
    statusStok: s.stok.status,
    labelStok: s.stok.label,
  };
}

/** Kartu produk (daftar & pencarian). */
export function keKartu(p: ProdukTampil): z.infer<typeof skemaKartu> {
  return {
    id: p.id,
    nama: p.nama,
    gambarUrl: p.gambarUrl,
    kategori: p.kategori,
    subkategori: p.subkategori,
    satuan: keSatuan(p.utama),
    jumlahPilihanSatuan: p.varian.reduce((n, v) => n + v.satuan.length, 0),
    tersedia: p.stok.tersedia,
    statusStok: p.stok.status,
    labelStok: p.stok.label,
    promo: null,
  };
}

/** Halaman detail produk. */
export function keDetail(p: ProdukTampil): z.infer<typeof skemaDetail> {
  return {
    id: p.id,
    nama: p.nama,
    deskripsi: p.deskripsi,
    gambarUrl: p.gambarUrl,
    kategori: p.kategori,
    subkategori: p.subkategori,
    satuanUtamaId: p.utama.id,
    tersedia: p.stok.tersedia,
    statusStok: p.stok.status,
    labelStok: p.stok.label,
    varian: p.varian.map((v) => ({
      skuId: v.skuId,
      nama: v.nama,
      satuanDasar: v.satuanDasar,
      satuan: v.satuan.map(keSatuan),
    })),
    promo: null,
  };
}

export interface OpsiRuteKatalog {
  readonly layanan: LayananKatalog | null;
  readonly lokasi: KonfigLokasi | null;
}

type Hasil<T> =
  | { ok: true; nilai: T }
  | { ok: false; status: 400 | 503; galat: (typeof GALAT)[keyof typeof GALAT] };

export const ruteKatalog: FastifyPluginCallbackZod<OpsiRuteKatalog> = (r, opsi, selesai) => {
  const { layanan, lokasi } = opsi;

  // Input tidak valid → 400 dengan bentuk galat seragam. Galat lain → 500 tanpa detail internal.
  r.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send(GALAT.INPUT_TIDAK_VALID);
    }
    req.log.error({ err }, "katalog: galat tak terduga");
    return reply.code(500).send(GALAT.INTERNAL);
  });
  const pusat = lokasi?.gudang.find((g) => g.jenis === "PUSAT")?.kode ?? null;

  /** Zona → gudang penerima (F-20). Tanpa zona: gudang PUSAT. */
  async function ambilSnapshot(
    zona: string | undefined,
    log: FastifyBaseLogger,
  ): Promise<Hasil<SnapshotKatalog>> {
    if (!layanan || !lokasi || !pusat) return { ok: false, status: 503, galat: GALAT.BELUM_SIAP };
    let kodeGudang = pusat;
    if (zona !== undefined) {
      const z = lokasi.zona.find((x) => x.kode === zona);
      if (!z) return { ok: false, status: 400, galat: GALAT.ZONA_TIDAK_DIKENAL };
      kodeGudang = z.gudang;
    }
    try {
      const id = await layanan.idGudang(kodeGudang);
      if (id === null) {
        log.error({ kodeGudang }, "katalog: gudang dari config/lokasi.json tidak ada di DB");
        return { ok: false, status: 503, galat: GALAT.BELUM_SIAP };
      }
      return { ok: true, nilai: await layanan.snapshot(id) };
    } catch (err) {
      // H14: sumber stok/DB tak terjangkau. Detail hanya di log (tanpa data pribadi).
      log.error({ err }, "katalog: gagal memuat snapshot");
      return { ok: false, status: 503, galat: GALAT.TIDAK_TERSEDIA };
    }
  }

  r.get(
    "/api/katalog/kategori",
    {
      schema: {
        querystring: z.object(skemaZonaQuery),
        response: { 200: skemaKategori, 400: skemaGalat, 503: skemaGalat },
      },
    },
    async (req, reply) => {
      const s = await ambilSnapshot(req.query.zona, req.log);
      if (!s.ok) return reply.code(s.status).send(s.galat);
      return { kategori: s.nilai.kategori.map((k) => ({ ...k, subkategori: [...k.subkategori] })) };
    },
  );

  r.get(
    "/api/katalog/produk",
    {
      schema: {
        querystring: skemaQueryDaftar,
        response: { 200: skemaDaftar, 400: skemaGalat, 503: skemaGalat },
      },
    },
    async (req, reply) => {
      const q = req.query;
      const s = await ambilSnapshot(q.zona, req.log);
      if (!s.ok) return reply.code(s.status).send(s.galat);
      const hasil = potongHalaman(
        saringProduk(s.nilai.produk, {
          kategori: q.kategori,
          subkategori: q.subkategori,
          cari: q.q,
        }),
        q.halaman,
        q.perHalaman,
      );
      return {
        produk: hasil.isi.map(keKartu),
        halaman: hasil.halaman,
        perHalaman: hasil.perHalaman,
        total: hasil.total,
        totalHalaman: hasil.totalHalaman,
      };
    },
  );

  r.get(
    "/api/katalog/produk/:id",
    {
      schema: {
        params: z.object({ id: z.string().regex(POLA_UUID) }),
        querystring: z.object(skemaZonaQuery),
        response: { 200: skemaDetail, 400: skemaGalat, 404: skemaGalat, 503: skemaGalat },
      },
    },
    async (req, reply) => {
      const s = await ambilSnapshot(req.query.zona, req.log);
      if (!s.ok) return reply.code(s.status).send(s.galat);
      // Produk tidak tayang (tanpa harga, harga ditahan, nonaktif, terlarang) = tidak ada.
      const p = s.nilai.produkPerId.get(req.params.id.toLowerCase());
      if (!p) return reply.code(404).send(GALAT.PRODUK_TIDAK_ADA);
      return keDetail(p);
    },
  );
  selesai();
};
