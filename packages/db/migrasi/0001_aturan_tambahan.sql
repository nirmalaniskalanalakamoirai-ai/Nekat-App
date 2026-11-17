-- T-013a: aturan yang tidak bisa dinyatakan lewat skema Drizzle (T-004 §1 M5, §3.4).

-- 1) FK melingkar zona -> drop_point: DEFERRABLE INITIALLY DEFERRED, agar zona dan drop point
--    pertamanya bisa dibuat dalam satu transaksi (zona aktif wajib punya drop point).
ALTER TABLE "zona"
  ADD CONSTRAINT "zona_drop_point_pusat_id_drop_point_id_fk"
  FOREIGN KEY ("drop_point_pusat_id") REFERENCES "drop_point"("id")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- 2) persetujuan_legal append-only (M5). Satu-satunya perubahan yang diizinkan:
--    anonimisasi ip_hmac & user_agent_ringkas menjadi NULL lewat fungsi anonimkan_persetujuan_legal().
CREATE FUNCTION "tolak_ubah_persetujuan_legal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('nekat.anonimisasi', true) = 'on'
     AND NEW.id = OLD.id
     AND NEW.akun_id = OLD.akun_id
     AND NEW.dokumen_legal_id = OLD.dokumen_legal_id
     AND NEW.disetujui_pada = OLD.disetujui_pada
     AND NEW.kanal = OLD.kanal
     AND NEW.ip_hmac IS NULL
     AND NEW.user_agent_ringkas IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'persetujuan_legal bersifat append-only (%)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "persetujuan_legal_append_only"
  BEFORE UPDATE OR DELETE ON "persetujuan_legal"
  FOR EACH ROW EXECUTE FUNCTION "tolak_ubah_persetujuan_legal"();
--> statement-breakpoint
CREATE FUNCTION "anonimkan_persetujuan_legal"(p_akun_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  jumlah integer;
BEGIN
  PERFORM set_config('nekat.anonimisasi', 'on', true);
  UPDATE "persetujuan_legal" SET "ip_hmac" = NULL, "user_agent_ringkas" = NULL
    WHERE "akun_id" = p_akun_id;
  GET DIAGNOSTICS jumlah = ROW_COUNT;
  PERFORM set_config('nekat.anonimisasi', 'off', true);
  RETURN jumlah;
END;
$$;
