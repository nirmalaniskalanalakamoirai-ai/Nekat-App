CREATE TABLE "admin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"nomor_hp_e164" text NOT NULL,
	"totp_rahasia_enc" "bytea",
	"kunci_versi" smallint,
	"totp_aktif_pada" timestamp with time zone,
	"totp_langkah_terakhir" bigint,
	"gagal_beruntun" smallint DEFAULT 0 NOT NULL,
	"dikunci_sampai" timestamp with time zone,
	"status" text DEFAULT 'AKTIF' NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_nomor_hp_format" CHECK ("admin"."nomor_hp_e164" ~ '^\+62[0-9]{8,13}$'),
	CONSTRAINT "admin_status" CHECK ("status" IN ('AKTIF', 'NONAKTIF')),
	CONSTRAINT "admin_gagal_nonneg" CHECK ("admin"."gagal_beruntun" >= 0)
);
--> statement-breakpoint
CREATE TABLE "admin_peran" (
	"admin_id" uuid NOT NULL,
	"peran_kode" text NOT NULL,
	CONSTRAINT "admin_peran_admin_id_peran_kode_pk" PRIMARY KEY("admin_id","peran_kode")
);
--> statement-breakpoint
CREATE TABLE "izin" (
	"kode" text PRIMARY KEY NOT NULL,
	"keterangan" text NOT NULL,
	CONSTRAINT "izin_pola" CHECK ("izin"."kode" ~ '^[a-z_]+\.[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "kode_pemulihan_totp" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"kode_hash" "bytea" NOT NULL,
	"dipakai_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "akun" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nomor_hp_e164" text,
	"hp_hmac" "bytea" NOT NULL,
	"kunci_versi" smallint NOT NULL,
	"hp_terverifikasi_pada" timestamp with time zone NOT NULL,
	"hp_diganti_pada" timestamp with time zone,
	"nama_panggilan" text,
	"jenis_pelanggan" text DEFAULT 'PERORANGAN' NOT NULL,
	"status" text DEFAULT 'AKTIF' NOT NULL,
	"dibekukan_alasan" text,
	"dianonimkan_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "akun_nomor_hp_format" CHECK ("akun"."nomor_hp_e164" IS NULL OR "akun"."nomor_hp_e164" ~ '^\+62[0-9]{8,13}$'),
	CONSTRAINT "akun_nama_panggilan_panjang" CHECK ("akun"."nama_panggilan" IS NULL OR char_length("akun"."nama_panggilan") BETWEEN 1 AND 40),
	CONSTRAINT "akun_jenis_pelanggan" CHECK ("jenis_pelanggan" IN ('PERORANGAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "akun_status" CHECK ("status" IN ('AKTIF', 'DIBEKUKAN', 'DIHAPUS')),
	CONSTRAINT "akun_dibekukan_alasan" CHECK ("akun"."status" <> 'DIBEKUKAN' OR "akun"."dibekukan_alasan" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "alamat" (
	"id" uuid PRIMARY KEY NOT NULL,
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
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_gagal_harian" (
	"hp_hmac" "bytea" NOT NULL,
	"tanggal" date NOT NULL,
	"gagal" integer DEFAULT 0 NOT NULL,
	"kirim" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "otp_gagal_harian_hp_hmac_tanggal_pk" PRIMARY KEY("hp_hmac","tanggal"),
	CONSTRAINT "otp_gagal_nonneg" CHECK ("otp_gagal_harian"."gagal" >= 0 AND "otp_gagal_harian"."kirim" >= 0)
);
--> statement-breakpoint
CREATE TABLE "otp_permintaan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hp_hmac" "bytea" NOT NULL,
	"tujuan" text NOT NULL,
	"kode_hmac" "bytea" NOT NULL,
	"kunci_versi" smallint NOT NULL,
	"percobaan" smallint DEFAULT 0 NOT NULL,
	"kedaluwarsa_pada" timestamp with time zone NOT NULL,
	"terpakai_pada" timestamp with time zone,
	"digantikan_pada" timestamp with time zone,
	"ip_hmac" "bytea",
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_tujuan" CHECK ("tujuan" IN ('LOGIN_PEMBELI', 'LOGIN_ADMIN')),
	CONSTRAINT "otp_percobaan" CHECK ("otp_permintaan"."percobaan" >= 0),
	CONSTRAINT "otp_terpakai_sebelum_kedaluwarsa" CHECK ("otp_permintaan"."terpakai_pada" IS NULL OR "otp_permintaan"."terpakai_pada" <= "otp_permintaan"."kedaluwarsa_pada")
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
	CONSTRAINT "sesi_satu_pemilik" CHECK (num_nonnulls("sesi"."akun_id", "sesi"."admin_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "harga_level" (
	"id" uuid PRIMARY KEY NOT NULL,
	"satuan_jual_id" uuid NOT NULL,
	"level" text NOT NULL,
	"mode" text NOT NULL,
	"margin_persen" numeric(9, 4),
	"harga_jual_rp" bigint,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harga_level_level" CHECK ("level" IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "harga_level_mode" CHECK ("mode" IN ('PERSEN', 'RUPIAH')),
	CONSTRAINT "harga_level_margin_positif" CHECK ("harga_level"."margin_persen" IS NULL OR "harga_level"."margin_persen" > 0),
	CONSTRAINT "harga_level_harga_positif" CHECK ("harga_level"."harga_jual_rp" IS NULL OR "harga_level"."harga_jual_rp" > 0),
	CONSTRAINT "harga_level_mode_konsisten" CHECK (("harga_level"."mode" = 'PERSEN' AND "harga_level"."harga_jual_rp" IS NULL) OR ("harga_level"."mode" = 'RUPIAH' AND "harga_level"."margin_persen" IS NULL))
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
	CONSTRAINT "harga_terhitung_level" CHECK ("level" IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "harga_terhitung_di_atas_modal" CHECK ("harga_terhitung"."modal_rp" > 0 AND "harga_terhitung"."harga_rp" > "harga_terhitung"."modal_rp")
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
	CONSTRAINT "modal_positif" CHECK ("modal_satuan_jual"."modal_rp" IS NULL OR "modal_satuan_jual"."modal_rp" > 0),
	CONSTRAINT "modal_gudang_positif" CHECK ("modal_satuan_jual"."modal_gudang_rp" IS NULL OR "modal_satuan_jual"."modal_gudang_rp" > 0),
	CONSTRAINT "modal_sumber" CHECK ("sumber" IN ('MANUAL', 'GUDANG'))
);
--> statement-breakpoint
CREATE TABLE "modal_timpaan" (
	"id" uuid PRIMARY KEY NOT NULL,
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
	CONSTRAINT "modal_timpaan_positif" CHECK ("modal_timpaan"."modal_rp" > 0),
	CONSTRAINT "modal_timpaan_catatan" CHECK (char_length(trim("modal_timpaan"."catatan")) > 0)
);
--> statement-breakpoint
CREATE TABLE "stok_lokasi" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sku_id" uuid NOT NULL,
	"gudang_id" uuid NOT NULL,
	"tersedia" bigint DEFAULT 0 NOT NULL,
	"data_pada" timestamp with time zone,
	"disinkron_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stok_lokasi_nonneg" CHECK ("stok_lokasi"."tersedia" >= 0)
);
--> statement-breakpoint
CREATE TABLE "kategori" (
	"id" uuid PRIMARY KEY NOT NULL,
	"induk_id" uuid,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"urutan" integer DEFAULT 0 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kategori_kode_unique" UNIQUE("kode"),
	CONSTRAINT "kategori_bukan_induk_sendiri" CHECK ("kategori"."induk_id" IS NULL OR "kategori"."induk_id" <> "kategori"."id"),
	CONSTRAINT "kategori_kode_format" CHECK ("kategori"."kode" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "pemetaan_sku_sumber" (
	"sku_id" uuid PRIMARY KEY NOT NULL,
	"sku_sumber_id" text NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pemetaan_sku_sumber_sku_sumber_id_unique" UNIQUE("sku_sumber_id")
);
--> statement-breakpoint
CREATE TABLE "produk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kategori_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"deskripsi" text,
	"gambar_url" text,
	"bebas_ppn" boolean DEFAULT false NOT NULL,
	"tinjauan_kategori" text DEFAULT 'TIDAK_PERLU' NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produk_nama_panjang" CHECK (char_length("produk"."nama") BETWEEN 1 AND 200),
	CONSTRAINT "produk_tinjauan_kategori" CHECK ("tinjauan_kategori" IN ('TIDAK_PERLU', 'MENUNGGU', 'DISETUJUI'))
);
--> statement-breakpoint
CREATE TABLE "satuan_jual" (
	"id" uuid PRIMARY KEY NOT NULL,
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
	CONSTRAINT "satuan_jual_jenis" CHECK ("jenis" IN ('PCS_1', 'PCS_3', 'LUSIN', 'DUS', 'KOLI')),
	CONSTRAINT "satuan_jual_isi_positif" CHECK ("satuan_jual"."isi_satuan_dasar" > 0),
	CONSTRAINT "satuan_jual_isi_sesuai_jenis" CHECK (("satuan_jual"."jenis" = 'PCS_1' AND "satuan_jual"."isi_satuan_dasar" = 1) OR ("satuan_jual"."jenis" = 'PCS_3' AND "satuan_jual"."isi_satuan_dasar" = 3) OR ("satuan_jual"."jenis" = 'LUSIN' AND "satuan_jual"."isi_satuan_dasar" = 12) OR "satuan_jual"."jenis" IN ('DUS', 'KOLI')),
	CONSTRAINT "satuan_jual_berat" CHECK ("satuan_jual"."berat_gram" >= 0),
	CONSTRAINT "satuan_jual_moq" CHECK ("satuan_jual"."moq_mitra_grosir" IS NULL OR "satuan_jual"."moq_mitra_grosir" > 0),
	CONSTRAINT "satuan_jual_tayang_tanpa_alasan" CHECK (NOT "satuan_jual"."tayang" OR cardinality("satuan_jual"."alasan_tidak_tayang") = 0)
);
--> statement-breakpoint
CREATE TABLE "sku" (
	"id" uuid PRIMARY KEY NOT NULL,
	"produk_id" uuid NOT NULL,
	"kode_sku" text NOT NULL,
	"barcode" text,
	"nama_varian" text,
	"satuan_dasar" text NOT NULL,
	"aktif_di_sumber" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_kode_sku_unique" UNIQUE("kode_sku"),
	CONSTRAINT "sku_satuan_dasar" CHECK ("satuan_dasar" IN ('pcs', 'gram', 'ml'))
);
--> statement-breakpoint
CREATE TABLE "dokumen_legal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jenis" text NOT NULL,
	"versi" text NOT NULL,
	"hash_isi" "bytea" NOT NULL,
	"berlaku_mulai" timestamp with time zone NOT NULL,
	"wajib_setuju_ulang" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokumen_legal_jenis" CHECK ("jenis" IN ('SYARAT_KETENTUAN', 'KEBIJAKAN_PRIVASI'))
);
--> statement-breakpoint
CREATE TABLE "persetujuan_legal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"akun_id" uuid NOT NULL,
	"dokumen_legal_id" uuid NOT NULL,
	"disetujui_pada" timestamp with time zone NOT NULL,
	"kanal" text NOT NULL,
	"ip_hmac" "bytea",
	"user_agent_ringkas" text,
	CONSTRAINT "persetujuan_legal_kanal" CHECK ("kanal" IN ('PWA', 'APP'))
);
--> statement-breakpoint
CREATE TABLE "drop_point" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kode_konfig" text NOT NULL,
	"zona_id" uuid NOT NULL,
	"gudang_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"alamat_publik" text,
	"jam_ambil" text,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drop_point_kode_konfig_unique" UNIQUE("kode_konfig")
);
--> statement-breakpoint
CREATE TABLE "gudang" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kode_konfig" text NOT NULL,
	"nama" text NOT NULL,
	"jenis" text NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gudang_kode_konfig_unique" UNIQUE("kode_konfig"),
	CONSTRAINT "gudang_jenis" CHECK ("jenis" IN ('PUSAT', 'CABANG'))
);
--> statement-breakpoint
CREATE TABLE "slot_kirim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zona_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"mulai" time NOT NULL,
	"selesai" time NOT NULL,
	"cut_off_pada" timestamp with time zone NOT NULL,
	"kapasitas_gram" bigint,
	"status" text DEFAULT 'DIBUKA' NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_kirim_jam" CHECK ("slot_kirim"."selesai" > "slot_kirim"."mulai"),
	CONSTRAINT "slot_kirim_kapasitas" CHECK ("slot_kirim"."kapasitas_gram" IS NULL OR "slot_kirim"."kapasitas_gram" > 0),
	CONSTRAINT "slot_kirim_status" CHECK ("status" IN ('DIBUKA', 'DITUTUP', 'DIBATALKAN'))
);
--> statement-breakpoint
CREATE TABLE "zona" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kode_konfig" text NOT NULL,
	"nama_kelurahan" text NOT NULL,
	"drop_point_pusat_id" uuid,
	"gudang_id" uuid NOT NULL,
	"aktif" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zona_kode_konfig_unique" UNIQUE("kode_konfig"),
	CONSTRAINT "zona_aktif_wajib_drop_point" CHECK (NOT "zona"."aktif" OR "zona"."drop_point_pusat_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "admin_peran" ADD CONSTRAINT "admin_peran_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_peran" ADD CONSTRAINT "admin_peran_peran_kode_peran_kode_fk" FOREIGN KEY ("peran_kode") REFERENCES "public"."peran"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kode_pemulihan_totp" ADD CONSTRAINT "kode_pemulihan_totp_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peran_izin" ADD CONSTRAINT "peran_izin_peran_kode_peran_kode_fk" FOREIGN KEY ("peran_kode") REFERENCES "public"."peran"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peran_izin" ADD CONSTRAINT "peran_izin_izin_kode_izin_kode_fk" FOREIGN KEY ("izin_kode") REFERENCES "public"."izin"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alamat" ADD CONSTRAINT "alamat_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alamat" ADD CONSTRAINT "alamat_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesi" ADD CONSTRAINT "sesi_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesi" ADD CONSTRAINT "sesi_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harga_level" ADD CONSTRAINT "harga_level_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harga_terhitung" ADD CONSTRAINT "harga_terhitung_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_satuan_jual" ADD CONSTRAINT "modal_satuan_jual_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_timpaan" ADD CONSTRAINT "modal_timpaan_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_timpaan" ADD CONSTRAINT "modal_timpaan_dibuat_oleh_admin_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modal_timpaan" ADD CONSTRAINT "modal_timpaan_dicabut_oleh_admin_id_fk" FOREIGN KEY ("dicabut_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stok_lokasi" ADD CONSTRAINT "stok_lokasi_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stok_lokasi" ADD CONSTRAINT "stok_lokasi_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kategori" ADD CONSTRAINT "kategori_induk_id_kategori_id_fk" FOREIGN KEY ("induk_id") REFERENCES "public"."kategori"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemetaan_sku_sumber" ADD CONSTRAINT "pemetaan_sku_sumber_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produk" ADD CONSTRAINT "produk_kategori_id_kategori_id_fk" FOREIGN KEY ("kategori_id") REFERENCES "public"."kategori"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satuan_jual" ADD CONSTRAINT "satuan_jual_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku" ADD CONSTRAINT "sku_produk_id_produk_id_fk" FOREIGN KEY ("produk_id") REFERENCES "public"."produk"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persetujuan_legal" ADD CONSTRAINT "persetujuan_legal_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persetujuan_legal" ADD CONSTRAINT "persetujuan_legal_dokumen_legal_id_dokumen_legal_id_fk" FOREIGN KEY ("dokumen_legal_id") REFERENCES "public"."dokumen_legal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_point" ADD CONSTRAINT "drop_point_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_point" ADD CONSTRAINT "drop_point_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_kirim" ADD CONSTRAINT "slot_kirim_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zona" ADD CONSTRAINT "zona_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_nomor_hp_uk" ON "admin" USING btree ("nomor_hp_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "akun_nomor_hp_uk" ON "akun" USING btree ("nomor_hp_e164") WHERE "akun"."nomor_hp_e164" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "akun_hp_hmac_uk" ON "akun" USING btree ("hp_hmac");--> statement-breakpoint
CREATE INDEX "alamat_akun_idx" ON "alamat" USING btree ("akun_id");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_hidup_uk" ON "otp_permintaan" USING btree ("hp_hmac","tujuan") WHERE "otp_permintaan"."terpakai_pada" IS NULL AND "otp_permintaan"."digantikan_pada" IS NULL;--> statement-breakpoint
CREATE INDEX "otp_hp_dibuat_idx" ON "otp_permintaan" USING btree ("hp_hmac","dibuat_pada" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "harga_level_uk" ON "harga_level" USING btree ("satuan_jual_id","level");--> statement-breakpoint
CREATE UNIQUE INDEX "modal_timpaan_aktif_uk" ON "modal_timpaan" USING btree ("satuan_jual_id") WHERE "modal_timpaan"."dicabut_pada" IS NULL;--> statement-breakpoint
CREATE INDEX "modal_timpaan_kedaluwarsa_idx" ON "modal_timpaan" USING btree ("kedaluwarsa_pada") WHERE "modal_timpaan"."dicabut_pada" IS NULL AND "modal_timpaan"."notifikasi_dikirim_pada" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stok_lokasi_uk" ON "stok_lokasi" USING btree ("sku_id","gudang_id");--> statement-breakpoint
CREATE INDEX "kategori_induk_idx" ON "kategori" USING btree ("induk_id");--> statement-breakpoint
CREATE INDEX "produk_kategori_idx" ON "produk" USING btree ("kategori_id");--> statement-breakpoint
CREATE UNIQUE INDEX "satuan_jual_sku_jenis_uk" ON "satuan_jual" USING btree ("sku_id","jenis");--> statement-breakpoint
CREATE INDEX "satuan_jual_tayang_idx" ON "satuan_jual" USING btree ("tayang") WHERE "satuan_jual"."tayang";--> statement-breakpoint
CREATE INDEX "sku_produk_idx" ON "sku" USING btree ("produk_id");--> statement-breakpoint
CREATE INDEX "sku_barcode_idx" ON "sku" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "dokumen_legal_jenis_versi_uk" ON "dokumen_legal" USING btree ("jenis","versi");--> statement-breakpoint
CREATE UNIQUE INDEX "persetujuan_legal_uk" ON "persetujuan_legal" USING btree ("akun_id","dokumen_legal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_kirim_uk" ON "slot_kirim" USING btree ("zona_id","tanggal","mulai");--> statement-breakpoint
CREATE INDEX "slot_kirim_cutoff_idx" ON "slot_kirim" USING btree ("cut_off_pada") WHERE "slot_kirim"."status" = 'DIBUKA';