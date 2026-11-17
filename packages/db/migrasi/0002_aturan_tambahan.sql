-- T-013a · Aturan yang tidak bisa dinyatakan lewat skema Drizzle.

-- 1. FK melingkar zona ↔ drop_point (T-004 §3.4): zona & drop point pertama dibuat dalam satu transaksi.
ALTER TABLE "zona"
  ADD CONSTRAINT "zona_drop_point_pusat_id_drop_point_id_fk"
  FOREIGN KEY ("drop_point_pusat_id") REFERENCES "drop_point"("id")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- Drop point pusat harus berada di zona itu sendiri.
CREATE OR REPLACE FUNCTION cek_drop_point_pusat_zona() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.drop_point_pusat_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM drop_point d WHERE d.id = NEW.drop_point_pusat_id AND d.zona_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'drop point pusat % bukan milik zona %', NEW.drop_point_pusat_id, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "zona_drop_point_pusat_milik_zona"
  AFTER INSERT OR UPDATE OF drop_point_pusat_id ON "zona"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cek_drop_point_pusat_zona();
--> statement-breakpoint

-- 2. Kategori maks. 2 tingkat (T-004 §3.5): induk harus kategori akar; kategori yang punya anak tidak boleh jadi subkategori.
ALTER TABLE "kategori"
  ADD CONSTRAINT "kategori_induk_id_kategori_id_fk"
  FOREIGN KEY ("induk_id") REFERENCES "kategori"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cek_kedalaman_kategori() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.induk_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM kategori k WHERE k.id = NEW.induk_id AND k.induk_id IS NOT NULL) THEN
      RAISE EXCEPTION 'kategori maksimal 2 tingkat (induk % sudah subkategori)', NEW.induk_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM kategori k WHERE k.induk_id = NEW.id) THEN
      RAISE EXCEPTION 'kategori % punya subkategori, tidak bisa dijadikan subkategori', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "kategori_maks_dua_tingkat"
  BEFORE INSERT OR UPDATE OF induk_id ON "kategori"
  FOR EACH ROW EXECUTE FUNCTION cek_kedalaman_kategori();
--> statement-breakpoint

-- Produk hanya boleh ditempel ke SUBKATEGORI (T-004 §3.5).
CREATE OR REPLACE FUNCTION cek_produk_di_subkategori() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kategori k WHERE k.id = NEW.kategori_id AND k.induk_id IS NOT NULL) THEN
    RAISE EXCEPTION 'produk wajib di subkategori, bukan kategori akar (%)', NEW.kategori_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "produk_di_subkategori"
  BEFORE INSERT OR UPDATE OF kategori_id ON "produk"
  FOR EACH ROW EXECUTE FUNCTION cek_produk_di_subkategori();
--> statement-breakpoint

-- 3. Tabel append-only (T-004 M5): UPDATE/DELETE ditolak untuk semua peran.
CREATE OR REPLACE FUNCTION tolak_ubah_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tabel % append-only: % tidak diizinkan', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "log_admin_append_only" BEFORE UPDATE OR DELETE ON "log_admin"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint
CREATE TRIGGER "log_audit_append_only" BEFORE UPDATE OR DELETE ON "log_audit"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint

-- persetujuan_legal: append-only, kecuali anonimkan_akun() boleh meng-NULL-kan ip_hmac & user_agent_ringkas (M5 pengecualian 3).
CREATE OR REPLACE FUNCTION tolak_ubah_persetujuan_legal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('nekat.anonimisasi', true) = 'on'
     AND NEW.id = OLD.id AND NEW.akun_id = OLD.akun_id AND NEW.dokumen_legal_id = OLD.dokumen_legal_id
     AND NEW.disetujui_pada = OLD.disetujui_pada AND NEW.kanal = OLD.kanal AND NEW.dibuat_pada = OLD.dibuat_pada
     AND NEW.ip_hmac IS NULL AND NEW.user_agent_ringkas IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tabel persetujuan_legal append-only: % tidak diizinkan', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "persetujuan_legal_append_only" BEFORE UPDATE OR DELETE ON "persetujuan_legal"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_persetujuan_legal();
--> statement-breakpoint

-- anonimkan_akun(): hapus PII akun, alamat, & jejak IP persetujuan; transaksi tetap (T-004 §6.3).
-- Penandaan transaksi-lokal `nekat.anonimisasi` hanya dipasang di dalam fungsi ini.
-- SECURITY DEFINER + EXECUTE dibatasi ke peran khusus dilakukan di T-045 (peran DB, ADR §7).
CREATE OR REPLACE FUNCTION anonimkan_akun(p_akun_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('nekat.anonimisasi', 'on', true);
  UPDATE persetujuan_legal SET ip_hmac = NULL, user_agent_ringkas = NULL WHERE akun_id = p_akun_id;
  UPDATE alamat SET alamat_teks = NULL, patokan = NULL, catatan_kurir = NULL, lat = NULL, lng = NULL,
                    dihapus_pada = COALESCE(dihapus_pada, now())
   WHERE akun_id = p_akun_id;
  UPDATE akun SET nomor_hp_e164 = NULL, nama_panggilan = NULL, status = 'DIHAPUS',
                  dianonimkan_pada = now(), diubah_pada = now()
   WHERE id = p_akun_id;
  PERFORM set_config('nekat.anonimisasi', 'off', true);
  INSERT INTO log_audit (jenis, aktor, ref_jenis, ref_id) VALUES ('ANONIMISASI_AKUN', 'SISTEM', 'akun', p_akun_id::text);
END;
$$;
--> statement-breakpoint

-- 4. diubah_pada otomatis.
CREATE OR REPLACE FUNCTION set_diubah_pada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.diubah_pada := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'diubah_pada' AND c.table_name <> 'konfigurasi'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_diubah_pada()',
                   t || '_diubah_pada', t);
  END LOOP;
END;
$$;
