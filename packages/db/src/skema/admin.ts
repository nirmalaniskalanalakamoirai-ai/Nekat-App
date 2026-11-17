import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea, cekDalam, idUtama, kolomAudit, waktu } from "./_umum.js";

// T-004 §3.3 Admin, peran, TOTP. Faktor kedua: H9 diputuskan "cukup OTP WA" (12 Nov),
// kolom TOTP tetap disiapkan sesuai model T-004 (bisa dinyalakan tanpa migrasi).

export const admin = pgTable(
  "admin",
  {
    id: idUtama(),
    /** [PII] */
    nama: text("nama").notNull(),
    /** [PII] Faktor pertama (OTP WA). */
    nomorHpE164: text("nomor_hp_e164").notNull(),
    /** [RAHASIA] AES-GCM di aplikasi, AAD = admin_id, kunci dari env. */
    totpRahasiaEnc: bytea("totp_rahasia_enc"),
    kunciVersi: smallint("kunci_versi"),
    totpAktifPada: waktu("totp_aktif_pada"),
    totpLangkahTerakhir: bigint("totp_langkah_terakhir", { mode: "number" }),
    gagalBeruntun: smallint("gagal_beruntun").notNull().default(0),
    dikunciSampai: waktu("dikunci_sampai"),
    status: text("status").notNull().default("AKTIF"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("admin_nomor_hp_uk").on(t.nomorHpE164),
    check("admin_nomor_hp_format", sql`${t.nomorHpE164} ~ '^\\+62[0-9]{8,13}$'`),
    check("admin_status", cekDalam("status", ["AKTIF", "NONAKTIF"])),
    check("admin_gagal_nonneg", sql`${t.gagalBeruntun} >= 0`),
  ],
);

export const kodePemulihanTotp = pgTable("kode_pemulihan_totp", {
  id: idUtama(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => admin.id, { onDelete: "restrict" }),
  /** [RAHASIA] */
  kodeHash: bytea("kode_hash").notNull(),
  dipakaiPada: waktu("dipakai_pada"),
  dibuatPada: kolomAudit.dibuatPada,
});

export const peran = pgTable("peran", {
  kode: text("kode").primaryKey(),
  nama: text("nama").notNull(),
});

export const izin = pgTable(
  "izin",
  {
    kode: text("kode").primaryKey(),
    keterangan: text("keterangan").notNull(),
  },
  (t) => [check("izin_pola", sql`${t.kode} ~ '^[a-z_]+\\.[a-z_]+$'`)],
);

export const peranIzin = pgTable(
  "peran_izin",
  {
    peranKode: text("peran_kode")
      .notNull()
      .references(() => peran.kode, { onDelete: "restrict" }),
    izinKode: text("izin_kode")
      .notNull()
      .references(() => izin.kode, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.peranKode, t.izinKode] })],
);

export const adminPeran = pgTable(
  "admin_peran",
  {
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    peranKode: text("peran_kode")
      .notNull()
      .references(() => peran.kode, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.adminId, t.peranKode] })],
);
