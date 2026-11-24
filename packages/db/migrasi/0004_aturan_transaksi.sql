-- T-013b · Aturan transaksi yang tidak bisa dinyatakan lewat skema Drizzle.
-- Catatan keamanan: penanda transaksi-lokal `nekat.*` mencegah salah tulis dari kode aplikasi, BUKAN
-- pengaman terhadap peran DB yang jahat (siapa pun bisa set_config). Pembatasan peran (app_rw tanpa
-- UPDATE/DELETE di tabel append-only, SECURITY DEFINER + EXECUTE terbatas) dikerjakan di T-045 (ADR §7).
-- Ditunda ke T-045 (temuan review T-013b putaran 1):
--   * peran DB (app_rw, migrasi, laporan_ro, retensi) + SECURITY DEFINER untuk pangkas_webhook_payload()
--     dan anonimkan_akun(), EXECUTE hanya untuk peran retensi;
--   * celah bypass penanda set_config('nekat.ledger' / 'nekat.retensi') oleh peran yang bisa menjalankan SQL bebas;
--   * CHECK/validasi kunci PII di payload jsonb (outbox, webhook_payload, antrean_tinjauan, log_*).
-- Kewajiban DOMAIN (bukan DB): debit ledger `PENCAIRAN` di transaksi yang sama dengan insert pencairan_saldo
-- (dan `PENCAIRAN_BATAL` saat GAGAL/DITOLAK); cek modal memakai harga tanpa PPN (K-28); jumlah reservasi
-- AKTIF tidak melebihi stok tersedia (lintas baris, di bawah kunci stok_lokasi).

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
DECLARE
  n integer;
  hari integer;
BEGIN
  -- Masa simpan minimal: konfigurasi `retensi.webhook_payload_hari` (angka hari), bawaan 90 hari (T-004 §6.3).
  SELECT CASE WHEN jsonb_typeof(k.nilai) = 'number' THEN (k.nilai #>> '{}')::integer END
    INTO hari FROM konfigurasi k WHERE k.kunci = 'retensi.webhook_payload_hari';
  hari := GREATEST(COALESCE(hari, 90), 1);
  IF p_batas IS NULL OR p_batas > now() - make_interval(days => hari) THEN
    RAISE EXCEPTION 'pangkas_webhook_payload: batas % lebih baru dari masa simpan minimal % hari', p_batas, hari
      USING ERRCODE = 'check_violation';
  END IF;
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
  -- Baris pertama bersaldo 0 (tidak memicu CHECK); transaksi bersamaan untuk akun baru menunggu baris
  -- yang sama alih-alih gagal unique. Lalu UPDATE (mengunci baris) menerapkan mutasi.
  INSERT INTO akun_saldo (akun_id, saldo_rp) VALUES (NEW.akun_id, 0) ON CONFLICT (akun_id) DO NOTHING;
  PERFORM set_config('nekat.ledger', 'on', true);
  UPDATE akun_saldo SET saldo_rp = saldo_rp + NEW.jumlah_rp WHERE akun_id = NEW.akun_id
  RETURNING saldo_rp INTO saldo_baru;
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
-- Ledger KOREKSI_ADMIN wajib lewat pengajuan yang DISETUJUI admin lain (default paling aman: SEMUA koreksi,
-- kredit maupun debit, tanpa ambang). Satu ledger per pengajuan: indeks ledger_koreksi_satu_per_pengajuan_uk (0005).
CREATE OR REPLACE FUNCTION cek_ledger_koreksi() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pj pengajuan_koreksi_saldo%ROWTYPE;
  pemutus uuid;
BEGIN
  IF NEW.jenis <> 'KOREKSI_ADMIN' THEN
    IF NEW.referensi_jenis = 'PENGAJUAN_KOREKSI' THEN
      RAISE EXCEPTION 'ledger_koreksi_tidak_sah: referensi PENGAJUAN_KOREKSI hanya untuk KOREKSI_ADMIN'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.referensi_jenis IS DISTINCT FROM 'PENGAJUAN_KOREKSI' OR NEW.referensi_id IS NULL THEN
    RAISE EXCEPTION 'ledger_koreksi_tidak_sah: KOREKSI_ADMIN wajib merujuk pengajuan_koreksi_saldo'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO pj FROM pengajuan_koreksi_saldo WHERE id = NEW.referensi_id FOR SHARE;
  IF NOT FOUND OR pj.akun_id <> NEW.akun_id OR pj.jumlah_rp <> NEW.jumlah_rp
     OR NEW.dibuat_oleh_admin_id IS DISTINCT FROM pj.diajukan_oleh THEN
    RAISE EXCEPTION 'ledger_koreksi_tidak_sah: akun, jumlah, atau pengaju tidak sama dengan pengajuan %', NEW.referensi_id
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT k.diputuskan_oleh INTO pemutus FROM keputusan_koreksi_saldo k
   WHERE k.pengajuan_id = pj.id AND k.hasil = 'DISETUJUI';
  IF NOT FOUND OR NEW.disetujui_oleh_admin_id IS NULL OR NEW.disetujui_oleh_admin_id <> pemutus THEN
    RAISE EXCEPTION 'ledger_koreksi_tidak_sah: pengajuan % belum DISETUJUI atau penyetuju tidak cocok', pj.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_saldo_cek_koreksi" BEFORE INSERT ON "ledger_saldo"
  FOR EACH ROW EXECUTE FUNCTION cek_ledger_koreksi();
--> statement-breakpoint

-- 6. K-22: setelah tagihan terbit tidak bisa tambah anggota maupun barang, dan tagihan tidak bisa "dibuka lagi".
--    Cek memakai FOR SHARE pada baris grup: penerbitan tagihan (UPDATE grup) menunggu insert yang sedang
--    berjalan, dan insert yang datang belakangan melihat tagihan_diterbitkan_pada yang sudah terisi.
CREATE OR REPLACE FUNCTION tolak_buka_ulang_tagihan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tagihan_diterbitkan_pada IS NOT NULL
     AND NEW.tagihan_diterbitkan_pada IS DISTINCT FROM OLD.tagihan_diterbitkan_pada THEN
    RAISE EXCEPTION 'grup_tagihan_terbit: waktu terbit tagihan tidak bisa diubah atau dihapus'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "grup_tagihan_tidak_dibuka_ulang" BEFORE UPDATE ON "grup"
  FOR EACH ROW EXECUTE FUNCTION tolak_buka_ulang_tagihan();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tolak_peserta_setelah_tagihan() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE terbit timestamptz;
BEGIN
  SELECT g.tagihan_diterbitkan_pada INTO terbit FROM grup g WHERE g.id = NEW.grup_id FOR SHARE;
  IF terbit IS NOT NULL THEN
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
  -- Kunci baris grup terkait (bila keranjang grup) lalu periksa; keranjang pribadi tidak terkena.
  PERFORM 1 FROM keranjang k JOIN grup g ON g.id = k.grup_id
    WHERE k.id IN (k_baru, k_lama)
    FOR SHARE OF g;
  PERFORM 1 FROM keranjang k JOIN grup g ON g.id = k.grup_id
    WHERE k.id IN (k_baru, k_lama) AND g.tagihan_diterbitkan_pada IS NOT NULL;
  IF FOUND THEN
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
--    (grup batal / stok habis). DIKELUARKAN, BATAL, DIREFUND = status akhir (ikut lagi = peserta baru).
--    Transisi maju lainnya dicek domain (update bersyarat WHERE status = asal).
CREATE OR REPLACE FUNCTION cek_peserta_tidak_batal_setelah_bayar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('DIKELUARKAN', 'BATAL', 'DIREFUND') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'peserta_status_akhir: % tidak bisa berubah ke %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
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
--> statement-breakpoint

-- 8. Status akhir pembayaran & invoice. Pembayaran: hanya MENUNGGU yang boleh berubah.
--    Invoice: hanya DITERBITKAN yang boleh berubah; LUNAS final (grup batal / stok habis setelah lunas →
--    dana kembali lewat ledger REFUND, invoice tetap LUNAS sebagai bukti bayar; baris dibatalkan per baris, K-29).
CREATE OR REPLACE FUNCTION cek_status_akhir_pembayaran() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'MENUNGGU' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'pembayaran_status_akhir: % tidak bisa berubah ke %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pembayaran_status_akhir" BEFORE UPDATE OF status ON "pembayaran"
  FOR EACH ROW EXECUTE FUNCTION cek_status_akhir_pembayaran();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cek_status_akhir_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DITERBITKAN' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'invoice_status_akhir: % tidak bisa berubah ke %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "invoice_status_akhir" BEFORE UPDATE OF status ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION cek_status_akhir_invoice();
--> statement-breakpoint

-- 9. Pencairan saldo (K-34; fitur dikunci sampai H5).
--    Insert: status DIAJUKAN, tujuan milik akun, nama_cocok, belum dinonaktifkan, sudah lewat jeda tujuan baru.
--    Update: transisi maju saja; akun/jumlah/tujuan/kunci tidak berubah; penyetuju & pemroses tidak bisa diganti.
--    Debit ledger PENCAIRAN (saat diajukan) & PENCAIRAN_BATAL (saat GAGAL/DITOLAK) = kewajiban domain.
CREATE OR REPLACE FUNCTION cek_pengajuan_pencairan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'DIAJUKAN' OR NEW.disetujui_oleh IS NOT NULL OR NEW.diproses_oleh IS NOT NULL THEN
    RAISE EXCEPTION 'pencairan_tidak_sah: pengajuan baru wajib berstatus DIAJUKAN tanpa penyetuju/pemroses'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM tujuan_pencairan_terverifikasi t
    WHERE t.id = NEW.tujuan_id AND t.akun_id = NEW.akun_id AND t.nama_cocok
      AND t.dinonaktifkan_pada IS NULL AND now() >= t.boleh_dipakai_sejak
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pencairan_tujuan_tidak_sah: tujuan belum boleh dipakai (nama tidak cocok, nonaktif, atau masih jeda)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pencairan_cek_pengajuan" BEFORE INSERT ON "pencairan_saldo"
  FOR EACH ROW EXECUTE FUNCTION cek_pengajuan_pencairan();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cek_transisi_pencairan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.akun_id <> OLD.akun_id OR NEW.jumlah_rp <> OLD.jumlah_rp OR NEW.tujuan_id <> OLD.tujuan_id
     OR NEW.kunci_idempotensi <> OLD.kunci_idempotensi OR NEW.reauth_sesi_pada <> OLD.reauth_sesi_pada
     OR (OLD.disetujui_oleh IS NOT NULL AND NEW.disetujui_oleh IS DISTINCT FROM OLD.disetujui_oleh)
     OR (OLD.diproses_oleh IS NOT NULL AND NEW.diproses_oleh IS DISTINCT FROM OLD.diproses_oleh)
     OR (OLD.xendit_disbursement_ref IS NOT NULL
         AND NEW.xendit_disbursement_ref IS DISTINCT FROM OLD.xendit_disbursement_ref) THEN
    RAISE EXCEPTION 'pencairan_tidak_sah: kolom inti, penyetuju, atau pemroses tidak bisa diubah'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DIAJUKAN' AND NEW.status IN ('DISETUJUI', 'DITOLAK'))
    OR (OLD.status = 'DISETUJUI' AND NEW.status IN ('DIPROSES', 'GAGAL'))
    OR (OLD.status = 'DIPROSES' AND NEW.status IN ('BERHASIL', 'GAGAL'))
  ) THEN
    RAISE EXCEPTION 'pencairan_transisi_tidak_sah: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pencairan_cek_transisi" BEFORE UPDATE ON "pencairan_saldo"
  FOR EACH ROW EXECUTE FUNCTION cek_transisi_pencairan();
