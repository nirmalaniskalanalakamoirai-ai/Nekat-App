// T-004 §3.12 armada/tarif/ongkir, §3.13 diskon & gratis ongkir, §3.14 COD.
// SEMUA angka bisnis (tarif, kapasitas, nilai diskon, ambang KPI) kosong bawaan; diisi admin/adapter.
// K-25: ongkir masuk tagihan barang; host bayar → satu ongkir, bayar sendiri → dibagi rata (domain).
// K-21: satu diskon atas total belanja (tidak menumpuk, P-15) → `UK` satu diskon per invoice.
// K-31: COD hanya pesanan retail/individu, tidak di grup.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admin, akun } from "./akun.js";
import { dalam, idUuid, kolomAudit, kolomDibuat, rupiah, ts } from "./_umum.js";
import { grup, pesertaGrup } from "./grup.js";
import { invoice } from "./invoice.js";
import { LEVEL_HARGA } from "./katalog.js";
import { zona } from "./lokasi.js";

// ---- §3.12 Armada, tarif, ongkir ----

export const armada = pgTable(
  "armada",
  {
    kode: text("kode").primaryKey(), // MOTOR, TOSSA, PICKUP (seed tanpa angka)
    nama: text("nama").notNull(),
    kapasitasGram: bigint("kapasitas_gram", { mode: "number" }), // NULL = belum diisi admin
    aktif: boolean("aktif").notNull().default(false),
    ...kolomAudit,
  },
  () => [
    check("armada_kode_format", sql`kode ~ '^[A-Z][A-Z0-9_]*$'`),
    check("armada_kapasitas_positif", sql`kapasitas_gram IS NULL OR kapasitas_gram > 0`),
    // Armada tanpa kapasitas tidak bisa dipilih "terkecil yang cukup" (keputusan §4).
    check("armada_aktif_butuh_kapasitas", sql`NOT aktif OR kapasitas_gram IS NOT NULL`),
  ],
);

/** Versi tarif. NULL semua = antar rumah tidak tersedia (ADR §5.3). Angka dari adapter eksternal (#4, K-05). */
export const tarifArmada = pgTable(
  "tarif_armada",
  {
    id: idUuid(),
    armadaKode: text("armada_kode")
      .notNull()
      .references(() => armada.kode, { onDelete: "restrict" }),
    tarifDasarRp: rupiah("tarif_dasar_rp"),
    tarifPerKgRp: rupiah("tarif_per_kg_rp"),
    tarifPerKmRp: rupiah("tarif_per_km_rp"),
    sumberAdapter: text("sumber_adapter").notNull(),
    refEksternal: text("ref_eksternal"),
    berlakuMulai: ts("berlaku_mulai").notNull(),
    diambilPada: ts("diambil_pada"),
    ...kolomDibuat,
  },
  (t) => [
    check(
      "tarif_nonneg",
      sql`(tarif_dasar_rp IS NULL OR tarif_dasar_rp >= 0) AND (tarif_per_kg_rp IS NULL OR tarif_per_kg_rp >= 0) AND (tarif_per_km_rp IS NULL OR tarif_per_km_rp >= 0)`,
    ),
    index("tarif_armada_berlaku_idx").on(t.armadaKode, t.berlakuMulai.desc()),
  ],
);

/**
 * Ongkir jadi dari adapter (pembulatan ikut adapter, P-12). `peserta_id` NULL = kuotasi untuk seluruh grup
 * (K-25: host bayar → satu ongkir; bayar sendiri → dibagi rata, pembagian di domain).
 */
export const kuotasiOngkir = pgTable(
  "kuotasi_ongkir",
  {
    id: idUuid(),
    grupId: uuid("grup_id")
      .notNull()
      .references(() => grup.id, { onDelete: "restrict" }),
    pesertaId: uuid("peserta_id").references(() => pesertaGrup.id, { onDelete: "restrict" }),
    armadaKode: text("armada_kode")
      .notNull()
      .references(() => armada.kode, { onDelete: "restrict" }),
    beratGram: integer("berat_gram").notNull(),
    jarakMeter: integer("jarak_meter").notNull(),
    ongkirRp: rupiah("ongkir_rp").notNull(),
    sumberAdapter: text("sumber_adapter").notNull(),
    refEksternal: text("ref_eksternal"),
    berlakuSampai: ts("berlaku_sampai").notNull(),
    dipakaiDiInvoiceId: uuid("dipakai_di_invoice_id").references(() => invoice.id, {
      onDelete: "restrict",
    }),
    ...kolomDibuat,
  },
  (t) => [
    check("kuotasi_nonneg", sql`berat_gram >= 0 AND jarak_meter >= 0 AND ongkir_rp >= 0`),
    index("kuotasi_grup_idx").on(t.grupId),
    index("kuotasi_peserta_idx").on(t.pesertaId),
  ],
);

// ---- §3.13 Diskon & gratis ongkir ----

export const JENIS_DISKON = ["PERSEN", "NOMINAL"] as const;
export const CAKUPAN_DISKON = ["SEMUA", "PRODUK", "KATEGORI", "LEVEL", "ZONA"] as const;
// K-21 diputuskan: satu diskon atas total belanja, dibagi ke barang hanya untuk cek modal.
export const CARA_HITUNG_DISKON = ["TOTAL_PROPORSIONAL"] as const;

const kuotaCek = (prefiks: string) =>
  [
    check(
      `${prefiks}_kuota`,
      sql`terpakai >= 0 AND (kuota IS NULL OR (kuota > 0 AND terpakai <= kuota))`,
    ),
    check(`${prefiks}_maks_per_akun`, sql`maks_per_akun IS NULL OR maks_per_akun > 0`),
    check(`${prefiks}_periode`, sql`berlaku_sampai > berlaku_mulai`),
    check(`${prefiks}_level`, sql`level IS NULL OR ${dalam("level", LEVEL_HARGA)}`),
  ] as const;

export const aturanDiskon = pgTable(
  "aturan_diskon",
  {
    id: idUuid(),
    nama: text("nama").notNull(),
    jenis: text("jenis").notNull(),
    nilaiPersen: numeric("nilai_persen", { precision: 9, scale: 4 }), // kosong bawaan
    nilaiRp: rupiah("nilai_rp"), // kosong bawaan
    cakupanJenis: text("cakupan_jenis").notNull().default("SEMUA"),
    cakupanIds: uuid("cakupan_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    level: text("level"), // NULL = semua level
    caraHitung: text("cara_hitung").notNull().default("TOTAL_PROPORSIONAL"),
    berlakuMulai: ts("berlaku_mulai").notNull(),
    berlakuSampai: ts("berlaku_sampai").notNull(),
    kuota: integer("kuota"),
    terpakai: integer("terpakai").notNull().default(0),
    maksPerAkun: integer("maks_per_akun"), // cegah penimbunan (CWE-770)
    aktif: boolean("aktif").notNull().default(false),
    ...kolomAudit,
  },
  () => [
    check("diskon_jenis", dalam("jenis", JENIS_DISKON)),
    check(
      "diskon_nilai_sesuai_jenis",
      sql`(jenis = 'PERSEN' AND nilai_rp IS NULL AND (nilai_persen IS NULL OR (nilai_persen > 0 AND nilai_persen < 100)))
        OR (jenis = 'NOMINAL' AND nilai_persen IS NULL AND (nilai_rp IS NULL OR nilai_rp > 0))`,
    ),
    check("diskon_aktif_butuh_nilai", sql`NOT aktif OR num_nonnulls(nilai_persen, nilai_rp) = 1`),
    check("diskon_cakupan", dalam("cakupan_jenis", CAKUPAN_DISKON)),
    check(
      "diskon_cakupan_lengkap",
      sql`(cakupan_jenis = 'SEMUA' AND cardinality(cakupan_ids) = 0)
        OR (cakupan_jenis = 'LEVEL' AND level IS NOT NULL AND cardinality(cakupan_ids) = 0)
        OR (cakupan_jenis IN ('PRODUK', 'KATEGORI', 'ZONA') AND cardinality(cakupan_ids) > 0)`,
    ),
    check("diskon_cara_hitung", dalam("cara_hitung", CARA_HITUNG_DISKON)),
    ...kuotaCek("diskon"),
  ],
);

export const SUBSIDI_ONGKIR = ["PENUH", "MAKS"] as const;

export const aturanGratisOngkir = pgTable(
  "aturan_gratis_ongkir",
  {
    id: idUuid(),
    nama: text("nama").notNull(),
    minimalBelanjaRp: rupiah("minimal_belanja_rp"), // sesudah diskon (P-13); kosong bawaan
    zonaId: uuid("zona_id").references(() => zona.id, { onDelete: "restrict" }), // NULL = semua zona
    level: text("level"),
    berlakuMulai: ts("berlaku_mulai").notNull(),
    berlakuSampai: ts("berlaku_sampai").notNull(),
    subsidiJenis: text("subsidi_jenis").notNull().default("PENUH"),
    subsidiMaksRp: rupiah("subsidi_maks_rp"),
    kuota: integer("kuota"),
    terpakai: integer("terpakai").notNull().default(0),
    maksPerAkun: integer("maks_per_akun"),
    aktif: boolean("aktif").notNull().default(false),
    ...kolomAudit,
  },
  () => [
    check("gratis_ongkir_minimal", sql`minimal_belanja_rp IS NULL OR minimal_belanja_rp > 0`),
    check("gratis_ongkir_subsidi_jenis", dalam("subsidi_jenis", SUBSIDI_ONGKIR)),
    check(
      "gratis_ongkir_subsidi_konsisten",
      sql`(subsidi_jenis = 'PENUH' AND subsidi_maks_rp IS NULL) OR (subsidi_jenis = 'MAKS' AND (subsidi_maks_rp IS NULL OR subsidi_maks_rp > 0))`,
    ),
    check(
      "gratis_ongkir_aktif_lengkap",
      sql`NOT aktif OR subsidi_jenis = 'PENUH' OR subsidi_maks_rp IS NOT NULL`,
    ),
    ...kuotaCek("gratis_ongkir"),
  ],
);

export const STATUS_PEMAKAIAN_PROMO = [
  "DIRESERVASI",
  "TERPAKAI",
  "DILEPAS",
  "TIDAK_MEMENUHI",
] as const;

export const pemakaianPromo = pgTable(
  "pemakaian_promo",
  {
    id: idUuid(),
    aturanDiskonId: uuid("aturan_diskon_id").references(() => aturanDiskon.id, {
      onDelete: "restrict",
    }),
    aturanGratisOngkirId: uuid("aturan_gratis_ongkir_id"),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "restrict" }),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("DIRESERVASI"),
    alasanTidakMemenuhi: text("alasan_tidak_memenuhi"), // P-27
    ...kolomAudit,
  },
  (t) => [
    foreignKey({
      name: "pemakaian_promo_gratis_ongkir_fk",
      columns: [t.aturanGratisOngkirId],
      foreignColumns: [aturanGratisOngkir.id],
    }).onDelete("restrict"),
    check(
      "promo_tepat_satu_aturan",
      sql`num_nonnulls(aturan_diskon_id, aturan_gratis_ongkir_id) = 1`,
    ),
    check("promo_status", dalam("status", STATUS_PEMAKAIAN_PROMO)),
    check(
      "promo_tidak_memenuhi_beralasan",
      sql`status <> 'TIDAK_MEMENUHI' OR (alasan_tidak_memenuhi IS NOT NULL AND char_length(btrim(alasan_tidak_memenuhi)) > 0)`,
    ),
    uniqueIndex("promo_diskon_invoice_uk")
      .on(t.aturanDiskonId, t.invoiceId)
      .where(sql`aturan_diskon_id IS NOT NULL`),
    uniqueIndex("promo_gratis_ongkir_invoice_uk")
      .on(t.aturanGratisOngkirId, t.invoiceId)
      .where(sql`aturan_gratis_ongkir_id IS NOT NULL`),
    // P-15: diskon tidak menumpuk → paling banyak satu diskon & satu gratis ongkir hidup per invoice.
    uniqueIndex("promo_satu_diskon_per_invoice_uk")
      .on(t.invoiceId)
      .where(sql`aturan_diskon_id IS NOT NULL AND status IN ('DIRESERVASI', 'TERPAKAI')`),
    uniqueIndex("promo_satu_gratis_ongkir_per_invoice_uk")
      .on(t.invoiceId)
      .where(sql`aturan_gratis_ongkir_id IS NOT NULL AND status IN ('DIRESERVASI', 'TERPAKAI')`),
    index("promo_diskon_akun_idx")
      .on(t.aturanDiskonId, t.akunId)
      .where(sql`status IN ('DIRESERVASI', 'TERPAKAI')`),
    index("promo_gratis_ongkir_akun_idx")
      .on(t.aturanGratisOngkirId, t.akunId)
      .where(sql`status IN ('DIRESERVASI', 'TERPAKAI')`),
  ],
);

// ---- §3.14 COD: KPI mingguan (keputusan §2) ----

/** Versi ambang KPI. Nilai (keputusan §2/§14 #2) diisi admin, tidak di seed. */
export const ambangKpiCod = pgTable(
  "ambang_kpi_cod",
  {
    id: idUuid(),
    minPesananSelesai: integer("min_pesanan_selesai"),
    minSuksesPersen: numeric("min_sukses_persen", { precision: 5, scale: 2 }),
    maksPenolakan: integer("maks_penolakan"),
    maksBatalSetelahKirim: integer("maks_batal_setelah_kirim"),
    berlakuMulai: ts("berlaku_mulai").notNull(),
    dibuatOleh: uuid("dibuat_oleh")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    ...kolomDibuat,
  },
  () => [
    check(
      "ambang_cod_nonneg",
      sql`(min_pesanan_selesai IS NULL OR min_pesanan_selesai >= 0) AND (maks_penolakan IS NULL OR maks_penolakan >= 0) AND (maks_batal_setelah_kirim IS NULL OR maks_batal_setelah_kirim >= 0)`,
    ),
    check(
      "ambang_cod_persen",
      sql`min_sukses_persen IS NULL OR min_sukses_persen BETWEEN 0 AND 100`,
    ),
  ],
);

/** Job idempoten per (akun, minggu). */
export const kpiCodMingguan = pgTable(
  "kpi_cod_mingguan",
  {
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    mingguMulai: date("minggu_mulai").notNull(), // WIB
    pesananSelesai: integer("pesanan_selesai").notNull(),
    pesananTotal: integer("pesanan_total").notNull(),
    penolakan: integer("penolakan").notNull(),
    batalSetelahKirim: integer("batal_setelah_kirim").notNull(),
    suksesPersen: numeric("sukses_persen", { precision: 5, scale: 2 }),
    lolos: boolean("lolos").notNull(),
    ambangId: uuid("ambang_id")
      .notNull()
      .references(() => ambangKpiCod.id, { onDelete: "restrict" }),
    dihitungPada: ts("dihitung_pada").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.akunId, t.mingguMulai] }),
    check(
      "kpi_cod_nonneg",
      sql`pesanan_selesai >= 0 AND pesanan_total >= 0 AND penolakan >= 0 AND batal_setelah_kirim >= 0`,
    ),
    check("kpi_cod_selesai_maks_total", sql`pesanan_selesai <= pesanan_total`),
    check("kpi_cod_persen", sql`sukses_persen IS NULL OR sukses_persen BETWEEN 0 AND 100`),
  ],
);

export const statusCod = pgTable(
  "status_cod",
  {
    akunId: uuid("akun_id")
      .primaryKey()
      .references(() => akun.id, { onDelete: "restrict" }),
    mingguLolosBerturut: smallint("minggu_lolos_berturut").notNull().default(0),
    aktif: boolean("aktif").notNull().default(false),
    dicabutManualPada: ts("dicabut_manual_pada"),
    dicabutOleh: uuid("dicabut_oleh").references(() => admin.id, { onDelete: "restrict" }),
    alasanCabut: text("alasan_cabut"),
    ...kolomAudit,
  },
  () => [
    check("status_cod_minggu_nonneg", sql`minggu_lolos_berturut >= 0`),
    // Keputusan §2: COD hanya setelah lolos 3 minggu berturut-turut.
    check("status_cod_aktif_tiga_minggu", sql`NOT aktif OR minggu_lolos_berturut >= 3`),
    check(
      "status_cod_cabut_lengkap",
      sql`(dicabut_manual_pada IS NULL AND dicabut_oleh IS NULL AND alasan_cabut IS NULL)
        OR (dicabut_manual_pada IS NOT NULL AND dicabut_oleh IS NOT NULL AND alasan_cabut IS NOT NULL AND char_length(btrim(alasan_cabut)) > 0)`,
    ),
  ],
);
