-- T-013b · Aturan transaksi yang tidak bisa dinyatakan lewat skema Drizzle.
-- Catatan keamanan: penanda transaksi-lokal `nekat.*` mencegah salah tulis dari kode aplikasi, BUKAN
-- pengaman terhadap peran DB yang jahat (siapa pun bisa set_config). Pembatasan peran (app_rw tanpa
-- UPDATE/DELETE di tabel append-only, SECURITY DEFINER + EXECUTE terbatas) dikerjakan di T-045 (ADR §7).

-- 1. diubah_pada otomatis untuk tabel baru (fungsi set_diubah_pada() dari 0002).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'diubah_pada' AND c.table_name <> 'konfigurasi'
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger g JOIN pg_class k ON k.oid = g.tgrelid
          WHERE k.relname = c.table_name AND g.tgname = c.table_name || '_diubah_pada'
       )
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_diubah_pada()',
                   t || '_diubah_pada', t);
  END LOOP;
END;
$$;
--> statement-breakpoint

-- 2. Tabel append-only (T-004 M5): UPDATE/DELETE ditolak (fungsi tolak_ubah_append_only() dari 0002).
CREATE TRIGGER "ledger_saldo_append_only" BEFORE UPDATE OR DELETE ON "ledger_saldo"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint
CREATE TRIGGER "webhook_event_append_only" BEFORE UPDATE OR DELETE ON "webhook_event"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint
CREATE TRIGGER "konfigurasi_ppn_append_only" BEFORE UPDATE OR DELETE ON "konfigurasi_ppn"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint
CREATE TRIGGER "pengajuan_koreksi_saldo_append_only" BEFORE UPDATE OR DELETE ON "pengajuan_koreksi_saldo"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint
CREATE TRIGGER "keputusan_koreksi_saldo_append_only" BEFORE UPDATE OR DELETE ON "keputusan_koreksi_saldo"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint
-- Hasil idempotensi InventorySource tidak pernah diubah (hash pertama yang berlaku). DELETE dibiarkan untuk retensi.
CREATE TRIGGER "idempotensi_inventori_tanpa_ubah" BEFORE UPDATE ON "idempotensi_inventori"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_append_only();
--> statement-breakpoint

-- 3. webhook_payload: tanpa UPDATE; DELETE hanya lewat pangkas_webhook_payload() (M5 pengecualian 2).
CREATE OR REPLACE FUNCTION tolak_ubah_webhook_payload() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('nekat.retensi', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'tabel webhook_payload append-only: % hanya lewat pangkas_webhook_payload()', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "webhook_payload_append_only" BEFORE UPDATE OR DELETE ON "webhook_payload"
  FOR EACH ROW EXECUTE FUNCTION tolak_ubah_webhook_payload();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pangkas_webhook_payload(p_batas timestamptz) RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('nekat.retensi', 'on', true);
  DELETE FROM webhook_payload WHERE dibuat_pada < p_batas;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('nekat.retensi', 'off', true);
  INSERT INTO log_audit (jenis, aktor, data)
  VALUES ('PANGKAS_WEBHOOK_PAYLOAD', 'SISTEM', jsonb_build_object('batas', p_batas, 'jumlah', n));
  RETURN n;
END;
$$;
--> statement-breakpoint

-- 4. Saldo satu ledger (K-13): akun_saldo hanya berubah lewat insert ledger_saldo.
CREATE OR REPLACE FUNCTION jaga_akun_saldo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND current_setting('nekat.ledger', true) = 'on' THEN
    RETURN NEW;
  END IF;
  -- Baris awal bersaldo 0 boleh dibuat langsung (mis. saat akun dibuat).
  IF TG_OP = 'INSERT' AND NEW.saldo_rp = 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'akun_saldo hanya berubah lewat ledger_saldo (%)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "akun_saldo_hanya_lewat_ledger" BEFORE INSERT OR UPDATE OR DELETE ON "akun_saldo"
  FOR EACH ROW EXECUTE FUNCTION jaga_akun_saldo();
--> statement-breakpoint
-- AFTER INSERT (bukan BEFORE): baris yang dilewati `ON CONFLICT DO NOTHING` tidak mengubah saldo.
-- Pemanggil wajib mengunci akun_saldo FOR UPDATE lalu mengisi saldo_sesudah_rp = saldo + jumlah;
-- bila tidak cocok (salah hitung / balapan) seluruh statement ditolak, saldo tidak pernah menyimpang.
CREATE OR REPLACE FUNCTION terapkan_ledger_saldo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE saldo_baru bigint;
BEGIN
  PERFORM set_config('nekat.ledger', 'on', true);
  -- Bukan INSERT ... ON CONFLICT: CHECK dievaluasi pada baris usulan insert (jumlah debit negatif).
  UPDATE akun_saldo SET saldo_rp = saldo_rp + NEW.jumlah_rp WHERE akun_id = NEW.akun_id
  RETURNING saldo_rp INTO saldo_baru;
  IF NOT FOUND THEN
    -- Baris pertama; dua transaksi bersamaan untuk akun baru → salah satu gagal unique (bukan menyimpang).
    INSERT INTO akun_saldo (akun_id, saldo_rp) VALUES (NEW.akun_id, NEW.jumlah_rp)
    RETURNING saldo_rp INTO saldo_baru;
  END IF;
  PERFORM set_config('nekat.ledger', 'off', true);
  IF saldo_baru <> NEW.saldo_sesudah_rp THEN
    RAISE EXCEPTION 'ledger_saldo_sesudah_tidak_cocok: saldo_sesudah_rp % <> saldo hasil %', NEW.saldo_sesudah_rp, saldo_baru
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_saldo_terapkan" AFTER INSERT ON "ledger_saldo"
  FOR EACH ROW EXECUTE FUNCTION terapkan_ledger_saldo();
--> statement-breakpoint

-- 5. Four-eyes koreksi saldo: pemutus ≠ pengaju (T-004 §3.11).
CREATE OR REPLACE FUNCTION cek_four_eyes_koreksi() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pengajuan_koreksi_saldo p WHERE p.id = NEW.pengajuan_id AND p.diajukan_oleh = NEW.diputuskan_oleh
  ) THEN
    RAISE EXCEPTION 'koreksi_four_eyes: pengaju tidak boleh memutuskan pengajuannya sendiri'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "keputusan_koreksi_four_eyes" BEFORE INSERT ON "keputusan_koreksi_saldo"
  FOR EACH ROW EXECUTE FUNCTION cek_four_eyes_koreksi();
--> statement-breakpoint

-- 6. K-22: setelah tagihan terbit tidak bisa tambah anggota maupun barang.
CREATE OR REPLACE FUNCTION tolak_peserta_setelah_tagihan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM grup g WHERE g.id = NEW.grup_id AND g.tagihan_diterbitkan_pada IS NOT NULL) THEN
    RAISE EXCEPTION 'grup_tagihan_terbit: tidak bisa menambah anggota setelah tagihan terbit'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "peserta_grup_tolak_setelah_tagihan" BEFORE INSERT ON "peserta_grup"
  FOR EACH ROW EXECUTE FUNCTION tolak_peserta_setelah_tagihan();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tolak_item_setelah_tagihan() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k_baru uuid;
  k_lama uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    k_baru := NEW.keranjang_id;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    k_lama := OLD.keranjang_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM keranjang k JOIN grup g ON g.id = k.grup_id
     WHERE k.id IN (k_baru, k_lama) AND g.tagihan_diterbitkan_pada IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'grup_tagihan_terbit: isi keranjang grup terkunci setelah tagihan terbit (%)', TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "item_keranjang_tolak_setelah_tagihan" BEFORE INSERT OR UPDATE OR DELETE ON "item_keranjang"
  FOR EACH ROW EXECUTE FUNCTION tolak_item_setelah_tagihan();
--> statement-breakpoint

-- 7. F-07 / K-40: tidak bisa batal setelah bayar. Dari status sesudah lunas, peserta tidak bisa kembali
--    ke AKTIF/MENUNGGU_BAYAR atau menjadi BATAL/DIKELUARKAN; dana kembali hanya lewat DIREFUND
--    (grup batal / stok habis). Transisi maju lainnya dicek domain (update bersyarat WHERE status = asal).
CREATE OR REPLACE FUNCTION cek_peserta_tidak_batal_setelah_bayar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('LUNAS', 'TERKUNCI', 'DIPROSES', 'DIKIRIM', 'SIAP_DIAMBIL', 'DITERIMA', 'DITOLAK',
                    'DANA_DITAHAN', 'TIDAK_DIAMBIL')
     AND NEW.status IN ('AKTIF', 'MENUNGGU_BAYAR', 'BATAL', 'DIKELUARKAN') THEN
    RAISE EXCEPTION 'peserta_tidak_batal_setelah_bayar: % → % tidak diizinkan (F-07, K-40)', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "peserta_grup_tidak_batal_setelah_bayar" BEFORE UPDATE OF status ON "peserta_grup"
  FOR EACH ROW EXECUTE FUNCTION cek_peserta_tidak_batal_setelah_bayar();
