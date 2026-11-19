// T-004 §3.15 (bagian T-013a): log admin, log audit, antrean tinjauan, konfigurasi.
// outbox, job_run, idempotensi_inventori: lihat operasional.ts (T-013b).
import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admin } from "./akun.js";
import { bytea, dalam, idUuid, kolomAudit, ts } from "./_umum.js";

/** Append-only (M5). sebelum/sesudah tanpa PII. */
export const logAdmin = pgTable(
  "log_admin",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    izinKode: text("izin_kode").notNull(),
    entitasJenis: text("entitas_jenis").notNull(),
    entitasId: text("entitas_id"),
    sebelum: jsonb("sebelum"),
    sesudah: jsonb("sesudah"),
    alasan: text("alasan"),
    ipHmac: bytea("ip_hmac"),
    waktu: ts("waktu").notNull().defaultNow(),
  },
  (t) => [
    index("log_admin_entitas_idx").on(t.entitasJenis, t.entitasId, t.waktu.desc()),
    index("log_admin_admin_idx").on(t.adminId, t.waktu.desc()),
  ],
);

export const AKTOR_AUDIT = ["SISTEM", "PENGGUNA", "ADMIN"] as const;

/** Append-only (M5). data tanpa PII. */
export const logAudit = pgTable(
  "log_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jenis: text("jenis").notNull(),
    aktor: text("aktor").notNull(),
    refJenis: text("ref_jenis"),
    refId: text("ref_id"),
    data: jsonb("data"),
    waktu: ts("waktu").notNull().defaultNow(),
  },
  (t) => [
    check("log_audit_aktor", dalam("aktor", AKTOR_AUDIT)),
    index("log_audit_ref_idx").on(t.refJenis, t.refId),
  ],
);

export const JENIS_TINJAUAN = [
  "MODAL_PECAHAN",
  "HARGA_PECAHAN",
  "INVOICE_FINAL_BELUM_LUNAS",
  "KATEGORI",
  "SKU_BELUM_DIPETAKAN",
  "TIMPAAN_KEDALUWARSA",
  "GRUP_DITAHAN",
  "DANA_DITAHAN",
  "PEMBAYARAN_YATIM",
  "NOMINAL_TIDAK_COCOK",
  "PICKING_GAGAL",
  "KONFLIK_IDEMPOTENSI",
] as const;
export const STATUS_TINJAUAN = ["TERBUKA", "SELESAI", "DIABAIKAN"] as const;

export const antreanTinjauan = pgTable(
  "antrean_tinjauan",
  {
    id: idUuid(),
    jenis: text("jenis").notNull(),
    entitasJenis: text("entitas_jenis").notNull(),
    entitasId: uuid("entitas_id").notNull(),
    data: jsonb("data"),
    status: text("status").notNull().default("TERBUKA"),
    ditanganiOleh: uuid("ditangani_oleh").references(() => admin.id, { onDelete: "restrict" }),
    catatan: text("catatan"),
    selesaiPada: ts("selesai_pada"),
    ...kolomAudit,
  },
  (t) => [
    check("tinjauan_jenis", dalam("jenis", JENIS_TINJAUAN)),
    check("tinjauan_status", dalam("status", STATUS_TINJAUAN)),
    check(
      "tinjauan_ditutup_lengkap",
      sql`status = 'TERBUKA' OR (selesai_pada IS NOT NULL AND ditangani_oleh IS NOT NULL AND catatan IS NOT NULL AND char_length(btrim(catatan)) > 0)`,
    ),
    uniqueIndex("tinjauan_terbuka_uk")
      .on(t.jenis, t.entitasJenis, t.entitasId)
      .where(sql`status = 'TERBUKA'`),
    index("tinjauan_status_idx").on(t.status, t.jenis, t.dibuatPada),
  ],
);

/** Konfigurasi bisnis (tanpa rahasia). Riwayat perubahan di log_admin. */
export const konfigurasi = pgTable(
  "konfigurasi",
  {
    kunci: text("kunci").primaryKey(),
    nilai: jsonb("nilai"),
    diubahOleh: uuid("diubah_oleh").references(() => admin.id, { onDelete: "restrict" }),
    diubahPada: ts("diubah_pada").notNull().defaultNow(),
  },
  () => [check("konfigurasi_kunci_format", sql`kunci ~ '^[a-z_]+(\\.[a-z_]+)+$'`)],
);
