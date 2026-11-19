// T-004 §3.8: keranjang & grup (G-01: grup per keranjang, campur produk).
// Penyesuaian keputusan 16–19 Nov: K-22 (tombol "Siap" + "Terbitkan tagihan", setelah itu terkunci),
// K-31 (COD tidak berlaku di grup → status COD_TERKONFIRMASI tidak dipakai), K-33 (host bisa berpindah),
// K-39 (peringatan sebelum dikeluarkan), F-07/K-40 (tidak bisa batal setelah bayar: trigger migrasi 0004).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { akun, alamat } from "./akun.js";
import { dalam, idUuid, kolomAudit, rupiah, ts } from "./_umum.js";
import { LEVEL_HARGA, satuanJual } from "./katalog.js";
import { dropPoint, gudang, slotKirim, zona } from "./lokasi.js";

export const STATUS_KERANJANG = ["AKTIF", "DIPAKAI_GRUP", "DITINGGALKAN"] as const;

export const keranjang = pgTable(
  "keranjang",
  {
    id: idUuid(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    // NULL = keranjang pribadi sebelum masuk grup.
    grupId: uuid("grup_id").references(() => grup.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("AKTIF"),
    // K-22: anggota menekan "Siap"; NULL = belum siap. Hanya untuk keranjang grup.
    siapPada: ts("siap_pada"),
    ...kolomAudit,
  },
  (t) => [
    check("keranjang_status", dalam("status", STATUS_KERANJANG)),
    check(
      "keranjang_dipakai_grup_butuh_grup",
      sql`status <> 'DIPAKAI_GRUP' OR grup_id IS NOT NULL`,
    ),
    check("keranjang_siap_hanya_grup", sql`siap_pada IS NULL OR grup_id IS NOT NULL`),
    uniqueIndex("keranjang_pribadi_aktif_uk")
      .on(t.akunId)
      .where(sql`grup_id IS NULL AND status = 'AKTIF'`),
    uniqueIndex("keranjang_grup_aktif_uk")
      .on(t.akunId, t.grupId)
      .where(sql`grup_id IS NOT NULL AND status <> 'DITINGGALKAN'`),
    // Target FK komposit dari peserta_grup (keranjang pasti milik akun & grup yang sama).
    unique("keranjang_id_akun_grup_uk").on(t.id, t.akunId, t.grupId),
    index("keranjang_grup_idx").on(t.grupId),
  ],
);

/** Tanpa harga (dihitung server, ADR §5.3); tidak memotong stok (P-08). */
export const itemKeranjang = pgTable(
  "item_keranjang",
  {
    id: idUuid(),
    // Satu-satunya cascade (T-004 §3.8): data belum transaksi.
    keranjangId: uuid("keranjang_id")
      .notNull()
      .references(() => keranjang.id, { onDelete: "cascade" }),
    satuanJualId: uuid("satuan_jual_id")
      .notNull()
      .references(() => satuanJual.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
    ...kolomAudit,
  },
  (t) => [
    check("item_keranjang_qty_positif", sql`qty > 0`),
    uniqueIndex("item_keranjang_uk").on(t.keranjangId, t.satuanJualId),
    index("item_keranjang_satuan_jual_idx").on(t.satuanJualId),
  ],
);

export const STATUS_GRUP = [
  "DIBUKA",
  "AKTIF",
  // K-22: tagihan sudah terbit, menunggu pelunasan (TTL 60 menit, K-07) — tambahan T-013b atas T-004 §4.1.
  "TAGIHAN_TERBIT",
  "CUT_OFF",
  "DITAHAN",
  "HARGA_TERKUNCI",
  "LANJUT_SATUAN",
  "GAGAL",
  "BATAL",
  "DIPROSES",
  "SELESAI",
] as const;
export const CARA_BAYAR_GRUP = ["SENDIRI", "HOST"] as const;

export const grup = pgTable(
  "grup",
  {
    id: idUuid(),
    kodeLink: text("kode_link").notNull(),
    // Pembuat grup; berpindah ke anggota paling awal bila host keluar sebelum tagihan terbit (K-33).
    hostAkunId: uuid("host_akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    zonaId: uuid("zona_id")
      .notNull()
      .references(() => zona.id, { onDelete: "restrict" }),
    slotKirimId: uuid("slot_kirim_id")
      .notNull()
      .references(() => slotKirim.id, { onDelete: "restrict" }),
    // Cabang penerima pesanan, cek stok sebelum diproses (F-20).
    gudangId: uuid("gudang_id")
      .notNull()
      .references(() => gudang.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("DIBUKA"),
    alasanStatus: text("alasan_status"),
    caraBayar: text("cara_bayar").notNull().default("SENDIRI"),
    // Snapshot konfigurasi `grup.min_akun`; keputusan §3: minimal 3 akun berbeda, tidak bisa dilonggarkan.
    minAkun: smallint("min_akun").notNull().default(3),
    akunMenambahBarang: integer("akun_menambah_barang").notNull().default(0), // cache (K-17)
    akunLunas: integer("akun_lunas").notNull().default(0), // cache (K-12)
    totalBelanjaRp: rupiah("total_belanja_rp").notNull().default(0), // cache (F-30, K-23)
    hargaGrupBerlaku: boolean("harga_grup_berlaku").notNull().default(false),
    // K-22: host menekan "Terbitkan tagihan" (atau terbit otomatis, K-39). Setelah ini tidak bisa
    // tambah anggota / barang (trigger migrasi 0004).
    tagihanDiterbitkanPada: ts("tagihan_diterbitkan_pada"),
    evaluasiDimulaiPada: ts("evaluasi_dimulai_pada"),
    ditahanPada: ts("ditahan_pada"),
    dibatalkanPada: ts("dibatalkan_pada"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("grup_kode_link_uk").on(t.kodeLink),
    check("grup_kode_link_format", sql`kode_link ~ '^[A-HJ-NP-Z2-9]{6}$'`),
    check("grup_status", dalam("status", STATUS_GRUP)),
    check("grup_cara_bayar", dalam("cara_bayar", CARA_BAYAR_GRUP)),
    check("grup_min_akun", sql`min_akun >= 3`),
    check(
      "grup_hitungan_nonneg",
      sql`akun_menambah_barang >= 0 AND akun_lunas >= 0 AND total_belanja_rp >= 0`,
    ),
    check(
      "grup_ditahan_lengkap",
      sql`status <> 'DITAHAN' OR (ditahan_pada IS NOT NULL AND alasan_status IS NOT NULL)`,
    ),
    check("grup_batal_lengkap", sql`status <> 'BATAL' OR dibatalkan_pada IS NOT NULL`),
    // Setelah tagihan terbit, grup tidak kembali ke tahap pengumpulan (K-22).
    check(
      "grup_tagihan_terbit_konsisten",
      sql`(status <> 'TAGIHAN_TERBIT' OR tagihan_diterbitkan_pada IS NOT NULL) AND (tagihan_diterbitkan_pada IS NULL OR status NOT IN ('DIBUKA', 'AKTIF'))`,
    ),
    index("grup_slot_status_idx").on(t.slotKirimId, t.status),
    index("grup_host_idx").on(t.hostAkunId),
    index("grup_ditahan_idx")
      .on(t.status)
      .where(sql`status = 'DITAHAN'`),
  ],
);

export const PERAN_PESERTA = ["HOST", "ANGGOTA"] as const;
// K-31: COD tidak berlaku di grup → `COD_TERKONFIRMASI` (T-004 §4.2) tidak dimasukkan.
export const STATUS_PESERTA = [
  "AKTIF",
  "MENUNGGU_BAYAR",
  "LUNAS",
  "TERKUNCI",
  "DIPROSES",
  "DIKIRIM",
  "SIAP_DIAMBIL",
  "DITERIMA",
  "DITOLAK",
  "DIKELUARKAN",
  "BATAL",
  "DIREFUND",
  "DANA_DITAHAN",
  "TIDAK_DIAMBIL",
] as const;
/** Status yang tidak menghitung peserta sebagai anggota hidup grup. */
export const STATUS_PESERTA_NONAKTIF = ["DIKELUARKAN", "BATAL", "DIREFUND"] as const;
export const CARA_KIRIM = ["ANTAR_RUMAH", "DROP_POINT"] as const;
// K-11 diputuskan: pengguna memilih; BELUM_MEMILIH diperlakukan domain sebagai batal (default K-11).
export const PILIHAN_SAAT_GAGAL = ["BELUM_MEMILIH", "LANJUT_SATUAN", "BATAL_KE_SALDO"] as const;

const daftarSql = (nilai: readonly string[]) => nilai.map((n) => `'${n}'`).join(", ");

export const pesertaGrup = pgTable(
  "peserta_grup",
  {
    id: idUuid(),
    grupId: uuid("grup_id")
      .notNull()
      .references(() => grup.id, { onDelete: "restrict" }),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    keranjangId: uuid("keranjang_id").notNull(),
    peran: text("peran").notNull().default("ANGGOTA"),
    status: text("status").notNull().default("AKTIF"),
    // NULL = belum memilih (dipilih sebelum tagihan terbit, K-25).
    caraKirim: text("cara_kirim"),
    alamatId: uuid("alamat_id").references(() => alamat.id, { onDelete: "restrict" }),
    dropPointId: uuid("drop_point_id").references(() => dropPoint.id, { onDelete: "restrict" }),
    alamatSnapshot: jsonb("alamat_snapshot"), // [PII] salinan alamat saat tagihan terbit
    levelHarga: text("level_harga"),
    pilihanSaatGagal: text("pilihan_saat_gagal").notNull().default("BELUM_MEMILIH"),
    danaDitahan: boolean("dana_ditahan").notNull().default(false), // F-10
    kreditTertahanRp: rupiah("kredit_tertahan_rp").notNull().default(0),
    bergabungPada: ts("bergabung_pada").notNull().defaultNow(),
    diperingatkanPada: ts("diperingatkan_pada"), // K-39: peringatan 5 menit sebelum dikeluarkan
    dikeluarkanPada: ts("dikeluarkan_pada"),
    refPengundangAkunId: uuid("ref_pengundang_akun_id").references(() => akun.id, {
      onDelete: "restrict",
    }), // menunggu F-22
    ...kolomAudit,
  },
  (t) => [
    // Satu akun (unik per nomor HP OTP) hanya sekali hidup per grup (keputusan §3).
    uniqueIndex("peserta_grup_akun_aktif_uk")
      .on(t.grupId, t.akunId)
      .where(sql.raw(`status NOT IN (${daftarSql(STATUS_PESERTA_NONAKTIF)})`)),
    // Satu host hidup per grup (K-33: peran dipindah, bukan ditambah).
    uniqueIndex("peserta_grup_satu_host_uk")
      .on(t.grupId)
      .where(sql.raw(`peran = 'HOST' AND status NOT IN (${daftarSql(STATUS_PESERTA_NONAKTIF)})`)),
    uniqueIndex("peserta_grup_keranjang_uk").on(t.keranjangId),
    foreignKey({
      name: "peserta_grup_keranjang_milik_akun_grup_fk",
      columns: [t.keranjangId, t.akunId, t.grupId],
      foreignColumns: [keranjang.id, keranjang.akunId, keranjang.grupId],
    }).onDelete("restrict"),
    // Target FK komposit invoice_peserta.
    unique("peserta_grup_id_grup_uk").on(t.id, t.grupId),
    check("peserta_peran", dalam("peran", PERAN_PESERTA)),
    check("peserta_status", dalam("status", STATUS_PESERTA)),
    check("peserta_cara_kirim", sql`cara_kirim IS NULL OR ${dalam("cara_kirim", CARA_KIRIM)}`),
    check(
      "peserta_tujuan_kirim_konsisten",
      sql`(cara_kirim IS NULL AND alamat_id IS NULL AND drop_point_id IS NULL)
        OR (cara_kirim = 'ANTAR_RUMAH' AND alamat_id IS NOT NULL AND drop_point_id IS NULL)
        OR (cara_kirim = 'DROP_POINT' AND drop_point_id IS NOT NULL AND alamat_id IS NULL)`,
    ),
    check("peserta_level_harga", sql`level_harga IS NULL OR ${dalam("level_harga", LEVEL_HARGA)}`),
    check("peserta_pilihan_gagal", dalam("pilihan_saat_gagal", PILIHAN_SAAT_GAGAL)),
    check("peserta_kredit_tertahan_nonneg", sql`kredit_tertahan_rp >= 0`),
    check(
      "peserta_dikeluarkan_lengkap",
      sql`status <> 'DIKELUARKAN' OR dikeluarkan_pada IS NOT NULL`,
    ),
    check(
      "peserta_bukan_pengundang_sendiri",
      sql`ref_pengundang_akun_id IS NULL OR ref_pengundang_akun_id <> akun_id`,
    ),
    index("peserta_grup_akun_idx").on(t.akunId),
  ],
);
