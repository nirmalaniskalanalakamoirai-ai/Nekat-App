import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bukaKoneksi, jalankanMigrasi, type KoneksiDb } from "./koneksi.js";
import { jalankanSeed, KATEGORI_TERLARANG } from "./seed.js";
import * as s from "./skema/index.js";

// Tes integrasi PostgreSQL. Jalan bila DATABASE_URL_TEST diisi (CI: service container postgres:17).
// PERINGATAN: skema public di database ini DIHAPUS di awal tes. Jangan arahkan ke database berisi data.
const URL_TES = process.env["DATABASE_URL_TEST"];

const hmac = (t: string) => Buffer.from(t.padEnd(32, "0"));

async function ditolak(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { cause?: { constraint?: string; message?: string }; message: string };
    return err.cause?.constraint ?? err.cause?.message ?? err.message;
  }
  throw new Error("Diharapkan ditolak database, ternyata diterima");
}

describe.skipIf(!URL_TES)("skema database (integrasi)", () => {
  let k: KoneksiDb;

  beforeAll(async () => {
    k = bukaKoneksi(URL_TES ?? "");
    await k.pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    );
    await jalankanMigrasi(k.db);
  }, 60_000);

  afterAll(async () => {
    await k.tutup();
  });

  it("membuat 27 tabel T-004 §3.1–§3.7", async () => {
    const r = await k.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    expect(Number(r.rows[0]?.n)).toBe(27);
  });

  it("migrasi idempoten (jalan dua kali tanpa error)", async () => {
    await expect(jalankanMigrasi(k.db)).resolves.toBeUndefined();
  });

  describe("seed", () => {
    it("idempoten dan tanpa kategori rokok/bir", async () => {
      await jalankanSeed(k.db);
      await jalankanSeed(k.db);
      const semua = await k.db
        .select({ kode: s.kategori.kode, induk: s.kategori.indukId })
        .from(s.kategori);
      expect(semua.filter((x) => x.induk === null)).toHaveLength(7);
      expect(semua.length).toBeGreaterThan(20);
      for (const t of KATEGORI_TERLARANG) {
        expect(semua.some((x) => x.kode.includes(t))).toBe(false);
      }
    });

    it("izin khusus owner tidak diberikan ke admin", async () => {
      const r = await k.db.select().from(s.peranIzin).where(eq(s.peranIzin.peranKode, "admin"));
      const kode = r.map((x) => x.izinKode);
      expect(kode).toContain("harga.ubah");
      expect(kode).not.toContain("saldo.setujui");
      expect(kode).not.toContain("konfigurasi.ubah");
    });

    it("tidak membuat harga, modal, produk, atau stok", async () => {
      for (const t of [
        "produk",
        "modal_satuan_jual",
        "harga_level",
        "harga_terhitung",
        "stok_lokasi",
      ]) {
        const r = await k.pool.query<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`);
        expect(Number(r.rows[0]?.n), t).toBe(0);
      }
    });
  });

  describe("akun & OTP", () => {
    it("menolak nomor HP bukan format +62", async () => {
      const c = await ditolak(
        k.db.insert(s.akun).values({
          nomorHpE164: "08123456789",
          hpHmac: hmac("a"),
          kunciVersi: 1,
          hpTerverifikasiPada: new Date(),
        }),
      );
      expect(c).toBe("akun_nomor_hp_format");
    });

    it("satu akun per nomor HP", async () => {
      await k.db.insert(s.akun).values({
        nomorHpE164: "+6281234567890",
        hpHmac: hmac("b"),
        kunciVersi: 1,
        hpTerverifikasiPada: new Date(),
      });
      const c = await ditolak(
        k.db.insert(s.akun).values({
          nomorHpE164: "+6281234567890",
          hpHmac: hmac("c"),
          kunciVersi: 1,
          hpTerverifikasiPada: new Date(),
        }),
      );
      expect(c).toBe("akun_nomor_hp_uk");
    });

    it("akun dibekukan wajib punya alasan", async () => {
      const c = await ditolak(
        k.db.insert(s.akun).values({
          nomorHpE164: "+6281111111111",
          hpHmac: hmac("d"),
          kunciVersi: 1,
          hpTerverifikasiPada: new Date(),
          status: "DIBEKUKAN",
        }),
      );
      expect(c).toBe("akun_dibekukan_alasan");
    });

    it("paling banyak satu OTP hidup per nomor & tujuan", async () => {
      const otp = {
        hpHmac: hmac("otp"),
        tujuan: "LOGIN_PEMBELI",
        kodeHmac: hmac("kode"),
        kunciVersi: 1,
        kedaluwarsaPada: new Date(Date.now() + 300_000),
      };
      await k.db.insert(s.otpPermintaan).values(otp);
      expect(await ditolak(k.db.insert(s.otpPermintaan).values(otp))).toBe("otp_hidup_uk");
    });
  });

  describe("katalog, modal & harga", () => {
    let satuanJualId = "";

    beforeAll(async () => {
      const [sub] = await k.db
        .select()
        .from(s.kategori)
        .where(eq(s.kategori.kode, "minyak-goreng"));
      const [p] = await k.db
        .insert(s.produk)
        .values({ kategoriId: sub?.id ?? "", nama: "Minyak Goreng Contoh 1 L" })
        .returning();
      const [v] = await k.db
        .insert(s.sku)
        .values({ produkId: p?.id ?? "", kodeSku: "CONTOH-001", satuanDasar: "pcs" })
        .returning();
      const [sj] = await k.db
        .insert(s.satuanJual)
        .values({ skuId: v?.id ?? "", jenis: "PCS_1", isiSatuanDasar: 1, beratGram: 1000 })
        .returning();
      satuanJualId = sj?.id ?? "";
    });

    it("satuan jual baru tidak tayang secara bawaan", async () => {
      const [sj] = await k.db.select().from(s.satuanJual).where(eq(s.satuanJual.id, satuanJualId));
      expect(sj?.tayang).toBe(false);
    });

    it("isi LUSIN wajib 12", async () => {
      const [sj] = await k.db.select().from(s.satuanJual).where(eq(s.satuanJual.id, satuanJualId));
      const c = await ditolak(
        k.db
          .insert(s.satuanJual)
          .values({ skuId: sj?.skuId ?? "", jenis: "LUSIN", isiSatuanDasar: 10, beratGram: 1 }),
      );
      expect(c).toBe("satuan_jual_isi_sesuai_jenis");
    });

    it("tayang tidak boleh bersama alasan tidak tayang", async () => {
      const c = await ditolak(
        k.db
          .update(s.satuanJual)
          .set({ tayang: true, alasanTidakTayang: ["MODAL_KOSONG"] })
          .where(eq(s.satuanJual.id, satuanJualId)),
      );
      expect(c).toBe("satuan_jual_tayang_tanpa_alasan");
    });

    it("modal 0 ditolak, modal kosong diterima", async () => {
      expect(
        await ditolak(
          k.db.insert(s.modalSatuanJual).values({ satuanJualId, modalRp: 0, sumber: "MANUAL" }),
        ),
      ).toBe("modal_positif");
      await k.db
        .insert(s.modalSatuanJual)
        .values({ satuanJualId, modalRp: null, sumber: "MANUAL" });
    });

    it("harga terhitung wajib di atas modal (margin 0 dilarang)", async () => {
      const dasar = { satuanJualId, level: "SATUAN", versiHarga: "v1" };
      expect(
        await ditolak(
          k.db.insert(s.hargaTerhitung).values({ ...dasar, modalRp: 10_000, hargaRp: 10_000 }),
        ),
      ).toBe("harga_terhitung_di_atas_modal");
      expect(
        await ditolak(
          k.db.insert(s.hargaTerhitung).values({ ...dasar, modalRp: 10_000, hargaRp: 9_000 }),
        ),
      ).toBe("harga_terhitung_di_atas_modal");
      await k.db.insert(s.hargaTerhitung).values({ ...dasar, modalRp: 10_000, hargaRp: 10_001 });
    });

    it("mode harga level harus konsisten (persen atau rupiah, bukan keduanya)", async () => {
      const c = await ditolak(
        k.db.insert(s.hargaLevel).values({
          satuanJualId,
          level: "SATUAN",
          mode: "PERSEN",
          marginPersen: "10",
          hargaJualRp: 11_000,
        }),
      );
      expect(c).toBe("harga_level_mode_konsisten");
    });

    it("margin 0 ditolak", async () => {
      const c = await ditolak(
        k.db
          .insert(s.hargaLevel)
          .values({ satuanJualId, level: "MITRA_GROSIR", mode: "PERSEN", marginPersen: "0" }),
      );
      expect(c).toBe("harga_level_margin_positif");
    });

    it("bigint di luar batas aman JavaScript ditolak saat dibaca", async () => {
      await expect(k.pool.query("SELECT 9007199254740993::bigint AS n")).rejects.toThrow(
        RangeError,
      );
    });
  });

  describe("lokasi", () => {
    it("zona aktif + drop point dibuat dalam satu transaksi (FK ditunda)", async () => {
      await k.db.transaction(async (tx) => {
        const [g] = await tx
          .insert(s.gudang)
          .values({ kodeKonfig: "gudang-pusat", nama: "Gudang Pusat", jenis: "PUSAT" })
          .returning();
        const zonaId = "0190f000-0000-7000-8000-000000000001";
        const dpId = "0190f000-0000-7000-8000-000000000002";
        await tx.insert(s.zona).values({
          id: zonaId,
          kodeKonfig: "zona-pilot",
          namaKelurahan: "Kelurahan Pilot",
          gudangId: g?.id ?? "",
          aktif: true,
          dropPointPusatId: dpId,
        });
        await tx.insert(s.dropPoint).values({
          id: dpId,
          kodeKonfig: "dp-1",
          zonaId,
          gudangId: g?.id ?? "",
          nama: "Drop point 1",
        });
      });
      const [z] = await k.db.select().from(s.zona).where(eq(s.zona.kodeKonfig, "zona-pilot"));
      expect(z?.aktif).toBe(true);
    });

    it("zona aktif tanpa drop point ditolak", async () => {
      const [g] = await k.db.select().from(s.gudang);
      const c = await ditolak(
        k.db
          .insert(s.zona)
          .values({ kodeKonfig: "zona-x", namaKelurahan: "X", gudangId: g?.id ?? "", aktif: true }),
      );
      expect(c).toBe("zona_aktif_wajib_drop_point");
    });

    it("slot kirim: jam selesai harus setelah mulai", async () => {
      const [z] = await k.db.select().from(s.zona);
      const c = await ditolak(
        k.db.insert(s.slotKirim).values({
          zonaId: z?.id ?? "",
          tanggal: "2026-12-01",
          mulai: "10:00",
          selesai: "08:00",
          cutOffPada: new Date("2026-11-30T13:00:00Z"),
        }),
      );
      expect(c).toBe("slot_kirim_jam");
    });
  });

  describe("persetujuan legal (append-only)", () => {
    let akunId = "";

    beforeAll(async () => {
      const [a] = await k.db
        .insert(s.akun)
        .values({
          nomorHpE164: "+6289999999999",
          hpHmac: hmac("legal"),
          kunciVersi: 1,
          hpTerverifikasiPada: new Date(),
        })
        .returning();
      const [d] = await k.db
        .insert(s.dokumenLegal)
        .values({
          jenis: "SYARAT_KETENTUAN",
          versi: "2026-11-10",
          hashIsi: hmac("isi"),
          berlakuMulai: new Date(),
        })
        .returning();
      akunId = a?.id ?? "";
      await k.db.insert(s.persetujuanLegal).values({
        akunId,
        dokumenLegalId: d?.id ?? "",
        disetujuiPada: new Date(),
        kanal: "PWA",
        ipHmac: hmac("ip"),
        userAgentRingkas: "Android Chrome",
      });
    });

    it("UPDATE dan DELETE ditolak", async () => {
      const u = await ditolak(
        k.db
          .update(s.persetujuanLegal)
          .set({ kanal: "APP" })
          .where(eq(s.persetujuanLegal.akunId, akunId)),
      );
      expect(u).toMatch(/append-only/);
      const d = await ditolak(
        k.db.delete(s.persetujuanLegal).where(eq(s.persetujuanLegal.akunId, akunId)),
      );
      expect(d).toMatch(/append-only/);
    });

    it("anonimisasi lewat fungsi khusus hanya mengosongkan IP & user agent", async () => {
      const r = await k.db.execute(sql`SELECT anonimkan_persetujuan_legal(${akunId}::uuid) AS n`);
      expect((r.rows[0] as { n: number }).n).toBe(1);
      const [p] = await k.db
        .select()
        .from(s.persetujuanLegal)
        .where(eq(s.persetujuanLegal.akunId, akunId));
      expect(p?.ipHmac).toBeNull();
      expect(p?.userAgentRingkas).toBeNull();
      expect(p?.kanal).toBe("PWA");
    });
  });
});
