// T-004 §3.5–§3.7: katalog, SKU, satuan jual, stok, modal & harga per level.
// Pagar lintas baris SATUAN ≥ MITRA_GROSIR ≥ FRANCHISE ditegakkan domain (M9), bukan di sini.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admin } from "./akun.js";
import { dalam, idUuid, kolomAudit, rupiah, ts } from "./_umum.js";
import { gudang } from "./lokasi.js";

export const kategori = pgTable(
  "kategori",
  {
    id: idUuid(),
    // NULL = kategori, terisi = subkategori (maks. 2 tingkat: dicek trigger migrasi kustom).
    indukId: uuid("induk_id"),
    kode: text("kode").notNull(),
    nama: text("nama").notNull(),
    urutan: integer("urutan").notNull().default(0),
    aktif: boolean("aktif").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("kategori_kode_uk").on(t.kode),
    check("kategori_kode_format", sql`kode ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("kategori_bukan_induk_sendiri", sql`induk_id IS NULL OR induk_id <> id`),
    index("kategori_induk_idx").on(t.indukId),
  ],
);

export const TINJAUAN_KATEGORI = ["TIDAK_PERLU", "MENUNGGU", "DISETUJUI"] as const;

export const produk = pgTable(
  "produk",
  {
    id: idUuid(),
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
    check("produk_nama_panjang", sql`char_length(nama) BETWEEN 1 AND 200`),
    check("produk_tinjauan_kategori", dalam("tinjauan_kategori", TINJAUAN_KATEGORI)),
    index("produk_kategori_idx").on(t.kategoriId),
  ],
);

export const SATUAN_DASAR = ["pcs", "gram", "ml"] as const;

export const sku = pgTable(
  "sku",
  {
    id: idUuid(),
    produkId: uuid("produk_id")
      .notNull()
      .references(() => produk.id, { onDelete: "restrict" }),
    kodeSku: text("kode_sku").notNull(),
    barcode: text("barcode"),
    namaVarian: text("nama_varian"),
    satuanDasar: text("satuan_dasar").notNull(),
    aktifDiSumber: boolean("aktif_di_sumber").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("sku_kode_uk").on(t.kodeSku),
    index("sku_barcode_idx").on(t.barcode),
    index("sku_produk_idx").on(t.produkId),
    check("sku_satuan_dasar", dalam("satuan_dasar", SATUAN_DASAR)),
  ],
);

export const pemetaanSkuSumber = pgTable(
  "pemetaan_sku_sumber",
  {
    skuId: uuid("sku_id")
      .primaryKey()
      .references(() => sku.id, { onDelete: "restrict" }),
    skuSumberId: text("sku_sumber_id").notNull(),
    ...kolomAudit,
  },
  (t) => [uniqueIndex("pemetaan_sku_sumber_uk").on(t.skuSumberId)],
);

export const JENIS_SATUAN_JUAL = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"] as const;

export const satuanJual = pgTable(
  "satuan_jual",
  {
    id: idUuid(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id, { onDelete: "restrict" }),
    jenis: text("jenis").notNull(),
    isiSatuanDasar: integer("isi_satuan_dasar").notNull(),
    beratGram: integer("berat_gram").notNull(),
    moqMitraGrosir: integer("moq_mitra_grosir"),
    bolehGrup: boolean("boleh_grup").notNull().default(true), // menunggu P-21
    tayang: boolean("tayang").notNull().default(false), // hanya ditulis use case harga/stok
    alasanTidakTayang: text("alasan_tidak_tayang")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    versiHarga: text("versi_harga"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("satuan_jual_sku_jenis_uk").on(t.skuId, t.jenis),
    check("satuan_jual_jenis", dalam("jenis", JENIS_SATUAN_JUAL)),
    check("satuan_jual_isi_positif", sql`isi_satuan_dasar > 0`),
    check(
      "satuan_jual_isi_kanonik",
      sql`(jenis = 'PCS_1' AND isi_satuan_dasar = 1) OR (jenis = 'PCS_3' AND isi_satuan_dasar = 3) OR (jenis = 'LUSIN' AND isi_satuan_dasar = 12) OR jenis IN ('DUS', 'KOLI')`,
    ),
    check("satuan_jual_berat", sql`berat_gram >= 0`),
    check("satuan_jual_moq", sql`moq_mitra_grosir IS NULL OR moq_mitra_grosir > 0`),
    // Tayang hanya bila tidak ada alasan tidak tayang.
    check("satuan_jual_tayang_konsisten", sql`NOT tayang OR cardinality(alasan_tidak_tayang) = 0`),
    index("satuan_jual_tayang_idx")
      .on(t.tayang)
      .where(sql`tayang`),
  ],
);

export const stokLokasi = pgTable(
  "stok_lokasi",
  {
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id, { onDelete: "restrict" }),
    gudangId: uuid("gudang_id")
      .notNull()
      .references(() => gudang.id, { onDelete: "restrict" }),
    tersedia: bigint("tersedia", { mode: "number" }).notNull(),
    dataPada: ts("data_pada").notNull(),
    disinkronPada: ts("disinkron_pada").notNull(),
    ...kolomAudit,
  },
  (t) => [
    primaryKey({ columns: [t.skuId, t.gudangId] }),
    check("stok_tersedia_nonneg", sql`tersedia >= 0`),
  ],
);

export const SUMBER_MODAL = ["MANUAL", "GUDANG"] as const;

export const modalSatuanJual = pgTable(
  "modal_satuan_jual",
  {
    satuanJualId: uuid("satuan_jual_id")
      .primaryKey()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    modalRp: rupiah("modal_rp"), // NULL = kosong → tidak tayang
    sumber: text("sumber").notNull(),
    modalGudangRp: rupiah("modal_gudang_rp"),
    dataPada: ts("data_pada"),
    disinkronPada: ts("disinkron_pada"),
    ...kolomAudit,
  },
  () => [
    check("modal_positif", sql`modal_rp IS NULL OR modal_rp > 0`),
    check("modal_gudang_positif", sql`modal_gudang_rp IS NULL OR modal_gudang_rp > 0`),
    check("modal_sumber", dalam("sumber", SUMBER_MODAL)),
  ],
);

export const modalTimpaan = pgTable(
  "modal_timpaan",
  {
    id: idUuid(),
    satuanJualId: uuid("satuan_jual_id")
      .notNull()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    modalRp: rupiah("modal_rp").notNull(),
    catatan: text("catatan").notNull(),
    kedaluwarsaPada: date("kedaluwarsa_pada"), // pengingat saja (K-03)
    notifikasiDikirimPada: ts("notifikasi_dikirim_pada"),
    dibuatOleh: uuid("dibuat_oleh")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    dicabutOleh: uuid("dicabut_oleh").references(() => admin.id, { onDelete: "restrict" }),
    dicabutPada: ts("dicabut_pada"),
    ...kolomAudit,
  },
  (t) => [
    check("timpaan_modal_positif", sql`modal_rp > 0`),
    check("timpaan_catatan_wajib", sql`char_length(btrim(catatan)) > 0`),
    check("timpaan_dicabut_konsisten", sql`(dicabut_pada IS NULL) = (dicabut_oleh IS NULL)`),
    uniqueIndex("timpaan_satu_aktif_uk")
      .on(t.satuanJualId)
      .where(sql`dicabut_pada IS NULL`),
    index("timpaan_kedaluwarsa_idx")
      .on(t.kedaluwarsaPada)
      .where(sql`dicabut_pada IS NULL AND notifikasi_dikirim_pada IS NULL`),
  ],
);

export const LEVEL_HARGA = ["SATUAN", "MITRA_GROSIR", "FRANCHISE"] as const;
export const MODE_HARGA = ["PERSEN", "RUPIAH"] as const;

export const hargaLevel = pgTable(
  "harga_level",
  {
    id: idUuid(),
    satuanJualId: uuid("satuan_jual_id")
      .notNull()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    level: text("level").notNull(),
    mode: text("mode").notNull(),
    marginPersen: numeric("margin_persen", { precision: 9, scale: 4 }),
    hargaJualRp: rupiah("harga_jual_rp"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("harga_level_uk").on(t.satuanJualId, t.level),
    check("harga_level_level", dalam("level", LEVEL_HARGA)),
    check("harga_level_mode", dalam("mode", MODE_HARGA)),
    check("harga_level_margin_positif", sql`margin_persen IS NULL OR margin_persen > 0`),
    check("harga_level_harga_positif", sql`harga_jual_rp IS NULL OR harga_jual_rp > 0`),
    check(
      "harga_level_mode_konsisten",
      sql`(mode = 'PERSEN' AND harga_jual_rp IS NULL) OR (mode = 'RUPIAH' AND margin_persen IS NULL)`,
    ),
  ],
);

/** Hasil engine harga (ditulis hanya use case harga, M9). */
export const hargaTerhitung = pgTable(
  "harga_terhitung",
  {
    satuanJualId: uuid("satuan_jual_id")
      .notNull()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    level: text("level").notNull(),
    modalRp: rupiah("modal_rp").notNull(),
    hargaRp: rupiah("harga_rp").notNull(),
    versiHarga: text("versi_harga").notNull(),
    dihitungPada: ts("dihitung_pada").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.satuanJualId, t.level] }),
    check("harga_terhitung_level", dalam("level", LEVEL_HARGA)),
    // CLAUDE.md: tidak ada harga di bawah modal; P-16: margin 0 dilarang.
    check("harga_terhitung_di_atas_modal", sql`modal_rp > 0 AND harga_rp > modal_rp`),
  ],
);
