// T-004 §3.6 (reservasi), §3.9 invoice/tagihan, §3.10 pembayaran Xendit.
// Penyesuaian keputusan 16–19 Nov: K-25 (ongkir masuk SATU tagihan bersama barang → tidak ada invoice
// `FINAL`, kolom `jenis` T-004 dihapus), K-26 (biaya admin per akun peserta di tagihan barang),
// K-29 (stok habis → hanya baris itu dibatalkan), K-36 (hanya QRIS/VA), K-37 (gabungan ikut TTL tertua),
// P-19 (pembeli tidak pernah ditagih tambahan → harga final ≤ harga dibayar).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admin, akun } from "./akun.js";
import { dalam, idUuid, kolomAudit, kolomDibuat, rupiah, ts } from "./_umum.js";
import { grup, pesertaGrup } from "./grup.js";
import { LEVEL_HARGA, satuanJual, sku, stokLokasi } from "./katalog.js";
import { gudang } from "./lokasi.js";

/** Versi konfigurasi PPN (append-only, G-04). Semua NULL bawaan; diisi owner. */
export const konfigurasiPpn = pgTable(
  "konfigurasi_ppn",
  {
    id: idUuid(),
    tarifPersen: numeric("tarif_persen", { precision: 9, scale: 4 }),
    dppPembilang: integer("dpp_pembilang"),
    dppPenyebut: integer("dpp_penyebut"),
    berlakuMulai: ts("berlaku_mulai").notNull(),
    dibuatOleh: uuid("dibuat_oleh")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    ...kolomDibuat,
  },
  (t) => [
    check(
      "ppn_tarif_rentang",
      sql`tarif_persen IS NULL OR (tarif_persen >= 0 AND tarif_persen < 100)`,
    ),
    check(
      "ppn_dpp_konsisten",
      sql`(dpp_pembilang IS NULL AND dpp_penyebut IS NULL) OR (dpp_pembilang > 0 AND dpp_penyebut > 0 AND dpp_pembilang <= dpp_penyebut)`,
    ),
    index("ppn_berlaku_idx").on(t.berlakuMulai.desc()),
  ],
);

export const STATUS_INVOICE = [
  "DITERBITKAN",
  "LUNAS",
  "KEDALUWARSA",
  "DIBATALKAN",
  "DIGANTI",
] as const;

/** Tagihan grup. Fase 1 hanya lewat grup (`grup_id` NN, T-004 §3.9). */
export const invoice = pgTable(
  "invoice",
  {
    id: idUuid(),
    nomor: text("nomor").notNull(),
    grupId: uuid("grup_id")
      .notNull()
      .references(() => grup.id, { onDelete: "restrict" }),
    // SENDIRI = akun peserta; HOST = host (G-06: kredit selisih/refund ke akun pembayar).
    pembayarAkunId: uuid("pembayar_akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    gabungan: boolean("gabungan").notNull().default(false), // K-17
    status: text("status").notNull().default("DITERBITKAN"),
    diterbitkanPada: ts("diterbitkan_pada").notNull(),
    ttlMenit: smallint("ttl_menit").notNull(), // snapshot konfigurasi (F-26)
    kedaluwarsaPada: ts("kedaluwarsa_pada").notNull(),
    menggantikanInvoiceIds: uuid("menggantikan_invoice_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    subtotalBarangRp: rupiah("subtotal_barang_rp").notNull().default(0),
    potonganRp: rupiah("potongan_rp").notNull().default(0),
    biayaAdminRp: rupiah("biaya_admin_rp").notNull().default(0),
    ongkirRp: rupiah("ongkir_rp").notNull().default(0),
    subsidiOngkirRp: rupiah("subsidi_ongkir_rp").notNull().default(0),
    ppnRp: rupiah("ppn_rp"), // cara hitung ikut konsultan pajak (K-28)
    dppRp: rupiah("dpp_rp"),
    konfigurasiPpnId: uuid("konfigurasi_ppn_id").references(() => konfigurasiPpn.id, {
      onDelete: "restrict",
    }),
    totalRp: rupiah("total_rp").notNull(),
    saldoDipakaiRp: rupiah("saldo_dipakai_rp").notNull().default(0), // G-03
    sisaBayarRp: rupiah("sisa_bayar_rp").notNull(),
    lunasPada: ts("lunas_pada"), // paid_at Xendit atau waktu debit saldo (F-11)
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("invoice_nomor_uk").on(t.nomor),
    // Target FK komposit invoice_peserta (peserta & invoice satu grup).
    unique("invoice_id_grup_uk").on(t.id, t.grupId),
    check("invoice_status", dalam("status", STATUS_INVOICE)),
    check("invoice_ttl_positif", sql`ttl_menit > 0`),
    check("invoice_kedaluwarsa_setelah_terbit", sql`kedaluwarsa_pada > diterbitkan_pada`),
    // Invoice biasa: kedaluwarsa = terbit + TTL (K-07). Gabungan: ikut tagihan tertua (K-37, dicek domain).
    check(
      "invoice_kedaluwarsa_ttl",
      sql`gabungan OR kedaluwarsa_pada = diterbitkan_pada + make_interval(mins => ttl_menit)`,
    ),
    check(
      "invoice_menggantikan_hanya_gabungan",
      sql`gabungan OR cardinality(menggantikan_invoice_ids) = 0`,
    ),
    check(
      "invoice_komponen_nonneg",
      sql`subtotal_barang_rp >= 0 AND potongan_rp >= 0 AND biaya_admin_rp >= 0 AND ongkir_rp >= 0 AND subsidi_ongkir_rp >= 0`,
    ),
    check("invoice_subsidi_maks_ongkir", sql`subsidi_ongkir_rp <= ongkir_rp`),
    check(
      "invoice_ppn_nonneg",
      sql`(ppn_rp IS NULL OR ppn_rp >= 0) AND (dpp_rp IS NULL OR dpp_rp >= 0)`,
    ),
    check(
      "invoice_total_konsisten",
      sql`total_rp = subtotal_barang_rp - potongan_rp + biaya_admin_rp + ongkir_rp - subsidi_ongkir_rp AND total_rp >= 0`,
    ),
    check("invoice_saldo_dipakai", sql`saldo_dipakai_rp >= 0 AND saldo_dipakai_rp <= total_rp`),
    check("invoice_sisa_bayar", sql`sisa_bayar_rp = total_rp - saldo_dipakai_rp`),
    check("invoice_lunas_lengkap", sql`status <> 'LUNAS' OR lunas_pada IS NOT NULL`),
    index("invoice_kedaluwarsa_idx")
      .on(t.status, t.kedaluwarsaPada)
      .where(sql`status = 'DITERBITKAN'`),
    index("invoice_grup_idx").on(t.grupId),
    index("invoice_pembayar_idx").on(t.pembayarAkunId, t.diterbitkanPada.desc()),
  ],
);

/** Peserta yang ditagih di invoice. Satu invoice aktif per peserta. */
export const invoicePeserta = pgTable(
  "invoice_peserta",
  {
    invoiceId: uuid("invoice_id").notNull(),
    pesertaId: uuid("peserta_id").notNull(),
    grupId: uuid("grup_id").notNull(),
    aktif: boolean("aktif").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    primaryKey({ columns: [t.invoiceId, t.pesertaId] }),
    foreignKey({
      name: "invoice_peserta_invoice_grup_fk",
      columns: [t.invoiceId, t.grupId],
      foreignColumns: [invoice.id, invoice.grupId],
    }).onDelete("restrict"),
    foreignKey({
      name: "invoice_peserta_peserta_grup_fk",
      columns: [t.pesertaId, t.grupId],
      foreignColumns: [pesertaGrup.id, pesertaGrup.grupId],
    }).onDelete("restrict"),
    uniqueIndex("invoice_peserta_satu_aktif_uk")
      .on(t.pesertaId)
      .where(sql`aktif`),
  ],
);

export const JENIS_BARIS_INVOICE = [
  "BARANG",
  "BIAYA_ADMIN",
  "BIAYA_ADMIN_PAGAR",
  "ONGKIR",
  "SUBSIDI_ONGKIR",
  "DISKON",
] as const;

/** Snapshot per baris saat tagihan terbit (K-15). */
export const barisInvoice = pgTable(
  "baris_invoice",
  {
    id: idUuid(),
    invoiceId: uuid("invoice_id").notNull(),
    pesertaId: uuid("peserta_id").notNull(),
    jenis: text("jenis").notNull(),
    satuanJualId: uuid("satuan_jual_id").references(() => satuanJual.id, { onDelete: "restrict" }),
    namaSnapshot: text("nama_snapshot").notNull(),
    qty: integer("qty").notNull().default(1),
    levelHarga: text("level_harga"),
    hargaDibayarRp: rupiah("harga_dibayar_rp"),
    modalSnapshotRp: rupiah("modal_snapshot_rp"),
    versiHarga: text("versi_harga"),
    potonganBarisRp: rupiah("potongan_baris_rp").notNull().default(0), // alokasi diskon total (K-21)
    subsidiOngkirBarisRp: rupiah("subsidi_ongkir_baris_rp").notNull().default(0), // P-20
    bebasPpn: boolean("bebas_ppn"),
    ppnBarisRp: rupiah("ppn_baris_rp"),
    dppBarisRp: rupiah("dpp_baris_rp"),
    nilaiRp: rupiah("nilai_rp").notNull(),
    // Diisi saat cut-off.
    modalCutoffRp: rupiah("modal_cutoff_rp"),
    hargaFinalRp: rupiah("harga_final_rp"),
    nilaiBersihFinalRp: rupiah("nilai_bersih_final_rp"),
    qtyTeralokasi: integer("qty_teralokasi"),
    dibatalkan: boolean("dibatalkan").notNull().default(false),
    dibatalkanAlasan: text("dibatalkan_alasan"), // mis. STOK_HABIS (K-29), DIGANTI (K-17)
    ...kolomAudit,
  },
  (t) => [
    // Baris wajib milik peserta yang tercatat di invoice ini.
    foreignKey({
      name: "baris_invoice_invoice_peserta_fk",
      columns: [t.invoiceId, t.pesertaId],
      foreignColumns: [invoicePeserta.invoiceId, invoicePeserta.pesertaId],
    }).onDelete("restrict"),
    check("baris_jenis", dalam("jenis", JENIS_BARIS_INVOICE)),
    check("baris_qty_positif", sql`qty > 0`),
    check("baris_level_harga", sql`level_harga IS NULL OR ${dalam("level_harga", LEVEL_HARGA)}`),
    check(
      "baris_barang_lengkap",
      sql`jenis <> 'BARANG' OR (satuan_jual_id IS NOT NULL AND level_harga IS NOT NULL AND harga_dibayar_rp IS NOT NULL AND modal_snapshot_rp IS NOT NULL AND versi_harga IS NOT NULL AND bebas_ppn IS NOT NULL)`,
    ),
    check(
      "baris_non_barang_tanpa_harga",
      sql`jenis = 'BARANG' OR (satuan_jual_id IS NULL AND harga_dibayar_rp IS NULL AND modal_snapshot_rp IS NULL AND potongan_baris_rp = 0 AND subsidi_ongkir_baris_rp = 0 AND harga_final_rp IS NULL AND qty_teralokasi IS NULL)`,
    ),
    // CLAUDE.md + P-16: harga dibayar > modal (margin 0 dilarang).
    // Catatan K-28: CHECK modal di DB memakai harga TERMASUK PPN (harga tampil). Cek modal memakai harga
    // TANPA PPN (lebih ketat) adalah kewajiban domain, karena rincian PPN ikut konsultan pajak.
    check(
      "baris_harga_di_atas_modal",
      sql`jenis <> 'BARANG' OR (modal_snapshot_rp > 0 AND harga_dibayar_rp > modal_snapshot_rp)`,
    ),
    check("baris_alokasi_nonneg", sql`potongan_baris_rp >= 0 AND subsidi_ongkir_baris_rp >= 0`),
    // Lantai keras: nilai bersih setelah promo & subsidi ongkir ≥ modal (keputusan §4, P-07; β di domain).
    check(
      "baris_bersih_tidak_di_bawah_modal",
      sql`jenis <> 'BARANG' OR harga_dibayar_rp * qty - potongan_baris_rp - subsidi_ongkir_baris_rp >= modal_snapshot_rp * qty`,
    ),
    check(
      "baris_nilai_konsisten",
      sql`(jenis = 'BARANG' AND nilai_rp = harga_dibayar_rp * qty) OR (jenis IN ('DISKON', 'SUBSIDI_ONGKIR') AND nilai_rp < 0) OR (jenis IN ('BIAYA_ADMIN', 'BIAYA_ADMIN_PAGAR', 'ONGKIR') AND nilai_rp >= 0)`,
    ),
    check(
      "baris_ppn_nonneg",
      sql`(ppn_baris_rp IS NULL OR ppn_baris_rp >= 0) AND (dpp_baris_rp IS NULL OR dpp_baris_rp >= 0)`,
    ),
    // P-09 + P-16: harga final > modal cut-off (margin 0 dilarang); P-19: pembeli tidak pernah ditagih
    // tambahan (final ≤ dibayar).
    check(
      "baris_harga_final",
      sql`harga_final_rp IS NULL OR (modal_cutoff_rp IS NOT NULL AND harga_final_rp > modal_cutoff_rp AND harga_final_rp <= harga_dibayar_rp)`,
    ),
    check("baris_modal_cutoff_positif", sql`modal_cutoff_rp IS NULL OR modal_cutoff_rp > 0`),
    check("baris_qty_teralokasi", sql`qty_teralokasi IS NULL OR qty_teralokasi BETWEEN 0 AND qty`),
    // P-23, P-26: nilai bersih final ≥ modal cut-off × qty teralokasi (+ subsidi bila ada alokasi).
    check(
      "baris_bersih_final_tidak_di_bawah_modal",
      sql`nilai_bersih_final_rp IS NULL OR (modal_cutoff_rp IS NOT NULL AND qty_teralokasi IS NOT NULL AND nilai_bersih_final_rp >= modal_cutoff_rp * qty_teralokasi + CASE WHEN qty_teralokasi > 0 THEN subsidi_ongkir_baris_rp ELSE 0 END)`,
    ),
    check("baris_batal_beralasan", sql`NOT dibatalkan OR dibatalkan_alasan IS NOT NULL`),
    // K-06/K-26: biaya admin flat satu kali per akun peserta per grup.
    uniqueIndex("baris_biaya_admin_satu_uk")
      .on(t.pesertaId)
      .where(sql`jenis = 'BIAYA_ADMIN' AND NOT dibatalkan`),
    index("baris_invoice_idx").on(t.invoiceId),
    index("baris_peserta_idx").on(t.pesertaId),
    index("baris_satuan_jual_idx").on(t.satuanJualId),
  ],
);

export const STATUS_RESERVASI = ["AKTIF", "TERPAKAI", "DILEPAS"] as const;

/** Dibuat saat tagihan terbit (barang di keranjang tidak memotong stok, P-08). */
export const reservasiStok = pgTable(
  "reservasi_stok",
  {
    id: idUuid(),
    barisInvoiceId: uuid("baris_invoice_id")
      .notNull()
      .references(() => barisInvoice.id, { onDelete: "restrict" }),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id, { onDelete: "restrict" }),
    gudangId: uuid("gudang_id")
      .notNull()
      .references(() => gudang.id, { onDelete: "restrict" }),
    qtySatuanDasar: integer("qty_satuan_dasar").notNull(),
    status: text("status").notNull().default("AKTIF"),
    selesaiPada: ts("selesai_pada"), // waktu TERPAKAI / DILEPAS
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("reservasi_baris_uk").on(t.barisInvoiceId),
    foreignKey({
      name: "reservasi_stok_lokasi_fk",
      columns: [t.skuId, t.gudangId],
      foreignColumns: [stokLokasi.skuId, stokLokasi.gudangId],
    }).onDelete("restrict"),
    check("reservasi_qty_positif", sql`qty_satuan_dasar > 0`),
    check("reservasi_status", dalam("status", STATUS_RESERVASI)),
    check("reservasi_selesai_konsisten", sql`(status = 'AKTIF') = (selesai_pada IS NULL)`),
    index("reservasi_aktif_idx")
      .on(t.skuId, t.gudangId)
      .where(sql`status = 'AKTIF'`),
  ],
);

// K-36: tagihan grup hanya QRIS/VA. E-wallet (keputusan §9) menyusul → cukup ganti CHECK.
export const METODE_BAYAR_GRUP = ["QRIS", "VA"] as const;
export const STATUS_PEMBAYARAN = [
  "MENUNGGU",
  "LUNAS",
  "KEDALUWARSA",
  "GAGAL",
  "NOMINAL_TIDAK_COCOK",
] as const;

export const pembayaran = pgTable(
  "pembayaran",
  {
    // PK = external_id ke Xendit: retry tidak membuat tagihan ganda.
    id: idUuid(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "restrict" }),
    metode: text("metode").notNull(),
    kanal: text("kanal"), // kode bank VA
    jumlahRp: rupiah("jumlah_rp").notNull(),
    xenditRef: text("xendit_ref"),
    status: text("status").notNull().default("MENUNGGU"),
    kedaluwarsaPada: ts("kedaluwarsa_pada"),
    paidAtGateway: ts("paid_at_gateway"), // basis keterlambatan (F-11)
    webhookDiterimaPada: ts("webhook_diterima_pada"),
    kunciIdempotensi: text("kunci_idempotensi").notNull(),
    ...kolomAudit,
  },
  (t) => [
    check("pembayaran_metode", dalam("metode", METODE_BAYAR_GRUP)),
    check("pembayaran_status", dalam("status", STATUS_PEMBAYARAN)),
    check("pembayaran_jumlah_positif", sql`jumlah_rp > 0`),
    check("pembayaran_lunas_lengkap", sql`status <> 'LUNAS' OR paid_at_gateway IS NOT NULL`),
    uniqueIndex("pembayaran_xendit_ref_uk").on(t.xenditRef),
    uniqueIndex("pembayaran_kunci_idempotensi_uk").on(t.kunciIdempotensi),
    uniqueIndex("pembayaran_satu_hidup_uk")
      .on(t.invoiceId)
      .where(sql`status IN ('MENUNGGU', 'LUNAS')`),
    index("pembayaran_status_idx").on(t.status, t.dibuatPada),
  ],
);

/** Append-only (M5). Status proses di webhook_proses, payload di webhook_payload. */
export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: idUuid(),
    gateway: text("gateway").notNull(),
    eventIdGateway: text("event_id_gateway").notNull(),
    externalId: text("external_id").notNull(),
    status: text("status").notNull(),
    // NULL = event yatim → antrean_tinjauan.
    pembayaranId: uuid("pembayaran_id").references(() => pembayaran.id, { onDelete: "restrict" }),
    diterimaPada: ts("diterima_pada").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_event_id_gateway_uk").on(t.gateway, t.eventIdGateway),
    uniqueIndex("webhook_event_external_status_uk").on(t.gateway, t.externalId, t.status),
    index("webhook_event_pembayaran_idx").on(t.pembayaranId),
  ],
);

export const HASIL_WEBHOOK = [
  "DIPROSES",
  "DUPLIKAT",
  "YATIM",
  "NOMINAL_TIDAK_COCOK",
  "TERLAMBAT",
] as const;

export const webhookProses = pgTable(
  "webhook_proses",
  {
    webhookEventId: uuid("webhook_event_id")
      .primaryKey()
      .references(() => webhookEvent.id, { onDelete: "restrict" }),
    diprosesPada: ts("diproses_pada").notNull().defaultNow(),
    hasil: text("hasil").notNull(),
  },
  () => [check("webhook_proses_hasil", dalam("hasil", HASIL_WEBHOOK))],
);

/** Payload teredaksi; hanya dipangkas lewat `pangkas_webhook_payload()` (M5 pengecualian 2). */
export const webhookPayload = pgTable(
  "webhook_payload",
  {
    webhookEventId: uuid("webhook_event_id")
      .primaryKey()
      .references(() => webhookEvent.id, { onDelete: "restrict" }),
    payloadRedaksi: jsonb("payload_redaksi").notNull(),
    ...kolomDibuat,
  },
  (t) => [index("webhook_payload_dibuat_idx").on(t.dibuatPada)],
);
