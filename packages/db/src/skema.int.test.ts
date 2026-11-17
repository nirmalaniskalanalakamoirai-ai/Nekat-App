// Tes integrasi skema T-013a terhadap PostgreSQL NYATA (ADR-0001: tidak memakai mock DB).
// Jalan bila DATABASE_URL_TEST diisi (CI: service container postgres). Tiap run membuat database sementara.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatDb, jalankanMigrasi, type Db } from "./koneksi.js";
import { jalankanSeed, KATA_TERLARANG, SEED_KATEGORI } from "./seed.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];

/** Pesan error PostgreSQL (drizzle membungkus error driver di `cause`). */
function pesan(e: unknown): string {
  const bagian: string[] = [];
  let x: unknown = e;
  while (x instanceof Error) {
    bagian.push(x.message);
    x = x.cause;
  }
  return bagian.join(" | ");
}

async function gagal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return pesan(e);
  }
  throw new Error("Diharapkan gagal, ternyata berhasil");
}

const hex = (n = 16) => randomBytes(n).toString("hex");

describe.skipIf(!URL_ADMIN)("skema database T-013a (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_${hex(4)}`;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${namaDb}`);
    await admin.end();
    const u = new URL(URL_ADMIN ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await admin.end();
  });

  const q = (s: string) => db.execute(sql.raw(s));

  it("migrasi idempoten (dijalankan dua kali tanpa error)", async () => {
    await jalankanMigrasi(db);
  });

  it("uuid_v7 menghasilkan UUID versi 7 yang urut waktu", async () => {
    const r = await q("SELECT uuid_v7()::text AS a, pg_sleep(0.002), uuid_v7()::text AS b");
    const baris = r.rows[0] as { a: string; b: string };
    expect(baris.a[14]).toBe("7");
    expect(baris.a < baris.b).toBe(true);
  });

  describe("seed", () => {
    it("membuat kategori, subkategori, peran & izin; idempoten", async () => {
      await jalankanSeed(db);
      await jalankanSeed(db);
      const r = await q(
        "SELECT count(*) FILTER (WHERE induk_id IS NULL)::int AS akar, count(*) FILTER (WHERE induk_id IS NOT NULL)::int AS sub FROM kategori",
      );
      const { akar, sub } = r.rows[0] as { akar: number; sub: number };
      expect(akar).toBe(SEED_KATEGORI.length);
      expect(sub).toBe(SEED_KATEGORI.reduce((n, k) => n + k.sub.length, 0));
      const izinAdmin = await q("SELECT izin_kode FROM peran_izin WHERE peran_kode = 'admin'");
      expect(izinAdmin.rows.map((x) => (x as { izin_kode: string }).izin_kode)).not.toContain(
        "saldo.setujui",
      );
    });

    it("tidak ada kategori rokok/bir/alkohol", async () => {
      const r = await q("SELECT kode, nama FROM kategori");
      for (const row of r.rows as { kode: string; nama: string }[]) {
        for (const kata of KATA_TERLARANG) {
          expect(`${row.kode} ${row.nama}`.toLowerCase()).not.toContain(kata);
        }
      }
    });

    it("tidak ada harga, modal, atau konfigurasi bernilai di seed", async () => {
      const r = await q(
        "SELECT (SELECT count(*) FROM harga_level)::int + (SELECT count(*) FROM harga_terhitung)::int + (SELECT count(*) FROM modal_satuan_jual)::int AS n",
      );
      expect((r.rows[0] as { n: number }).n).toBe(0);
    });
  });

  describe("akun", () => {
    it("menolak nomor HP bukan +62", async () => {
      const e = await gagal(
        q(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
           VALUES ('081234567890', '\\x${hex()}', 1, now())`),
      );
      expect(e).toMatch(/akun_nomor_hp_format/);
    });

    it("satu akun per nomor HP (anti banyak akun)", async () => {
      const ins = () =>
        q(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
           VALUES ('+6281200000001', '\\x${hex()}', 1, now())`);
      await ins();
      expect(await gagal(ins())).toMatch(/akun_nomor_hp_uk/);
    });

    it("hanya satu OTP hidup per nomor & tujuan", async () => {
      const h = hex();
      const ins = () =>
        q(`INSERT INTO otp_permintaan (hp_hmac, tujuan, kode_hmac, kode_kunci_versi, kedaluwarsa_pada)
           VALUES ('\\x${h}', 'LOGIN_PEMBELI', '\\x${hex()}', 1, now() + interval '5 minutes')`);
      await ins();
      expect(await gagal(ins())).toMatch(/otp_satu_hidup_uk/);
    });

    it("sesi wajib tepat satu pemilik", async () => {
      expect(
        await gagal(
          q(
            `INSERT INTO sesi (id_hash, kedaluwarsa_pada) VALUES ('\\x${hex()}', now() + interval '1 day')`,
          ),
        ),
      ).toMatch(/sesi_satu_pemilik/);
    });

    it("anonimkan_akun menghapus PII tapi persetujuan tetap ada", async () => {
      const a =
        await q(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada, nama_panggilan)
                         VALUES ('+6281200000002', '\\x${hex()}', 1, now(), 'Bu Sri') RETURNING id`);
      const akunId = (a.rows[0] as { id: string }).id;
      const d = await q(`INSERT INTO dokumen_legal (jenis, versi, hash_isi, berlaku_mulai)
                         VALUES ('SYARAT_KETENTUAN', 'uji-${hex(2)}', '\\x${hex()}', now()) RETURNING id`);
      const dokId = (d.rows[0] as { id: string }).id;
      await q(`INSERT INTO persetujuan_legal (akun_id, dokumen_legal_id, disetujui_pada, kanal, ip_hmac, user_agent_ringkas)
               VALUES ('${akunId}', '${dokId}', now(), 'PWA', '\\x${hex()}', 'Chrome Android')`);

      await q(`SELECT anonimkan_akun('${akunId}')`);

      const akunRow = (
        await q(`SELECT nomor_hp_e164, nama_panggilan, status FROM akun WHERE id = '${akunId}'`)
      ).rows[0];
      expect(akunRow).toEqual({ nomor_hp_e164: null, nama_panggilan: null, status: "DIHAPUS" });
      const p = (
        await q(
          `SELECT ip_hmac, user_agent_ringkas FROM persetujuan_legal WHERE akun_id = '${akunId}'`,
        )
      ).rows;
      expect(p).toEqual([{ ip_hmac: null, user_agent_ringkas: null }]);
    });

    it("persetujuan legal append-only di luar anonimisasi", async () => {
      expect(await gagal(q("UPDATE persetujuan_legal SET kanal = 'APP'"))).toMatch(/append-only/);
      expect(await gagal(q("DELETE FROM persetujuan_legal"))).toMatch(/append-only/);
    });
  });

  describe("lokasi", () => {
    it("zona aktif wajib punya drop point; FK melingkar bisa dibuat dalam satu transaksi", async () => {
      await db.transaction(async (tx) => {
        const g = await tx.execute(
          sql.raw(
            `INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('gd-uji', 'Gudang Uji', 'PUSAT') RETURNING id`,
          ),
        );
        const gid = (g.rows[0] as { id: string }).id;
        const z = await tx.execute(
          sql.raw(
            `INSERT INTO zona (kode_konfig, nama_kelurahan, gudang_id) VALUES ('zn-uji', 'Kel. Uji', '${gid}') RETURNING id`,
          ),
        );
        const zid = (z.rows[0] as { id: string }).id;
        const dp = await tx.execute(
          sql.raw(`INSERT INTO drop_point (kode_konfig, zona_id, gudang_id, nama)
                   VALUES ('dp-uji', '${zid}', '${gid}', 'DP Uji') RETURNING id`),
        );
        const dpid = (dp.rows[0] as { id: string }).id;
        await tx.execute(
          sql.raw(
            `UPDATE zona SET drop_point_pusat_id = '${dpid}', aktif = true WHERE id = '${zid}'`,
          ),
        );
      });
      expect(
        await gagal(q("UPDATE zona SET drop_point_pusat_id = NULL WHERE kode_konfig = 'zn-uji'")),
      ).toMatch(/zona_aktif_butuh_drop_point/);
    });

    it("drop point pusat harus milik zona yang sama", async () => {
      const e = await gagal(
        db.transaction(async (tx) => {
          const g = await tx.execute(sql.raw(`SELECT id FROM gudang WHERE kode_konfig = 'gd-uji'`));
          const gid = (g.rows[0] as { id: string }).id;
          const z = await tx.execute(
            sql.raw(
              `INSERT INTO zona (kode_konfig, nama_kelurahan, gudang_id) VALUES ('zn-lain', 'Kel. Lain', '${gid}') RETURNING id`,
            ),
          );
          const zid = (z.rows[0] as { id: string }).id;
          await tx.execute(
            sql.raw(
              `UPDATE zona SET drop_point_pusat_id = (SELECT id FROM drop_point WHERE kode_konfig = 'dp-uji') WHERE id = '${zid}'`,
            ),
          );
        }),
      );
      expect(e).toMatch(/bukan milik zona/);
    });

    it("cut-off slot wajib sebelum jam mulai (WIB)", async () => {
      const e = await gagal(
        q(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
           SELECT id, DATE '2026-12-01', TIME '08:00', TIME '10:00', TIMESTAMPTZ '2026-12-01 08:30+07' FROM zona WHERE kode_konfig = 'zn-uji'`),
      );
      expect(e).toMatch(/slot_cutoff_sebelum_mulai/);
      await q(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
               SELECT id, DATE '2026-12-01', TIME '08:00', TIME '10:00', TIMESTAMPTZ '2026-11-30 20:00+07' FROM zona WHERE kode_konfig = 'zn-uji'`);
    });
  });

  describe("katalog & harga", () => {
    let satuanJualId = "";

    beforeAll(async () => {
      const r = await q(`
        WITH p AS (
          INSERT INTO produk (kategori_id, nama) SELECT id, 'Minyak Goreng 2 L' FROM kategori WHERE kode = 'minyak-goreng' RETURNING id
        ), s AS (
          INSERT INTO sku (produk_id, kode_sku, satuan_dasar) SELECT id, 'UJI-MG-2L', 'pcs' FROM p RETURNING id
        )
        INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram) SELECT id, 'PCS_1', 1, 1900 FROM s RETURNING id`);
      satuanJualId = (r.rows[0] as { id: string }).id;
    });

    it("produk wajib di subkategori, bukan kategori akar", async () => {
      expect(
        await gagal(
          q(
            "INSERT INTO produk (kategori_id, nama) SELECT id, 'X' FROM kategori WHERE kode = 'sembako'",
          ),
        ),
      ).toMatch(/wajib di subkategori/);
    });

    it("kategori maksimal 2 tingkat", async () => {
      expect(
        await gagal(
          q(
            "INSERT INTO kategori (kode, nama, induk_id) SELECT 'tingkat-tiga', 'X', id FROM kategori WHERE kode = 'beras'",
          ),
        ),
      ).toMatch(/maksimal 2 tingkat/);
    });

    it("isi satuan jual kanonik (LUSIN = 12)", async () => {
      expect(
        await gagal(
          q(
            `INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram) SELECT id, 'LUSIN', 10, 100 FROM sku WHERE kode_sku = 'UJI-MG-2L'`,
          ),
        ),
      ).toMatch(/satuan_jual_isi_kanonik/);
    });

    it("satuan jual baru tidak tayang secara bawaan", async () => {
      const r = await q(`SELECT tayang FROM satuan_jual WHERE id = '${satuanJualId}'`);
      expect((r.rows[0] as { tayang: boolean }).tayang).toBe(false);
    });

    it("tidak bisa tayang bila masih ada alasan tidak tayang", async () => {
      expect(
        await gagal(
          q(
            `UPDATE satuan_jual SET tayang = true, alasan_tidak_tayang = '{MODAL_KOSONG}' WHERE id = '${satuanJualId}'`,
          ),
        ),
      ).toMatch(/satuan_jual_tayang_konsisten/);
    });

    it("modal 0 ditolak; modal kosong (NULL) boleh", async () => {
      expect(
        await gagal(
          q(
            `INSERT INTO modal_satuan_jual (satuan_jual_id, modal_rp, sumber) VALUES ('${satuanJualId}', 0, 'MANUAL')`,
          ),
        ),
      ).toMatch(/modal_positif/);
      await q(
        `INSERT INTO modal_satuan_jual (satuan_jual_id, modal_rp, sumber) VALUES ('${satuanJualId}', NULL, 'MANUAL')`,
      );
    });

    it("HARGA TIDAK BOLEH DI BAWAH ATAU SAMA DENGAN MODAL (CLAUDE.md, P-16)", async () => {
      expect(
        await gagal(
          q(`INSERT INTO harga_terhitung (satuan_jual_id, level, modal_rp, harga_rp, versi_harga)
                       VALUES ('${satuanJualId}', 'SATUAN', 30000, 29999, 'v')`),
        ),
      ).toMatch(/harga_terhitung_di_atas_modal/);
      expect(
        await gagal(
          q(`INSERT INTO harga_terhitung (satuan_jual_id, level, modal_rp, harga_rp, versi_harga)
                       VALUES ('${satuanJualId}', 'SATUAN', 30000, 30000, 'v')`),
        ),
      ).toMatch(/harga_terhitung_di_atas_modal/);
      await q(`INSERT INTO harga_terhitung (satuan_jual_id, level, modal_rp, harga_rp, versi_harga)
               VALUES ('${satuanJualId}', 'SATUAN', 30000, 30001, 'v')`);
    });

    it("harga_level: mode PERSEN tidak boleh membawa harga rupiah, dan sebaliknya", async () => {
      expect(
        await gagal(
          q(`INSERT INTO harga_level (satuan_jual_id, level, mode, margin_persen, harga_jual_rp)
                       VALUES ('${satuanJualId}', 'SATUAN', 'PERSEN', 10, 35000)`),
        ),
      ).toMatch(/harga_level_mode_konsisten/);
    });

    it("hanya satu timpaan modal aktif per satuan jual, catatan wajib", async () => {
      await q(`INSERT INTO admin (nama, nomor_hp_e164) VALUES ('Admin Uji', '+6281299999999')`);
      const ins = (catatan: string) =>
        q(`INSERT INTO modal_timpaan (satuan_jual_id, modal_rp, catatan, dibuat_oleh)
           SELECT '${satuanJualId}', 31000, '${catatan}', id FROM admin WHERE nomor_hp_e164 = '+6281299999999'`);
      expect(await gagal(ins("  "))).toMatch(/timpaan_catatan_wajib/);
      await ins("harga naik dari distributor");
      expect(await gagal(ins("kedua"))).toMatch(/timpaan_satu_aktif_uk/);
    });

    it("stok tidak boleh negatif", async () => {
      expect(
        await gagal(
          q(`INSERT INTO stok_lokasi (sku_id, gudang_id, tersedia, data_pada, disinkron_pada)
                       SELECT s.id, g.id, -1, now(), now() FROM sku s, gudang g WHERE s.kode_sku = 'UJI-MG-2L' AND g.kode_konfig = 'gd-uji'`),
        ),
      ).toMatch(/stok_tersedia_nonneg/);
    });
  });

  describe("log & tinjauan", () => {
    it("log_audit append-only", async () => {
      await q("INSERT INTO log_audit (jenis, aktor) VALUES ('UJI', 'SISTEM')");
      expect(await gagal(q("UPDATE log_audit SET jenis = 'X'"))).toMatch(/append-only/);
      expect(await gagal(q("DELETE FROM log_audit"))).toMatch(/append-only/);
    });

    it("antrean tinjauan tidak dobel saat masih terbuka, dan wajib catatan saat ditutup", async () => {
      const id = "018f0000-0000-7000-8000-000000000001";
      const ins = () =>
        q(
          `INSERT INTO antrean_tinjauan (jenis, entitas_jenis, entitas_id, data) VALUES ('MODAL_PECAHAN', 'satuan_jual', '${id}', '{"modal":"1234.5"}')`,
        );
      await ins();
      expect(await gagal(ins())).toMatch(/tinjauan_terbuka_uk/);
      expect(
        await gagal(
          q(
            `UPDATE antrean_tinjauan SET status = 'SELESAI', selesai_pada = now() WHERE entitas_id = '${id}'`,
          ),
        ),
      ).toMatch(/tinjauan_ditutup_lengkap/);
    });

    it("diubah_pada diperbarui otomatis", async () => {
      await q("UPDATE kategori SET nama = 'Beras Premium' WHERE kode = 'beras'");
      const r = await q(
        "SELECT diubah_pada > dibuat_pada AS berubah FROM kategori WHERE kode = 'beras'",
      );
      expect((r.rows[0] as { berubah: boolean }).berubah).toBe(true);
    });
  });
});
