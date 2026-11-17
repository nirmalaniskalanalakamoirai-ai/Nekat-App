import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cekDalam, idUtama, kolomAudit, rupiah, waktu } from "./_umum.js";
import { admin } from "./admin.js";
import { satuanJual, sku } from "./katalog.js";
import { gudang } from "./lokasi.js";

// T-004 §3.6 Stok, §3.7 Modal & harga per level. Semua nilai bisnis KOSONG secara bawaan.
// reservasi_stok (FK ke baris_invoice) dibuat bersama tabel invoice di T-013b.

export const LEVEL_HARGA = ["SATUAN", "MITRA_GROSIR", "FRANCHISE"] as const;

export const stokLokasi = pgTable(
  "stok_lokasi",
  {
    id: idUtama(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id, { onDelete: "restrict" }),
    gudangId: uuid("gudang_id")
      .notNull()
      .references(() => gudang.id, { onDelete: "restrict" }),
    /** Satuan dasar (pcs / gram / ml). */
    tersedia: bigint("tersedia", { mode: "number" }).notNull().default(0),
    dataPada: waktu("data_pada"),
    disinkronPada: waktu("disinkron_pada"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("stok_lokasi_uk").on(t.skuId, t.gudangId),
    check("stok_lokasi_nonneg", sql`${t.tersedia} >= 0`),
  ],
);

export const modalSatuanJual = pgTable(
  "modal_satuan_jual",
  {
    satuanJualId: uuid("satuan_jual_id")
      .primaryKey()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    /** NULL = kosong → tidak tayang. */
    modalRp: rupiah("modal_rp"),
    sumber: text("sumber").notNull(),
    modalGudangRp: rupiah("modal_gudang_rp"),
    dataPada: waktu("data_pada"),
    disinkronPada: waktu("disinkron_pada"),
    ...kolomAudit,
  },
  (t) => [
    check("modal_positif", sql`${t.modalRp} IS NULL OR ${t.modalRp} > 0`),
    check("modal_gudang_positif", sql`${t.modalGudangRp} IS NULL OR ${t.modalGudangRp} > 0`),
    check("modal_sumber", cekDalam("sumber", ["MANUAL", "GUDANG"])),
  ],
);

export const modalTimpaan = pgTable(
  "modal_timpaan",
  {
    id: idUtama(),
    satuanJualId: uuid("satuan_jual_id")
      .notNull()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    modalRp: rupiah("modal_rp").notNull(),
    catatan: text("catatan").notNull(),
    kedaluwarsaPada: date("kedaluwarsa_pada", { mode: "string" }),
    notifikasiDikirimPada: waktu("notifikasi_dikirim_pada"),
    dibuatOleh: uuid("dibuat_oleh")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    dicabutOleh: uuid("dicabut_oleh").references(() => admin.id, { onDelete: "restrict" }),
    dicabutPada: waktu("dicabut_pada"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("modal_timpaan_aktif_uk")
      .on(t.satuanJualId)
      .where(sql`${t.dicabutPada} IS NULL`),
    index("modal_timpaan_kedaluwarsa_idx")
      .on(t.kedaluwarsaPada)
      .where(sql`${t.dicabutPada} IS NULL AND ${t.notifikasiDikirimPada} IS NULL`),
    check("modal_timpaan_positif", sql`${t.modalRp} > 0`),
    check("modal_timpaan_catatan", sql`char_length(trim(${t.catatan})) > 0`),
  ],
);

export const hargaLevel = pgTable(
  "harga_level",
  {
    id: idUtama(),
    satuanJualId: uuid("satuan_jual_id")
      .notNull()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    level: text("level").notNull(),
    mode: text("mode").notNull(),
    /** M2: numeric(9,4). NULL = kosong. */
    marginPersen: numeric("margin_persen", { precision: 9, scale: 4 }),
    hargaJualRp: rupiah("harga_jual_rp"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("harga_level_uk").on(t.satuanJualId, t.level),
    check("harga_level_level", cekDalam("level", LEVEL_HARGA)),
    check("harga_level_mode", cekDalam("mode", ["PERSEN", "RUPIAH"])),
    check("harga_level_margin_positif", sql`${t.marginPersen} IS NULL OR ${t.marginPersen} > 0`),
    check("harga_level_harga_positif", sql`${t.hargaJualRp} IS NULL OR ${t.hargaJualRp} > 0`),
    check(
      "harga_level_mode_konsisten",
      sql`(${t.mode} = 'PERSEN' AND ${t.hargaJualRp} IS NULL) OR (${t.mode} = 'RUPIAH' AND ${t.marginPersen} IS NULL)`,
    ),
  ],
);

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
    dihitungPada: waktu("dihitung_pada").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.satuanJualId, t.level] }),
    check("harga_terhitung_level", cekDalam("level", LEVEL_HARGA)),
    // PG-1 + P-16: harga jual wajib di atas modal (margin 0 dilarang).
    check("harga_terhitung_di_atas_modal", sql`${t.modalRp} > 0 AND ${t.hargaRp} > ${t.modalRp}`),
  ],
);
