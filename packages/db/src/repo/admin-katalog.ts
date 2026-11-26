// Repositori panel admin (T-036): CRUD produk / SKU / satuan jual, stok lokal, log_admin.
// Setiap perubahan + baris `log_admin` ditulis dalam SATU transaksi (perubahan tanpa log tidak
// mungkin terjadi). Baris diubah dikunci `FOR UPDATE` agar "sebelum" di log akurat.
// Harga, modal, margin, MOQ, `bebas_ppn`, `tayang` TIDAK ditulis di sini (T-037 / use case harga).
import { redaksiUntukLog } from "@nekat/domain";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../koneksi.js";
import {
  admin,
  antreanTinjauan,
  gudang,
  kategori,
  logAdmin,
  produk,
  satuanJual,
  sku,
  stokLokasi,
} from "../skema/index.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type KodeGalatRepoAdmin = "TIDAK_ADA" | "DUPLIKAT" | "DITOLAK";

/** Galat yang aman diteruskan ke rute (tanpa detail SQL). */
export class GalatRepoAdmin extends Error {
  constructor(
    readonly kode: KodeGalatRepoAdmin,
    readonly alasan: string,
  ) {
    super(`${kode}: ${alasan}`);
    this.name = "GalatRepoAdmin";
  }
}

export interface KonteksLog {
  readonly adminId: string;
  readonly izinKode: string;
  readonly ipHmac: Buffer | null;
  readonly alasan: string | null;
}

export interface KategoriAdmin {
  readonly id: string;
  readonly kode: string;
  readonly nama: string;
  readonly aktif: boolean;
  readonly indukId: string | null;
  readonly induk: { readonly kode: string; readonly nama: string; readonly aktif: boolean } | null;
}

export interface ProdukAdmin {
  readonly id: string;
  readonly kategoriId: string;
  readonly kategoriNama: string;
  readonly indukKategoriNama: string | null;
  readonly nama: string;
  readonly deskripsi: string | null;
  readonly gambarUrl: string | null;
  readonly aktif: boolean;
  readonly bebasPpn: boolean;
  readonly tinjauanKategori: string;
  readonly jumlahSku: number;
  readonly diubahPada: Date;
}

export interface SatuanAdmin {
  readonly id: string;
  readonly skuId: string;
  readonly jenis: string;
  readonly isiSatuanDasar: number;
  readonly beratGram: number;
  readonly tayang: boolean;
  readonly alasanTidakTayang: readonly string[];
}

export interface SkuAdmin {
  readonly id: string;
  readonly produkId: string;
  readonly kodeSku: string;
  readonly barcode: string | null;
  readonly namaVarian: string | null;
  readonly satuanDasar: string;
  readonly aktifDiSumber: boolean;
  readonly satuan: readonly SatuanAdmin[];
}

export interface DataProduk {
  readonly kategoriId: string;
  readonly nama: string;
  readonly deskripsi: string | null;
  readonly gambarUrl: string | null;
  readonly aktif: boolean;
}

/** Hasil cek domain untuk produk; repo hanya meneruskannya ke DB. */
export type CekProdukRepo =
  | { ok: true; tinjauanKategori: string; kataMencurigakan: readonly string[] }
  | { ok: false; alasan: string };

export interface DataSku {
  readonly kodeSku: string;
  readonly barcode: string | null;
  readonly namaVarian: string | null;
  readonly satuanDasar: string;
  readonly aktifDiSumber: boolean;
}

export interface BarisStokAdmin {
  readonly skuId: string;
  readonly kodeSku: string;
  readonly namaProduk: string;
  readonly namaVarian: string | null;
  readonly satuanDasar: string;
  readonly gudangId: string;
  /** NULL = belum ada baris stok (dianggap 0 / belum diisi). */
  readonly tersedia: number | null;
  readonly dataPada: Date | null;
}

export interface BarisLogAdmin {
  readonly id: number;
  readonly waktu: Date;
  readonly adminId: string;
  readonly adminNama: string;
  readonly izinKode: string;
  readonly entitasJenis: string;
  readonly entitasId: string | null;
  readonly sebelum: unknown;
  readonly sesudah: unknown;
  readonly alasan: string | null;
}

export interface Halaman<T> {
  readonly isi: readonly T[];
  readonly total: number;
}

export interface RepoAdminKatalog {
  daftarKategori(): Promise<KategoriAdmin[]>;
  kategoriPerId(id: string): Promise<KategoriAdmin | null>;
  daftarProduk(q: {
    cari?: string | undefined;
    halaman: number;
    perHalaman: number;
  }): Promise<Halaman<ProdukAdmin>>;
  ambilProduk(id: string): Promise<{ produk: ProdukAdmin; sku: SkuAdmin[] } | null>;
  buatProduk(
    data: DataProduk,
    cek: (kategori: KategoriAdmin | null) => CekProdukRepo,
    log: KonteksLog,
  ): Promise<string>;
  ubahProduk(
    id: string,
    ubah: Partial<DataProduk>,
    cek: (
      kategori: KategoriAdmin | null,
      sebelum: { nama: string; tinjauanKategori: string },
      namaBaru: string,
    ) => CekProdukRepo,
    log: KonteksLog,
  ): Promise<void>;
  buatSku(produkId: string, data: DataSku, log: KonteksLog): Promise<string>;
  ubahSku(id: string, ubah: Partial<DataSku>, log: KonteksLog): Promise<void>;
  buatSatuan(
    skuId: string,
    data: { jenis: string; isiSatuanDasar: number; beratGram: number },
    log: KonteksLog,
  ): Promise<string>;
  ubahSatuan(
    id: string,
    hitung: (sebelum: {
      jenis: string;
      isiSatuanDasar: number;
      beratGram: number;
    }) => { ok: true; isiSatuanDasar: number; beratGram: number } | { ok: false; alasan: string },
    log: KonteksLog,
  ): Promise<void>;
  daftarGudang(): Promise<{ id: string; kode: string; nama: string; aktif: boolean }[]>;
  daftarStok(q: {
    gudangId: string;
    cari?: string | undefined;
    halaman: number;
    perHalaman: number;
  }): Promise<Halaman<BarisStokAdmin>>;
  /** Set stok absolut (mode lokal). Baris belum ada → dibuat. */
  aturStok(skuId: string, gudangId: string, tersedia: number, log: KonteksLog): Promise<void>;
  daftarLog(q: {
    entitasJenis?: string | undefined;
    entitasId?: string | undefined;
    sebelumId?: number | undefined;
    batas: number;
  }): Promise<BarisLogAdmin[]>;
}

/** Kode SQLSTATE PostgreSQL. */
function kodePg(err: unknown): string | undefined {
  let e: unknown = err;
  // drizzle membungkus galat driver di `cause`.
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const kode = (e as { code?: unknown }).code;
    if (typeof kode === "string") return kode;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

async function terjemahGalat<T>(fn: () => Promise<T>, pesanDuplikat: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GalatRepoAdmin) throw err;
    const kode = kodePg(err);
    if (kode === "23505") throw new GalatRepoAdmin("DUPLIKAT", pesanDuplikat);
    if (kode === "23503") throw new GalatRepoAdmin("TIDAK_ADA", "Data rujukan tidak ditemukan.");
    if (kode === "23514") throw new GalatRepoAdmin("DITOLAK", "Data melanggar aturan isian.");
    throw err;
  }
}

async function tulisLog(
  tx: Tx,
  log: KonteksLog,
  entitasJenis: string,
  entitasId: string,
  sebelum: unknown,
  sesudah: unknown,
): Promise<void> {
  await tx.insert(logAdmin).values({
    adminId: log.adminId,
    izinKode: log.izinKode,
    entitasJenis,
    entitasId,
    sebelum: sebelum === null ? null : redaksiUntukLog(sebelum),
    sesudah: sesudah === null ? null : redaksiUntukLog(sesudah),
    alasan: log.alasan,
    ipHmac: log.ipHmac,
  });
}

/** Snapshot field yang dicatat di log (tanpa kolom audit). */
function snapProduk(p: {
  kategoriId: string;
  nama: string;
  deskripsi: string | null;
  gambarUrl: string | null;
  aktif: boolean;
  tinjauanKategori: string;
}) {
  return {
    kategoriId: p.kategoriId,
    nama: p.nama,
    deskripsi: p.deskripsi,
    gambarUrl: p.gambarUrl,
    aktif: p.aktif,
    tinjauanKategori: p.tinjauanKategori,
  };
}

function snapSku(s: DataSku & { produkId: string }) {
  return {
    produkId: s.produkId,
    kodeSku: s.kodeSku,
    barcode: s.barcode,
    namaVarian: s.namaVarian,
    satuanDasar: s.satuanDasar,
    aktifDiSumber: s.aktifDiSumber,
  };
}

const POTONG_CARI = (cari: string) => `%${cari.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function buatRepoAdminKatalog(db: Db): RepoAdminKatalog {
  const induk = alias(kategori, "induk");

  async function kategoriPerId(
    pembaca: Pick<Db, "select">,
    id: string,
  ): Promise<KategoriAdmin | null> {
    const [k] = await pembaca
      .select({
        id: kategori.id,
        kode: kategori.kode,
        nama: kategori.nama,
        aktif: kategori.aktif,
        indukId: kategori.indukId,
        indukKode: induk.kode,
        indukNama: induk.nama,
        indukAktif: induk.aktif,
      })
      .from(kategori)
      .leftJoin(induk, eq(induk.id, kategori.indukId))
      .where(eq(kategori.id, id));
    if (!k) return null;
    return {
      id: k.id,
      kode: k.kode,
      nama: k.nama,
      aktif: k.aktif,
      indukId: k.indukId,
      induk:
        k.indukKode !== null && k.indukNama !== null && k.indukAktif !== null
          ? { kode: k.indukKode, nama: k.indukNama, aktif: k.indukAktif }
          : null,
    };
  }

  async function antreKategori(tx: Tx, produkId: string, kata: readonly string[]): Promise<void> {
    if (kata.length === 0) return;
    await tx
      .insert(antreanTinjauan)
      .values({
        jenis: "KATEGORI",
        entitasJenis: "produk",
        entitasId: produkId,
        data: { kata: [...kata] },
      })
      .onConflictDoNothing();
  }

  const kolomProduk = {
    id: produk.id,
    kategoriId: produk.kategoriId,
    kategoriNama: kategori.nama,
    indukKategoriNama: induk.nama,
    nama: produk.nama,
    deskripsi: produk.deskripsi,
    gambarUrl: produk.gambarUrl,
    aktif: produk.aktif,
    bebasPpn: produk.bebasPpn,
    tinjauanKategori: produk.tinjauanKategori,
    jumlahSku: sql<number>`(SELECT count(*)::int FROM ${sku} WHERE ${sku.produkId} = ${produk.id})`,
    diubahPada: produk.diubahPada,
  };

  return {
    async daftarKategori() {
      const semua = await db
        .select({
          id: kategori.id,
          kode: kategori.kode,
          nama: kategori.nama,
          aktif: kategori.aktif,
          indukId: kategori.indukId,
          urutan: kategori.urutan,
        })
        .from(kategori)
        .orderBy(asc(kategori.urutan), asc(kategori.kode));
      const perId = new Map(semua.map((k) => [k.id, k]));
      return semua.map((k) => {
        const i = k.indukId ? perId.get(k.indukId) : undefined;
        return {
          id: k.id,
          kode: k.kode,
          nama: k.nama,
          aktif: k.aktif,
          indukId: k.indukId,
          induk: i ? { kode: i.kode, nama: i.nama, aktif: i.aktif } : null,
        };
      });
    },

    kategoriPerId: (id) => kategoriPerId(db, id),

    async daftarProduk(q) {
      const syarat: SQL | undefined = q.cari
        ? or(
            ilike(produk.nama, POTONG_CARI(q.cari)),
            sql`EXISTS (SELECT 1 FROM ${sku} WHERE ${sku.produkId} = ${produk.id} AND (${sku.kodeSku} ILIKE ${POTONG_CARI(q.cari)} OR ${sku.barcode} = ${q.cari}))`,
          )
        : undefined;
      const [jumlah] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(produk)
        .where(syarat);
      const isi = await db
        .select(kolomProduk)
        .from(produk)
        .innerJoin(kategori, eq(kategori.id, produk.kategoriId))
        .leftJoin(induk, eq(induk.id, kategori.indukId))
        .where(syarat)
        .orderBy(desc(produk.diubahPada), asc(produk.id))
        .limit(q.perHalaman)
        .offset((q.halaman - 1) * q.perHalaman);
      return { isi, total: jumlah?.n ?? 0 };
    },

    async ambilProduk(id) {
      const [p] = await db
        .select(kolomProduk)
        .from(produk)
        .innerJoin(kategori, eq(kategori.id, produk.kategoriId))
        .leftJoin(induk, eq(induk.id, kategori.indukId))
        .where(eq(produk.id, id));
      if (!p) return null;
      const daftarSku = await db
        .select({
          id: sku.id,
          produkId: sku.produkId,
          kodeSku: sku.kodeSku,
          barcode: sku.barcode,
          namaVarian: sku.namaVarian,
          satuanDasar: sku.satuanDasar,
          aktifDiSumber: sku.aktifDiSumber,
        })
        .from(sku)
        .where(eq(sku.produkId, id))
        .orderBy(asc(sku.kodeSku));
      const satuan =
        daftarSku.length === 0
          ? []
          : await db
              .select({
                id: satuanJual.id,
                skuId: satuanJual.skuId,
                jenis: satuanJual.jenis,
                isiSatuanDasar: satuanJual.isiSatuanDasar,
                beratGram: satuanJual.beratGram,
                tayang: satuanJual.tayang,
                alasanTidakTayang: satuanJual.alasanTidakTayang,
              })
              .from(satuanJual)
              .where(
                inArray(
                  satuanJual.skuId,
                  daftarSku.map((s) => s.id),
                ),
              )
              .orderBy(asc(satuanJual.isiSatuanDasar), asc(satuanJual.jenis));
      return {
        produk: p,
        sku: daftarSku.map((s) => ({ ...s, satuan: satuan.filter((x) => x.skuId === s.id) })),
      };
    },

    async buatProduk(data, cek, log) {
      return terjemahGalat(
        () =>
          db.transaction(async (tx) => {
            const k = await kategoriPerId(tx, data.kategoriId);
            const hasil = cek(k);
            if (!hasil.ok) throw new GalatRepoAdmin("DITOLAK", hasil.alasan);
            const [baru] = await tx
              .insert(produk)
              .values({ ...data, tinjauanKategori: hasil.tinjauanKategori })
              .returning({ id: produk.id });
            if (!baru) throw new Error("insert produk tanpa id");
            await antreKategori(tx, baru.id, hasil.kataMencurigakan);
            await tulisLog(
              tx,
              log,
              "produk",
              baru.id,
              null,
              snapProduk({ ...data, tinjauanKategori: hasil.tinjauanKategori }),
            );
            return baru.id;
          }),
        "Produk sudah ada.",
      );
    },

    async ubahProduk(id, ubah, cek, log) {
      await terjemahGalat(
        () =>
          db.transaction(async (tx) => {
            const [lama] = await tx
              .select({
                kategoriId: produk.kategoriId,
                nama: produk.nama,
                deskripsi: produk.deskripsi,
                gambarUrl: produk.gambarUrl,
                aktif: produk.aktif,
                tinjauanKategori: produk.tinjauanKategori,
              })
              .from(produk)
              .where(eq(produk.id, id))
              .for("update");
            if (!lama) throw new GalatRepoAdmin("TIDAK_ADA", "Produk tidak ditemukan.");
            const baru = { ...lama, ...ubah };
            const hasil = cek(await kategoriPerId(tx, baru.kategoriId), lama, baru.nama);
            if (!hasil.ok) throw new GalatRepoAdmin("DITOLAK", hasil.alasan);
            const sesudah = { ...baru, tinjauanKategori: hasil.tinjauanKategori };
            await tx
              .update(produk)
              .set({ ...sesudah, diubahPada: sql`now()` })
              .where(eq(produk.id, id));
            await antreKategori(tx, id, hasil.kataMencurigakan);
            await tulisLog(tx, log, "produk", id, snapProduk(lama), snapProduk(sesudah));
          }),
        "Produk sudah ada.",
      );
    },

    async buatSku(produkId, data, log) {
      return terjemahGalat(
        () =>
          db.transaction(async (tx) => {
            const [p] = await tx
              .select({ id: produk.id })
              .from(produk)
              .where(eq(produk.id, produkId))
              .for("update");
            if (!p) throw new GalatRepoAdmin("TIDAK_ADA", "Produk tidak ditemukan.");
            const [baru] = await tx
              .insert(sku)
              .values({ produkId, ...data })
              .returning({ id: sku.id });
            if (!baru) throw new Error("insert sku tanpa id");
            await tulisLog(tx, log, "sku", baru.id, null, snapSku({ produkId, ...data }));
            return baru.id;
          }),
        "Kode SKU sudah dipakai.",
      );
    },

    async ubahSku(id, ubah, log) {
      await terjemahGalat(
        () =>
          db.transaction(async (tx) => {
            const [lama] = await tx
              .select({
                produkId: sku.produkId,
                kodeSku: sku.kodeSku,
                barcode: sku.barcode,
                namaVarian: sku.namaVarian,
                satuanDasar: sku.satuanDasar,
                aktifDiSumber: sku.aktifDiSumber,
              })
              .from(sku)
              .where(eq(sku.id, id))
              .for("update");
            if (!lama) throw new GalatRepoAdmin("TIDAK_ADA", "SKU tidak ditemukan.");
            const baru = { ...lama, ...ubah };
            await tx
              .update(sku)
              .set({ ...ubah, diubahPada: sql`now()` })
              .where(eq(sku.id, id));
            await tulisLog(tx, log, "sku", id, snapSku(lama), snapSku(baru));
          }),
        "Kode SKU sudah dipakai.",
      );
    },

    async buatSatuan(skuId, data, log) {
      return terjemahGalat(
        () =>
          db.transaction(async (tx) => {
            const [s] = await tx
              .select({ id: sku.id })
              .from(sku)
              .where(eq(sku.id, skuId))
              .for("update");
            if (!s) throw new GalatRepoAdmin("TIDAK_ADA", "SKU tidak ditemukan.");
            // `tayang` tetap bawaan false: hanya use case harga/stok yang menulisnya.
            const [baru] = await tx
              .insert(satuanJual)
              .values({ skuId, ...data })
              .returning({ id: satuanJual.id });
            if (!baru) throw new Error("insert satuan tanpa id");
            await tulisLog(tx, log, "satuan_jual", baru.id, null, { skuId, ...data });
            return baru.id;
          }),
        "Satuan jual jenis ini sudah ada untuk SKU tersebut.",
      );
    },

    async ubahSatuan(id, hitung, log) {
      await terjemahGalat(
        () =>
          db.transaction(async (tx) => {
            const [lama] = await tx
              .select({
                skuId: satuanJual.skuId,
                jenis: satuanJual.jenis,
                isiSatuanDasar: satuanJual.isiSatuanDasar,
                beratGram: satuanJual.beratGram,
              })
              .from(satuanJual)
              .where(eq(satuanJual.id, id))
              .for("update");
            if (!lama) throw new GalatRepoAdmin("TIDAK_ADA", "Satuan jual tidak ditemukan.");
            const h = hitung(lama);
            if (!h.ok) throw new GalatRepoAdmin("DITOLAK", h.alasan);
            await tx
              .update(satuanJual)
              .set({
                isiSatuanDasar: h.isiSatuanDasar,
                beratGram: h.beratGram,
                diubahPada: sql`now()`,
              })
              .where(eq(satuanJual.id, id));
            await tulisLog(tx, log, "satuan_jual", id, lama, {
              ...lama,
              isiSatuanDasar: h.isiSatuanDasar,
              beratGram: h.beratGram,
            });
          }),
        "Satuan jual duplikat.",
      );
    },

    async daftarGudang() {
      return db
        .select({ id: gudang.id, kode: gudang.kodeKonfig, nama: gudang.nama, aktif: gudang.aktif })
        .from(gudang)
        .orderBy(asc(gudang.jenis), asc(gudang.kodeKonfig));
    },

    async daftarStok(q) {
      const syarat: SQL | undefined = q.cari
        ? or(
            ilike(produk.nama, POTONG_CARI(q.cari)),
            ilike(sku.kodeSku, POTONG_CARI(q.cari)),
            eq(sku.barcode, q.cari),
          )
        : undefined;
      const [jumlah] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(sku)
        .innerJoin(produk, eq(produk.id, sku.produkId))
        .where(syarat);
      const isi = await db
        .select({
          skuId: sku.id,
          kodeSku: sku.kodeSku,
          namaProduk: produk.nama,
          namaVarian: sku.namaVarian,
          satuanDasar: sku.satuanDasar,
          tersedia: stokLokasi.tersedia,
          dataPada: stokLokasi.dataPada,
        })
        .from(sku)
        .innerJoin(produk, eq(produk.id, sku.produkId))
        .leftJoin(
          stokLokasi,
          and(eq(stokLokasi.skuId, sku.id), eq(stokLokasi.gudangId, q.gudangId)),
        )
        .where(syarat)
        .orderBy(asc(produk.nama), asc(sku.kodeSku))
        .limit(q.perHalaman)
        .offset((q.halaman - 1) * q.perHalaman);
      return { isi: isi.map((b) => ({ ...b, gudangId: q.gudangId })), total: jumlah?.n ?? 0 };
    },

    async aturStok(skuId, gudangId, tersedia, log) {
      await terjemahGalat(
        () =>
          db.transaction(async (tx) => {
            const [s] = await tx.select({ id: sku.id }).from(sku).where(eq(sku.id, skuId));
            const [g] = await tx
              .select({ id: gudang.id })
              .from(gudang)
              .where(eq(gudang.id, gudangId));
            if (!s || !g) throw new GalatRepoAdmin("TIDAK_ADA", "SKU atau gudang tidak ditemukan.");
            const [lama] = await tx
              .select({ tersedia: stokLokasi.tersedia })
              .from(stokLokasi)
              .where(and(eq(stokLokasi.skuId, skuId), eq(stokLokasi.gudangId, gudangId)))
              .for("update");
            await tx
              .insert(stokLokasi)
              .values({
                skuId,
                gudangId,
                tersedia,
                dataPada: sql`now()`,
                disinkronPada: sql`now()`,
              })
              .onConflictDoUpdate({
                target: [stokLokasi.skuId, stokLokasi.gudangId],
                set: {
                  tersedia,
                  dataPada: sql`now()`,
                  disinkronPada: sql`now()`,
                  diubahPada: sql`now()`,
                },
              });
            await tulisLog(
              tx,
              log,
              "stok_lokasi",
              `${skuId}:${gudangId}`,
              lama ? { skuId, gudangId, tersedia: lama.tersedia } : null,
              { skuId, gudangId, tersedia },
            );
          }),
        "Stok duplikat.",
      );
    },

    async daftarLog(q) {
      const syarat = and(
        q.entitasJenis ? eq(logAdmin.entitasJenis, q.entitasJenis) : undefined,
        q.entitasId ? eq(logAdmin.entitasId, q.entitasId) : undefined,
        q.sebelumId !== undefined ? lt(logAdmin.id, q.sebelumId) : undefined,
      );
      return db
        .select({
          id: logAdmin.id,
          waktu: logAdmin.waktu,
          adminId: logAdmin.adminId,
          adminNama: admin.nama,
          izinKode: logAdmin.izinKode,
          entitasJenis: logAdmin.entitasJenis,
          entitasId: logAdmin.entitasId,
          sebelum: logAdmin.sebelum,
          sesudah: logAdmin.sesudah,
          alasan: logAdmin.alasan,
        })
        .from(logAdmin)
        .innerJoin(admin, eq(admin.id, logAdmin.adminId))
        .where(syarat)
        .orderBy(desc(logAdmin.id))
        .limit(q.batas);
    },
  };
}
