// Tes integrasi ledger saldo T-021 terhadap PostgreSQL NYATA (ADR-0001: tanpa mock DB).
// Jalan bila DATABASE_URL_TEST diisi. Angka rupiah di sini hanya data uji, BUKAN harga/margin/tarif.
import { randomBytes } from "node:crypto";
import { GalatSaldo } from "@nekat/domain";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatDb, jalankanMigrasi, type Db } from "./koneksi.js";
import {
  ajukanKoreksiSaldo,
  buatRepoSaldo,
  cariSelisihSaldo,
  debitCheckout,
  kembalikanSaldoInvoice,
  kredit,
  putuskanKoreksiSaldo,
  type Tx,
} from "./repo/ledger-saldo.js";
import { jalankanSeed } from "./seed.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];
const hex = (n = 16) => randomBytes(n).toString("hex");

async function kodeGalat(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GalatSaldo) return e.kode;
    throw e;
  }
  throw new Error("Diharapkan GalatSaldo, ternyata berhasil");
}

describe.skipIf(!URL_ADMIN)("ledger saldo T-021 (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_saldo_${hex(4)}`;
  const id: Record<string, string> = {};
  let nomorHp = 81400000000;
  let nomorKode = 0;

  const q = async (s: string) => (await db.execute(sql.raw(s))).rows;
  const satu = async (s: string): Promise<string> => {
    const [b] = await q(s);
    return String(b?.["id"]);
  };
  const angka = async (s: string): Promise<number> => {
    const [b] = await q(s);
    return Number(b?.["v"]);
  };
  const trx = <T>(f: (tx: Tx) => Promise<T>) => db.transaction(f);

  const buatAkun = () =>
    satu(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
          VALUES ('+62${String(nomorHp++)}', '\\x${hex()}', 1, now()) RETURNING id`);
  const uuidBaru = () => satu("SELECT uuid_v7() AS id");
  const saldo = (a: string) =>
    angka(`SELECT COALESCE((SELECT saldo_rp FROM akun_saldo WHERE akun_id = '${a}'), 0) AS v`);
  const jumlahEntri = (kunci: string) =>
    angka(`SELECT count(*)::int AS v FROM ledger_saldo WHERE kunci_idempotensi = '${kunci}'`);

  const kodeLink = () => {
    const abjad = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let n = nomorKode++;
    let s = "";
    for (let i = 0; i < 6; i++) {
      s += abjad[n % abjad.length] ?? "A";
      n = Math.floor(n / abjad.length);
    }
    return s;
  };
  const buatGrup = (host: string) =>
    satu(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id)
          VALUES ('${kodeLink()}', '${host}', '${id["zona"]}', '${id["slot"]}', '${id["gudang"]}') RETURNING id`);

  /** Invoice di dalam transaksi pemanggil, setelah saldo didebit (alur penerbitan I1/I2). */
  const sisipkanInvoice = async (
    tx: Tx,
    o: { id: string; grupId: string; pembayar: string; total: number; saldo: number },
  ) => {
    const nomor = `INV-${hex(4)}`;
    await tx.execute(
      sql.raw(`INSERT INTO invoice (id, nomor, grup_id, pembayar_akun_id, diterbitkan_pada, ttl_menit, kedaluwarsa_pada,
                 subtotal_barang_rp, total_rp, saldo_dipakai_rp, sisa_bayar_rp)
               VALUES ('${o.id}', '${nomor}', '${o.grupId}', '${o.pembayar}', now(), 60, now() + interval '60 minutes',
                 ${o.total}, ${o.total}, ${o.saldo}, ${o.total - o.saldo})`),
    );
    return nomor;
  };

  /** Terbitkan invoice dengan saldo (debit + insert invoice satu transaksi). */
  const terbitkan = async (pembayar: string, total: number) => {
    const grupId = await buatGrup(pembayar);
    const invoiceId = await uuidBaru();
    const h = await trx(async (tx) => {
      const r = await debitCheckout(tx, { akunId: pembayar, invoiceId, maksRp: total });
      if (!r.ok) throw new Error(r.kode);
      const nomor = await sisipkanInvoice(tx, {
        id: invoiceId,
        grupId,
        pembayar,
        total,
        saldo: r.dipakaiRp,
      });
      return { ...r, nomor };
    });
    return { invoiceId, grupId, ...h };
  };

  const kreditSelisih = (akunId: string, jumlahRp: number, grupId?: string, pesertaId?: string) =>
    trx(async (tx) => {
      const r = await kredit(tx, {
        akunId,
        jumlahRp,
        sumber: {
          jenis: "SELISIH_HARGA",
          grupId: grupId ?? (await uuidBaru()),
          pesertaId: pesertaId ?? (await uuidBaru()),
        },
      });
      if (!r.ok) throw new Error(r.kode);
      return r;
    });

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${namaDb}`);
    await admin.end();
    const u = new URL(URL_ADMIN ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
    await jalankanSeed(db);
    id["gudang"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-saldo', 'Gudang', 'PUSAT') RETURNING id",
    );
    id["zona"] = await satu(
      `INSERT INTO zona (kode_konfig, nama_kelurahan, gudang_id) VALUES ('z-saldo', 'Kelurahan Uji', '${id["gudang"]}') RETURNING id`,
    );
    id["slot"] = await satu(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
      VALUES ('${id["zona"]}', '2026-12-01', '09:00', '12:00', '2026-11-30T00:00:00Z') RETURNING id`);
    id["admin1"] = await satu(
      "INSERT INTO admin (nama, nomor_hp_e164) VALUES ('Admin Satu', '+6281111112101') RETURNING id",
    );
    id["admin2"] = await satu(
      "INSERT INTO admin (nama, nomor_hp_e164) VALUES ('Admin Dua', '+6281111112102') RETURNING id",
    );
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    for (let i = 0; i < 100; i++) {
      const r = await admin.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1",
        [namaDb],
      );
      if ((r.rows[0]?.n ?? 0) === 0) break;
      await new Promise((selesai) => setTimeout(selesai, 20));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await admin.end();
  });

  it("wajib dipanggil di dalam transaksi (pool biasa ditolak)", async () => {
    const a = await buatAkun();
    expect(
      await kodeGalat(
        debitCheckout(db as unknown as Tx, { akunId: a, invoiceId: await uuidBaru(), maksRp: 1 }),
      ),
    ).toBe("BUKAN_TRANSAKSI");
  });

  describe("kredit", () => {
    it("kredit menambah saldo; event yang sama diulang → satu entri, sukses tanpa efek", async () => {
      const a = await buatAkun();
      const grupId = await uuidBaru();
      const pesertaId = await uuidBaru();
      const r1 = await kreditSelisih(a, 1234, grupId, pesertaId);
      expect(r1).toMatchObject({ ok: true, jumlahRp: 1234, saldoSesudahRp: 1234, duplikat: false });
      const r2 = await kreditSelisih(a, 1234, grupId, pesertaId);
      expect(r2).toMatchObject({
        ok: true,
        idEntri: r1.idEntri,
        saldoSesudahRp: 1234,
        duplikat: true,
      });
      expect(await saldo(a)).toBe(1234);
      expect(await jumlahEntri(`selisih:${grupId}:${pesertaId}`)).toBe(1);
    });

    it("kunci sama dengan nominal berbeda → KUNCI_BENTROK (rollback), saldo tetap", async () => {
      const a = await buatAkun();
      const g = await uuidBaru();
      const p = await uuidBaru();
      await kreditSelisih(a, 500, g, p);
      expect(await kodeGalat(kreditSelisih(a, 501, g, p))).toBe("KUNCI_BENTROK");
      // Akun lain memakai sumber yang sama (bug pemanggil) juga ditolak.
      const b = await buatAkun();
      expect(await kodeGalat(kreditSelisih(b, 500, g, p))).toBe("KUNCI_BENTROK");
      expect(await saldo(a)).toBe(500);
      expect(await saldo(b)).toBe(0);
    });

    it("event yang sama datang bersamaan (paralel) → tepat satu entri", async () => {
      const a = await buatAkun();
      const pembayaranId = await uuidBaru();
      const hasil = await Promise.all(
        Array.from({ length: 8 }, () =>
          trx((tx) =>
            kredit(tx, {
              akunId: a,
              jumlahRp: 2500,
              sumber: { jenis: "BAYAR_TERLAMBAT", pembayaranId },
              dapatDicairkanSejak: new Date("2027-01-01T00:00:00Z"),
            }),
          ),
        ),
      );
      expect(hasil.filter((h) => h.ok && !h.duplikat)).toHaveLength(1);
      expect(hasil.every((h) => h.ok)).toBe(true);
      expect(await saldo(a)).toBe(2500);
      expect(await jumlahEntri(`bayar_terlambat:${pembayaranId}`)).toBe(1);
      expect(
        await angka(
          `SELECT extract(year FROM dapat_dicairkan_sejak)::int AS v FROM ledger_saldo WHERE kunci_idempotensi = 'bayar_terlambat:${pembayaranId}'`,
        ),
      ).toBe(2027);
    });

    it("akun baru: kredit pertama paralel lintas sumber tetap konsisten (baris akun_saldo dibuat sekali)", async () => {
      const a = await buatAkun();
      await Promise.all(Array.from({ length: 6 }, () => kreditSelisih(a, 100)));
      expect(await saldo(a)).toBe(600);
    });

    it("gagal di transaksi pemanggil → kredit ikut rollback", async () => {
      const a = await buatAkun();
      await expect(
        trx(async (tx) => {
          await kredit(tx, {
            akunId: a,
            jumlahRp: 900,
            sumber: { jenis: "REFUND", alasan: "STOK_HABIS", barisInvoiceId: await uuidBaru() },
          });
          throw new Error("status penyebab gagal");
        }),
      ).rejects.toThrow("status penyebab gagal");
      expect(await saldo(a)).toBe(0);
    });

    it("menolak nominal 0/negatif/pecahan dan jenis di luar kontrak (mis. PENCAIRAN_BATAL)", async () => {
      const a = await buatAkun();
      const sumber = { jenis: "BAYAR_TERLAMBAT", pembayaranId: await uuidBaru() } as const;
      for (const n of [0, -1, 1.5]) {
        expect(await kodeGalat(trx((tx) => kredit(tx, { akunId: a, jumlahRp: n, sumber })))).toBe(
          "NOMINAL_TIDAK_VALID",
        );
      }
      expect(
        await kodeGalat(
          trx((tx) =>
            kredit(tx, {
              akunId: a,
              jumlahRp: 1,
              sumber: { jenis: "PENCAIRAN_BATAL" } as never,
            }),
          ),
        ),
      ).toBe("ID_TIDAK_VALID");
      expect(
        await kodeGalat(
          trx(async (tx) => kredit(tx, { akunId: await uuidBaru(), jumlahRp: 1, sumber })),
        ),
      ).toBe("AKUN_TIDAK_ADA");
    });
  });

  describe("debit checkout (§9)", () => {
    it("menutup penuh dan sebagian; saldo 0 → tanpa entri", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 10_000);
      const penuh = await terbitkan(a, 4_000);
      expect(penuh).toMatchObject({ ok: true, dipakaiRp: 4_000, saldoSesudahRp: 6_000 });
      const sebagian = await terbitkan(a, 9_999);
      expect(sebagian).toMatchObject({ ok: true, dipakaiRp: 6_000, saldoSesudahRp: 0 });
      const kosong = await terbitkan(a, 7_000);
      expect(kosong).toMatchObject({ ok: true, idEntri: null, dipakaiRp: 0, saldoSesudahRp: 0 });
      expect(await saldo(a)).toBe(0);
      expect(
        await angka(`SELECT sisa_bayar_rp AS v FROM invoice WHERE id = '${sebagian.invoiceId}'`),
      ).toBe(3_999);
    });

    it("panggilan ulang untuk invoice yang sama → entri lama (tidak mendebit dua kali)", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 5_000);
      const t = await terbitkan(a, 3_000);
      const ulang = await trx((tx) =>
        debitCheckout(tx, { akunId: a, invoiceId: t.invoiceId, maksRp: 3_000 }),
      );
      expect(ulang).toMatchObject({
        ok: true,
        idEntri: t.idEntri,
        dipakaiRp: 3_000,
        duplikat: true,
      });
      expect(await saldo(a)).toBe(2_000);
      expect(await jumlahEntri(`debit:${t.invoiceId}`)).toBe(1);
      // Akun lain tidak bisa "mengklaim" debit invoice itu.
      const b = await buatAkun();
      expect(
        await kodeGalat(
          trx((tx) => debitCheckout(tx, { akunId: b, invoiceId: t.invoiceId, maksRp: 1 })),
        ),
      ).toBe("KUNCI_BENTROK");
    });

    it("dua (dan lebih) debit bersamaan tidak pernah membuat saldo negatif", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 10_000);
      const invoiceIds = await Promise.all(Array.from({ length: 6 }, () => uuidBaru()));
      const hasil = await Promise.all(
        invoiceIds.map((invoiceId) =>
          trx((tx) => debitCheckout(tx, { akunId: a, invoiceId, maksRp: 3_000 })),
        ),
      );
      const dipakai = hasil.map((h) => (h.ok ? h.dipakaiRp : -1)).sort((x, y) => y - x);
      expect(dipakai).toEqual([3_000, 3_000, 3_000, 1_000, 0, 0]);
      expect(await saldo(a)).toBe(0);
      expect(
        await angka(
          `SELECT min(saldo_sesudah_rp)::int AS v FROM ledger_saldo WHERE akun_id = '${a}'`,
        ),
      ).toBe(0);
      expect(await cariSelisihSaldo(db)).toEqual([]);
    });

    it("debit kedua menunggu kunci transaksi pertama lalu membaca saldo terkini", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 5_000);
      let lepas: () => void = () => undefined;
      const tahan = new Promise<void>((r) => (lepas = r));
      let pertamaSelesaiDebit: () => void = () => undefined;
      const sudahDebit = new Promise<void>((r) => (pertamaSelesaiDebit = r));
      const i1 = await uuidBaru();
      const i2 = await uuidBaru();
      const pertama = trx(async (tx) => {
        const r = await debitCheckout(tx, { akunId: a, invoiceId: i1, maksRp: 4_000 });
        pertamaSelesaiDebit();
        await tahan; // kunci akun_saldo masih dipegang
        return r;
      });
      await sudahDebit;
      let keduaSelesai = false;
      const kedua = trx((tx) =>
        debitCheckout(tx, { akunId: a, invoiceId: i2, maksRp: 4_000 }),
      ).then((r) => {
        keduaSelesai = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 150));
      expect(keduaSelesai).toBe(false);
      lepas();
      const [r1, r2] = await Promise.all([pertama, kedua]);
      expect(r1).toMatchObject({ ok: true, dipakaiRp: 4_000 });
      expect(r2).toMatchObject({ ok: true, dipakaiRp: 1_000, saldoSesudahRp: 0 });
    });

    it("akun DIBEKUKAN tidak bisa memakai saldo maupun menerima kredit (transaksi tetap sehat)", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 1_000);
      await q(`UPDATE akun SET status = 'DIBEKUKAN', dibekukan_alasan = 'uji' WHERE id = '${a}'`);
      const r = await trx(async (tx) => {
        const d = await debitCheckout(tx, { akunId: a, invoiceId: await uuidBaru(), maksRp: 500 });
        const k = await kredit(tx, {
          akunId: a,
          jumlahRp: 700,
          sumber: { jenis: "REFUND", alasan: "KELUHAN", keluhanId: await uuidBaru() },
        });
        // Pemanggil masih bisa menulis di transaksi yang sama (mis. menandai DANA_DITAHAN).
        await tx.execute(sql`SELECT 1`);
        return { d, k };
      });
      expect(r.d).toEqual({ ok: false, kode: "AKUN_DIBEKUKAN", retryable: false });
      expect(r.k).toEqual({ ok: false, kode: "AKUN_DIBEKUKAN", retryable: false });
      expect(await saldo(a)).toBe(1_000);
    });

    it("menolak maks negatif/pecahan", async () => {
      const a = await buatAkun();
      for (const n of [-1, 0.5]) {
        expect(
          await kodeGalat(
            trx(async (tx) =>
              debitCheckout(tx, { akunId: a, invoiceId: await uuidBaru(), maksRp: n }),
            ),
          ),
        ).toBe("NOMINAL_TIDAK_VALID");
      }
    });
  });

  describe("SALDO_BALIK (§8.2, §9.4)", () => {
    it("invoice kedaluwarsa → saldo yang dipakai kembali sekali; ulang = duplikat", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 8_000);
      const t = await terbitkan(a, 5_000);
      expect(await saldo(a)).toBe(3_000);

      // Invoice masih DITERBITKAN → ditolak (pemanggil wajib mengubah status dulu).
      expect(
        await kodeGalat(trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }))),
      ).toBe("INVOICE_TIDAK_SESUAI");

      const r = await trx(async (tx) => {
        await tx.execute(
          sql.raw(`UPDATE invoice SET status = 'KEDALUWARSA' WHERE id = '${t.invoiceId}'`),
        );
        return kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId });
      });
      expect(r).toMatchObject({
        ok: true,
        jumlahRp: 5_000,
        saldoSesudahRp: 8_000,
        duplikat: false,
      });
      const ulang = await Promise.all(
        [1, 2, 3].map(() => trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }))),
      );
      expect(ulang.every((u) => u.ok && u.duplikat)).toBe(true);
      expect(await saldo(a)).toBe(8_000);
      expect(await jumlahEntri(`saldo-balik:${t.invoiceId}`)).toBe(1);
    });

    it("invoice LUNAS tidak bisa SALDO_BALIK (saldonya bagian REFUND §8.1.3)", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 2_000);
      const t = await terbitkan(a, 2_000);
      await q(
        `UPDATE invoice SET status = 'LUNAS', lunas_pada = now() WHERE id = '${t.invoiceId}'`,
      );
      expect(
        await kodeGalat(trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }))),
      ).toBe("INVOICE_TIDAK_SESUAI");
      expect(await saldo(a)).toBe(0);
    });

    it("invoice tanpa saldo dipakai → no-op tanpa entri", async () => {
      const a = await buatAkun();
      const t = await terbitkan(a, 1_000);
      await q(`UPDATE invoice SET status = 'DIBATALKAN' WHERE id = '${t.invoiceId}'`);
      const r = await trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }));
      expect(r).toMatchObject({ ok: true, idEntri: null, jumlahRp: 0 });
    });
  });

  describe("koreksi admin four-eyes", () => {
    it("pengaju tidak bisa memutus; admin lain menyetujui → KOREKSI_ADMIN; ulang = duplikat", async () => {
      const a = await buatAkun();
      const { pengajuanId } = await trx((tx) =>
        ajukanKoreksiSaldo(tx, {
          akunId: a,
          jumlahRp: 750,
          alasan: " uji koreksi ",
          adminId: id["admin1"] ?? "",
        }),
      );
      expect(
        await kodeGalat(
          trx((tx) =>
            putuskanKoreksiSaldo(tx, {
              pengajuanId,
              hasil: "DISETUJUI",
              adminId: id["admin1"] ?? "",
            }),
          ),
        ),
      ).toBe("KOREKSI_TIDAK_SAH");
      const r = await trx((tx) =>
        putuskanKoreksiSaldo(tx, { pengajuanId, hasil: "DISETUJUI", adminId: id["admin2"] ?? "" }),
      );
      expect(r).toMatchObject({ hasil: "DISETUJUI", saldoSesudahRp: 750, duplikat: false });
      const ulang = await trx((tx) =>
        putuskanKoreksiSaldo(tx, { pengajuanId, hasil: "DISETUJUI", adminId: id["admin2"] ?? "" }),
      );
      expect(ulang).toMatchObject({ hasil: "DISETUJUI", duplikat: true });
      expect(
        await kodeGalat(
          trx((tx) =>
            putuskanKoreksiSaldo(tx, {
              pengajuanId,
              hasil: "DITOLAK",
              adminId: id["admin2"] ?? "",
            }),
          ),
        ),
      ).toBe("KOREKSI_TIDAK_SAH");
      expect(await saldo(a)).toBe(750);
      expect(await jumlahEntri(`koreksi:${pengajuanId}`)).toBe(1);
    });

    it("koreksi debit melebihi saldo → SALDO_KURANG, keputusan ikut rollback; DITOLAK tanpa entri", async () => {
      const a = await buatAkun();
      await kreditSelisih(a, 100);
      const { pengajuanId } = await trx((tx) =>
        ajukanKoreksiSaldo(tx, {
          akunId: a,
          jumlahRp: -101,
          alasan: "uji",
          adminId: id["admin1"] ?? "",
        }),
      );
      expect(
        await kodeGalat(
          trx((tx) =>
            putuskanKoreksiSaldo(tx, {
              pengajuanId,
              hasil: "DISETUJUI",
              adminId: id["admin2"] ?? "",
            }),
          ),
        ),
      ).toBe("SALDO_KURANG");
      expect(
        await angka(
          `SELECT count(*)::int AS v FROM keputusan_koreksi_saldo WHERE pengajuan_id = '${pengajuanId}'`,
        ),
      ).toBe(0);
      const tolak = await trx((tx) =>
        putuskanKoreksiSaldo(tx, { pengajuanId, hasil: "DITOLAK", adminId: id["admin2"] ?? "" }),
      );
      expect(tolak).toEqual({ hasil: "DITOLAK", duplikat: false });
      expect(await saldo(a)).toBe(100);
    });

    it("alasan kosong ditolak", async () => {
      const a = await buatAkun();
      expect(
        await kodeGalat(
          trx((tx) =>
            ajukanKoreksiSaldo(tx, {
              akunId: a,
              jumlahRp: 1,
              alasan: "   ",
              adminId: id["admin1"] ?? "",
            }),
          ),
        ),
      ).toBe("KOREKSI_TIDAK_SAH");
    });
  });

  describe("riwayat & rekonsiliasi", () => {
    it("riwayat urut terbaru, paging cursor, nomor tagihan hanya milik akun sendiri", async () => {
      const a = await buatAkun();
      const lain = await buatAkun();
      await kreditSelisih(a, 3_000);
      const t = await terbitkan(a, 1_000);
      // Invoice milik akun lain dirujuk entri akun a (data salah pemanggil): nomornya tidak boleh tampil.
      const tLain = await terbitkan(lain, 10);
      await trx((tx) =>
        kredit(tx, {
          akunId: a,
          jumlahRp: 10,
          sumber: { jenis: "REFUND_ONGKIR", invoiceId: tLain.invoiceId, pesertaId: a },
        }),
      );
      const repo = buatRepoSaldo(db);
      const h1 = await repo.riwayat(a, { batas: 2 });
      expect(h1.saldoRp).toBe(2_010);
      expect(
        h1.entri.map((e) => [e.jenis, e.jumlahRp, e.saldoSesudahRp, e.referensiTampil]),
      ).toEqual([
        ["REFUND_ONGKIR", 10, 2_010, null],
        ["PAKAI_CHECKOUT", -1_000, 2_000, t.nomor],
      ]);
      expect(h1.entri[1]?.jenisTampil).toBe("Dipakai untuk bayar tagihan");
      expect(h1.cursorBerikut).not.toBeNull();
      const h2 = await repo.riwayat(a, { batas: 2, sebelumId: Number(h1.cursorBerikut) });
      expect(h2.entri.map((e) => e.jenis)).toEqual(["SELISIH_HARGA"]);
      expect(h2.cursorBerikut).toBeNull();
      // Akun tanpa riwayat.
      const kosong = await repo.riwayat(await buatAkun(), { batas: 10 });
      expect(kosong).toEqual({ saldoRp: 0, entri: [], cursorBerikut: null });
    });

    it("saldo = Σ ledger untuk semua akun setelah semua skenario", async () => {
      expect(await cariSelisihSaldo(db)).toEqual([]);
    });
  });
});
