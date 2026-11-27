-- T-029 integrasi Xendit (QRIS/VA), expand-only:
--   1. STATUS_PEMBAYARAN + LUNAS_TERLAMBAT (docs/flow/pembayaran.md §4.2, §15 T-9). Sengaja di luar
--      partial UK `pembayaran_satu_hidup_uk` (tetap MENUNGGU/LUNAS). `pembayaran_lunas_lengkap` diperluas:
--      LUNAS_TERLAMBAT wajib punya paid_at_gateway. Transisi ke LUNAS_TERLAMBAT ditulis T-030.
--   2. pembayaran.instruksi (jsonb, nullable): instruksi bayar (QR string / nomor VA + bank + nama penerima)
--      dari gateway agar POST /bayar ganda & GET status mengembalikan instruksi yang sama tanpa memanggil
--      Xendit lagi. Hanya boleh ada bila xendit_ref sudah ada.
--   3. pembayaran.alasan_gagal: kode gagal permanen (FP-25), hanya untuk status GAGAL.
--   4. CHECK kanal: VA wajib kode bank, QRIS tanpa kanal. NOT VALID: baris lama tidak dicek (expand aman).
--   5. Trigger status akhir: selain MENUNGGU → apa pun, kini juga KEDALUWARSA/GAGAL → LUNAS_TERLAMBAT
--      (§4.2: pembayaran lama yang tetap terbayar). Tidak pernah KEDALUWARSA/GAGAL → LUNAS.
-- Catatan nomor: T-021 (PR #36, belum di main) memakai 0007. File ini 0008 dengan `when` jurnal lebih besar;
-- bila #36 di-merge setelah ini, snapshot 0008 harus di-rebase ke snapshot 0007 (prevId) sebelum migrasi
-- dijalankan di DB yang sudah menerapkan 0008 (migrator drizzle melewati entri dengan `when` lebih kecil).
ALTER TABLE "pembayaran" DROP CONSTRAINT "pembayaran_status";--> statement-breakpoint
ALTER TABLE "pembayaran" DROP CONSTRAINT "pembayaran_lunas_lengkap";--> statement-breakpoint
ALTER TABLE "pembayaran" ADD COLUMN "instruksi" jsonb;--> statement-breakpoint
ALTER TABLE "pembayaran" ADD COLUMN "alasan_gagal" text;--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_instruksi_butuh_ref" CHECK (instruksi IS NULL OR (xendit_ref IS NOT NULL AND jsonb_typeof(instruksi) = 'object'));--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_alasan_gagal" CHECK (alasan_gagal IS NULL OR (status = 'GAGAL' AND alasan_gagal IN ('METODE_TIDAK_DIDUKUNG', 'NOMINAL_DI_BAWAH_MINIMUM', 'DITOLAK_GATEWAY', 'GAGAL_GATEWAY')));--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_kanal_va" CHECK ((metode = 'VA') = (kanal IS NOT NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_status" CHECK (status IN ('MENUNGGU', 'LUNAS', 'KEDALUWARSA', 'GAGAL', 'NOMINAL_TIDAK_COCOK', 'LUNAS_TERLAMBAT'));--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_lunas_lengkap" CHECK (status NOT IN ('LUNAS', 'LUNAS_TERLAMBAT') OR paid_at_gateway IS NOT NULL);;--> statement-breakpoint
CREATE OR REPLACE FUNCTION cek_status_akhir_pembayaran() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status OR OLD.status = 'MENUNGGU' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('KEDALUWARSA', 'GAGAL') AND NEW.status = 'LUNAS_TERLAMBAT' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'pembayaran_status_akhir: % tidak bisa berubah ke %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;
