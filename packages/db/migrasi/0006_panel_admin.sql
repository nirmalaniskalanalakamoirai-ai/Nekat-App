-- T-036 panel admin dasar: faktor pertama kata sandi (scrypt) sementara (lihat keputusan terbuka di laporan T-036),
-- dan indeks unik kode pemulihan TOTP per admin. Kolom TOTP/lockout/sesi sudah ada sejak 0001.
ALTER TABLE "admin" ADD COLUMN "kata_sandi_hash" text;--> statement-breakpoint
ALTER TABLE "admin" ADD COLUMN "kata_sandi_diubah_pada" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "kode_pemulihan_admin_hash_uk" ON "kode_pemulihan_totp" USING btree ("admin_id","kode_hash");--> statement-breakpoint
ALTER TABLE "admin" ADD CONSTRAINT "admin_kata_sandi_format" CHECK (kata_sandi_hash IS NULL OR kata_sandi_hash ~ '^scrypt[$][0-9]+[$][0-9]+[$][0-9]+[$][A-Za-z0-9_-]+[$][A-Za-z0-9_-]+$');