CREATE TABLE "grup" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"kode_link" text NOT NULL,
	"host_akun_id" uuid NOT NULL,
	"zona_id" uuid NOT NULL,
	"slot_kirim_id" uuid NOT NULL,
	"gudang_id" uuid NOT NULL,
	"status" text DEFAULT 'DIBUKA' NOT NULL,
	"alasan_status" text,
	"cara_bayar" text DEFAULT 'SENDIRI' NOT NULL,
	"min_akun" smallint DEFAULT 3 NOT NULL,
	"akun_menambah_barang" integer DEFAULT 0 NOT NULL,
	"akun_lunas" integer DEFAULT 0 NOT NULL,
	"total_belanja_rp" bigint DEFAULT 0 NOT NULL,
	"harga_grup_berlaku" boolean DEFAULT false NOT NULL,
	"tagihan_diterbitkan_pada" timestamp with time zone,
	"evaluasi_dimulai_pada" timestamp with time zone,
	"ditahan_pada" timestamp with time zone,
	"dibatalkan_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grup_kode_link_format" CHECK (kode_link ~ '^[A-HJ-NP-Z2-9]{6}$'),
	CONSTRAINT "grup_status" CHECK (status IN ('DIBUKA', 'AKTIF', 'TAGIHAN_TERBIT', 'CUT_OFF', 'DITAHAN', 'HARGA_TERKUNCI', 'LANJUT_SATUAN', 'GAGAL', 'BATAL', 'DIPROSES', 'SELESAI')),
	CONSTRAINT "grup_cara_bayar" CHECK (cara_bayar IN ('SENDIRI', 'HOST')),
	CONSTRAINT "grup_min_akun" CHECK (min_akun >= 3),
	CONSTRAINT "grup_hitungan_nonneg" CHECK (akun_menambah_barang >= 0 AND akun_lunas >= 0 AND total_belanja_rp >= 0),
	CONSTRAINT "grup_ditahan_lengkap" CHECK (status <> 'DITAHAN' OR (ditahan_pada IS NOT NULL AND alasan_status IS NOT NULL)),
	CONSTRAINT "grup_batal_lengkap" CHECK (status <> 'BATAL' OR dibatalkan_pada IS NOT NULL),
	CONSTRAINT "grup_tagihan_terbit_konsisten" CHECK ((status <> 'TAGIHAN_TERBIT' OR tagihan_diterbitkan_pada IS NOT NULL) AND (tagihan_diterbitkan_pada IS NULL OR status NOT IN ('DIBUKA', 'AKTIF')))
);
--> statement-breakpoint
CREATE TABLE "item_keranjang" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"keranjang_id" uuid NOT NULL,
	"satuan_jual_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_keranjang_qty_positif" CHECK (qty > 0)
);
--> statement-breakpoint
CREATE TABLE "keranjang" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"akun_id" uuid NOT NULL,
	"grup_id" uuid,
	"status" text DEFAULT 'AKTIF' NOT NULL,
	"siap_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keranjang_id_akun_grup_uk" UNIQUE("id","akun_id","grup_id"),
	CONSTRAINT "keranjang_status" CHECK (status IN ('AKTIF', 'DIPAKAI_GRUP', 'DITINGGALKAN')),
	CONSTRAINT "keranjang_dipakai_grup_butuh_grup" CHECK (status <> 'DIPAKAI_GRUP' OR grup_id IS NOT NULL),
	CONSTRAINT "keranjang_siap_hanya_grup" CHECK (siap_pada IS NULL OR grup_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "peserta_grup" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"grup_id" uuid NOT NULL,
	"akun_id" uuid NOT NULL,
	"keranjang_id" uuid NOT NULL,
	"peran" text DEFAULT 'ANGGOTA' NOT NULL,
	"status" text DEFAULT 'AKTIF' NOT NULL,
	"cara_kirim" text,
	"alamat_id" uuid,
	"drop_point_id" uuid,
	"alamat_snapshot" jsonb,
	"level_harga" text,
	"pilihan_saat_gagal" text DEFAULT 'BELUM_MEMILIH' NOT NULL,
	"dana_ditahan" boolean DEFAULT false NOT NULL,
	"kredit_tertahan_rp" bigint DEFAULT 0 NOT NULL,
	"bergabung_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diperingatkan_pada" timestamp with time zone,
	"dikeluarkan_pada" timestamp with time zone,
	"ref_pengundang_akun_id" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peserta_grup_id_grup_uk" UNIQUE("id","grup_id"),
	CONSTRAINT "peserta_peran" CHECK (peran IN ('HOST', 'ANGGOTA')),
	CONSTRAINT "peserta_status" CHECK (status IN ('AKTIF', 'MENUNGGU_BAYAR', 'LUNAS', 'TERKUNCI', 'DIPROSES', 'DIKIRIM', 'SIAP_DIAMBIL', 'DITERIMA', 'DITOLAK', 'DIKELUARKAN', 'BATAL', 'DIREFUND', 'DANA_DITAHAN', 'TIDAK_DIAMBIL')),
	CONSTRAINT "peserta_cara_kirim" CHECK (cara_kirim IS NULL OR cara_kirim IN ('ANTAR_RUMAH', 'DROP_POINT')),
	CONSTRAINT "peserta_tujuan_kirim_konsisten" CHECK ((cara_kirim IS NULL AND alamat_id IS NULL AND drop_point_id IS NULL)
        OR (cara_kirim = 'ANTAR_RUMAH' AND alamat_id IS NOT NULL AND drop_point_id IS NULL)
        OR (cara_kirim = 'DROP_POINT' AND drop_point_id IS NOT NULL AND alamat_id IS NULL)),
	CONSTRAINT "peserta_level_harga" CHECK (level_harga IS NULL OR level_harga IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "peserta_pilihan_gagal" CHECK (pilihan_saat_gagal IN ('BELUM_MEMILIH', 'LANJUT_SATUAN', 'BATAL_KE_SALDO')),
	CONSTRAINT "peserta_kredit_tertahan_nonneg" CHECK (kredit_tertahan_rp >= 0),
	CONSTRAINT "peserta_dikeluarkan_lengkap" CHECK (status <> 'DIKELUARKAN' OR dikeluarkan_pada IS NOT NULL),
	CONSTRAINT "peserta_bukan_pengundang_sendiri" CHECK (ref_pengundang_akun_id IS NULL OR ref_pengundang_akun_id <> akun_id)
);
--> statement-breakpoint
CREATE TABLE "baris_invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"peserta_id" uuid NOT NULL,
	"jenis" text NOT NULL,
	"satuan_jual_id" uuid,
	"nama_snapshot" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"level_harga" text,
	"harga_dibayar_rp" bigint,
	"modal_snapshot_rp" bigint,
	"versi_harga" text,
	"potongan_baris_rp" bigint DEFAULT 0 NOT NULL,
	"subsidi_ongkir_baris_rp" bigint DEFAULT 0 NOT NULL,
	"bebas_ppn" boolean,
	"ppn_baris_rp" bigint,
	"dpp_baris_rp" bigint,
	"nilai_rp" bigint NOT NULL,
	"modal_cutoff_rp" bigint,
	"harga_final_rp" bigint,
	"nilai_bersih_final_rp" bigint,
	"qty_teralokasi" integer,
	"dibatalkan" boolean DEFAULT false NOT NULL,
	"dibatalkan_alasan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baris_jenis" CHECK (jenis IN ('BARANG', 'BIAYA_ADMIN', 'BIAYA_ADMIN_PAGAR', 'ONGKIR', 'SUBSIDI_ONGKIR', 'DISKON')),
	CONSTRAINT "baris_qty_positif" CHECK (qty > 0),
	CONSTRAINT "baris_level_harga" CHECK (level_harga IS NULL OR level_harga IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE')),
	CONSTRAINT "baris_barang_lengkap" CHECK (jenis <> 'BARANG' OR (satuan_jual_id IS NOT NULL AND level_harga IS NOT NULL AND harga_dibayar_rp IS NOT NULL AND modal_snapshot_rp IS NOT NULL AND versi_harga IS NOT NULL AND bebas_ppn IS NOT NULL)),
	CONSTRAINT "baris_non_barang_tanpa_harga" CHECK (jenis = 'BARANG' OR (satuan_jual_id IS NULL AND harga_dibayar_rp IS NULL AND modal_snapshot_rp IS NULL AND potongan_baris_rp = 0 AND subsidi_ongkir_baris_rp = 0 AND harga_final_rp IS NULL AND qty_teralokasi IS NULL)),
	CONSTRAINT "baris_harga_di_atas_modal" CHECK (jenis <> 'BARANG' OR (modal_snapshot_rp > 0 AND harga_dibayar_rp > modal_snapshot_rp)),
	CONSTRAINT "baris_alokasi_nonneg" CHECK (potongan_baris_rp >= 0 AND subsidi_ongkir_baris_rp >= 0),
	CONSTRAINT "baris_bersih_tidak_di_bawah_modal" CHECK (jenis <> 'BARANG' OR harga_dibayar_rp * qty - potongan_baris_rp - subsidi_ongkir_baris_rp >= modal_snapshot_rp * qty),
	CONSTRAINT "baris_nilai_konsisten" CHECK ((jenis = 'BARANG' AND nilai_rp = harga_dibayar_rp * qty) OR (jenis IN ('DISKON', 'SUBSIDI_ONGKIR') AND nilai_rp < 0) OR (jenis IN ('BIAYA_ADMIN', 'BIAYA_ADMIN_PAGAR', 'ONGKIR') AND nilai_rp >= 0)),
	CONSTRAINT "baris_ppn_nonneg" CHECK ((ppn_baris_rp IS NULL OR ppn_baris_rp >= 0) AND (dpp_baris_rp IS NULL OR dpp_baris_rp >= 0)),
	CONSTRAINT "baris_harga_final" CHECK (harga_final_rp IS NULL OR (modal_cutoff_rp IS NOT NULL AND harga_final_rp >= modal_cutoff_rp AND harga_final_rp <= harga_dibayar_rp)),
	CONSTRAINT "baris_modal_cutoff_positif" CHECK (modal_cutoff_rp IS NULL OR modal_cutoff_rp > 0),
	CONSTRAINT "baris_qty_teralokasi" CHECK (qty_teralokasi IS NULL OR qty_teralokasi BETWEEN 0 AND qty),
	CONSTRAINT "baris_bersih_final_tidak_di_bawah_modal" CHECK (nilai_bersih_final_rp IS NULL OR (modal_cutoff_rp IS NOT NULL AND qty_teralokasi IS NOT NULL AND nilai_bersih_final_rp >= modal_cutoff_rp * qty_teralokasi + CASE WHEN qty_teralokasi > 0 THEN subsidi_ongkir_baris_rp ELSE 0 END)),
	CONSTRAINT "baris_batal_beralasan" CHECK (NOT dibatalkan OR dibatalkan_alasan IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"nomor" text NOT NULL,
	"grup_id" uuid NOT NULL,
	"pembayar_akun_id" uuid NOT NULL,
	"gabungan" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'DITERBITKAN' NOT NULL,
	"diterbitkan_pada" timestamp with time zone NOT NULL,
	"ttl_menit" smallint NOT NULL,
	"kedaluwarsa_pada" timestamp with time zone NOT NULL,
	"menggantikan_invoice_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"subtotal_barang_rp" bigint DEFAULT 0 NOT NULL,
	"potongan_rp" bigint DEFAULT 0 NOT NULL,
	"biaya_admin_rp" bigint DEFAULT 0 NOT NULL,
	"ongkir_rp" bigint DEFAULT 0 NOT NULL,
	"subsidi_ongkir_rp" bigint DEFAULT 0 NOT NULL,
	"ppn_rp" bigint,
	"dpp_rp" bigint,
	"konfigurasi_ppn_id" uuid,
	"total_rp" bigint NOT NULL,
	"saldo_dipakai_rp" bigint DEFAULT 0 NOT NULL,
	"sisa_bayar_rp" bigint NOT NULL,
	"lunas_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_id_grup_uk" UNIQUE("id","grup_id"),
	CONSTRAINT "invoice_status" CHECK (status IN ('DITERBITKAN', 'LUNAS', 'KEDALUWARSA', 'DIBATALKAN', 'DIGANTI')),
	CONSTRAINT "invoice_ttl_positif" CHECK (ttl_menit > 0),
	CONSTRAINT "invoice_kedaluwarsa_setelah_terbit" CHECK (kedaluwarsa_pada > diterbitkan_pada),
	CONSTRAINT "invoice_kedaluwarsa_ttl" CHECK (gabungan OR kedaluwarsa_pada = diterbitkan_pada + make_interval(mins => ttl_menit)),
	CONSTRAINT "invoice_menggantikan_hanya_gabungan" CHECK (gabungan OR cardinality(menggantikan_invoice_ids) = 0),
	CONSTRAINT "invoice_komponen_nonneg" CHECK (subtotal_barang_rp >= 0 AND potongan_rp >= 0 AND biaya_admin_rp >= 0 AND ongkir_rp >= 0 AND subsidi_ongkir_rp >= 0),
	CONSTRAINT "invoice_subsidi_maks_ongkir" CHECK (subsidi_ongkir_rp <= ongkir_rp),
	CONSTRAINT "invoice_ppn_nonneg" CHECK ((ppn_rp IS NULL OR ppn_rp >= 0) AND (dpp_rp IS NULL OR dpp_rp >= 0)),
	CONSTRAINT "invoice_total_konsisten" CHECK (total_rp = subtotal_barang_rp - potongan_rp + biaya_admin_rp + ongkir_rp - subsidi_ongkir_rp AND total_rp >= 0),
	CONSTRAINT "invoice_saldo_dipakai" CHECK (saldo_dipakai_rp >= 0 AND saldo_dipakai_rp <= total_rp),
	CONSTRAINT "invoice_sisa_bayar" CHECK (sisa_bayar_rp = total_rp - saldo_dipakai_rp),
	CONSTRAINT "invoice_lunas_lengkap" CHECK (status <> 'LUNAS' OR lunas_pada IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "invoice_peserta" (
	"invoice_id" uuid NOT NULL,
	"peserta_id" uuid NOT NULL,
	"grup_id" uuid NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_peserta_invoice_id_peserta_id_pk" PRIMARY KEY("invoice_id","peserta_id")
);
--> statement-breakpoint
CREATE TABLE "konfigurasi_ppn" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"tarif_persen" numeric(9, 4),
	"dpp_pembilang" integer,
	"dpp_penyebut" integer,
	"berlaku_mulai" timestamp with time zone NOT NULL,
	"dibuat_oleh" uuid NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppn_tarif_rentang" CHECK (tarif_persen IS NULL OR (tarif_persen >= 0 AND tarif_persen < 100)),
	CONSTRAINT "ppn_dpp_konsisten" CHECK ((dpp_pembilang IS NULL AND dpp_penyebut IS NULL) OR (dpp_pembilang > 0 AND dpp_penyebut > 0 AND dpp_pembilang <= dpp_penyebut))
);
--> statement-breakpoint
CREATE TABLE "pembayaran" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"metode" text NOT NULL,
	"kanal" text,
	"jumlah_rp" bigint NOT NULL,
	"xendit_ref" text,
	"status" text DEFAULT 'MENUNGGU' NOT NULL,
	"kedaluwarsa_pada" timestamp with time zone,
	"paid_at_gateway" timestamp with time zone,
	"webhook_diterima_pada" timestamp with time zone,
	"kunci_idempotensi" text NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pembayaran_metode" CHECK (metode IN ('QRIS', 'VA')),
	CONSTRAINT "pembayaran_status" CHECK (status IN ('MENUNGGU', 'LUNAS', 'KEDALUWARSA', 'GAGAL', 'NOMINAL_TIDAK_COCOK')),
	CONSTRAINT "pembayaran_jumlah_positif" CHECK (jumlah_rp > 0),
	CONSTRAINT "pembayaran_lunas_lengkap" CHECK (status <> 'LUNAS' OR paid_at_gateway IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "reservasi_stok" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"baris_invoice_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"gudang_id" uuid NOT NULL,
	"qty_satuan_dasar" integer NOT NULL,
	"status" text DEFAULT 'AKTIF' NOT NULL,
	"selesai_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservasi_qty_positif" CHECK (qty_satuan_dasar > 0),
	CONSTRAINT "reservasi_status" CHECK (status IN ('AKTIF', 'TERPAKAI', 'DILEPAS')),
	CONSTRAINT "reservasi_selesai_konsisten" CHECK ((status = 'AKTIF') = (selesai_pada IS NULL))
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"gateway" text NOT NULL,
	"event_id_gateway" text NOT NULL,
	"external_id" text NOT NULL,
	"status" text NOT NULL,
	"pembayaran_id" uuid,
	"diterima_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_payload" (
	"webhook_event_id" uuid PRIMARY KEY NOT NULL,
	"payload_redaksi" jsonb NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_proses" (
	"webhook_event_id" uuid PRIMARY KEY NOT NULL,
	"diproses_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"hasil" text NOT NULL,
	CONSTRAINT "webhook_proses_hasil" CHECK (hasil IN ('DIPROSES', 'DUPLIKAT', 'YATIM', 'NOMINAL_TIDAK_COCOK', 'TERLAMBAT'))
);
--> statement-breakpoint
CREATE TABLE "akun_saldo" (
	"akun_id" uuid PRIMARY KEY NOT NULL,
	"saldo_rp" bigint DEFAULT 0 NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "akun_saldo_tidak_negatif" CHECK (saldo_rp >= 0)
);
--> statement-breakpoint
CREATE TABLE "keputusan_koreksi_saldo" (
	"pengajuan_id" uuid PRIMARY KEY NOT NULL,
	"hasil" text NOT NULL,
	"diputuskan_oleh" uuid NOT NULL,
	"catatan" text,
	"diputuskan_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keputusan_koreksi_hasil" CHECK (hasil IN ('DISETUJUI', 'DITOLAK'))
);
--> statement-breakpoint
CREATE TABLE "ledger_saldo" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"akun_id" uuid NOT NULL,
	"jumlah_rp" bigint NOT NULL,
	"jenis" text NOT NULL,
	"referensi_jenis" text,
	"referensi_id" uuid,
	"kunci_idempotensi" text NOT NULL,
	"alasan" text,
	"dibuat_oleh_admin_id" uuid,
	"disetujui_oleh_admin_id" uuid,
	"dapat_dicairkan_sejak" timestamp with time zone,
	"saldo_sesudah_rp" bigint NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_jenis" CHECK (jenis IN ('SELISIH_HARGA', 'REFUND', 'REFUND_ONGKIR', 'BAYAR_TERLAMBAT', 'SALDO_BALIK', 'PENCAIRAN_BATAL', 'PAKAI_CHECKOUT', 'PENCAIRAN', 'KOREKSI_ADMIN')),
	CONSTRAINT "ledger_jumlah_bukan_nol" CHECK (jumlah_rp <> 0),
	CONSTRAINT "ledger_tanda_sesuai_jenis" CHECK ((jenis IN ('SELISIH_HARGA', 'REFUND', 'REFUND_ONGKIR', 'BAYAR_TERLAMBAT', 'SALDO_BALIK', 'PENCAIRAN_BATAL') AND jumlah_rp > 0) OR (jenis IN ('PAKAI_CHECKOUT', 'PENCAIRAN') AND jumlah_rp < 0) OR jenis = 'KOREKSI_ADMIN'),
	CONSTRAINT "ledger_saldo_sesudah_nonneg" CHECK (saldo_sesudah_rp >= 0),
	CONSTRAINT "ledger_referensi_lengkap" CHECK ((referensi_jenis IS NULL) = (referensi_id IS NULL)),
	CONSTRAINT "ledger_koreksi_lengkap" CHECK (jenis <> 'KOREKSI_ADMIN' OR (alasan IS NOT NULL AND char_length(btrim(alasan)) > 0 AND dibuat_oleh_admin_id IS NOT NULL)),
	CONSTRAINT "ledger_four_eyes" CHECK (disetujui_oleh_admin_id IS NULL OR disetujui_oleh_admin_id <> dibuat_oleh_admin_id)
);
--> statement-breakpoint
CREATE TABLE "pencairan_saldo" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"akun_id" uuid NOT NULL,
	"jumlah_rp" bigint NOT NULL,
	"tujuan_id" uuid NOT NULL,
	"reauth_sesi_pada" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'DIAJUKAN' NOT NULL,
	"xendit_disbursement_ref" text,
	"kunci_idempotensi" text NOT NULL,
	"disetujui_oleh" uuid,
	"diproses_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pencairan_jumlah_positif" CHECK (jumlah_rp > 0),
	CONSTRAINT "pencairan_status" CHECK (status IN ('DIAJUKAN', 'DISETUJUI', 'DIPROSES', 'BERHASIL', 'GAGAL', 'DITOLAK')),
	CONSTRAINT "pencairan_four_eyes" CHECK (disetujui_oleh IS NULL OR diproses_oleh IS NULL OR disetujui_oleh <> diproses_oleh)
);
--> statement-breakpoint
CREATE TABLE "pengajuan_koreksi_saldo" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"akun_id" uuid NOT NULL,
	"jumlah_rp" bigint NOT NULL,
	"alasan" text NOT NULL,
	"diajukan_oleh" uuid NOT NULL,
	"diajukan_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreksi_jumlah_bukan_nol" CHECK (jumlah_rp <> 0),
	CONSTRAINT "koreksi_alasan_wajib" CHECK (char_length(btrim(alasan)) > 0)
);
--> statement-breakpoint
CREATE TABLE "tujuan_pencairan_terverifikasi" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"akun_id" uuid NOT NULL,
	"tujuan_jenis" text NOT NULL,
	"tujuan_kode" text NOT NULL,
	"nomor_tujuan_enc" "bytea" NOT NULL,
	"nomor_kunci_versi" smallint NOT NULL,
	"nomor_tujuan_akhir" text NOT NULL,
	"nama_hasil_validasi" text,
	"nama_cocok" boolean NOT NULL,
	"xendit_validasi_ref" text,
	"divalidasi_pada" timestamp with time zone NOT NULL,
	"boleh_dipakai_sejak" timestamp with time zone NOT NULL,
	"dinonaktifkan_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tujuan_id_akun_uk" UNIQUE("id","akun_id"),
	CONSTRAINT "tujuan_jenis" CHECK (tujuan_jenis IN ('BANK', 'VA', 'EWALLET')),
	CONSTRAINT "tujuan_nomor_akhir" CHECK (nomor_tujuan_akhir ~ '^[0-9]{1,4}$'),
	CONSTRAINT "tujuan_jeda" CHECK (boleh_dipakai_sejak >= divalidasi_pada)
);
--> statement-breakpoint
CREATE TABLE "ambang_kpi_cod" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"min_pesanan_selesai" integer,
	"min_sukses_persen" numeric(5, 2),
	"maks_penolakan" integer,
	"maks_batal_setelah_kirim" integer,
	"berlaku_mulai" timestamp with time zone NOT NULL,
	"dibuat_oleh" uuid NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ambang_cod_nonneg" CHECK ((min_pesanan_selesai IS NULL OR min_pesanan_selesai >= 0) AND (maks_penolakan IS NULL OR maks_penolakan >= 0) AND (maks_batal_setelah_kirim IS NULL OR maks_batal_setelah_kirim >= 0)),
	CONSTRAINT "ambang_cod_persen" CHECK (min_sukses_persen IS NULL OR min_sukses_persen BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "armada" (
	"kode" text PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"kapasitas_gram" bigint,
	"aktif" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "armada_kode_format" CHECK (kode ~ '^[A-Z][A-Z0-9_]*$'),
	CONSTRAINT "armada_kapasitas_positif" CHECK (kapasitas_gram IS NULL OR kapasitas_gram > 0),
	CONSTRAINT "armada_aktif_butuh_kapasitas" CHECK (NOT aktif OR kapasitas_gram IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "aturan_diskon" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"nama" text NOT NULL,
	"jenis" text NOT NULL,
	"nilai_persen" numeric(9, 4),
	"nilai_rp" bigint,
	"cakupan_jenis" text DEFAULT 'SEMUA' NOT NULL,
	"cakupan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"level" text,
	"cara_hitung" text DEFAULT 'TOTAL_PROPORSIONAL' NOT NULL,
	"berlaku_mulai" timestamp with time zone NOT NULL,
	"berlaku_sampai" timestamp with time zone NOT NULL,
	"kuota" integer,
	"terpakai" integer DEFAULT 0 NOT NULL,
	"maks_per_akun" integer,
	"aktif" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diskon_jenis" CHECK (jenis IN ('PERSEN', 'NOMINAL')),
	CONSTRAINT "diskon_nilai_sesuai_jenis" CHECK ((jenis = 'PERSEN' AND nilai_rp IS NULL AND (nilai_persen IS NULL OR (nilai_persen > 0 AND nilai_persen < 100)))
        OR (jenis = 'NOMINAL' AND nilai_persen IS NULL AND (nilai_rp IS NULL OR nilai_rp > 0))),
	CONSTRAINT "diskon_aktif_butuh_nilai" CHECK (NOT aktif OR num_nonnulls(nilai_persen, nilai_rp) = 1),
	CONSTRAINT "diskon_cakupan" CHECK (cakupan_jenis IN ('SEMUA', 'PRODUK', 'KATEGORI', 'LEVEL', 'ZONA')),
	CONSTRAINT "diskon_cakupan_lengkap" CHECK ((cakupan_jenis = 'SEMUA' AND cardinality(cakupan_ids) = 0)
        OR (cakupan_jenis = 'LEVEL' AND level IS NOT NULL AND cardinality(cakupan_ids) = 0)
        OR (cakupan_jenis IN ('PRODUK', 'KATEGORI', 'ZONA') AND cardinality(cakupan_ids) > 0)),
	CONSTRAINT "diskon_cara_hitung" CHECK (cara_hitung IN ('TOTAL_PROPORSIONAL')),
	CONSTRAINT "diskon_kuota" CHECK (terpakai >= 0 AND (kuota IS NULL OR (kuota > 0 AND terpakai <= kuota))),
	CONSTRAINT "diskon_maks_per_akun" CHECK (maks_per_akun IS NULL OR maks_per_akun > 0),
	CONSTRAINT "diskon_periode" CHECK (berlaku_sampai > berlaku_mulai),
	CONSTRAINT "diskon_level" CHECK (level IS NULL OR level IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE'))
);
--> statement-breakpoint
CREATE TABLE "aturan_gratis_ongkir" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"nama" text NOT NULL,
	"minimal_belanja_rp" bigint,
	"zona_id" uuid,
	"level" text,
	"berlaku_mulai" timestamp with time zone NOT NULL,
	"berlaku_sampai" timestamp with time zone NOT NULL,
	"subsidi_jenis" text DEFAULT 'PENUH' NOT NULL,
	"subsidi_maks_rp" bigint,
	"kuota" integer,
	"terpakai" integer DEFAULT 0 NOT NULL,
	"maks_per_akun" integer,
	"aktif" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gratis_ongkir_minimal" CHECK (minimal_belanja_rp IS NULL OR minimal_belanja_rp > 0),
	CONSTRAINT "gratis_ongkir_subsidi_jenis" CHECK (subsidi_jenis IN ('PENUH', 'MAKS')),
	CONSTRAINT "gratis_ongkir_subsidi_konsisten" CHECK ((subsidi_jenis = 'PENUH' AND subsidi_maks_rp IS NULL) OR (subsidi_jenis = 'MAKS' AND (subsidi_maks_rp IS NULL OR subsidi_maks_rp > 0))),
	CONSTRAINT "gratis_ongkir_aktif_lengkap" CHECK (NOT aktif OR subsidi_jenis = 'PENUH' OR subsidi_maks_rp IS NOT NULL),
	CONSTRAINT "gratis_ongkir_kuota" CHECK (terpakai >= 0 AND (kuota IS NULL OR (kuota > 0 AND terpakai <= kuota))),
	CONSTRAINT "gratis_ongkir_maks_per_akun" CHECK (maks_per_akun IS NULL OR maks_per_akun > 0),
	CONSTRAINT "gratis_ongkir_periode" CHECK (berlaku_sampai > berlaku_mulai),
	CONSTRAINT "gratis_ongkir_level" CHECK (level IS NULL OR level IN ('SATUAN', 'MITRA_GROSIR', 'FRANCHISE'))
);
--> statement-breakpoint
CREATE TABLE "kpi_cod_mingguan" (
	"akun_id" uuid NOT NULL,
	"minggu_mulai" date NOT NULL,
	"pesanan_selesai" integer NOT NULL,
	"pesanan_total" integer NOT NULL,
	"penolakan" integer NOT NULL,
	"batal_setelah_kirim" integer NOT NULL,
	"sukses_persen" numeric(5, 2),
	"lolos" boolean NOT NULL,
	"ambang_id" uuid NOT NULL,
	"dihitung_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_cod_mingguan_akun_id_minggu_mulai_pk" PRIMARY KEY("akun_id","minggu_mulai"),
	CONSTRAINT "kpi_cod_nonneg" CHECK (pesanan_selesai >= 0 AND pesanan_total >= 0 AND penolakan >= 0 AND batal_setelah_kirim >= 0),
	CONSTRAINT "kpi_cod_selesai_maks_total" CHECK (pesanan_selesai <= pesanan_total),
	CONSTRAINT "kpi_cod_persen" CHECK (sukses_persen IS NULL OR sukses_persen BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "kuotasi_ongkir" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"grup_id" uuid NOT NULL,
	"peserta_id" uuid,
	"armada_kode" text NOT NULL,
	"berat_gram" integer NOT NULL,
	"jarak_meter" integer NOT NULL,
	"ongkir_rp" bigint NOT NULL,
	"sumber_adapter" text NOT NULL,
	"ref_eksternal" text,
	"berlaku_sampai" timestamp with time zone NOT NULL,
	"dipakai_di_invoice_id" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kuotasi_nonneg" CHECK (berat_gram >= 0 AND jarak_meter >= 0 AND ongkir_rp >= 0)
);
--> statement-breakpoint
CREATE TABLE "pemakaian_promo" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"aturan_diskon_id" uuid,
	"aturan_gratis_ongkir_id" uuid,
	"invoice_id" uuid NOT NULL,
	"akun_id" uuid NOT NULL,
	"status" text DEFAULT 'DIRESERVASI' NOT NULL,
	"alasan_tidak_memenuhi" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_tepat_satu_aturan" CHECK (num_nonnulls(aturan_diskon_id, aturan_gratis_ongkir_id) = 1),
	CONSTRAINT "promo_status" CHECK (status IN ('DIRESERVASI', 'TERPAKAI', 'DILEPAS', 'TIDAK_MEMENUHI')),
	CONSTRAINT "promo_tidak_memenuhi_beralasan" CHECK (status <> 'TIDAK_MEMENUHI' OR (alasan_tidak_memenuhi IS NOT NULL AND char_length(btrim(alasan_tidak_memenuhi)) > 0))
);
--> statement-breakpoint
CREATE TABLE "status_cod" (
	"akun_id" uuid PRIMARY KEY NOT NULL,
	"minggu_lolos_berturut" smallint DEFAULT 0 NOT NULL,
	"aktif" boolean DEFAULT false NOT NULL,
	"dicabut_manual_pada" timestamp with time zone,
	"dicabut_oleh" uuid,
	"alasan_cabut" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_cod_minggu_nonneg" CHECK (minggu_lolos_berturut >= 0),
	CONSTRAINT "status_cod_aktif_tiga_minggu" CHECK (NOT aktif OR minggu_lolos_berturut >= 3),
	CONSTRAINT "status_cod_cabut_lengkap" CHECK ((dicabut_manual_pada IS NULL AND dicabut_oleh IS NULL AND alasan_cabut IS NULL)
        OR (dicabut_manual_pada IS NOT NULL AND dicabut_oleh IS NOT NULL AND alasan_cabut IS NOT NULL AND char_length(btrim(alasan_cabut)) > 0))
);
--> statement-breakpoint
CREATE TABLE "tarif_armada" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"armada_kode" text NOT NULL,
	"tarif_dasar_rp" bigint,
	"tarif_per_kg_rp" bigint,
	"tarif_per_km_rp" bigint,
	"sumber_adapter" text NOT NULL,
	"ref_eksternal" text,
	"berlaku_mulai" timestamp with time zone NOT NULL,
	"diambil_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tarif_nonneg" CHECK ((tarif_dasar_rp IS NULL OR tarif_dasar_rp >= 0) AND (tarif_per_kg_rp IS NULL OR tarif_per_kg_rp >= 0) AND (tarif_per_km_rp IS NULL OR tarif_per_km_rp >= 0))
);
--> statement-breakpoint
CREATE TABLE "idempotensi_inventori" (
	"ruang" text NOT NULL,
	"kunci" text NOT NULL,
	"hash" text NOT NULL,
	"hasil" jsonb NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotensi_inventori_ruang_kunci_pk" PRIMARY KEY("ruang","kunci"),
	CONSTRAINT "idempotensi_ruang" CHECK (ruang IN ('konfirmasi', 'picking')),
	CONSTRAINT "idempotensi_hash_sha256" CHECK (hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotensi_kunci_isi" CHECK (char_length(kunci) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"kunci" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"pemegang" text,
	"lease_sampai" timestamp with time zone,
	"mulai_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"selesai_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_status" CHECK (status IN ('BERJALAN', 'SELESAI', 'GAGAL')),
	CONSTRAINT "job_berjalan_butuh_lease" CHECK (status <> 'BERJALAN' OR lease_sampai IS NOT NULL),
	CONSTRAINT "job_selesai_lengkap" CHECK (status = 'BERJALAN' OR selesai_pada IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"grup_id" uuid,
	"jenis" text NOT NULL,
	"kunci_idempotensi" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'MENUNGGU' NOT NULL,
	"percobaan" smallint DEFAULT 0 NOT NULL,
	"kirim_setelah" timestamp with time zone DEFAULT now() NOT NULL,
	"kedaluwarsa_pesan" timestamp with time zone,
	"terkirim_pada" timestamp with time zone,
	"galat_terakhir" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_jenis" CHECK (jenis IN ('WA', 'PICKING', 'BATAL_PEMBAYARAN_XENDIT')),
	CONSTRAINT "outbox_status" CHECK (status IN ('MENUNGGU', 'TERKIRIM', 'GAGAL', 'KEDALUWARSA')),
	CONSTRAINT "outbox_percobaan_nonneg" CHECK (percobaan >= 0),
	CONSTRAINT "outbox_terkirim_lengkap" CHECK (status <> 'TERKIRIM' OR terkirim_pada IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "grup" ADD CONSTRAINT "grup_host_akun_id_akun_id_fk" FOREIGN KEY ("host_akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grup" ADD CONSTRAINT "grup_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grup" ADD CONSTRAINT "grup_slot_kirim_id_slot_kirim_id_fk" FOREIGN KEY ("slot_kirim_id") REFERENCES "public"."slot_kirim"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grup" ADD CONSTRAINT "grup_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_keranjang" ADD CONSTRAINT "item_keranjang_keranjang_id_keranjang_id_fk" FOREIGN KEY ("keranjang_id") REFERENCES "public"."keranjang"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_keranjang" ADD CONSTRAINT "item_keranjang_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keranjang" ADD CONSTRAINT "keranjang_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keranjang" ADD CONSTRAINT "keranjang_grup_id_grup_id_fk" FOREIGN KEY ("grup_id") REFERENCES "public"."grup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peserta_grup" ADD CONSTRAINT "peserta_grup_grup_id_grup_id_fk" FOREIGN KEY ("grup_id") REFERENCES "public"."grup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peserta_grup" ADD CONSTRAINT "peserta_grup_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peserta_grup" ADD CONSTRAINT "peserta_grup_alamat_id_alamat_id_fk" FOREIGN KEY ("alamat_id") REFERENCES "public"."alamat"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peserta_grup" ADD CONSTRAINT "peserta_grup_drop_point_id_drop_point_id_fk" FOREIGN KEY ("drop_point_id") REFERENCES "public"."drop_point"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peserta_grup" ADD CONSTRAINT "peserta_grup_ref_pengundang_akun_id_akun_id_fk" FOREIGN KEY ("ref_pengundang_akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peserta_grup" ADD CONSTRAINT "peserta_grup_keranjang_milik_akun_grup_fk" FOREIGN KEY ("keranjang_id","akun_id","grup_id") REFERENCES "public"."keranjang"("id","akun_id","grup_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baris_invoice" ADD CONSTRAINT "baris_invoice_satuan_jual_id_satuan_jual_id_fk" FOREIGN KEY ("satuan_jual_id") REFERENCES "public"."satuan_jual"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baris_invoice" ADD CONSTRAINT "baris_invoice_invoice_peserta_fk" FOREIGN KEY ("invoice_id","peserta_id") REFERENCES "public"."invoice_peserta"("invoice_id","peserta_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_grup_id_grup_id_fk" FOREIGN KEY ("grup_id") REFERENCES "public"."grup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_pembayar_akun_id_akun_id_fk" FOREIGN KEY ("pembayar_akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_konfigurasi_ppn_id_konfigurasi_ppn_id_fk" FOREIGN KEY ("konfigurasi_ppn_id") REFERENCES "public"."konfigurasi_ppn"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_peserta" ADD CONSTRAINT "invoice_peserta_invoice_grup_fk" FOREIGN KEY ("invoice_id","grup_id") REFERENCES "public"."invoice"("id","grup_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_peserta" ADD CONSTRAINT "invoice_peserta_peserta_grup_fk" FOREIGN KEY ("peserta_id","grup_id") REFERENCES "public"."peserta_grup"("id","grup_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "konfigurasi_ppn" ADD CONSTRAINT "konfigurasi_ppn_dibuat_oleh_admin_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservasi_stok" ADD CONSTRAINT "reservasi_stok_baris_invoice_id_baris_invoice_id_fk" FOREIGN KEY ("baris_invoice_id") REFERENCES "public"."baris_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservasi_stok" ADD CONSTRAINT "reservasi_stok_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservasi_stok" ADD CONSTRAINT "reservasi_stok_gudang_id_gudang_id_fk" FOREIGN KEY ("gudang_id") REFERENCES "public"."gudang"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservasi_stok" ADD CONSTRAINT "reservasi_stok_lokasi_fk" FOREIGN KEY ("sku_id","gudang_id") REFERENCES "public"."stok_lokasi"("sku_id","gudang_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_pembayaran_id_pembayaran_id_fk" FOREIGN KEY ("pembayaran_id") REFERENCES "public"."pembayaran"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_payload" ADD CONSTRAINT "webhook_payload_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_proses" ADD CONSTRAINT "webhook_proses_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "akun_saldo" ADD CONSTRAINT "akun_saldo_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keputusan_koreksi_saldo" ADD CONSTRAINT "keputusan_koreksi_saldo_diputuskan_oleh_admin_id_fk" FOREIGN KEY ("diputuskan_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keputusan_koreksi_saldo" ADD CONSTRAINT "keputusan_koreksi_pengajuan_fk" FOREIGN KEY ("pengajuan_id") REFERENCES "public"."pengajuan_koreksi_saldo"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_saldo" ADD CONSTRAINT "ledger_saldo_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_saldo" ADD CONSTRAINT "ledger_saldo_dibuat_oleh_admin_id_admin_id_fk" FOREIGN KEY ("dibuat_oleh_admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_saldo" ADD CONSTRAINT "ledger_saldo_disetujui_oleh_admin_id_admin_id_fk" FOREIGN KEY ("disetujui_oleh_admin_id") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pencairan_saldo" ADD CONSTRAINT "pencairan_saldo_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pencairan_saldo" ADD CONSTRAINT "pencairan_saldo_disetujui_oleh_admin_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pencairan_saldo" ADD CONSTRAINT "pencairan_saldo_diproses_oleh_admin_id_fk" FOREIGN KEY ("diproses_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pencairan_saldo" ADD CONSTRAINT "pencairan_tujuan_milik_akun_fk" FOREIGN KEY ("tujuan_id","akun_id") REFERENCES "public"."tujuan_pencairan_terverifikasi"("id","akun_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengajuan_koreksi_saldo" ADD CONSTRAINT "pengajuan_koreksi_saldo_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengajuan_koreksi_saldo" ADD CONSTRAINT "pengajuan_koreksi_saldo_diajukan_oleh_admin_id_fk" FOREIGN KEY ("diajukan_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tujuan_pencairan_terverifikasi" ADD CONSTRAINT "tujuan_pencairan_terverifikasi_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambang_kpi_cod" ADD CONSTRAINT "ambang_kpi_cod_dibuat_oleh_admin_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aturan_gratis_ongkir" ADD CONSTRAINT "aturan_gratis_ongkir_zona_id_zona_id_fk" FOREIGN KEY ("zona_id") REFERENCES "public"."zona"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_cod_mingguan" ADD CONSTRAINT "kpi_cod_mingguan_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_cod_mingguan" ADD CONSTRAINT "kpi_cod_mingguan_ambang_id_ambang_kpi_cod_id_fk" FOREIGN KEY ("ambang_id") REFERENCES "public"."ambang_kpi_cod"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" ADD CONSTRAINT "kuotasi_ongkir_grup_id_grup_id_fk" FOREIGN KEY ("grup_id") REFERENCES "public"."grup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" ADD CONSTRAINT "kuotasi_ongkir_peserta_id_peserta_grup_id_fk" FOREIGN KEY ("peserta_id") REFERENCES "public"."peserta_grup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" ADD CONSTRAINT "kuotasi_ongkir_armada_kode_armada_kode_fk" FOREIGN KEY ("armada_kode") REFERENCES "public"."armada"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" ADD CONSTRAINT "kuotasi_ongkir_dipakai_di_invoice_id_invoice_id_fk" FOREIGN KEY ("dipakai_di_invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemakaian_promo" ADD CONSTRAINT "pemakaian_promo_aturan_diskon_id_aturan_diskon_id_fk" FOREIGN KEY ("aturan_diskon_id") REFERENCES "public"."aturan_diskon"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemakaian_promo" ADD CONSTRAINT "pemakaian_promo_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemakaian_promo" ADD CONSTRAINT "pemakaian_promo_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemakaian_promo" ADD CONSTRAINT "pemakaian_promo_gratis_ongkir_fk" FOREIGN KEY ("aturan_gratis_ongkir_id") REFERENCES "public"."aturan_gratis_ongkir"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cod" ADD CONSTRAINT "status_cod_akun_id_akun_id_fk" FOREIGN KEY ("akun_id") REFERENCES "public"."akun"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_cod" ADD CONSTRAINT "status_cod_dicabut_oleh_admin_id_fk" FOREIGN KEY ("dicabut_oleh") REFERENCES "public"."admin"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif_armada" ADD CONSTRAINT "tarif_armada_armada_kode_armada_kode_fk" FOREIGN KEY ("armada_kode") REFERENCES "public"."armada"("kode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_grup_id_grup_id_fk" FOREIGN KEY ("grup_id") REFERENCES "public"."grup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grup_kode_link_uk" ON "grup" USING btree ("kode_link");--> statement-breakpoint
CREATE INDEX "grup_slot_status_idx" ON "grup" USING btree ("slot_kirim_id","status");--> statement-breakpoint
CREATE INDEX "grup_host_idx" ON "grup" USING btree ("host_akun_id");--> statement-breakpoint
CREATE INDEX "grup_ditahan_idx" ON "grup" USING btree ("status") WHERE status = 'DITAHAN';--> statement-breakpoint
CREATE UNIQUE INDEX "item_keranjang_uk" ON "item_keranjang" USING btree ("keranjang_id","satuan_jual_id");--> statement-breakpoint
CREATE INDEX "item_keranjang_satuan_jual_idx" ON "item_keranjang" USING btree ("satuan_jual_id");--> statement-breakpoint
CREATE UNIQUE INDEX "keranjang_pribadi_aktif_uk" ON "keranjang" USING btree ("akun_id") WHERE grup_id IS NULL AND status = 'AKTIF';--> statement-breakpoint
CREATE UNIQUE INDEX "keranjang_grup_aktif_uk" ON "keranjang" USING btree ("akun_id","grup_id") WHERE grup_id IS NOT NULL AND status <> 'DITINGGALKAN';--> statement-breakpoint
CREATE INDEX "keranjang_grup_idx" ON "keranjang" USING btree ("grup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peserta_grup_akun_aktif_uk" ON "peserta_grup" USING btree ("grup_id","akun_id") WHERE status NOT IN ('DIKELUARKAN', 'BATAL', 'DIREFUND');--> statement-breakpoint
CREATE UNIQUE INDEX "peserta_grup_satu_host_uk" ON "peserta_grup" USING btree ("grup_id") WHERE peran = 'HOST' AND status NOT IN ('DIKELUARKAN', 'BATAL', 'DIREFUND');--> statement-breakpoint
CREATE UNIQUE INDEX "peserta_grup_keranjang_uk" ON "peserta_grup" USING btree ("keranjang_id");--> statement-breakpoint
CREATE INDEX "peserta_grup_akun_idx" ON "peserta_grup" USING btree ("akun_id");--> statement-breakpoint
CREATE UNIQUE INDEX "baris_biaya_admin_satu_uk" ON "baris_invoice" USING btree ("peserta_id") WHERE jenis = 'BIAYA_ADMIN' AND NOT dibatalkan;--> statement-breakpoint
CREATE INDEX "baris_invoice_idx" ON "baris_invoice" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "baris_peserta_idx" ON "baris_invoice" USING btree ("peserta_id");--> statement-breakpoint
CREATE INDEX "baris_satuan_jual_idx" ON "baris_invoice" USING btree ("satuan_jual_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_nomor_uk" ON "invoice" USING btree ("nomor");--> statement-breakpoint
CREATE INDEX "invoice_kedaluwarsa_idx" ON "invoice" USING btree ("status","kedaluwarsa_pada") WHERE status = 'DITERBITKAN';--> statement-breakpoint
CREATE INDEX "invoice_grup_idx" ON "invoice" USING btree ("grup_id");--> statement-breakpoint
CREATE INDEX "invoice_pembayar_idx" ON "invoice" USING btree ("pembayar_akun_id","diterbitkan_pada" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_peserta_satu_aktif_uk" ON "invoice_peserta" USING btree ("peserta_id") WHERE aktif;--> statement-breakpoint
CREATE INDEX "ppn_berlaku_idx" ON "konfigurasi_ppn" USING btree ("berlaku_mulai" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "pembayaran_xendit_ref_uk" ON "pembayaran" USING btree ("xendit_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "pembayaran_kunci_idempotensi_uk" ON "pembayaran" USING btree ("kunci_idempotensi");--> statement-breakpoint
CREATE UNIQUE INDEX "pembayaran_satu_hidup_uk" ON "pembayaran" USING btree ("invoice_id") WHERE status IN ('MENUNGGU', 'LUNAS');--> statement-breakpoint
CREATE INDEX "pembayaran_status_idx" ON "pembayaran" USING btree ("status","dibuat_pada");--> statement-breakpoint
CREATE UNIQUE INDEX "reservasi_baris_uk" ON "reservasi_stok" USING btree ("baris_invoice_id");--> statement-breakpoint
CREATE INDEX "reservasi_aktif_idx" ON "reservasi_stok" USING btree ("sku_id","gudang_id") WHERE status = 'AKTIF';--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_id_gateway_uk" ON "webhook_event" USING btree ("gateway","event_id_gateway");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_external_status_uk" ON "webhook_event" USING btree ("gateway","external_id","status");--> statement-breakpoint
CREATE INDEX "webhook_event_pembayaran_idx" ON "webhook_event" USING btree ("pembayaran_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_kunci_idempotensi_uk" ON "ledger_saldo" USING btree ("kunci_idempotensi");--> statement-breakpoint
CREATE INDEX "ledger_akun_idx" ON "ledger_saldo" USING btree ("akun_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "pencairan_kunci_idempotensi_uk" ON "pencairan_saldo" USING btree ("kunci_idempotensi");--> statement-breakpoint
CREATE UNIQUE INDEX "pencairan_xendit_ref_uk" ON "pencairan_saldo" USING btree ("xendit_disbursement_ref");--> statement-breakpoint
CREATE INDEX "pencairan_akun_idx" ON "pencairan_saldo" USING btree ("akun_id","dibuat_pada");--> statement-breakpoint
CREATE INDEX "koreksi_akun_idx" ON "pengajuan_koreksi_saldo" USING btree ("akun_id");--> statement-breakpoint
CREATE INDEX "tujuan_akun_idx" ON "tujuan_pencairan_terverifikasi" USING btree ("akun_id");--> statement-breakpoint
CREATE INDEX "kuotasi_grup_idx" ON "kuotasi_ongkir" USING btree ("grup_id");--> statement-breakpoint
CREATE INDEX "kuotasi_peserta_idx" ON "kuotasi_ongkir" USING btree ("peserta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_diskon_invoice_uk" ON "pemakaian_promo" USING btree ("aturan_diskon_id","invoice_id") WHERE aturan_diskon_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_gratis_ongkir_invoice_uk" ON "pemakaian_promo" USING btree ("aturan_gratis_ongkir_id","invoice_id") WHERE aturan_gratis_ongkir_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_satu_diskon_per_invoice_uk" ON "pemakaian_promo" USING btree ("invoice_id") WHERE aturan_diskon_id IS NOT NULL AND status IN ('DIRESERVASI', 'TERPAKAI');--> statement-breakpoint
CREATE UNIQUE INDEX "promo_satu_gratis_ongkir_per_invoice_uk" ON "pemakaian_promo" USING btree ("invoice_id") WHERE aturan_gratis_ongkir_id IS NOT NULL AND status IN ('DIRESERVASI', 'TERPAKAI');--> statement-breakpoint
CREATE INDEX "promo_diskon_akun_idx" ON "pemakaian_promo" USING btree ("aturan_diskon_id","akun_id") WHERE status IN ('DIRESERVASI', 'TERPAKAI');--> statement-breakpoint
CREATE INDEX "promo_gratis_ongkir_akun_idx" ON "pemakaian_promo" USING btree ("aturan_gratis_ongkir_id","akun_id") WHERE status IN ('DIRESERVASI', 'TERPAKAI');--> statement-breakpoint
CREATE INDEX "tarif_armada_berlaku_idx" ON "tarif_armada" USING btree ("armada_kode","berlaku_mulai" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_kunci_idempotensi_uk" ON "outbox" USING btree ("kunci_idempotensi");--> statement-breakpoint
CREATE INDEX "outbox_antrean_idx" ON "outbox" USING btree ("kirim_setelah") WHERE status = 'MENUNGGU';--> statement-breakpoint
CREATE INDEX "outbox_grup_idx" ON "outbox" USING btree ("grup_id");