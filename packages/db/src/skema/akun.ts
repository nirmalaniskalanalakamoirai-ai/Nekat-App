import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { bytea, cekDalam, idUtama, kolomAudit, waktu } from "./_umum.js";
import { admin } from "./admin.js";
import { zona } from "./lokasi.js";

// T-004 §3.1 Akun & autentikasi. Kolom [PII] / [RAHASIA] ditandai di komentar.

export const STATUS_AKUN = ["AKTIF", "DIBEKUKAN", "DIHAPUS"] as const;
export const JENIS_PELANGGAN = ["PERORANGAN", "MITRA_GROSIR", "FRANCHISE"] as const;

export const akun = pgTable(
  "akun",
  {
    id: idUtama(),
    /** [PII] NULL hanya setelah dianonimkan. */
    nomorHpE164: text("nomor_hp_e164"),
    /** HMAC nomor HP (blind index) — UK penuh, menunggu K-35. */
    hpHmac: bytea("hp_hmac").notNull(),
    kunciVersi: smallint("kunci_versi").notNull(),
    hpTerverifikasiPada: waktu("hp_terverifikasi_pada").notNull(),
    hpDigantiPada: waktu("hp_diganti_pada"),
    /** [PII] */
    namaPanggilan: text("nama_panggilan"),
    jenisPelanggan: text("jenis_pelanggan").notNull().default("PERORANGAN"),
    status: text("status").notNull().default("AKTIF"),
    dibekukanAlasan: text("dibekukan_alasan"),
    dianonimkanPada: waktu("dianonimkan_pada"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("akun_nomor_hp_uk")
      .on(t.nomorHpE164)
      .where(sql`${t.nomorHpE164} IS NOT NULL`),
    uniqueIndex("akun_hp_hmac_uk").on(t.hpHmac),
    check(
      "akun_nomor_hp_format",
      sql`${t.nomorHpE164} IS NULL OR ${t.nomorHpE164} ~ '^\\+62[0-9]{8,13}$'`,
    ),
    check(
      "akun_nama_panggilan_panjang",
      sql`${t.namaPanggilan} IS NULL OR char_length(${t.namaPanggilan}) BETWEEN 1 AND 40`,
    ),
    check("akun_jenis_pelanggan", cekDalam("jenis_pelanggan", JENIS_PELANGGAN)),
    check("akun_status", cekDalam("status", STATUS_AKUN)),
    check(
      "akun_dibekukan_alasan",
      sql`${t.status} <> 'DIBEKUKAN' OR ${t.dibekukanAlasan} IS NOT NULL`,
    ),
  ],
);

export const otpPermintaan = pgTable(
  "otp_permintaan",
  {
    id: idUtama(),
    hpHmac: bytea("hp_hmac").notNull(),
    tujuan: text("tujuan").notNull(),
    /** [RAHASIA] HMAC(kode, pepper env). Kode asli tidak pernah disimpan. */
    kodeHmac: bytea("kode_hmac").notNull(),
    kunciVersi: smallint("kunci_versi").notNull(),
    percobaan: smallint("percobaan").notNull().default(0),
    kedaluwarsaPada: waktu("kedaluwarsa_pada").notNull(),
    terpakaiPada: waktu("terpakai_pada"),
    digantikanPada: waktu("digantikan_pada"),
    ipHmac: bytea("ip_hmac"),
    dibuatPada: kolomAudit.dibuatPada,
  },
  (t) => [
    uniqueIndex("otp_hidup_uk")
      .on(t.hpHmac, t.tujuan)
      .where(sql`${t.terpakaiPada} IS NULL AND ${t.digantikanPada} IS NULL`),
    index("otp_hp_dibuat_idx").on(t.hpHmac, t.dibuatPada.desc()),
    check("otp_tujuan", cekDalam("tujuan", ["LOGIN_PEMBELI", "LOGIN_ADMIN"])),
    check("otp_percobaan", sql`${t.percobaan} >= 0`),
    check(
      "otp_terpakai_sebelum_kedaluwarsa",
      sql`${t.terpakaiPada} IS NULL OR ${t.terpakaiPada} <= ${t.kedaluwarsaPada}`,
    ),
  ],
);

export const otpGagalHarian = pgTable(
  "otp_gagal_harian",
  {
    hpHmac: bytea("hp_hmac").notNull(),
    /** Tanggal WIB. */
    tanggal: date("tanggal", { mode: "string" }).notNull(),
    gagal: integer("gagal").notNull().default(0),
    kirim: integer("kirim").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.hpHmac, t.tanggal] }),
    check("otp_gagal_nonneg", sql`${t.gagal} >= 0 AND ${t.kirim} >= 0`),
  ],
);

export const sesi = pgTable(
  "sesi",
  {
    /** Hash ID sesi; cookie memegang ID asli. */
    idHash: bytea("id_hash").primaryKey(),
    akunId: uuid("akun_id").references(() => akun.id, { onDelete: "restrict" }),
    adminId: uuid("admin_id").references(() => admin.id, { onDelete: "restrict" }),
    faktorKeduaPada: waktu("faktor_kedua_pada"),
    reauthPada: waktu("reauth_pada"),
    kedaluwarsaPada: waktu("kedaluwarsa_pada").notNull(),
    dicabutPada: waktu("dicabut_pada"),
    dibuatPada: kolomAudit.dibuatPada,
  },
  (t) => [check("sesi_satu_pemilik", sql`num_nonnulls(${t.akunId}, ${t.adminId}) = 1`)],
);

export const alamat = pgTable(
  "alamat",
  {
    id: idUtama(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    /** NULL = di luar zona (F-18). */
    zonaId: uuid("zona_id").references(() => zona.id, { onDelete: "restrict" }),
    label: text("label"),
    /** [PII] */
    alamatTeks: text("alamat_teks"),
    /** [PII] */
    patokan: text("patokan"),
    /** [PII] */
    catatanKurir: text("catatan_kurir"),
    /** [PII] */
    lat: numeric("lat", { precision: 9, scale: 6 }),
    /** [PII] */
    lng: numeric("lng", { precision: 9, scale: 6 }),
    dihapusPada: waktu("dihapus_pada"),
    ...kolomAudit,
  },
  (t) => [index("alamat_akun_idx").on(t.akunId)],
);
