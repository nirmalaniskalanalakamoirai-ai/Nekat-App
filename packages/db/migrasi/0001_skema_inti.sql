CREATE TABLE "admin" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"nama" text NOT NULL,
	"nomor_hp_e164" text NOT NULL,
	"totp_rahasia_enc" "bytea",
	"totp_kunci_versi" smallint,
	"totp_aktif_pada" timestamp with time zone,
	"totp_langkah_terakhir" bigint,
	"gagal_beruntun" smallint DEFAULT 0 NOT NULL,
	"dikunci_sampai" timestamp with time zone,
	"status" text DEFAULT 'AKTIF' NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_nomor_hp_format" CHECK (nomor_hp_e164 ~ '^\+62[0-9]{8,13}$'),
	CONSTRAINT "admin_status" CHECK (status IN ('AKTIF', 'NONAKTIF')),
	CONSTRAINT "admin_totp_aktif_butuh_rahasia" CHECK (totp_aktif_pada IS NULL OR (totp_rahasia_enc IS NOT NULL AND totp_kunci_versi IS NOT NULL)),
	CONSTRAINT "admin_gagal_nonneg" CHECK (gagal_beruntun >= 0)
);
--> statement-breakpoint
CREATE TABLE "admin_peran" (
	"admin_id" uuid NOT NULL,
	"peran_kode" text NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_peran_admin_id_peran_kode_pk" PRIMARY KEY("admin_id","peran_kode")
);
--> statement-breakpoint
CREATE TABLE "akun" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"nomor_hp_e164" text,
	"hp_hmac" "bytea" NOT NULL,
	"hp_hmac_kunci_versi" smallint NOT NULL,
	"hp_terverifikasi_pada" timestamp with time zone NOT NULL,
	"hp_diganti_pada" timestamp with time zone,
	"nama_panggilan" text,
	"jenis_pelanggan" text DEFAULT 'PERORANGAN' NOT NULL,
	"status" text DEFAULT 'AKTIF' NOT NULL,
	"dibekukan_alasan" text,
	"dianonimkan_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "akun_nomor_hp_format" CHECK (nomor_hp_e164 IS NULL OR nomor_hp_e164 ~ '^\+62[0-9]{8,13}$'),
	CONSTRAINT "akun_nama_panggilan_panjang" CHECK (nama_panggilan IS NULL OR char_length(nama_panggilan) BETWEEN 1 AND 40),
	CONSTRAINT "akun_jenis_pelanggan" CHECK (jenis_pelanggan IN ('PERORANGAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "akun_status" CHECK (status IN ('AKTIF', 'DIBEKUKAN', 'DIHAPUS')),
	CONSTRAINT "akun_dibekukan_alasan" CHECK (status <> 'DIBEKUKAN' OR dibekukan_alasan IS NOT NULL),
	CONSTRAINT "akun_hp_wajib_kecuali_anonim" CHECK (nomor_hp_e164 IS NOT NULL OR dianonimkan_pada IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "alamat" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"akun_id" uuid NOT NULL,
	"zona_id" uuid,
	"label" text,
	"alamat_teks" text,
	"patokan" text,
	"catatan_kurir" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"dihapus_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alamat_lat" CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
	CONSTRAINT "alamat_lng" CHECK (lng IS NULL OR lng BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "dokumen_legal" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"jenis" text NOT NULL,
	"versi" text NOT NULL,
	"hash_isi" "bytea" NOT NULL,
	"berlaku_mulai" timestamp with time zone NOT NULL,
	"wajib_setuju_ulang" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokumen_legal_jenis" CHECK (jenis IN ('SYARAT_KETENTUAN', 'KEBIJAKAN_PRIVASI'))
);
--> statement-breakpoint
CREATE TABLE "izin" (
	"kode" text PRIMARY KEY NOT NULL,
	"keterangan" text NOT NULL,
	CONSTRAINT "izin_pola" CHECK (kode ~ '^[a-z_]+\.[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "kode_pemulihan_totp" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"admin_id" uuid NOT NULL,
	"kode_hash" "bytea" NOT NULL,
	"dipakai_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_gagal_harian" (
	"hp_hmac" "bytea" NOT NULL,
	"tanggal" date NOT NULL,
	"gagal" integer DEFAULT 0 NOT NULL,
	"kirim" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "otp_gagal_harian_hp_hmac_tanggal_pk" PRIMARY KEY("hp_hmac","tanggal"),
	CONSTRAINT "otp_gagal_nonneg" CHECK (gagal >= 0 AND kirim >= 0)
);
--> statement-breakpoint
CREATE TABLE "otp_permintaan" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"hp_hmac" "bytea" NOT NULL,
	"tujuan" text NOT NULL,
	"kode_hmac" "bytea" NOT NULL,
	"kode_kunci_versi" smallint NOT NULL,
	"percobaan" smallint DEFAULT 0 NOT NULL,
	"kedaluwarsa_pada" timestamp with time zone NOT NULL,
	"terpakai_pada" timestamp with time zone,
	"digantikan_pada" timestamp with time zone,
	"ip_hmac" "bytea",
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_tujuan" CHECK (tujuan IN ('LOGIN_PEMBELI', 'LOGIN_ADMIN')),
	CONSTRAINT "otp_percobaan" CHECK (percobaan >= 0),
	CONSTRAINT "otp_terpakai_sebelum_kedaluwarsa" CHECK (terpakai_pada IS NULL OR terpakai_pada <= kedaluwarsa_pada)
);
--> statement-breakpoint
CREATE TABLE "peran" (
	"kode" text PRIMARY KEY NOT NULL,
	"nama" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peran_izin" (
	"peran_kode" text NOT NULL,
	"izin_kode" text NOT NULL,
	CONSTRAINT "peran_izin_peran_kode_izin_kode_pk" PRIMARY KEY("peran_kode","izin_kode")
);
--> statement-breakpoint
CREATE TABLE "persetujuan_legal" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"akun_id" uuid NOT NULL,
	"dokumen_legal_id" uuid NOT NULL,
	"disetujui_pada" timestamp with time zone NOT NULL,
	"kanal" text NOT NULL,
	"ip_hmac" "bytea",
	"user_agent_ringkas" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persetujuan_kanal" CHECK (kanal IN ('PWA', 'APP'))
);
--> statement-breakpoint
CREATE TABLE "sesi" (
	"id_hash" "bytea" PRIMARY KEY NOT NULL,
	"akun_id" uuid,
	"admin_id" uuid,
	"faktor_kedua_pada" timestamp with time zone,
	"reauth_pada" timestamp with time zone,
	"kedaluwarsa_pada" timestamp with time zone NOT NULL,
	"dicabut_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sesi_satu_pemilik" CHECK (num_nonnulls(akun_id, admin_id) = 1)
);
--> statement-breakpoint
CREATE TABLE "harga_level" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"satuan_jual_id" uuid NOT NULL,
	"level" text NOT NULL,
	"mode" text NOT NULL,
	"margin_persen" numeric(9, 4),
	"harga_jual_rp" bigint,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harga_level_level" CHECK (level IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "harga_level_mode" CHECK (mode IN ('PERSEN', 'RUPIAH')),
	CONSTRAINT "harga_level_margin_positif" CHECK (margin_persen IS NULL OR margin_persen > 0),
	CONSTRAINT "harga_level_harga_positif" CHECK (harga_jual_rp IS NULL OR harga_jual_rp > 0),
	CONSTRAINT "harga_level_mode_konsisten" CHECK ((mode = 'PERSEN' AND harga_jual_rp IS NULL) OR (mode = 'RUPIAH' AND margin_persen IS NULL))
);
--> statement-breakpoint
CREATE TABLE "harga_terhitung" (
	"satuan_jual_id" uuid NOT NULL,
	"level" text NOT NULL,
	"modal_rp" bigint NOT NULL,
	"harga_rp" bigint NOT NULL,
	"versi_harga" text NOT NULL,
	"dihitung_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harga_terhitung_satuan_jual_id_level_pk" PRIMARY KEY("satuan_jual_id","level"),
	CONSTRAINT "harga_terhitung_level" CHECK (level IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "harga_terhitung_di_atas_modal" CHECK (modal_rp > 0 AND harga_rp > modal_rp)
);
--> statement-breakpoint
CREATE TABLE "kategori" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"induk_id" uuid,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"urutan" integer DEFAULT 0 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kategori_kode_format" CHECK (kode ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "kategori_bukan_induk_sendiri" CHECK (induk_id IS NULL OR induk_id <> id)
);
--> statement-breakpoint
CREATE TABLE "modal_satuan_jual" (
	"satuan_jual_id" uuid PRIMARY KEY NOT NULL,
	"modal_rp" bigint,
	"sumber" text NOT NULL,
	"modal_gudang_rp" bigint,
	"data_pada" timestamp with time zone,
	"disinkron_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modal_positif" CHECK (modal_rp IS NULL OR modal_rp > 0),
	CONSTRAINT "modal_gudang_positif" CHECK (modal_gudang_rp IS NULL OR modal_gudang_rp > 0),
	CONSTRAINT "modal_sumber" CHECK (sumber IN ('MANUAL', 'GUDANG'))
);
--> statement-breakpoint
CREATE TABLE "modal_timpaan" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"satuan_jual_id" uuid NOT NULL,
	"modal_rp" bigint NOT NULL,
	"catatan" text NOT NULL,
	"kedaluwarsa_pada" date,
	"notifikasi_dikirim_pada" timestamp with time zone,
	"dibuat_oleh" uuid NOT NULL,
	"dicabut_oleh" uuid,
	"dicabut_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timpaan_modal_positif" CHECK (modal_rp > 0),
	CONSTRAINT "timpaan_catatan_wajib" CHECK (char_length(btrim(catatan)) > 0),
	CONSTRAINT "timpaan_dicabut_konsisten" CHECK ((dicabut_pada IS NULL) = (dicabut_oleh IS NULL))
);
--> statement-breakpoint
CREATE TABLE "pemetaan_sku_sumber" (
	"sku_id" uuid PRIMARY KEY NOT NULL,
	"sku_sumber_id" text NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "produk" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"kategori_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"deskripsi" text,
	"gambar_url" text,
	"bebas_ppn" boolean DEFAULT false NOT NULL,
	"tinjauan_kategori" text DEFAULT 'TIDAK_PERLU' NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produk_nama_panjang" CHECK (char_length(nama) BETWEEN 1 AND 200),
	CONSTRAINT "produk_tinjauan_kategori" CHECK (tinjauan_kategori IN ('TIDAK_PERLU', 'MENUNGGU', 'DISETUJUI'))
);
--> statement-breakpoint
CREATE TABLE "satuan_jual" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"sku_id" uuid NOT NULL,
	"jenis" text NOT NULL,
	"isi_satuan_dasar" integer NOT NULL,
	"berat_gram" integer NOT NULL,
	"moq_mitra_grosir" integer,
	"boleh_grup" boolean DEFAULT true NOT NULL,
	"tayang" boolean DEFAULT false NOT NULL,
	"alasan_tidak_tayang" text[] DEFAULT '{}'::text[] NOT NULL,
	"versi_harga" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "satuan_jual_jenis" CHECK (jenis IN ('PCS_1', 'PCS_3', 'LUSIN', 'DUS', 'KOLI')),
	CONSTRAINT "satuan_jual_isi_positif" CHECK (isi_satuan_dasar > 0),
	CONSTRAINT "satuan_jual_isi_kanonik" CHECK ((jenis = 'PCS_1' AND isi_satuan_dasar = 1) OR (jenis = 'PCS_3' AND isi_satuan_dasar = 3) OR (jenis = 'LUSIN' AND isi_satuan_dasar = 12) OR jenis IN ('DUS', 'KOLI')),
	CONSTRAINT "satuan_jual_berat" CHECK (berat_gram >= 0),
	CONSTRAINT "satuan_jual_moq" CHECK (moq_mitra_grosir IS NULL OR moq_mitra_grosir > 0),
	CONSTRAINT "satuan_jual_tayang_konsisten" CHECK (NOT tayang OR cardinality(alasan_tidak_tayang) = 0)
);
--> statement-breakpoint
CREATE TABLE "sku" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"produk_id" uuid NOT NULL,
	"kode_sku" text NOT NULL,
	"barcode" text,
	"nama_varian" text,
	"satuan_dasar" text NOT NULL,
	"aktif_di_sumber" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_satuan_dasar" CHECK (satuan_dasar IN ('pcs', 'gram', 'ml'))
);
--> statement-breakpoint
CREATE TABLE "stok_lokasi" (
	"sku_id" uuid NOT NULL,
	"gudang_id" uuid NOT NULL,
	"tersedia" bigint NOT NULL,
	"data_pada" timestamp with time zone NOT NULL,
	"disinkron_pada" timestamp with time zone NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stok_lokasi_sku_id_gudang_id_pk" PRIMARY KEY("sku_id","gudang_id"),
	CONSTRAINT "stok_tersedia_nonneg" CHECK (tersedia >= 0)
);
--> statement-breakpoint
CREATE TABLE "drop_point" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"kode_konfig" text NOT NULL,
	"zona_id" uuid NOT NULL,
	"gudang_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"alamat_publik" text,
	"jam_ambil" text,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gudang" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"kode_konfig" text NOT NULL,
	"nama" text NOT NULL,
	"jenis" text NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gudang_jenis" CHECK (jenis IN ('PUSAT', 'CABANG'))
);
--> statement-breakpoint
CREATE TABLE "slot_kirim" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"zona_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"mulai" time NOT NULL,
	"selesai" time NOT NULL,
	"cut_off_pada" timestamp with time zone NOT NULL,
	"kapasitas_gram" bigint,
	"status" text DEFAULT 'DIBUKA' NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_selesai_setelah_mulai" CHECK (selesai > mulai),
	CONSTRAINT "slot_cutoff_sebelum_mulai" CHECK (cut_off_pada < ((tanggal + mulai) AT TIME ZONE 'Asia/Jakarta')),
	CONSTRAINT "slot_kapasitas" CHECK (kapasitas_gram IS NULL OR kapasitas_gram > 0),
	CONSTRAINT "slot_status" CHECK (status IN ('DIBUKA', 'DITUTUP', 'DIBATALKAN'))
);
--> statement-breakpoint
CREATE TABLE "zona" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"kode_konfig" text NOT NULL,
	"nama_kelurahan" text NOT NULL,
	"drop_point_pusat_id" uuid,
	"gudang_id" uuid NOT NULL,
	"aktif" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zona_aktif_butuh_drop_point" CHECK (NOT aktif OR drop_point_pusat_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "antrean_tinjauan" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"jenis" text NOT NULL,
	"entitas_jenis" text NOT NULL,
	"entitas_id" uuid NOT NULL,
	"data" jsonb,
	"status" text DEFAULT 'TERBUKA' NOT NULL,
	"ditangani_oleh" uuid,
	"catatan" text,
	"selesai_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tinjauan_jenis" CHECK (jenis IN ('MODAL_PECAHAN', 'HARGA_PECAHAN', 'INVOICE_FINAL_BELUM_LUNAS', 'KATEGORI', 'SKU_BELUM_DIPETAKAN', 'TIMPAAN_KEDALUWARSA', 'GRUP_DITAHAN', 'DANA_DITAHAN', 'PEMBAYARAN_YATIM', 'NOMINAL_TIDAK_COCOK', 'PICKING_GAGAL', 'KONFLIK_IDEMPOTENSI')),
	CONSTRAINT "tinjauan_status" CHECK (status IN ('TERBUKA', 'SELESAI', 'DIABAIKAN')),
	CONSTRAINT "tinjauan_ditutup_lengkap" CHECK (status = 'TERBUKA' OR (selesai_pada IS NOT NULL AND ditangani_oleh IS NOT NULL AND catatan IS NOT NULL AND char_length(btrim(catatan)) > 0))
);
--> statement-breakpoint
CREATE TABLE "konfigurasi" (
	"kunci" text PRIMARY KEY NOT NULL,
	"nilai" jsonb,
	"diubah_oleh" uuid,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "konfigurasi_kunci_format" CHECK (kunci ~ '^[a-z_]+(\.[a-z_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "log_admin" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"izin_kode" text NOT NULL,
	"entitas_jenis" text NOT NULL,
	"entitas_id" text,
	"sebelum" jsonb,
	"sesudah" jsonb,
	"alasan" text,
	"ip_hmac" "bytea",
	"waktu" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"jenis" text NOT NULL,
	"aktor" text NOT NULL,
	"ref_jenis" text,
	"ref_id" text,
	"data" jsonb,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "log_audit_aktor" CHECK (aktor IN ('SISTEM', 'PENGGUNA', 'ADMIN'))
);
--> statement-breakpoint
ALTER TABLE "admin_peran" ADD CONSTRAINT "admin_peran_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_peran" ADD CONSTRAINT "admin_peran_peran_kode_peran_kode_fk" FOREIGN KEY ("peran_kode") REFERENCES "public"."peran"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alamat" ADD CONSTRAINT "alamat_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alamat" ADD CONSTRAINT "alamat_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kode_pemulihan_totp" ADD CONSTRAINT "kode_pemulihan_totp_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peran_izin" ADD CONSTRAINT "peran_izin_peran_kode_peran_kode_fk" FOREIGN KEY ("peran_kode") REFERENCES "public"."peran"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peran_izin" ADD CONSTRAINT "peran_izin_izin_kode_izin_kode_fk" FOREIGN KEY ("izin_kode") REFERENCES "public"."izin"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persetujuan_legal" ADD CONSTRAINT "persetujuan_legal_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persetujuan_legal" ADD CONSTRAINT "persetujuan_legal_dokumen_legal_id_dokumen_legal_id_fk" FOREIGN KEY ("dokumen_legal_id") REFERENCES "public"."dokumen_legal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesi" ADD CONSTRAINT "sesi_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesi" ADD CONSTRAINT "sesi_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harga_level" ADD CONSTRAINT "harga_level_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harga_terhitung" ADD CONSTRAINT "harga_terhitung_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_satuan_jual" ADD CONSTRAINT "modal_satuan_jual_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_timpaan" ADD CONSTRAINT "modal_timpaan_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_timpaan" ADD CONSTRAINT "modal_timpaan_dibuat_oleh_admin_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_timpaan" ADD CONSTRAINT "modal_timpaan_dicabut_oleh_admin_id_fk" FOREIGN KEY ("dicabut_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemetaan_sku_sumber" ADD CONSTRAINT "pemetaan_sku_sumber_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produk" ADD CONSTRAINT "produk_kategori_id_kategori_id_fk" FOREIGN KEY ("kategori_id") REFERENCES "public"."kategori"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satuan_jual" ADD CONSTRAINT "satuan_jual_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku" ADD CONSTRAINT "sku_produk_id_produk_id_fk" FOREIGN KEY ("produk_id") REFERENCES "public"."produk"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stok_lokasi" ADD CONSTRAINT "stok_lokasi_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stok_lokasi" ADD CONSTRAINT "stok_lokasi_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_point" ADD CONSTRAINT "drop_point_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_point" ADD CONSTRAINT "drop_point_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_kirim" ADD CONSTRAINT "slot_kirim_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zona" ADD CONSTRAINT "zona_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "antrean_tinjauan" ADD CONSTRAINT "antrean_tinjauan_ditangani_oleh_admin_id_fk" FOREIGN KEY ("ditangani_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "konfigurasi" ADD CONSTRAINT "konfigurasi_diubah_oleh_admin_id_fk" FOREIGN KEY ("diubah_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_admin" ADD CONSTRAINT "log_admin_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_nomor_hp_uk" ON "admin" USING btree ("nomor_hp_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "akun_nomor_hp_uk" ON "akun" USING btree ("nomor_hp_e164") WHERE nomor_hp_e164 IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "akun_hp_hmac_uk" ON "akun" USING btree ("hp_hmac");--> statement-breakpoint
CREATE INDEX "alamat_akun_idx" ON "alamat" USING btree ("akun_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dokumen_legal_jenis_versi_uk" ON "dokumen_legal" USING btree ("jenis","versi");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_satu_hidup_uk" ON "otp_permintaan" USING btree ("hp_hmac","tujuan") WHERE terpakai_pada IS NULL AND digantikan_pada IS NULL;--> statement-breakpoint
CREATE INDEX "otp_hp_waktu_idx" ON "otp_permintaan" USING btree ("hp_hmac","dibuat_pada" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "persetujuan_akun_dokumen_uk" ON "persetujuan_legal" USING btree ("akun_id","dokumen_legal_id");--> statement-breakpoint
CREATE INDEX "sesi_akun_idx" ON "sesi" USING btree ("akun_id");--> statement-breakpoint
CREATE INDEX "sesi_admin_idx" ON "sesi" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harga_level_uk" ON "harga_level" USING btree ("satuan_jual_id","level");--> statement-breakpoint
CREATE UNIQUE INDEX "kategori_kode_uk" ON "kategori" USING btree ("kode");--> statement-breakpoint
CREATE INDEX "kategori_induk_idx" ON "kategori" USING btree ("induk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timpaan_satu_aktif_uk" ON "modal_timpaan" USING btree ("satuan_jual_id") WHERE dicabut_pada IS NULL;--> statement-breakpoint
CREATE INDEX "timpaan_kedaluwarsa_idx" ON "modal_timpaan" USING btree ("kedaluwarsa_pada") WHERE dicabut_pada IS NULL AND notifikasi_dikirim_pada IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pemetaan_sku_sumber_uk" ON "pemetaan_sku_sumber" USING btree ("sku_sumber_id");--> statement-breakpoint
CREATE INDEX "produk_kategori_idx" ON "produk" USING btree ("kategori_id");--> statement-breakpoint
CREATE UNIQUE INDEX "satuan_jual_sku_jenis_uk" ON "satuan_jual" USING btree ("sku_id","jenis");--> statement-breakpoint
CREATE INDEX "satuan_jual_tayang_idx" ON "satuan_jual" USING btree ("tayang") WHERE tayang;--> statement-breakpoint
CREATE UNIQUE INDEX "sku_kode_uk" ON "sku" USING btree ("kode_sku");--> statement-breakpoint
CREATE INDEX "sku_barcode_idx" ON "sku" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "sku_produk_idx" ON "sku" USING btree ("produk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drop_point_kode_konfig_uk" ON "drop_point" USING btree ("kode_konfig");--> statement-breakpoint
CREATE INDEX "drop_point_zona_idx" ON "drop_point" USING btree ("zona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gudang_kode_konfig_uk" ON "gudang" USING btree ("kode_konfig");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_zona_tanggal_mulai_uk" ON "slot_kirim" USING btree ("zona_id","tanggal","mulai");--> statement-breakpoint
CREATE INDEX "slot_cutoff_dibuka_idx" ON "slot_kirim" USING btree ("cut_off_pada") WHERE status = 'DIBUKA';--> statement-breakpoint
CREATE UNIQUE INDEX "zona_kode_konfig_uk" ON "zona" USING btree ("kode_konfig");--> statement-breakpoint
CREATE UNIQUE INDEX "tinjauan_terbuka_uk" ON "antrean_tinjauan" USING btree ("jenis","entitas_jenis","entitas_id") WHERE status = 'TERBUKA';--> statement-breakpoint
CREATE INDEX "tinjauan_status_idx" ON "antrean_tinjauan" USING btree ("status","jenis","dibuat_pada");--> statement-breakpoint
CREATE INDEX "log_admin_entitas_idx" ON "log_admin" USING btree ("entitas_jenis","entitas_id","waktu" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "log_admin_admin_idx" ON "log_admin" USING btree ("admin_id","waktu" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "log_audit_ref_idx" ON "log_audit" USING btree ("ref_jenis","ref_id");