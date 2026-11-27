// T-004 §3.11: saldo = loyalty point (K-13 satu ledger, G-06: 1 poin = Rp1, tanpa kedaluwarsa).
// Invarian dijaga DB (migrasi 0004):
// - `akun_saldo` hanya berubah lewat trigger insert `ledger_saldo` → saldo = Σ ledger, tidak pernah negatif;
// - `ledger_saldo.saldo_sesudah_rp` wajib sama dengan saldo hasil penerapan (pemanggil mengunci
//   `akun_saldo FOR UPDATE` dulu, urutan kunci ADR §3.2) — salah hitung / balapan → transaksi ditolak;
// - ledger, pengajuan & keputusan koreksi append-only; four-eyes: pemutus ≠ pengaju.
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admin, akun } from "./akun.js";
import { invoice } from "./invoice.js";
import { bytea, dalam, idUuid, kolomAudit, kolomDibuat, rupiah, ts } from "./_umum.js";

export const akunSaldo = pgTable(
  "akun_saldo",
  {
    akunId: uuid("akun_id")
      .primaryKey()
      .references(() => akun.id, { onDelete: "restrict" }),
    saldoRp: rupiah("saldo_rp").notNull().default(0),
    ...kolomAudit,
  },
  () => [check("akun_saldo_tidak_negatif", sql`saldo_rp >= 0`)],
);

export const JENIS_KREDIT_SALDO = [
  "SELISIH_HARGA",
  "REFUND",
  "REFUND_ONGKIR",
  "BAYAR_TERLAMBAT",
  "SALDO_BALIK",
  "PENCAIRAN_BATAL",
] as const;
export const JENIS_DEBIT_SALDO = ["PAKAI_CHECKOUT", "PENCAIRAN"] as const;
export const JENIS_LEDGER_SALDO = [
  ...JENIS_KREDIT_SALDO,
  ...JENIS_DEBIT_SALDO,
  "KOREKSI_ADMIN",
] as const;

/** Append-only (M5). Satu-satunya sumber perubahan saldo. */
export const ledgerSaldo = pgTable(
  "ledger_saldo",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    jumlahRp: rupiah("jumlah_rp").notNull(), // + kredit, − debit
    jenis: text("jenis").notNull(),
    referensiJenis: text("referensi_jenis"),
    referensiId: uuid("referensi_id"),
    // T-021 (migrasi 0007): invoice sumber dana untuk entri berbasis invoice → batas Σ kredit per invoice
    // (REFUND + REFUND_ONGKIR + SELISIH_HARGA ≤ total_rp; SALDO_BALIK ≠ REFUND untuk invoice yang sama).
    invoiceId: uuid("invoice_id").references(() => invoice.id, { onDelete: "restrict" }),
    // mis. `selisih:{grup_id}:{peserta_id}`, `debit:{invoice_id}`, `koreksi:{pengajuan_id}`.
    kunciIdempotensi: text("kunci_idempotensi").notNull(),
    alasan: text("alasan"),
    dibuatOlehAdminId: uuid("dibuat_oleh_admin_id").references(() => admin.id, {
      onDelete: "restrict",
    }),
    disetujuiOlehAdminId: uuid("disetujui_oleh_admin_id").references(() => admin.id, {
      onDelete: "restrict",
    }),
    dapatDicairkanSejak: ts("dapat_dicairkan_sejak"), // masa tahan K-34 (nilai di konfigurasi)
    saldoSesudahRp: rupiah("saldo_sesudah_rp").notNull(),
    ...kolomDibuat,
  },
  (t) => [
    uniqueIndex("ledger_kunci_idempotensi_uk").on(t.kunciIdempotensi),
    check("ledger_jenis", dalam("jenis", JENIS_LEDGER_SALDO)),
    check("ledger_jumlah_bukan_nol", sql`jumlah_rp <> 0`),
    check(
      "ledger_tanda_sesuai_jenis",
      sql`(${dalam("jenis", JENIS_KREDIT_SALDO)} AND jumlah_rp > 0) OR (${dalam("jenis", JENIS_DEBIT_SALDO)} AND jumlah_rp < 0) OR jenis = 'KOREKSI_ADMIN'`,
    ),
    check("ledger_saldo_sesudah_nonneg", sql`saldo_sesudah_rp >= 0`),
    check("ledger_referensi_lengkap", sql`(referensi_jenis IS NULL) = (referensi_id IS NULL)`),
    check(
      "ledger_koreksi_lengkap",
      sql`jenis <> 'KOREKSI_ADMIN' OR (alasan IS NOT NULL AND char_length(btrim(alasan)) > 0 AND dibuat_oleh_admin_id IS NOT NULL)`,
    ),
    check(
      "ledger_four_eyes",
      sql`disetujui_oleh_admin_id IS NULL OR disetujui_oleh_admin_id <> dibuat_oleh_admin_id`,
    ),
    // Satu pengajuan koreksi = paling banyak satu baris ledger (four-eyes, trigger migrasi 0004).
    uniqueIndex("ledger_koreksi_satu_per_pengajuan_uk")
      .on(t.referensiId)
      .where(sql`jenis = 'KOREKSI_ADMIN'`),
    index("ledger_akun_idx").on(t.akunId, t.id.desc()),
    index("ledger_invoice_idx")
      .on(t.invoiceId, t.jenis)
      .where(sql`invoice_id IS NOT NULL`),
  ],
);

/** Four-eyes (append-only). Status = ada/tidaknya baris keputusan. */
export const pengajuanKoreksiSaldo = pgTable(
  "pengajuan_koreksi_saldo",
  {
    id: idUuid(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    jumlahRp: rupiah("jumlah_rp").notNull(),
    alasan: text("alasan").notNull(),
    diajukanOleh: uuid("diajukan_oleh")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    diajukanPada: ts("diajukan_pada").notNull().defaultNow(),
  },
  (t) => [
    check("koreksi_jumlah_bukan_nol", sql`jumlah_rp <> 0`),
    check("koreksi_alasan_wajib", sql`char_length(btrim(alasan)) > 0`),
    index("koreksi_akun_idx").on(t.akunId),
  ],
);

export const HASIL_KOREKSI = ["DISETUJUI", "DITOLAK"] as const;

export const keputusanKoreksiSaldo = pgTable(
  "keputusan_koreksi_saldo",
  {
    pengajuanId: uuid("pengajuan_id").primaryKey(),
    hasil: text("hasil").notNull(),
    // Pemutus ≠ pengaju (trigger migrasi 0004).
    diputuskanOleh: uuid("diputuskan_oleh")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    catatan: text("catatan"),
    diputuskanPada: ts("diputuskan_pada").notNull().defaultNow(),
  },
  (t) => [
    check("keputusan_koreksi_hasil", dalam("hasil", HASIL_KOREKSI)),
    foreignKey({
      name: "keputusan_koreksi_pengajuan_fk",
      columns: [t.pengajuanId],
      foreignColumns: [pengajuanKoreksiSaldo.id],
    }).onDelete("restrict"),
  ],
);

export const JENIS_TUJUAN_PENCAIRAN = ["BANK", "VA", "EWALLET"] as const;

/** Tujuan pencairan yang lolos validasi (K-34; fitur dikunci sampai H5). */
export const tujuanPencairanTerverifikasi = pgTable(
  "tujuan_pencairan_terverifikasi",
  {
    id: idUuid(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    tujuanJenis: text("tujuan_jenis").notNull(),
    tujuanKode: text("tujuan_kode").notNull(),
    nomorTujuanEnc: bytea("nomor_tujuan_enc").notNull(), // [PII][RAHASIA] AES-GCM, AAD = akun_id
    nomorKunciVersi: smallint("nomor_kunci_versi").notNull(),
    nomorTujuanAkhir: text("nomor_tujuan_akhir").notNull(),
    namaHasilValidasi: text("nama_hasil_validasi"), // [PII]
    namaCocok: boolean("nama_cocok").notNull(),
    xenditValidasiRef: text("xendit_validasi_ref"),
    divalidasiPada: ts("divalidasi_pada").notNull(),
    bolehDipakaiSejak: ts("boleh_dipakai_sejak").notNull(),
    dinonaktifkanPada: ts("dinonaktifkan_pada"),
    ...kolomAudit,
  },
  (t) => [
    check("tujuan_jenis", dalam("tujuan_jenis", JENIS_TUJUAN_PENCAIRAN)),
    check("tujuan_nomor_akhir", sql`nomor_tujuan_akhir ~ '^[0-9]{1,4}$'`),
    check("tujuan_jeda", sql`boleh_dipakai_sejak >= divalidasi_pada`),
    unique("tujuan_id_akun_uk").on(t.id, t.akunId),
    index("tujuan_akun_idx").on(t.akunId),
  ],
);

export const STATUS_PENCAIRAN = [
  "DIAJUKAN",
  "DISETUJUI",
  "DIPROSES",
  "BERHASIL",
  "GAGAL",
  "DITOLAK",
] as const;

export const pencairanSaldo = pgTable(
  "pencairan_saldo",
  {
    id: idUuid(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    jumlahRp: rupiah("jumlah_rp").notNull(),
    tujuanId: uuid("tujuan_id").notNull(),
    reauthSesiPada: ts("reauth_sesi_pada").notNull(), // step-up OTP (K-34)
    status: text("status").notNull().default("DIAJUKAN"),
    xenditDisbursementRef: text("xendit_disbursement_ref"),
    kunciIdempotensi: text("kunci_idempotensi").notNull(),
    disetujuiOleh: uuid("disetujui_oleh").references(() => admin.id, { onDelete: "restrict" }),
    diprosesOleh: uuid("diproses_oleh").references(() => admin.id, { onDelete: "restrict" }),
    ...kolomAudit,
  },
  (t) => [
    // Tujuan wajib milik akun yang sama.
    foreignKey({
      name: "pencairan_tujuan_milik_akun_fk",
      columns: [t.tujuanId, t.akunId],
      foreignColumns: [tujuanPencairanTerverifikasi.id, tujuanPencairanTerverifikasi.akunId],
    }).onDelete("restrict"),
    check("pencairan_jumlah_positif", sql`jumlah_rp > 0`),
    check("pencairan_status", dalam("status", STATUS_PENCAIRAN)),
    // Default paling aman sampai ambang four-eyes diisi (K-34): penyetuju ≠ pemroses SELALU.
    check(
      "pencairan_four_eyes",
      sql`disetujui_oleh IS NULL OR diproses_oleh IS NULL OR disetujui_oleh <> diproses_oleh`,
    ),
    check(
      "pencairan_disetujui_lengkap",
      sql`status NOT IN ('DISETUJUI', 'DIPROSES', 'BERHASIL') OR disetujui_oleh IS NOT NULL`,
    ),
    check(
      "pencairan_diproses_lengkap",
      sql`status NOT IN ('DIPROSES', 'BERHASIL') OR diproses_oleh IS NOT NULL`,
    ),
    uniqueIndex("pencairan_kunci_idempotensi_uk").on(t.kunciIdempotensi),
    uniqueIndex("pencairan_xendit_ref_uk").on(t.xenditDisbursementRef),
    index("pencairan_akun_idx").on(t.akunId, t.dibuatPada),
  ],
);
