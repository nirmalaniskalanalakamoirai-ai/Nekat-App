// T-004 §3.1–§3.3: akun, autentikasi, persetujuan legal, admin & peran.
import { sql } from "drizzle-orm";
import {
  boolean,
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
  bigint,
} from "drizzle-orm/pg-core";
import { bytea, dalam, idUuid, kolomAudit, kolomDibuat, ts } from "./_umum.js";
import { zona } from "./lokasi.js";

export const JENIS_PELANGGAN = ["PERORANGAN", "MITRA_GROSIR", "FRANCHISE"] as const;
export const STATUS_AKUN = ["AKTIF", "DIBEKUKAN", "DIHAPUS"] as const;
export const TUJUAN_OTP = ["LOGIN_PEMBELI", "LOGIN_ADMIN"] as const;

export const akun = pgTable(
  "akun",
  {
    id: idUuid(),
    nomorHpE164: text("nomor_hp_e164"), // [PII]
    hpHmac: bytea("hp_hmac").notNull(),
    hpHmacKunciVersi: smallint("hp_hmac_kunci_versi").notNull(),
    hpTerverifikasiPada: ts("hp_terverifikasi_pada").notNull(),
    hpDigantiPada: ts("hp_diganti_pada"),
    namaPanggilan: text("nama_panggilan"), // [PII]
    jenisPelanggan: text("jenis_pelanggan").notNull().default("PERORANGAN"),
    status: text("status").notNull().default("AKTIF"),
    dibekukanAlasan: text("dibekukan_alasan"),
    dianonimkanPada: ts("dianonimkan_pada"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("akun_nomor_hp_uk")
      .on(t.nomorHpE164)
      .where(sql`nomor_hp_e164 IS NOT NULL`),
    // Menunggu K-35: UK penuh (termasuk akun dihapus) sampai diputuskan lain.
    uniqueIndex("akun_hp_hmac_uk").on(t.hpHmac),
    check(
      "akun_nomor_hp_format",
      sql`nomor_hp_e164 IS NULL OR nomor_hp_e164 ~ '^\\+62[0-9]{8,13}$'`,
    ),
    check(
      "akun_nama_panggilan_panjang",
      sql`nama_panggilan IS NULL OR char_length(nama_panggilan) BETWEEN 1 AND 40`,
    ),
    check("akun_jenis_pelanggan", dalam("jenis_pelanggan", JENIS_PELANGGAN)),
    check("akun_status", dalam("status", STATUS_AKUN)),
    check("akun_dibekukan_alasan", sql`status <> 'DIBEKUKAN' OR dibekukan_alasan IS NOT NULL`),
    check(
      "akun_hp_wajib_kecuali_anonim",
      sql`nomor_hp_e164 IS NOT NULL OR dianonimkan_pada IS NOT NULL`,
    ),
  ],
);

export const otpPermintaan = pgTable(
  "otp_permintaan",
  {
    id: idUuid(),
    hpHmac: bytea("hp_hmac").notNull(),
    tujuan: text("tujuan").notNull(),
    kodeHmac: bytea("kode_hmac").notNull(), // [RAHASIA]
    kodeKunciVersi: smallint("kode_kunci_versi").notNull(),
    percobaan: smallint("percobaan").notNull().default(0),
    kedaluwarsaPada: ts("kedaluwarsa_pada").notNull(),
    terpakaiPada: ts("terpakai_pada"),
    digantikanPada: ts("digantikan_pada"),
    ipHmac: bytea("ip_hmac"),
    ...kolomDibuat,
  },
  (t) => [
    check("otp_tujuan", dalam("tujuan", TUJUAN_OTP)),
    check("otp_percobaan", sql`percobaan >= 0`),
    check(
      "otp_terpakai_sebelum_kedaluwarsa",
      sql`terpakai_pada IS NULL OR terpakai_pada <= kedaluwarsa_pada`,
    ),
    uniqueIndex("otp_satu_hidup_uk")
      .on(t.hpHmac, t.tujuan)
      .where(sql`terpakai_pada IS NULL AND digantikan_pada IS NULL`),
    index("otp_hp_waktu_idx").on(t.hpHmac, t.dibuatPada.desc()),
  ],
);

export const otpGagalHarian = pgTable(
  "otp_gagal_harian",
  {
    hpHmac: bytea("hp_hmac").notNull(),
    tanggal: date("tanggal").notNull(), // WIB
    gagal: integer("gagal").notNull().default(0),
    kirim: integer("kirim").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.hpHmac, t.tanggal] }),
    check("otp_gagal_nonneg", sql`gagal >= 0 AND kirim >= 0`),
  ],
);

export const STATUS_ADMIN = ["AKTIF", "NONAKTIF"] as const;

export const admin = pgTable(
  "admin",
  {
    id: idUuid(),
    nama: text("nama").notNull(), // [PII]
    nomorHpE164: text("nomor_hp_e164").notNull(), // [PII]
    // T-036: faktor pertama sementara = kata sandi (scrypt, format `scrypt$N$r$p$garam$hash`).
    // NULL = belum diatur → tidak bisa masuk. [RAHASIA] tidak pernah dikirim ke klien/log.
    kataSandiHash: text("kata_sandi_hash"),
    kataSandiDiubahPada: ts("kata_sandi_diubah_pada"),
    totpRahasiaEnc: bytea("totp_rahasia_enc"), // [RAHASIA] AES-GCM, AAD = admin_id
    totpKunciVersi: smallint("totp_kunci_versi"),
    totpAktifPada: ts("totp_aktif_pada"),
    totpLangkahTerakhir: bigint("totp_langkah_terakhir", { mode: "number" }),
    gagalBeruntun: smallint("gagal_beruntun").notNull().default(0),
    dikunciSampai: ts("dikunci_sampai"),
    status: text("status").notNull().default("AKTIF"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("admin_nomor_hp_uk").on(t.nomorHpE164),
    check("admin_nomor_hp_format", sql`nomor_hp_e164 ~ '^\\+62[0-9]{8,13}$'`),
    check("admin_status", dalam("status", STATUS_ADMIN)),
    check(
      "admin_totp_aktif_butuh_rahasia",
      sql`totp_aktif_pada IS NULL OR (totp_rahasia_enc IS NOT NULL AND totp_kunci_versi IS NOT NULL)`,
    ),
    check("admin_gagal_nonneg", sql`gagal_beruntun >= 0`),
    check(
      "admin_kata_sandi_format",
      sql`kata_sandi_hash IS NULL OR kata_sandi_hash ~ '^scrypt[$][0-9]+[$][0-9]+[$][0-9]+[$][A-Za-z0-9_-]+[$][A-Za-z0-9_-]+$'`,
    ),
  ],
);

export const kodePemulihanTotp = pgTable(
  "kode_pemulihan_totp",
  {
    id: idUuid(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admin.id, { onDelete: "restrict" }),
    kodeHash: bytea("kode_hash").notNull(), // [RAHASIA]
    dipakaiPada: ts("dipakai_pada"),
    ...kolomDibuat,
  },
  // T-036: pencarian kode saat masuk + cegah kode ganda per admin.
  (t) => [uniqueIndex("kode_pemulihan_admin_hash_uk").on(t.adminId, t.kodeHash)],
);

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
  () => [check("izin_pola", sql`kode ~ '^[a-z_]+\\.[a-z_]+$'`)],
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
    ...kolomDibuat,
  },
  (t) => [primaryKey({ columns: [t.adminId, t.peranKode] })],
);

export const sesi = pgTable(
  "sesi",
  {
    idHash: bytea("id_hash").primaryKey(),
    akunId: uuid("akun_id").references(() => akun.id, { onDelete: "restrict" }),
    adminId: uuid("admin_id").references(() => admin.id, { onDelete: "restrict" }),
    faktorKeduaPada: ts("faktor_kedua_pada"),
    reauthPada: ts("reauth_pada"),
    kedaluwarsaPada: ts("kedaluwarsa_pada").notNull(),
    dicabutPada: ts("dicabut_pada"),
    ...kolomDibuat,
  },
  (t) => [
    check("sesi_satu_pemilik", sql`num_nonnulls(akun_id, admin_id) = 1`),
    index("sesi_akun_idx").on(t.akunId),
    index("sesi_admin_idx").on(t.adminId),
  ],
);

export const alamat = pgTable(
  "alamat",
  {
    id: idUuid(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    zonaId: uuid("zona_id").references(() => zona.id, { onDelete: "restrict" }), // NULL = di luar zona (F-18)
    label: text("label"),
    alamatTeks: text("alamat_teks"), // [PII]
    patokan: text("patokan"), // [PII]
    catatanKurir: text("catatan_kurir"), // [PII]
    lat: numeric("lat", { precision: 9, scale: 6 }), // [PII]
    lng: numeric("lng", { precision: 9, scale: 6 }), // [PII]
    dihapusPada: ts("dihapus_pada"),
    ...kolomAudit,
  },
  (t) => [
    index("alamat_akun_idx").on(t.akunId),
    check("alamat_lat", sql`lat IS NULL OR lat BETWEEN -90 AND 90`),
    check("alamat_lng", sql`lng IS NULL OR lng BETWEEN -180 AND 180`),
  ],
);

export const JENIS_DOKUMEN_LEGAL = ["SYARAT_KETENTUAN", "KEBIJAKAN_PRIVASI"] as const;

export const dokumenLegal = pgTable(
  "dokumen_legal",
  {
    id: idUuid(),
    jenis: text("jenis").notNull(),
    versi: text("versi").notNull(),
    hashIsi: bytea("hash_isi").notNull(),
    berlakuMulai: ts("berlaku_mulai").notNull(),
    wajibSetujuUlang: boolean("wajib_setuju_ulang").notNull().default(true), // menunggu F-23
    ...kolomDibuat,
  },
  (t) => [
    check("dokumen_legal_jenis", dalam("jenis", JENIS_DOKUMEN_LEGAL)),
    uniqueIndex("dokumen_legal_jenis_versi_uk").on(t.jenis, t.versi),
  ],
);

/** Append-only (M5). Hanya `anonimkan_akun()` boleh meng-NULL-kan ip_hmac & user_agent_ringkas. */
export const persetujuanLegal = pgTable(
  "persetujuan_legal",
  {
    id: idUuid(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    dokumenLegalId: uuid("dokumen_legal_id")
      .notNull()
      .references(() => dokumenLegal.id, { onDelete: "restrict" }),
    disetujuiPada: ts("disetujui_pada").notNull(),
    kanal: text("kanal").notNull(),
    ipHmac: bytea("ip_hmac"), // [PII]
    userAgentRingkas: text("user_agent_ringkas"), // [PII]
    ...kolomDibuat,
  },
  (t) => [
    check("persetujuan_kanal", dalam("kanal", ["PWA", "APP"])),
    uniqueIndex("persetujuan_akun_dokumen_uk").on(t.akunId, t.dokumenLegalId),
  ],
);
