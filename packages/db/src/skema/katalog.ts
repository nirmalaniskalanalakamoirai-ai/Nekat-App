import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { cekDalam, idUtama, kolomAudit } from "./_umum.js";

// T-004 §3.5 Katalog. Tidak ada kategori rokok/bir di Fase 1 (keputusan §7).

export const JENIS_SATUAN_JUAL = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"] as const;

export const kategori = pgTable(
  "kategori",
  {
    id: idUtama(),
    /** NULL = kategori, terisi = subkategori (maks. 2 tingkat, dicek domain). */
    indukId: uuid("induk_id").references((): AnyPgColumn => kategori.id, { onDelete: "restrict" }),
    kode: text("kode").notNull().unique(),
    nama: text("nama").notNull(),
    urutan: integer("urutan").notNull().default(0),
    aktif: boolean("aktif").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    index("kategori_induk_idx").on(t.indukId),
    check("kategori_bukan_induk_sendiri", sql`${t.indukId} IS NULL OR ${t.indukId} <> ${t.id}`),
    check("kategori_kode_format", sql`${t.kode} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const produk = pgTable(
  "produk",
  {
    id: idUtama(),
    /** FK ke subkategori. */
    kategoriId: uuid("kategori_id")
      .notNull()
      .references(() => kategori.id, { onDelete: "restrict" }),
    nama: text("nama").notNull(),
    deskripsi: text("deskripsi"),
    gambarUrl: text("gambar_url"),
    bebasPpn: boolean("bebas_ppn").notNull().default(false),
    tinjauanKategori: text("tinjauan_kategori").notNull().default("TIDAK_PERLU"),
    aktif: boolean("aktif").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    index("produk_kategori_idx").on(t.kategoriId),
    check("produk_nama_panjang", sql`char_length(${t.nama}) BETWEEN 1 AND 200`),
    check(
      "produk_tinjauan_kategori",
      cekDalam("tinjauan_kategori", ["TIDAK_PERLU", "MENUNGGU", "DISETUJUI"]),
    ),
  ],
);

export const sku = pgTable(
  "sku",
  {
    id: idUtama(),
    produkId: uuid("produk_id")
      .notNull()
      .references(() => produk.id, { onDelete: "restrict" }),
    kodeSku: text("kode_sku").notNull().unique(),
    barcode: text("barcode"),
    namaVarian: text("nama_varian"),
    satuanDasar: text("satuan_dasar").notNull(),
    aktifDiSumber: boolean("aktif_di_sumber").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    index("sku_produk_idx").on(t.produkId),
    index("sku_barcode_idx").on(t.barcode),
    check("sku_satuan_dasar", cekDalam("satuan_dasar", ["pcs", "gram", "ml"])),
  ],
);

export const pemetaanSkuSumber = pgTable("pemetaan_sku_sumber", {
  skuId: uuid("sku_id")
    .primaryKey()
    .references(() => sku.id, { onDelete: "restrict" }),
  skuSumberId: text("sku_sumber_id").notNull().unique(),
  dibuatPada: kolomAudit.dibuatPada,
});

export const satuanJual = pgTable(
  "satuan_jual",
  {
    id: idUtama(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id, { onDelete: "restrict" }),
    jenis: text("jenis").notNull(),
    isiSatuanDasar: integer("isi_satuan_dasar").notNull(),
    beratGram: integer("berat_gram").notNull(),
    /** NULL = belum diatur (F-04, P-05). */
    moqMitraGrosir: integer("moq_mitra_grosir"),
    /** Menunggu P-21. */
    bolehGrup: boolean("boleh_grup").notNull().default(true),
    /** Hanya ditulis use case harga/stok. */
    tayang: boolean("tayang").notNull().default(false),
    alasanTidakTayang: text("alasan_tidak_tayang")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    versiHarga: text("versi_harga"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("satuan_jual_sku_jenis_uk").on(t.skuId, t.jenis),
    index("satuan_jual_tayang_idx")
      .on(t.tayang)
      .where(sql`${t.tayang}`),
    check("satuan_jual_jenis", cekDalam("jenis", JENIS_SATUAN_JUAL)),
    check("satuan_jual_isi_positif", sql`${t.isiSatuanDasar} > 0`),
    check(
      "satuan_jual_isi_sesuai_jenis",
      sql`(${t.jenis} = 'PCS_1' AND ${t.isiSatuanDasar} = 1) OR (${t.jenis} = 'PCS_3' AND ${t.isiSatuanDasar} = 3) OR (${t.jenis} = 'LUSIN' AND ${t.isiSatuanDasar} = 12) OR ${t.jenis} IN ('DUS', 'KOLI')`,
    ),
    check("satuan_jual_berat", sql`${t.beratGram} >= 0`),
    check("satuan_jual_moq", sql`${t.moqMitraGrosir} IS NULL OR ${t.moqMitraGrosir} > 0`),
    check(
      "satuan_jual_tayang_tanpa_alasan",
      sql`NOT ${t.tayang} OR cardinality(${t.alasanTidakTayang}) = 0`,
    ),
  ],
);
