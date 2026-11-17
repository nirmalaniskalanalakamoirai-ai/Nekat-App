-- T-013a · Fungsi dasar sebelum tabel dibuat.
-- uuid_v7(): ID urut waktu (T-004 M3). PostgreSQL < 18 belum punya uuidv7() bawaan.
-- Catatan M10: v7 mudah ditebak, BUKAN pengaman; query wajib difilter akun_id dari sesi.
-- Byte acak tanpa ekstensi pgcrypto: dua gen_random_uuid() (v4, acak kriptografis).
CREATE OR REPLACE FUNCTION gen_random_bytes_compat(n integer) RETURNS bytea
LANGUAGE sql
VOLATILE
AS $$
  SELECT substring(
    decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex')
    FROM 1 FOR n
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b bytea := gen_random_bytes_compat(16);
BEGIN
  -- 48 bit waktu (milidetik)
  b := set_byte(b, 0, ((ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((ms >> 8) & 255)::int);
  b := set_byte(b, 5, (ms & 255)::int);
  -- versi 7 & varian RFC 9562
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);
  RETURN encode(b, 'hex')::uuid;
END;
$$;
