// Tes integrasi ledger saldo T-021 terhadap PostgreSQL NYATA (ADR-0001: tanpa mock DB).
// Jalan bila DATABASE_URL_TEST diisi. Angka rupiah di sini hanya data uji, BUKAN harga/margin/tarif.
import { randomBytes } from "node:crypto";
import { GalatSaldo, type SumberKredit } from "@nekat/domain";
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
  KUNCI_KONFIG_KOREKSI_MAKS,
  kunciLedgerBatch,
  putuskanKoreksiSaldo,
  type Tx,
} from "./repo/ledger-saldo.js";
import { jalankanSeed } from "./seed.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];
const hex = (n = 16) => randomBytes(n).toString("hex");
const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pesanGalat(e: unknown): string {
  const bagian: string[] = [];
  let x: unknown = e;
  while (x instanceof Error) {
    bagian.push(x.message);
    x = x.cause;
  }
  return bagian.join(" | ");
}

async function kodeGalat(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GalatSaldo) return e.kode;
    throw e;
  }
  throw new Error("Diharapkan GalatSaldo, ternyata berhasil");
}

async function gagalDb(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return pesanGalat(e);
  }
  throw new Error("Diharapkan gagal, ternyata berhasil");
}

interface InvoiceUji {
  invoiceId: string;
  grupId: string;
  pesertaId: string;
  nomor: string;
}

describe.skipIf(!URL_ADMIN)("ledger saldo T-021 (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_saldo_${hex(4)}`;
  const id: Record<string, string> = {};
  let nomorHp = 81400000000;
  let nomorHpAdmin = 81111112100;
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
  const txSql = (tx: Tx, s: string) => tx.execute(sql.raw(s));

  const buatAkun = () =>
    satu(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
          VALUES ('+62${String(nomorHp++)}', '\\x${hex()}', 1, now()) RETURNING id`);
  const buatAdmin = () =>
    satu(
      `INSERT INTO admin (nama, nomor_hp_e164) VALUES ('Admin ${hex(2)}', '+62${String(nomorHpAdmin++)}') RETURNING id`,
    );
  const uuidBaru = () => satu("SELECT uuid_v7() AS id");
  const saldo = (a: string) =>
    angka(`SELECT COALESCE((SELECT saldo_rp FROM akun_saldo WHERE akun_id = '${a}'), 0) AS v`);
  const jumlahEntri = (kunci: string) =>
    angka(`SELECT count(*)::int AS v FROM ledger_saldo WHERE kunci_idempotensi = '${kunci}'`);
  const entriInvoice = (invoiceId: string) =>
    angka(`SELECT count(*)::int AS v FROM ledger_saldo WHERE invoice_id = '${invoiceId}'`);

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

  /** Grup + peserta HOST (pembayar) + invoice DITERBITKAN (saldo 0) + invoice_peserta. */
  const buatInvoice = async (pembayar: string, total: number): Promise<InvoiceUji> => {
    const grupId =
      await satu(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id)
      VALUES ('${kodeLink()}', '${pembayar}', '${id["zona"]}', '${id["slot"]}', '${id["gudang"]}') RETURNING id`);
    const keranjang = await satu(
      `INSERT INTO keranjang (akun_id, grup_id, status) VALUES ('${pembayar}', '${grupId}', 'DIPAKAI_GRUP') RETURNING id`,
    );
    const pesertaId = await satu(`INSERT INTO peserta_grup (grup_id, akun_id, keranjang_id, peran)
      VALUES ('${grupId}', '${pembayar}', '${keranjang}', 'HOST') RETURNING id`);
    const nomor = `INV-${hex(4)}`;
    const invoiceId =
      await satu(`INSERT INTO invoice (nomor, grup_id, pembayar_akun_id, diterbitkan_pada, ttl_menit,
        kedaluwarsa_pada, subtotal_barang_rp, total_rp, saldo_dipakai_rp, sisa_bayar_rp)
      VALUES ('${nomor}', '${grupId}', '${pembayar}', now(), 60, now() + interval '60 minutes',
        ${total}, ${total}, 0, ${total}) RETURNING id`);
    await q(
      `INSERT INTO invoice_peserta (invoice_id, peserta_id, grup_id) VALUES ('${invoiceId}', '${pesertaId}', '${grupId}')`,
    );
    return { invoiceId, grupId, pesertaId, nomor };
  };

  // Modal = nilai − 1 hanya agar lolos CHECK harga ≥ modal; bukan angka harga/margin.
  const baris = (inv: InvoiceUji, nilai: number) =>
    satu(`INSERT INTO baris_invoice (invoice_id, peserta_id, jenis, satuan_jual_id, nama_snapshot, qty, level_harga,
        harga_dibayar_rp, modal_snapshot_rp, versi_harga, potongan_baris_rp, bebas_ppn, nilai_rp)
      VALUES ('${inv.invoiceId}', '${inv.pesertaId}', 'BARANG', '${id["sj"]}', 'Barang uji', 1, 'MITRA_GROSIR',
        ${nilai}, ${nilai - 1}, 'v-uji', 0, false, ${nilai}) RETURNING id`);

  const lunaskan = (invoiceId: string) =>
    q(`UPDATE invoice SET status = 'LUNAS', lunas_pada = now() WHERE id = '${invoiceId}'`);

  /** Invoice LUNAS tanpa saldo (dibayar penuh lewat kanal). */
  const invoiceLunas = async (pembayar: string, total: number) => {
    const inv = await buatInvoice(pembayar, total);
    await lunaskan(inv.invoiceId);
    return inv;
  };

  /** Terbitkan invoice lalu pakai saldo di transaksi yang sama (alur I1/I2). */
  const terbitkan = async (pembayar: string, total: number) => {
    const inv = await buatInvoice(pembayar, total);
    const r = await trx((tx) => debitCheckout(tx, { akunId: pembayar, invoiceId: inv.invoiceId }));
    if (!r.ok) throw new Error(r.kode);
    return { ...inv, ...r };
  };

  const selisih = (inv: InvoiceUji): SumberKredit => ({
    jenis: "SELISIH_HARGA",
    invoiceId: inv.invoiceId,
    grupId: inv.grupId,
    pesertaId: inv.pesertaId,
  });

  const kreditOk = (akunId: string, jumlahRp: number, sumber: SumberKredit) =>
    trx(async (tx) => {
      const r = await kredit(tx, { akunId, jumlahRp, sumber });
      if (!r.ok) throw new Error(r.kode);
      return r;
    });

  /** Isi saldo akun lewat selisih harga invoice LUNAS (sumber sah). */
  const isiSaldo = async (akunId: string, jumlahRp: number) => {
    const inv = await invoiceLunas(akunId, jumlahRp);
    return kreditOk(akunId, jumlahRp, selisih(inv));
  };

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
    id["produk"] = await satu(
      "INSERT INTO produk (kategori_id, nama) SELECT id, 'Gula Pasir' FROM kategori WHERE kode = 'gula' RETURNING id",
    );
    id["sku"] = await satu(
      `INSERT INTO sku (produk_id, kode_sku, satuan_dasar) VALUES ('${id["produk"]}', 'GP-S', 'pcs') RETURNING id`,
    );
    id["sj"] = await satu(`INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram)
      VALUES ('${id["sku"]}', 'PCS_1', 1, 1000) RETURNING id`);
    id["admin1"] = await buatAdmin();
    id["admin2"] = await buatAdmin();
    id["admin3"] = await buatAdmin();
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
      await tidur(20);
    }
    await admin.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await admin.end();
  });

  it("wajib dipanggil di dalam transaksi (pool biasa ditolak)", async () => {
    const a = await buatAkun();
    expect(
      await kodeGalat(
        debitCheckout(db as unknown as Tx, { akunId: a, invoiceId: await uuidBaru() }),
      ),
    ).toBe("BUKAN_TRANSAKSI");
  });

  describe("kredit", () => {
    it("kredit menambah saldo; event yang sama diulang → satu entri, sukses tanpa efek", async () => {
      const a = await buatAkun();
      const inv = await invoiceLunas(a, 5_000);
      const r1 = await kreditOk(a, 1_234, selisih(inv));
      expect(r1).toMatchObject({ jumlahRp: 1_234, saldoSesudahRp: 1_234, duplikat: false });
      const r2 = await kreditOk(a, 1_234, selisih(inv));
      expect(r2).toMatchObject({ idEntri: r1.idEntri, saldoSesudahRp: 1_234, duplikat: true });
      expect(await saldo(a)).toBe(1_234);
      expect(await jumlahEntri(`selisih:${inv.grupId}:${inv.pesertaId}`)).toBe(1);
    });

    it("replay dengan isi berbeda (nominal, dapat_dicairkan_sejak) → KUNCI_BENTROK, saldo tetap", async () => {
      const a = await buatAkun();
      const inv = await invoiceLunas(a, 5_000);
      await kreditOk(a, 500, selisih(inv));
      expect(await kodeGalat(kreditOk(a, 501, selisih(inv)))).toBe("KUNCI_BENTROK");
      expect(
        await kodeGalat(
          trx((tx) =>
            kredit(tx, {
              akunId: a,
              jumlahRp: 500,
              sumber: selisih(inv),
              dapatDicairkanSejak: new Date("2027-01-01T00:00:00Z"),
            }),
          ),
        ),
      ).toBe("KUNCI_BENTROK");
      expect(await saldo(a)).toBe(500);
    });

    it("P6 / L-1: akun diikat ke sumber — bukan pembayar, invoice fiktif, peserta/grup asing ditolak", async () => {
      const a = await buatAkun();
      const b = await buatAkun();
      const inv = await invoiceLunas(a, 5_000);
      expect(await kodeGalat(kreditOk(b, 100, selisih(inv)))).toBe("AKUN_TIDAK_SESUAI");
      expect(
        await kodeGalat(
          kreditOk(a, 100, {
            jenis: "REFUND_ONGKIR",
            invoiceId: await uuidBaru(),
            pesertaId: inv.pesertaId,
          }),
        ),
      ).toBe("SUMBER_TIDAK_SESUAI");
      expect(
        await kodeGalat(
          kreditOk(a, 100, {
            jenis: "REFUND",
            alasan: "KELUHAN",
            invoiceId: await uuidBaru(),
            keluhanId: await uuidBaru(),
          }),
        ),
      ).toBe("INVOICE_TIDAK_SESUAI");
      const lain = await invoiceLunas(b, 5_000);
      expect(
        await kodeGalat(
          kreditOk(a, 100, {
            jenis: "REFUND",
            alasan: "GRUP_BATAL",
            invoiceId: inv.invoiceId,
            pesertaId: lain.pesertaId,
            grupId: inv.grupId,
          }),
        ),
      ).toBe("SUMBER_TIDAK_SESUAI");
      expect(
        await kodeGalat(kreditOk(a, 100, { ...selisih(inv), grupId: lain.grupId } as SumberKredit)),
      ).toBe("SUMBER_TIDAK_SESUAI");
      expect(
        await kodeGalat(
          kreditOk(a, 100, {
            jenis: "REFUND",
            alasan: "STOK_HABIS",
            barisInvoiceId: await uuidBaru(),
          }),
        ),
      ).toBe("SUMBER_TIDAK_SESUAI");
      expect(await saldo(a)).toBe(0);
      expect(await saldo(b)).toBe(0);
    });

    it("event yang sama datang bersamaan (paralel) → tepat satu entri", async () => {
      const a = await buatAkun();
      const inv = await invoiceLunas(a, 9_000);
      const b1 = await baris(inv, 2_500);
      const hasil = await Promise.all(
        Array.from({ length: 8 }, () =>
          trx((tx) =>
            kredit(tx, {
              akunId: a,
              jumlahRp: 2_500,
              sumber: { jenis: "REFUND", alasan: "STOK_HABIS", barisInvoiceId: b1 },
              dapatDicairkanSejak: new Date("2027-01-01T00:00:00Z"),
            }),
          ),
        ),
      );
      expect(hasil.filter((h) => h.ok && !h.duplikat)).toHaveLength(1);
      expect(hasil.every((h) => h.ok)).toBe(true);
      expect(await saldo(a)).toBe(2_500);
      expect(await jumlahEntri(`refund:${b1}:STOK_HABIS`)).toBe(1);
    });

    it("P4 / M-1: kunci berbeda untuk dana yang sama dibatasi Σ ≤ total invoice (juga paralel)", async () => {
      const a = await buatAkun();
      const inv = await invoiceLunas(a, 10_000);
      const keluhan = () =>
        uuidBaru().then((k): SumberKredit => ({
          jenis: "REFUND",
          alasan: "KELUHAN",
          invoiceId: inv.invoiceId,
          keluhanId: k,
        }));
      const sumber = await Promise.all(Array.from({ length: 5 }, keluhan));
      const hasil = await Promise.allSettled(sumber.map((s) => kreditOk(a, 4_000, s)));
      expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(2);
      for (const h of hasil) {
        if (h.status === "rejected") {
          expect(h.reason).toBeInstanceOf(GalatSaldo);
          expect((h.reason as GalatSaldo).kode).toBe("MELEBIHI_DIBAYAR");
        }
      }
      // Sisa 2.000 masih boleh (tepat = total), lewat sumber lain (grup batal).
      await kreditOk(a, 2_000, {
        jenis: "REFUND",
        alasan: "GRUP_BATAL",
        invoiceId: inv.invoiceId,
        pesertaId: inv.pesertaId,
        grupId: inv.grupId,
      });
      expect(await kodeGalat(kreditOk(a, 1, selisih(inv)))).toBe("MELEBIHI_DIBAYAR");
      expect(await saldo(a)).toBe(10_000);
    });

    it("P5 / M-1: refund/selisih hanya untuk invoice LUNAS; invoice yang sudah SALDO_BALIK ditolak", async () => {
      const a = await buatAkun();
      const belum = await buatInvoice(a, 3_000);
      expect(await kodeGalat(kreditOk(a, 100, selisih(belum)))).toBe("INVOICE_TIDAK_SESUAI");
      await isiSaldo(a, 1_000);
      const t = await terbitkan(a, 3_000);
      await q(`UPDATE invoice SET status = 'KEDALUWARSA' WHERE id = '${t.invoiceId}'`);
      await trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }));
      expect(await kodeGalat(kreditOk(a, 1_000, selisih(t)))).toBe("INVOICE_TIDAK_SESUAI");
      expect(await saldo(a)).toBe(1_000);
    });

    it("jobCutoffId dikanonikkan: penulisan huruf besar → kunci sama → satu entri", async () => {
      const a = await buatAkun();
      const inv = await invoiceLunas(a, 5_000);
      const b1 = await baris(inv, 1_000);
      const slot = id["slot"] ?? "";
      const s = (c: string): SumberKredit => ({
        jenis: "REFUND",
        alasan: "ALOKASI",
        barisInvoiceId: b1,
        jobCutoffId: c,
      });
      await kreditOk(a, 700, s(`cutoff:${slot}`));
      const ulang = await kreditOk(a, 700, s(`CUTOFF:${slot.toUpperCase()}`));
      expect(ulang.duplikat).toBe(true);
      expect(await jumlahEntri(`refund:${b1}:ALOKASI:cutoff:${slot}`)).toBe(1);
      expect(await kodeGalat(kreditOk(a, 700, s(`job-${slot}`)))).toBe("ID_TIDAK_VALID");
    });

    it("BAYAR_TERLAMBAT hanya untuk pembayaran LUNAS_TERLAMBAT (status belum ada sampai T-030 → ditolak)", async () => {
      const a = await buatAkun();
      const inv = await buatInvoice(a, 2_000);
      const p =
        await satu(`INSERT INTO pembayaran (invoice_id, metode, jumlah_rp, kunci_idempotensi)
        VALUES ('${inv.invoiceId}', 'QRIS', 2000, 'bayar:${hex(4)}') RETURNING id`);
      expect(
        await kodeGalat(kreditOk(a, 2_000, { jenis: "BAYAR_TERLAMBAT", pembayaranId: p })),
      ).toBe("SUMBER_TIDAK_SESUAI");
      expect(
        await kodeGalat(
          kreditOk(a, 2_000, { jenis: "BAYAR_TERLAMBAT", pembayaranId: await uuidBaru() }),
        ),
      ).toBe("SUMBER_TIDAK_SESUAI");
    });

    it("gagal di transaksi pemanggil → kredit ikut rollback", async () => {
      const a = await buatAkun();
      const inv = await invoiceLunas(a, 1_000);
      await expect(
        trx(async (tx) => {
          await kredit(tx, { akunId: a, jumlahRp: 900, sumber: selisih(inv) });
          throw new Error("status penyebab gagal");
        }),
      ).rejects.toThrow("status penyebab gagal");
      expect(await saldo(a)).toBe(0);
    });

    it("menolak nominal 0/negatif/pecahan dan jenis di luar kontrak (mis. PENCAIRAN_BATAL)", async () => {
      const a = await buatAkun();
      const inv = await invoiceLunas(a, 1_000);
      for (const n of [0, -1, 1.5]) {
        expect(await kodeGalat(kreditOk(a, n, selisih(inv)))).toBe("NOMINAL_TIDAK_VALID");
      }
      expect(
        await kodeGalat(kreditOk(a, 1, { jenis: "PENCAIRAN_BATAL" } as unknown as SumberKredit)),
      ).toBe("ID_TIDAK_VALID");
    });
  });

  describe("debit checkout (§9)", () => {
    it("menutup penuh dan sebagian, invoice diisi di transaksi yang sama; saldo 0 → tanpa entri", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 10_000);
      const penuh = await terbitkan(a, 4_000);
      expect(penuh).toMatchObject({ dipakaiRp: 4_000, sisaBayarRp: 0, saldoSesudahRp: 6_000 });
      const sebagian = await terbitkan(a, 9_999);
      expect(sebagian).toMatchObject({ dipakaiRp: 6_000, sisaBayarRp: 3_999, saldoSesudahRp: 0 });
      const kosong = await terbitkan(a, 7_000);
      expect(kosong).toMatchObject({ idEntri: null, dipakaiRp: 0, sisaBayarRp: 7_000 });
      expect(await saldo(a)).toBe(0);
      const [inv] = await q(
        `SELECT saldo_dipakai_rp, sisa_bayar_rp FROM invoice WHERE id = '${sebagian.invoiceId}'`,
      );
      expect([Number(inv?.["saldo_dipakai_rp"]), Number(inv?.["sisa_bayar_rp"])]).toEqual([
        6_000, 3_999,
      ]);
    });

    it("maksRp membatasi pemakaian (K-50 menyusul)", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 5_000);
      const inv = await buatInvoice(a, 4_000);
      const r = await trx((tx) =>
        debitCheckout(tx, { akunId: a, invoiceId: inv.invoiceId, maksRp: 1_500 }),
      );
      expect(r).toMatchObject({ ok: true, dipakaiRp: 1_500, sisaBayarRp: 2_500 });
    });

    it("panggilan ulang untuk invoice yang sama → entri lama (tidak mendebit dua kali)", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 5_000);
      const t = await terbitkan(a, 3_000);
      const ulang = await trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: t.invoiceId }));
      expect(ulang).toMatchObject({
        ok: true,
        idEntri: t.idEntri,
        dipakaiRp: 3_000,
        duplikat: true,
      });
      expect(await saldo(a)).toBe(2_000);
      expect(await jumlahEntri(`debit:${t.invoiceId}`)).toBe(1);
    });

    it("P6 / L-1: invoice fiktif, bukan pembayar, sudah LUNAS, atau sudah punya pembayaran → ditolak", async () => {
      const a = await buatAkun();
      const b = await buatAkun();
      await isiSaldo(a, 5_000);
      await isiSaldo(b, 5_000);
      expect(
        await kodeGalat(
          trx(async (tx) => debitCheckout(tx, { akunId: a, invoiceId: await uuidBaru() })),
        ),
      ).toBe("INVOICE_TIDAK_SESUAI");
      const milikA = await buatInvoice(a, 1_000);
      expect(
        await kodeGalat(trx((tx) => debitCheckout(tx, { akunId: b, invoiceId: milikA.invoiceId }))),
      ).toBe("AKUN_TIDAK_SESUAI");
      const lunas = await invoiceLunas(a, 1_000);
      expect(
        await kodeGalat(trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: lunas.invoiceId }))),
      ).toBe("INVOICE_TIDAK_SESUAI");
      const adaBayar = await buatInvoice(a, 1_000);
      await q(`INSERT INTO pembayaran (invoice_id, metode, jumlah_rp, kunci_idempotensi)
        VALUES ('${adaBayar.invoiceId}', 'QRIS', 1000, 'bayar:${hex(4)}')`);
      expect(
        await kodeGalat(
          trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: adaBayar.invoiceId })),
        ),
      ).toBe("INVOICE_TIDAK_SESUAI");
      expect(await saldo(a)).toBe(5_000);
      expect(await saldo(b)).toBe(5_000);
    });

    it("dua (dan lebih) debit bersamaan tidak pernah membuat saldo negatif", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 10_000);
      const inv = await Promise.all(Array.from({ length: 6 }, () => buatInvoice(a, 3_000)));
      const hasil = await Promise.all(
        inv.map((i) => trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: i.invoiceId }))),
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
      await isiSaldo(a, 5_000);
      const i1 = await buatInvoice(a, 4_000);
      const i2 = await buatInvoice(a, 4_000);
      let lepas: () => void = () => undefined;
      const tahan = new Promise<void>((r) => (lepas = r));
      let tandaiDebit: () => void = () => undefined;
      const sudahDebit = new Promise<void>((r) => (tandaiDebit = r));
      const pertama = trx(async (tx) => {
        const r = await debitCheckout(tx, { akunId: a, invoiceId: i1.invoiceId });
        tandaiDebit();
        await tahan; // kunci akun_saldo masih dipegang
        return r;
      });
      await sudahDebit;
      let keduaSelesai = false;
      const kedua = trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: i2.invoiceId })).then(
        (r) => {
          keduaSelesai = true;
          return r;
        },
      );
      await tidur(150);
      expect(keduaSelesai).toBe(false);
      lepas();
      const [r1, r2] = await Promise.all([pertama, kedua]);
      expect(r1).toMatchObject({ ok: true, dipakaiRp: 4_000 });
      expect(r2).toMatchObject({ ok: true, dipakaiRp: 1_000, saldoSesudahRp: 0 });
    });

    it("akun DIBEKUKAN tidak bisa memakai saldo maupun menerima kredit (transaksi tetap sehat)", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 1_000);
      const baru = await buatInvoice(a, 500);
      const lunas = await invoiceLunas(a, 700);
      await q(`UPDATE akun SET status = 'DIBEKUKAN', dibekukan_alasan = 'uji' WHERE id = '${a}'`);
      const r = await trx(async (tx) => {
        const d = await debitCheckout(tx, { akunId: a, invoiceId: baru.invoiceId });
        const k = await kredit(tx, { akunId: a, jumlahRp: 700, sumber: selisih(lunas) });
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
      const inv = await buatInvoice(a, 1_000);
      for (const n of [-1, 0.5]) {
        expect(
          await kodeGalat(
            trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: inv.invoiceId, maksRp: n })),
          ),
        ).toBe("NOMINAL_TIDAK_VALID");
      }
    });
  });

  describe("urutan kunci: akun (FOR SHARE) → akun_saldo", () => {
    it("pembekuan akun menunggu transaksi ledger yang sedang berjalan; sesudahnya debit ditolak", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 3_000);
      const i1 = await buatInvoice(a, 1_000);
      const i2 = await buatInvoice(a, 1_000);
      let lepas: () => void = () => undefined;
      const tahan = new Promise<void>((r) => (lepas = r));
      let tandai: () => void = () => undefined;
      const sudah = new Promise<void>((r) => (tandai = r));
      const ledger = trx(async (tx) => {
        const r = await debitCheckout(tx, { akunId: a, invoiceId: i1.invoiceId });
        tandai();
        await tahan;
        return r;
      });
      await sudah;
      let bekuSelesai = false;
      const beku = q(
        `UPDATE akun SET status = 'DIBEKUKAN', dibekukan_alasan = 'uji' WHERE id = '${a}'`,
      ).then(() => (bekuSelesai = true));
      await tidur(150);
      expect(bekuSelesai).toBe(false); // tertahan FOR SHARE
      lepas();
      await Promise.all([ledger, beku]);
      const r2 = await trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: i2.invoiceId }));
      expect(r2).toEqual({ ok: false, kode: "AKUN_DIBEKUKAN", retryable: false });
      expect(await saldo(a)).toBe(2_000);
    });

    it("kunciLedgerBatch: dua batch dengan urutan akun berlawanan tidak deadlock", async () => {
      const a = await buatAkun();
      const b = await buatAkun();
      const ia = await Promise.all([invoiceLunas(a, 1_000), invoiceLunas(a, 1_000)]);
      const ib = await Promise.all([invoiceLunas(b, 1_000), invoiceLunas(b, 1_000)]);
      const batch = (urutan: [string, InvoiceUji][]) =>
        trx(async (tx) => {
          await kunciLedgerBatch(tx, {
            invoiceIds: urutan.map(([, i]) => i.invoiceId),
            akunIds: urutan.map(([x]) => x),
          });
          for (const [x, i] of urutan) {
            await tidur(20);
            const r = await kredit(tx, { akunId: x, jumlahRp: 100, sumber: selisih(i) });
            if (!r.ok) throw new Error(r.kode);
          }
        });
      const [ia0, ia1] = ia;
      const [ib0, ib1] = ib;
      await Promise.all([
        batch([
          [a, ia0],
          [b, ib0],
        ]),
        batch([
          [b, ib1],
          [a, ia1],
        ]),
      ]);
      expect(await saldo(a)).toBe(200);
      expect(await saldo(b)).toBe(200);
    });
  });

  describe("SALDO_BALIK (§8.2, §9.4)", () => {
    it("invoice kedaluwarsa → saldo yang dipakai kembali sekali; ulang = duplikat", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 8_000);
      const t = await terbitkan(a, 5_000);
      expect(await saldo(a)).toBe(3_000);

      // Invoice masih DITERBITKAN → ditolak (pemanggil wajib mengubah status dulu).
      expect(
        await kodeGalat(trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }))),
      ).toBe("INVOICE_TIDAK_SESUAI");

      const r = await trx(async (tx) => {
        await txSql(tx, `UPDATE invoice SET status = 'KEDALUWARSA' WHERE id = '${t.invoiceId}'`);
        return kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId });
      });
      expect(r).toMatchObject({
        ok: true,
        jumlahRp: 5_000,
        saldoSesudahRp: 8_000,
        duplikat: false,
      });
      const ulang = await trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }));
      expect(ulang).toMatchObject({ ok: true, duplikat: true });
      expect(await saldo(a)).toBe(8_000);
      expect(await jumlahEntri(`saldo-balik:${t.invoiceId}`)).toBe(1);
    });

    it("SALDO_BALIK pertama kali datang paralel → tepat satu entri", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 4_000);
      const t = await terbitkan(a, 4_000);
      await q(`UPDATE invoice SET status = 'DIBATALKAN' WHERE id = '${t.invoiceId}'`);
      const hasil = await Promise.all(
        Array.from({ length: 6 }, () =>
          trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId })),
        ),
      );
      expect(hasil.filter((h) => h.ok && !h.duplikat)).toHaveLength(1);
      expect(await saldo(a)).toBe(4_000);
      expect(await jumlahEntri(`saldo-balik:${t.invoiceId}`)).toBe(1);
    });

    it("akun DIBEKUKAN tetap menerima SALDO_BALIK (default sementara L-01), tapi tetap tidak bisa memakai", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 2_000);
      const t = await terbitkan(a, 2_000);
      await q(`UPDATE akun SET status = 'DIBEKUKAN', dibekukan_alasan = 'uji' WHERE id = '${a}'`);
      await q(`UPDATE invoice SET status = 'KEDALUWARSA' WHERE id = '${t.invoiceId}'`);
      const r = await trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }));
      expect(r).toMatchObject({ ok: true, jumlahRp: 2_000 });
      expect(await saldo(a)).toBe(2_000);
      const baru = await buatInvoice(a, 500);
      const d = await trx((tx) => debitCheckout(tx, { akunId: a, invoiceId: baru.invoiceId }));
      expect(d).toMatchObject({ ok: false, kode: "AKUN_DIBEKUKAN" });
    });

    it("invoice LUNAS tidak bisa SALDO_BALIK (saldonya bagian REFUND §8.1.3)", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 2_000);
      const t = await terbitkan(a, 2_000);
      await lunaskan(t.invoiceId);
      expect(
        await kodeGalat(trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }))),
      ).toBe("INVOICE_TIDAK_SESUAI");
      // Yang benar: REFUND (termasuk bagian saldo), dibatasi total invoice.
      await kreditOk(a, 2_000, {
        jenis: "REFUND",
        alasan: "GRUP_BATAL",
        invoiceId: t.invoiceId,
        pesertaId: t.pesertaId,
        grupId: t.grupId,
      });
      expect(await saldo(a)).toBe(2_000);
      expect(await entriInvoice(t.invoiceId)).toBe(2);
    });

    it("invoice tanpa saldo dipakai → no-op tanpa entri", async () => {
      const a = await buatAkun();
      const t = await buatInvoice(a, 1_000);
      await q(`UPDATE invoice SET status = 'DIBATALKAN' WHERE id = '${t.invoiceId}'`);
      const r = await trx((tx) => kembalikanSaldoInvoice(tx, { invoiceId: t.invoiceId }));
      expect(r).toMatchObject({ ok: true, idEntri: null, jumlahRp: 0 });
    });
  });

  describe("koreksi admin four-eyes", () => {
    const ajukan = (akunId: string, jumlahRp: number, adminId = id["admin1"] ?? "") =>
      trx((tx) => ajukanKoreksiSaldo(tx, { akunId, jumlahRp, alasan: "uji koreksi", adminId }));
    const putus = (pengajuanId: string, hasil: "DISETUJUI" | "DITOLAK", adminId: string) =>
      trx((tx) => putuskanKoreksiSaldo(tx, { pengajuanId, hasil, adminId }));

    it("pengaju tidak bisa memutus; admin lain menyetujui → KOREKSI_ADMIN; ulang = duplikat", async () => {
      const a = await buatAkun();
      const { pengajuanId } = await ajukan(a, 750);
      expect(await kodeGalat(putus(pengajuanId, "DISETUJUI", id["admin1"] ?? ""))).toBe(
        "KOREKSI_TIDAK_SAH",
      );
      const r = await putus(pengajuanId, "DISETUJUI", id["admin2"] ?? "");
      expect(r).toMatchObject({ hasil: "DISETUJUI", saldoSesudahRp: 750, duplikat: false });
      const ulang = await putus(pengajuanId, "DISETUJUI", id["admin2"] ?? "");
      expect(ulang).toMatchObject({ hasil: "DISETUJUI", duplikat: true });
      expect(await kodeGalat(putus(pengajuanId, "DITOLAK", id["admin2"] ?? ""))).toBe(
        "KOREKSI_TIDAK_SAH",
      );
      expect(await saldo(a)).toBe(750);
      expect(await jumlahEntri(`koreksi:${pengajuanId}`)).toBe(1);
    });

    it("dua admin memutus bersamaan → tepat satu keputusan & satu entri", async () => {
      const a = await buatAkun();
      const { pengajuanId } = await ajukan(a, 300);
      const hasil = await Promise.allSettled([
        putus(pengajuanId, "DISETUJUI", id["admin2"] ?? ""),
        putus(pengajuanId, "DISETUJUI", id["admin3"] ?? ""),
      ]);
      expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
      expect(await saldo(a)).toBe(300);
      expect(await jumlahEntri(`koreksi:${pengajuanId}`)).toBe(1);
    });

    it("M-2: pengaju & pemutus wajib admin AKTIF (kode dan trigger DB)", async () => {
      const a = await buatAkun();
      const nonaktif = await buatAdmin();
      await q(`UPDATE admin SET status = 'NONAKTIF' WHERE id = '${nonaktif}'`);
      expect(await kodeGalat(ajukan(a, 100, nonaktif))).toBe("KOREKSI_TIDAK_SAH");
      // Jalur langsung ke DB (melewati kode) juga ditolak trigger 0007.
      expect(
        await gagalDb(
          q(`INSERT INTO pengajuan_koreksi_saldo (akun_id, jumlah_rp, alasan, diajukan_oleh)
             VALUES ('${a}', 100, 'uji', '${nonaktif}')`),
        ),
      ).toMatch(/koreksi_admin_tidak_aktif/);

      const { pengajuanId } = await ajukan(a, 100);
      expect(await kodeGalat(putus(pengajuanId, "DISETUJUI", nonaktif))).toBe("KOREKSI_TIDAK_SAH");
      expect(
        await gagalDb(
          q(`INSERT INTO keputusan_koreksi_saldo (pengajuan_id, hasil, diputuskan_oleh)
             VALUES ('${pengajuanId}', 'DITOLAK', '${nonaktif}')`),
        ),
      ).toMatch(/koreksi_admin_tidak_aktif/);

      // Pengaju dinonaktifkan setelah mengajukan → tidak bisa disetujui, hanya ditolak.
      const pengajuLama = await buatAdmin();
      const p2 = await ajukan(a, 100, pengajuLama);
      await q(`UPDATE admin SET status = 'NONAKTIF' WHERE id = '${pengajuLama}'`);
      expect(await kodeGalat(putus(p2.pengajuanId, "DISETUJUI", id["admin2"] ?? ""))).toBe(
        "KOREKSI_TIDAK_SAH",
      );
      expect(
        await gagalDb(
          q(`INSERT INTO keputusan_koreksi_saldo (pengajuan_id, hasil, diputuskan_oleh)
             VALUES ('${p2.pengajuanId}', 'DISETUJUI', '${id["admin2"] ?? ""}')`),
        ),
      ).toMatch(/koreksi_admin_tidak_aktif/);
      expect(await putus(p2.pengajuanId, "DITOLAK", id["admin2"] ?? "")).toEqual({
        hasil: "DITOLAK",
        duplikat: false,
      });
      expect(await saldo(a)).toBe(0);
    });

    it("koreksi debit melebihi saldo → SALDO_KURANG, keputusan ikut rollback; DITOLAK tanpa entri", async () => {
      const a = await buatAkun();
      await isiSaldo(a, 100);
      const { pengajuanId } = await ajukan(a, -101);
      expect(await kodeGalat(putus(pengajuanId, "DISETUJUI", id["admin2"] ?? ""))).toBe(
        "SALDO_KURANG",
      );
      expect(
        await angka(
          `SELECT count(*)::int AS v FROM keputusan_koreksi_saldo WHERE pengajuan_id = '${pengajuanId}'`,
        ),
      ).toBe(0);
      expect(await putus(pengajuanId, "DITOLAK", id["admin2"] ?? "")).toEqual({
        hasil: "DITOLAK",
        duplikat: false,
      });
      expect(await saldo(a)).toBe(100);
    });

    it("batas nominal koreksi dari konfigurasi (kosong = tidak dibatasi); alasan kosong ditolak", async () => {
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
      const tanpaBatas = await ajukan(a, 1_000_000);
      await q(
        `INSERT INTO konfigurasi (kunci, nilai) VALUES ('${KUNCI_KONFIG_KOREKSI_MAKS}', '1000'::jsonb)`,
      );
      try {
        expect(await kodeGalat(ajukan(a, -1_001))).toBe("KOREKSI_TIDAK_SAH");
        await ajukan(a, 1_000);
        // Pengajuan lama di atas batas tidak bisa disetujui setelah batas berlaku.
        expect(
          await kodeGalat(putus(tanpaBatas.pengajuanId, "DISETUJUI", id["admin2"] ?? "")),
        ).toBe("KOREKSI_TIDAK_SAH");
        await q(
          `UPDATE konfigurasi SET nilai = '"abc"'::jsonb WHERE kunci = '${KUNCI_KONFIG_KOREKSI_MAKS}'`,
        );
        expect(await kodeGalat(ajukan(a, 1))).toBe("KOREKSI_TIDAK_SAH"); // gagal tertutup
      } finally {
        await q(`DELETE FROM konfigurasi WHERE kunci = '${KUNCI_KONFIG_KOREKSI_MAKS}'`);
      }
    });
  });

  describe("riwayat & rekonsiliasi", () => {
    it("riwayat urut terbaru, paging cursor, nomor tagihan dari invoice sumber", async () => {
      const a = await buatAkun();
      const sumber = await invoiceLunas(a, 3_000);
      await kreditOk(a, 3_000, selisih(sumber));
      const t = await terbitkan(a, 1_000);
      const repo = buatRepoSaldo(db);
      const h1 = await repo.riwayat(a, { batas: 1 });
      expect(h1.saldoRp).toBe(2_000);
      expect(
        h1.entri.map((e) => [e.jenis, e.jumlahRp, e.saldoSesudahRp, e.referensiTampil]),
      ).toEqual([["PAKAI_CHECKOUT", -1_000, 2_000, t.nomor]]);
      expect(h1.entri[0]?.jenisTampil).toBe("Dipakai untuk bayar tagihan");
      expect(h1.cursorBerikut).not.toBeNull();
      const h2 = await repo.riwayat(a, { batas: 5, sebelumId: Number(h1.cursorBerikut) });
      expect(h2.entri.map((e) => [e.jenis, e.referensiTampil])).toEqual([
        ["SELISIH_HARGA", sumber.nomor],
      ]);
      expect(h2.cursorBerikut).toBeNull();
      const kosong = await repo.riwayat(await buatAkun(), { batas: 10 });
      expect(kosong).toEqual({ saldoRp: 0, entri: [], cursorBerikut: null });
    });

    it("saldo = Σ ledger untuk semua akun setelah semua skenario", async () => {
      expect(await cariSelisihSaldo(db)).toEqual([]);
    });
  });
});
