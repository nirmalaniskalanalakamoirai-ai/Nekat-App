// Tes integrasi T-015b: sinkron config/lokasi.json → gudang/zona/drop_point terhadap PostgreSQL NYATA.
// Jalan bila DATABASE_URL_TEST diisi (CI: service container postgres). Tiap run membuat database sementara.
// Koordinat di sini UJI fiktif (keputusan #3: koordinat asli diisi Joseph).
import { randomBytes } from "node:crypto";
import { bacaKonfigLokasi, type KonfigLokasi } from "@nekat/shared";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatDb, jalankanMigrasi, type Db } from "./koneksi.js";
import { jalankanSeed } from "./seed.js";
import {
  JENIS_LOG_SINKRON,
  periksaFkLokasi,
  sinkronLokasi,
  type PerubahanLokasi,
} from "./sinkron-lokasi.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];

const dp = (kode: string, nama = `DP ${kode}`) => ({
  kode,
  nama,
  lat: -6.2,
  lng: 106.6,
  radiusMeter: 2500,
});

function konfig(isi: Partial<Pick<KonfigLokasi, "gudang" | "zona">> = {}): KonfigLokasi {
  return bacaKonfigLokasi({
    versi: 1,
    uji: true,
    gudang: isi.gudang ?? [
      { kode: "g-pusat", nama: "Gudang Uji", jenis: "PUSAT", lat: -6.2, lng: 106.6 },
      { kode: "g-cabang", nama: "Cabang Uji", jenis: "CABANG", lat: -6.25, lng: 106.65 },
    ],
    zona: isi.zona ?? [
      {
        kode: "z-satu",
        namaKelurahan: "Kelurahan Satu",
        gudang: "g-pusat",
        dropPoint: [dp("dp-satu-a"), dp("dp-satu-b")],
      },
      {
        kode: "z-dua",
        namaKelurahan: "Kelurahan Dua",
        gudang: "g-cabang",
        dropPoint: [dp("dp-dua-a")],
      },
    ],
  });
}

const ringkas = (p: readonly PerubahanLokasi[]) =>
  p.map((x) => `${x.aksi} ${x.jenis} ${x.kode}${x.hasil ? ` ${x.hasil}` : ""}`);

describe.skipIf(!URL_ADMIN)("sinkron lokasi T-015b (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_${randomBytes(4).toString("hex")}`;
  const q = async <T>(s: string) => (await db.execute(sql.raw(s))).rows as T[];
  const jumlahLog = async () =>
    (
      await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM log_audit WHERE jenis = '${JENIS_LOG_SINKRON}'`,
      )
    )[0]?.n ?? -1;
  const sinkron = (k: KonfigLokasi, kering = false, paksa = false) =>
    sinkronLokasi(db, k, { izinkanUji: true, kering, paksa, sidikKonfig: "abc123" });

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${namaDb}`);
    await admin.end();
    const u = new URL(URL_ADMIN ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
    // Tabel bantu khusus tes: perujuk drop point (di produksi: peserta_grup.drop_point_id).
    await q(
      "CREATE TABLE uji_rujuk_dp (dp_id uuid NOT NULL REFERENCES drop_point(id) ON DELETE RESTRICT)",
    );
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await admin.end();
  });

  it("config uji ditolak tanpa izin eksplisit; tidak ada yang ditulis", async () => {
    await expect(sinkronLokasi(db, konfig())).rejects.toThrow(/"uji": true/);
    expect(await q("SELECT 1 FROM gudang")).toHaveLength(0);
  });

  it("mode kering: menampilkan rencana tanpa menulis", async () => {
    const h = await sinkron(konfig(), true);
    expect(h.kering).toBe(true);
    expect(h.perubahan).toHaveLength(2 + 2 + 3);
    expect(h.konflik).toEqual([]);
    expect(h.konflikPemakaian).toEqual([]);
    expect(await q("SELECT 1 FROM zona")).toHaveLength(0);
    expect(await jumlahLog()).toBe(0);
  });

  it("sinkron awal: semua entri dibuat aktif, drop point pusat = pertama, perubahan dicatat", async () => {
    const h = await sinkron(konfig());
    expect(ringkas(h.perubahan)).toEqual([
      "TAMBAH gudang g-pusat",
      "TAMBAH gudang g-cabang",
      "TAMBAH zona z-satu",
      "TAMBAH zona z-dua",
      "TAMBAH drop_point dp-satu-a",
      "TAMBAH drop_point dp-satu-b",
      "TAMBAH drop_point dp-dua-a",
    ]);
    const zona = await q<{ kode: string; aktif: boolean; pusat: string; gudang: string }>(`
      SELECT z.kode_konfig AS kode, z.aktif, d.kode_konfig AS pusat, g.kode_konfig AS gudang
      FROM zona z JOIN drop_point d ON d.id = z.drop_point_pusat_id JOIN gudang g ON g.id = z.gudang_id
      ORDER BY 1`);
    expect(zona).toEqual([
      { kode: "z-dua", aktif: true, pusat: "dp-dua-a", gudang: "g-cabang" },
      { kode: "z-satu", aktif: true, pusat: "dp-satu-a", gudang: "g-pusat" },
    ]);
    const dpCabang = await q<{ gudang: string }>(`
      SELECT g.kode_konfig AS gudang FROM drop_point d JOIN gudang g ON g.id = d.gudang_id
      WHERE d.kode_konfig = 'dp-dua-a'`);
    expect(dpCabang).toEqual([{ gudang: "g-cabang" }]);
    expect(await jumlahLog()).toBe(7);
    const [log] = await q<{ ref_jenis: string; ref_id: string; aktor: string; data: unknown }>(
      `SELECT ref_jenis, ref_id, aktor, data FROM log_audit WHERE ref_id = 'dp-satu-a'`,
    );
    expect(log).toMatchObject({
      ref_jenis: "drop_point",
      aktor: "SISTEM",
      data: { aksi: "TAMBAH", sidikKonfig: "abc123", sesudah: { zona: "z-satu", aktif: true } },
    });
  });

  it("idempoten: dijalankan ulang → 0 perubahan, tidak ada log baru, diubah_pada tetap", async () => {
    const sebelum = await q<{ t: string }>(
      "SELECT max(diubah_pada)::text AS t FROM (SELECT diubah_pada FROM zona UNION ALL SELECT diubah_pada FROM drop_point UNION ALL SELECT diubah_pada FROM gudang) x",
    );
    const h = await sinkron(konfig());
    expect(h.perubahan).toEqual([]);
    expect(await jumlahLog()).toBe(7);
    const sesudah = await q<{ t: string }>(
      "SELECT max(diubah_pada)::text AS t FROM (SELECT diubah_pada FROM zona UNION ALL SELECT diubah_pada FROM drop_point UNION ALL SELECT diubah_pada FROM gudang) x",
    );
    expect(sesudah).toEqual(sebelum);
  });

  it("ubah nama & urutan drop point → UBAH; id baris tidak berubah", async () => {
    const [idLama] = await q<{ id: string }>(
      "SELECT id FROM drop_point WHERE kode_konfig = 'dp-satu-b'",
    );
    const k = konfig();
    const z = k.zona[0];
    if (!z) throw new Error("zona uji hilang");
    z.namaKelurahan = "Kelurahan Satu Baru";
    z.dropPoint = [dp("dp-satu-b", "DP B baru"), dp("dp-satu-a")];
    const h = await sinkron(k);
    expect(h.perubahan).toEqual([
      {
        aksi: "UBAH",
        jenis: "zona",
        kode: "z-satu",
        sebelum: { namaKelurahan: "Kelurahan Satu", dropPointPusat: "dp-satu-a" },
        sesudah: { namaKelurahan: "Kelurahan Satu Baru", dropPointPusat: "dp-satu-b" },
      },
      {
        aksi: "UBAH",
        jenis: "drop_point",
        kode: "dp-satu-b",
        sebelum: { nama: "DP dp-satu-b" },
        sesudah: { nama: "DP B baru" },
      },
    ]);
    const [baru] = await q<{ id: string; pusat: string }>(`
      SELECT d.id, (SELECT kode_konfig FROM drop_point WHERE id = z.drop_point_pusat_id) AS pusat
      FROM drop_point d JOIN zona z ON z.id = d.zona_id WHERE d.kode_konfig = 'dp-satu-b'`);
    expect(baru).toEqual({ id: idLama?.id, pusat: "dp-satu-b" });
  });

  it("drop point pindah zona → ditolak, tidak ada yang ditulis", async () => {
    const logAwal = await jumlahLog();
    const k = konfig({
      zona: [
        {
          kode: "z-satu",
          namaKelurahan: "Kelurahan Satu Baru",
          gudang: "g-pusat",
          dropPoint: [dp("dp-satu-b", "DP B baru")],
        },
        {
          kode: "z-dua",
          namaKelurahan: "Kelurahan Dua Ganti",
          gudang: "g-cabang",
          dropPoint: [dp("dp-dua-a"), dp("dp-satu-a")],
        },
      ],
    });
    await expect(sinkron(k)).rejects.toThrow(/dp-satu-a terdaftar di zona z-satu/);
    // Mode kering menampilkan konflik tanpa melempar.
    const kering = await sinkron(k, true);
    expect(kering.konflik).toHaveLength(1);
    expect(kering.konflik[0]).toMatch(/pindah zona tidak diizinkan/);
    expect(await jumlahLog()).toBe(logAwal);
    expect(await q("SELECT 1 FROM zona WHERE nama_kelurahan = 'Kelurahan Dua Ganti'")).toEqual([]);
  });

  it("dilepas dari config: yang belum dipakai DIHAPUS, yang dipakai hanya DINONAKTIFKAN", async () => {
    // z-dua dipakai slot kirim (sudah DITUTUP → boleh dilepas, Z-03); dp-satu-a dipakai (tabel
    // perujuk uji). dp-dua-a tidak dipakai.
    await q(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada, status)
      SELECT id, '2026-12-01', '09:00', '12:00', '2026-11-30T00:00:00Z', 'DITUTUP' FROM zona WHERE kode_konfig = 'z-dua'`);
    await q(
      "INSERT INTO uji_rujuk_dp (dp_id) SELECT id FROM drop_point WHERE kode_konfig = 'dp-satu-a'",
    );
    const k = konfig({
      gudang: [{ kode: "g-pusat", nama: "Gudang Uji", jenis: "PUSAT", lat: -6.2, lng: 106.6 }],
      zona: [
        {
          kode: "z-satu",
          namaKelurahan: "Kelurahan Satu Baru",
          gudang: "g-pusat",
          dropPoint: [dp("dp-satu-b", "DP B baru")],
        },
      ],
    });
    const h = await sinkron(k);
    expect(ringkas(h.perubahan)).toEqual([
      "LEPAS drop_point dp-dua-a DIHAPUS",
      "LEPAS drop_point dp-satu-a DINONAKTIFKAN",
      "LEPAS zona z-dua DINONAKTIFKAN",
      "LEPAS gudang g-cabang DINONAKTIFKAN",
    ]);
    const baris = await q<{ jenis: string; kode: string; aktif: boolean }>(`
      SELECT 'gudang' AS jenis, kode_konfig AS kode, aktif FROM gudang
      UNION ALL SELECT 'zona', kode_konfig, aktif FROM zona
      UNION ALL SELECT 'drop_point', kode_konfig, aktif FROM drop_point ORDER BY 1, 2`);
    expect(baris).toEqual([
      { jenis: "drop_point", kode: "dp-satu-a", aktif: false },
      { jenis: "drop_point", kode: "dp-satu-b", aktif: true },
      { jenis: "gudang", kode: "g-cabang", aktif: false },
      { jenis: "gudang", kode: "g-pusat", aktif: true },
      { jenis: "zona", kode: "z-dua", aktif: false },
      { jenis: "zona", kode: "z-satu", aktif: true },
    ]);
    // Zona nonaktif kehilangan drop point pusat yang dihapus (CHECK tetap terpenuhi).
    expect(await q("SELECT drop_point_pusat_id FROM zona WHERE kode_konfig = 'z-dua'")).toEqual([
      { drop_point_pusat_id: null },
    ]);
    const [log] = await q<{ data: unknown }>(
      "SELECT data FROM log_audit WHERE ref_id = 'g-cabang' ORDER BY id DESC LIMIT 1",
    );
    expect(log?.data).toMatchObject({ aksi: "LEPAS", hasil: "DINONAKTIFKAN" });

    // Ulang: baris nonaktif dibiarkan → 0 perubahan.
    expect((await sinkron(k)).perubahan).toEqual([]);
  });

  it("entri nonaktif kembali ke config → diaktifkan lagi dengan id yang sama", async () => {
    const [id] = await q<{ id: string }>("SELECT id FROM zona WHERE kode_konfig = 'z-dua'");
    const h = await sinkron(konfig());
    expect(ringkas(h.perubahan)).toEqual([
      "UBAH gudang g-cabang",
      "UBAH zona z-satu",
      "UBAH zona z-dua",
      "UBAH drop_point dp-satu-a",
      "UBAH drop_point dp-satu-b",
      "TAMBAH drop_point dp-dua-a",
    ]);
    const zona = await q<{ id: string; aktif: boolean; pusat: string }>(`
      SELECT z.id, z.aktif, d.kode_konfig AS pusat FROM zona z
      JOIN drop_point d ON d.id = z.drop_point_pusat_id WHERE z.kode_konfig = 'z-dua'`);
    expect(zona).toEqual([{ id: id?.id, aktif: true, pusat: "dp-dua-a" }]);
    expect(
      await q(
        "SELECT 1 FROM gudang WHERE NOT aktif UNION ALL SELECT 1 FROM drop_point WHERE NOT aktif",
      ),
    ).toEqual([]);
    expect((await sinkron(konfig())).perubahan).toEqual([]);
  });

  it("dua sinkron bersamaan → advisory lock: hasil konsisten, tidak ada baris ganda", async () => {
    const k = konfig();
    const z = k.zona[1];
    if (!z) throw new Error("zona uji hilang");
    z.dropPoint = [...z.dropPoint, dp("dp-dua-b")];
    const [a, b] = await Promise.all([sinkron(k), sinkron(k)]);
    const jumlah = [a, b].map((h) => h.perubahan.length).sort();
    expect(jumlah).toEqual([0, 1]);
    expect(await q("SELECT 1 FROM drop_point WHERE kode_konfig = 'dp-dua-b'")).toHaveLength(1);
  });

  /** Config yang berlaku setelah tes advisory lock (z-dua punya dp-dua-b). */
  const konfigKini = () => {
    const k = konfig();
    const z = k.zona[1];
    if (z) z.dropPoint = [...z.dropPoint, dp("dp-dua-b")];
    return k;
  };

  it("pagar FK: semua FK ke gudang/zona/drop_point ON DELETE RESTRICT; FK lain menolak pelepasan", async () => {
    expect(
      await q(`SELECT conrelid::regclass::text AS tabel, conname::text AS nama FROM pg_constraint
        WHERE contype = 'f'
          AND confrelid IN ('gudang'::regclass, 'zona'::regclass, 'drop_point'::regclass)
          AND (confdeltype <> 'r' OR (condeferrable AND confdeltype = 'a'))`),
    ).toEqual([]);
    expect(await periksaFkLokasi(db)).toEqual([]);

    await q("CREATE TABLE uji_cascade (zona_id uuid REFERENCES zona(id) ON DELETE CASCADE)");
    try {
      const logAwal = await jumlahLog();
      const k = konfig(); // tanpa dp-dua-b → ada LEPAS
      await expect(sinkron(k)).rejects.toThrow(/uji_cascade.*harus ON DELETE RESTRICT/);
      const kering = await sinkron(k, true);
      expect(kering.konflik).toEqual([
        "FK uji_cascade.uji_cascade_zona_id_fkey (on delete 'c') harus ON DELETE RESTRICT",
      ]);
      expect(await jumlahLog()).toBe(logAwal);
      expect(
        await q("SELECT 1 FROM drop_point WHERE kode_konfig = 'dp-dua-b' AND aktif"),
      ).toHaveLength(1);
      // Tanpa pelepasan, pagar FK tidak menghalangi.
      expect((await sinkron(konfigKini())).perubahan).toEqual([]);
    } finally {
      await q("DROP TABLE uji_cascade");
    }
  });

  it("Z-03: slot DIBUKA / grup belum final menolak lepas & pindah gudang kecuali --paksa", async () => {
    const [slot] = await q<{
      id: string;
    }>(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
      SELECT id, '2026-12-02', '09:00', '12:00', '2026-12-01T00:00:00Z' FROM zona WHERE kode_konfig = 'z-dua'
      RETURNING id`);
    const [akun] = await q<{
      id: string;
    }>(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
      VALUES ('+6281200000015', '\\x${randomBytes(16).toString("hex")}', 1, now()) RETURNING id`);
    await q(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id)
      SELECT 'SNKABC', '${akun?.id ?? ""}', z.id, '${slot?.id ?? ""}', z.gudang_id
      FROM zona z WHERE z.kode_konfig = 'z-dua'`);
    const logAwal = await jumlahLog();

    const tanpaDua = konfig({
      gudang: [{ kode: "g-pusat", nama: "Gudang Uji", jenis: "PUSAT", lat: -6.2, lng: 106.6 }],
      zona: [konfig().zona[0] ?? (undefined as never)],
    });
    await expect(sinkron(tanpaDua)).rejects.toThrow(
      /zona z-dua dilepas saat masih ada slot kirim DIBUKA & grup belum final.*--paksa/,
    );
    const kering = await sinkron(tanpaDua, true);
    expect(kering.konflik).toEqual([]);
    expect(kering.konflikPemakaian).toEqual([
      "zona z-dua dilepas saat masih ada slot kirim DIBUKA & grup belum final",
      "gudang g-cabang dilepas saat masih menerima grup belum final",
    ]);

    const pindah = konfigKini();
    const zDua = pindah.zona[1];
    if (zDua) zDua.gudang = "g-pusat";
    await expect(sinkron(pindah)).rejects.toThrow(/zona z-dua pindah gudang g-cabang → g-pusat/);
    expect(await jumlahLog()).toBe(logAwal);
    expect(
      await q(`SELECT g.kode_konfig AS gudang FROM zona z JOIN gudang g ON g.id = z.gudang_id
        WHERE z.kode_konfig = 'z-dua'`),
    ).toEqual([{ gudang: "g-cabang" }]);

    const dipaksa = await sinkron(pindah, false, true);
    expect(dipaksa.konflikPemakaian).toEqual([
      "zona z-dua pindah gudang g-cabang → g-pusat saat masih ada slot kirim DIBUKA & grup belum final",
    ]);
    expect(ringkas(dipaksa.perubahan)).toEqual([
      "UBAH zona z-dua",
      "UBAH drop_point dp-dua-a",
      "UBAH drop_point dp-dua-b",
    ]);
    const [log] = await q<{ data: unknown }>(
      "SELECT data FROM log_audit WHERE ref_id = 'z-dua' ORDER BY id DESC LIMIT 1",
    );
    expect(log?.data).toMatchObject({ aksi: "UBAH", dipaksa: dipaksa.konflikPemakaian });

    // Kembalikan ke g-cabang (juga butuh --paksa).
    expect((await sinkron(konfigKini(), false, true)).perubahan).toHaveLength(3);
  });

  /** z-satu: pusat dp-satu-a (dipakai) & dp-satu-b → dp-satu-c. z-dua: pusat dp-dua-a → dp-dua-b. */
  const konfigPusatBaru = () => {
    const k = konfig();
    const [zSatu, zDua] = k.zona;
    if (zSatu) zSatu.dropPoint = [dp("dp-satu-c")];
    if (zDua) zDua.dropPoint = [dp("dp-dua-b")];
    return k;
  };

  it("drop point pusat diganti: pusat lama dipakai → nonaktif, tidak dipakai → dihapus", async () => {
    const h = await sinkron(konfigPusatBaru());
    expect(ringkas(h.perubahan)).toEqual([
      "UBAH zona z-satu",
      "UBAH zona z-dua",
      "TAMBAH drop_point dp-satu-c",
      "LEPAS drop_point dp-dua-a DIHAPUS",
      "LEPAS drop_point dp-satu-a DINONAKTIFKAN",
      "LEPAS drop_point dp-satu-b DIHAPUS",
    ]);
    // Grup belum final di z-dua tidak menghalangi (yang dicek: peserta yang memilih drop point itu).
    expect(h.konflikPemakaian).toEqual([]);
    const zona = await q<{ kode: string; aktif: boolean; pusat: string }>(`
      SELECT z.kode_konfig AS kode, z.aktif, d.kode_konfig AS pusat FROM zona z
      JOIN drop_point d ON d.id = z.drop_point_pusat_id ORDER BY 1`);
    expect(zona).toEqual([
      { kode: "z-dua", aktif: true, pusat: "dp-dua-b" },
      { kode: "z-satu", aktif: true, pusat: "dp-satu-c" },
    ]);
    expect(
      await q<{ kode: string; aktif: boolean }>(
        "SELECT kode_konfig AS kode, aktif FROM drop_point ORDER BY 1",
      ),
    ).toEqual([
      { kode: "dp-dua-b", aktif: true },
      { kode: "dp-satu-a", aktif: false },
      { kode: "dp-satu-c", aktif: true },
    ]);
    expect((await sinkron(konfigPusatBaru())).perubahan).toEqual([]);
  });

  it("gudang dirujuk stok_lokasi → hanya dinonaktifkan; gudang tanpa rujukan → dihapus", async () => {
    const tambahan = konfigPusatBaru();
    tambahan.gudang.push(
      { kode: "g-stok", nama: "Cabang Stok", jenis: "CABANG", lat: -6.3, lng: 106.7 },
      { kode: "g-kosong", nama: "Cabang Kosong", jenis: "CABANG", lat: -6.3, lng: 106.7 },
    );
    expect(ringkas((await sinkron(tambahan)).perubahan)).toEqual([
      "TAMBAH gudang g-stok",
      "TAMBAH gudang g-kosong",
    ]);
    await jalankanSeed(db);
    await q(
      `INSERT INTO produk (kategori_id, nama) SELECT id, 'Gula Uji' FROM kategori WHERE kode = 'gula'`,
    );
    await q(`INSERT INTO sku (produk_id, kode_sku, satuan_dasar)
      SELECT id, 'GU-1', 'pcs' FROM produk WHERE nama = 'Gula Uji'`);
    await q(`INSERT INTO stok_lokasi (sku_id, gudang_id, tersedia, data_pada, disinkron_pada)
      SELECT s.id, g.id, 10, now(), now() FROM sku s, gudang g
      WHERE s.kode_sku = 'GU-1' AND g.kode_konfig = 'g-stok'`);

    const h = await sinkron(konfigPusatBaru());
    expect(ringkas(h.perubahan)).toEqual([
      "LEPAS gudang g-kosong DIHAPUS",
      "LEPAS gudang g-stok DINONAKTIFKAN",
    ]);
    expect(
      await q(
        "SELECT kode_konfig AS kode, aktif FROM gudang WHERE kode_konfig LIKE 'g-%' ORDER BY 1",
      ),
    ).toEqual([
      { kode: "g-cabang", aktif: true },
      { kode: "g-pusat", aktif: true },
      { kode: "g-stok", aktif: false },
    ]);
    expect(await q("SELECT tersedia FROM stok_lokasi")).toEqual([{ tersedia: "10" }]);
  });
});
