-- T-013b putaran perbaikan 1 (review & audit): harga final > modal cut-off (P-16), FK komposit kuotasi_ongkir
-- ke grup yang sama, indeks retensi webhook_payload, satu ledger KOREKSI_ADMIN per pengajuan, kelengkapan
-- penyetuju/pemroses pencairan. Trigger pendukung ada di 0004.
ALTER TABLE "baris_invoice" DROP CONSTRAINT "baris_harga_final";--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" DROP CONSTRAINT "kuotasi_ongkir_peserta_id_peserta_grup_id_fk";
--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" DROP CONSTRAINT "kuotasi_ongkir_dipakai_di_invoice_id_invoice_id_fk";
--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" ADD CONSTRAINT "kuotasi_peserta_grup_fk" FOREIGN KEY ("peserta_id","grup_id") REFERENCES "public"."peserta_grup"("id","grup_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuotasi_ongkir" ADD CONSTRAINT "kuotasi_invoice_grup_fk" FOREIGN KEY ("dipakai_di_invoice_id","grup_id") REFERENCES "public"."invoice"("id","grup_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_payload_dibuat_idx" ON "webhook_payload" USING btree ("dibuat_pada");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_koreksi_satu_per_pengajuan_uk" ON "ledger_saldo" USING btree ("referensi_id") WHERE jenis = 'KOREKSI_ADMIN';--> statement-breakpoint
ALTER TABLE "baris_invoice" ADD CONSTRAINT "baris_harga_final" CHECK (harga_final_rp IS NULL OR (modal_cutoff_rp IS NOT NULL AND harga_final_rp > modal_cutoff_rp AND harga_final_rp <= harga_dibayar_rp));--> statement-breakpoint
ALTER TABLE "pencairan_saldo" ADD CONSTRAINT "pencairan_disetujui_lengkap" CHECK (status NOT IN ('DISETUJUI', 'DIPROSES', 'BERHASIL') OR disetujui_oleh IS NOT NULL);--> statement-breakpoint
ALTER TABLE "pencairan_saldo" ADD CONSTRAINT "pencairan_diproses_lengkap" CHECK (status NOT IN ('DIPROSES', 'BERHASIL') OR diproses_oleh IS NOT NULL);