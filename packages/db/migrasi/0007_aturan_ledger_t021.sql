-- T-021 ledger saldo (expand-only):
--   1. ledger_saldo.invoice_id (nullable, FK) + indeks: domain mengikat entri berbasis invoice ke invoice sumber
--      dana dan menjaga Σ(REFUND + REFUND_ONGKIR + SELISIH_HARGA) ≤ invoice.total_rp, serta SALDO_BALIK dan
--      REFUND tidak pernah sama-sama ada untuk satu invoice (dicek kode di bawah kunci invoice FOR UPDATE).
--   2. Four-eyes koreksi saldo: pengaju & pemutus wajib admin AKTIF (melengkapi trigger 0004 pemutus ≠ pengaju).
ALTER TABLE "ledger_saldo" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_saldo" ADD CONSTRAINT "ledger_saldo_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_invoice_idx" ON "ledger_saldo" USING btree ("invoice_id","jenis") WHERE invoice_id IS NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION cek_pengaju_koreksi_aktif() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM admin a WHERE a.id = NEW.diajukan_oleh AND a.status = 'AKTIF' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'koreksi_admin_tidak_aktif: pengaju harus admin AKTIF'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pengajuan_koreksi_admin_aktif" BEFORE INSERT ON "pengajuan_koreksi_saldo"
  FOR EACH ROW EXECUTE FUNCTION cek_pengaju_koreksi_aktif();
--> statement-breakpoint
-- Pemutus wajib AKTIF; untuk DISETUJUI pengaju juga harus masih AKTIF (pengajuan admin yang sudah
-- dinonaktifkan tidak bisa disetujui, hanya ditolak).
CREATE OR REPLACE FUNCTION cek_pemutus_koreksi_aktif() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM admin a WHERE a.id = NEW.diputuskan_oleh AND a.status = 'AKTIF' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'koreksi_admin_tidak_aktif: pemutus harus admin AKTIF'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.hasil = 'DISETUJUI' THEN
    PERFORM 1 FROM pengajuan_koreksi_saldo p JOIN admin a ON a.id = p.diajukan_oleh
     WHERE p.id = NEW.pengajuan_id AND a.status = 'AKTIF' FOR SHARE OF a;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'koreksi_admin_tidak_aktif: pengaju harus admin AKTIF untuk disetujui'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "keputusan_koreksi_admin_aktif" BEFORE INSERT ON "keputusan_koreksi_saldo"
  FOR EACH ROW EXECUTE FUNCTION cek_pemutus_koreksi_aktif();
