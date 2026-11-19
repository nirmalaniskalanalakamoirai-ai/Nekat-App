// Tes integrasi skema T-013b (keranjang, grup, invoice, pembayaran, saldo, promo, COD, idempotensi)
// terhadap PostgreSQL NYATA (ADR-0001: tanpa mock DB). Jalan bila DATABASE_URL_TEST diisi.
// Angka rupiah di sini hanya data uji, BUKAN harga/margin/tarif produk.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatDb, jalankanMigrasi, type Db } from "./koneksi.js";
import { buatPenyimpanIdempotensiPg } from "./repo/idempotensi-inventori.js";
import { jalankanSeed, SEED_ARMADA } from "./seed.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];

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
const SHA = (c: string) => c.repeat(64);

describe.skipIf(!URL_ADMIN)("skema database T-013b (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_trx_${hex(4)}`;
  const id: Record<string, string> = {};
  let nomorHp = 81300000000;
  let nomorKode = 0;

  const q = async (s: string) => (await db.execute(sql.raw(s))).rows;
  const satu = async (s: string): Promise<string> => {
    const [baris] = await q(s);
    return String(baris?.["id"]);
  };
  const nilai = async (s: string): Promise<unknown> => {
    const [baris] = await q(s);
    return baris?.["v"];
  };

  const buatAkun = () =>
    satu(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
          VALUES ('+62${String(nomorHp++)}', '\\x${hex()}', 1, now()) RETURNING id`);

  /** Kode link 6 karakter tanpa karakter ambigu. */
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

  const buatKeranjangGrup = (akunId: string, grupId: string) =>
    satu(
      `INSERT INTO keranjang (akun_id, grup_id, status) VALUES ('${akunId}', '${grupId}', 'DIPAKAI_GRUP') RETURNING id`,
    );

  const ikut = async (akunId: string, grupId: string, peran = "ANGGOTA") => {
    const k = await buatKeranjangGrup(akunId, grupId);
    return satu(`INSERT INTO peserta_grup (grup_id, akun_id, keranjang_id, peran)
                 VALUES ('${grupId}', '${akunId}', '${k}', '${peran}') RETURNING id`);
  };

  /** Invoice biasa: kedaluwarsa = terbit + TTL. Total dihitung dari komponen kecuali ditimpa. */
  const buatInvoice = (
    grupId: string,
    pembayar: string,
    o: {
      subtotal?: number;
      total?: number;
      saldo?: number;
      ttl?: number;
      kedaluwarsa?: string;
    } = {},
  ) => {
    const subtotal = o.subtotal ?? 0;
    const total = o.total ?? subtotal;
    const saldo = o.saldo ?? 0;
    const ttl = o.ttl ?? 60;
    const kedaluwarsa =
      o.kedaluwarsa ?? `'2026-11-20T01:00:00Z'::timestamptz + interval '${ttl - 60} minutes'`;
    return satu(`INSERT INTO invoice (nomor, grup_id, pembayar_akun_id, diterbitkan_pada, ttl_menit, kedaluwarsa_pada,
                   subtotal_barang_rp, total_rp, saldo_dipakai_rp, sisa_bayar_rp)
                 VALUES ('INV-${hex(4)}', '${grupId}', '${pembayar}', '2026-11-20T00:00:00Z', ${ttl}, ${kedaluwarsa},
                   ${subtotal}, ${total}, ${saldo}, ${total - saldo}) RETURNING id`);
  };

  const tagihPeserta = (invoiceId: string, pesertaId: string, grupId: string) =>
    q(
      `INSERT INTO invoice_peserta (invoice_id, peserta_id, grup_id) VALUES ('${invoiceId}', '${pesertaId}', '${grupId}')`,
    );

  const barisBarang = (
    invoiceId: string,
    pesertaId: string,
    o: { harga: number; modal: number; qty?: number; potongan?: number; nilai?: number },
  ) => {
    const qty = o.qty ?? 1;
    return satu(`INSERT INTO baris_invoice (invoice_id, peserta_id, jenis, satuan_jual_id, nama_snapshot, qty, level_harga,
                   harga_dibayar_rp, modal_snapshot_rp, versi_harga, potongan_baris_rp, bebas_ppn, nilai_rp)
                 VALUES ('${invoiceId}', '${pesertaId}', 'BARANG', '${id["sj"]}', 'Barang uji', ${qty}, 'MITRA_GROSIR',
                   ${o.harga}, ${o.modal}, 'v-uji', ${o.potongan ?? 0}, false, ${o.nilai ?? o.harga * qty}) RETURNING id`);
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
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-trx', 'Gudang', 'PUSAT') RETURNING id",
    );
    id["zona"] = await satu(
      `INSERT INTO zona (kode_konfig, nama_kelurahan, gudang_id) VALUES ('z-trx', 'Kelurahan Uji', '${id["gudang"]}') RETURNING id`,
    );
    id["slot"] = await satu(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
      VALUES ('${id["zona"]}', '2026-12-01', '09:00', '12:00', '2026-11-30T00:00:00Z') RETURNING id`);
    id["produk"] = await satu(
      "INSERT INTO produk (kategori_id, nama) SELECT id, 'Gula Pasir' FROM kategori WHERE kode = 'gula' RETURNING id",
    );
    id["sku"] = await satu(
      `INSERT INTO sku (produk_id, kode_sku, satuan_dasar) VALUES ('${id["produk"]}', 'GP-1', 'pcs') RETURNING id`,
    );
    id["sj"] = await satu(`INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram)
      VALUES ('${id["sku"]}', 'PCS_1', 1, 1000) RETURNING id`);
    await q(`INSERT INTO stok_lokasi (sku_id, gudang_id, tersedia, data_pada, disinkron_pada)
      VALUES ('${id["sku"]}', '${id["gudang"]}', 100, now(), now())`);
    id["admin1"] = await satu(
      "INSERT INTO admin (nama, nomor_hp_e164) VALUES ('Admin Satu', '+6281111111101') RETURNING id",
    );
    id["admin2"] = await satu(
      "INSERT INTO admin (nama, nomor_hp_e164) VALUES ('Admin Dua', '+6281111111102') RETURNING id",
    );
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    // Tes paralel membuka beberapa koneksi; tunggu backend benar-benar keluar sebelum DROP ... FORCE
    // agar klien yang sedang menutup tidak menerima FATAL 57P01 (error tak tertangani).
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

  it("migrasi idempoten dan seed armada tanpa kapasitas/tarif (nonaktif)", async () => {
    await jalankanMigrasi(db);
    await jalankanSeed(db);
    const r = await q("SELECT kode, kapasitas_gram, aktif FROM armada ORDER BY kode");
    expect(r).toHaveLength(SEED_ARMADA.length);
    for (const a of r) {
      expect(a["kapasitas_gram"]).toBeNull();
      expect(a["aktif"]).toBe(false);
    }
    expect(await nilai("SELECT count(*)::int AS v FROM tarif_armada")).toBe(0);
    expect(await gagal(q("UPDATE armada SET aktif = true WHERE kode = 'MOTOR'"))).toMatch(
      /armada_aktif_butuh_kapasitas/,
    );
  });

  describe("keranjang & grup", () => {
    it("satu keranjang pribadi aktif per akun", async () => {
      const a = await buatAkun();
      await q(`INSERT INTO keranjang (akun_id) VALUES ('${a}')`);
      expect(await gagal(q(`INSERT INTO keranjang (akun_id) VALUES ('${a}')`))).toMatch(
        /keranjang_pribadi_aktif_uk/,
      );
    });

    it("grup wajib minimal 3 akun dan kode link tanpa karakter ambigu", async () => {
      const h = await buatAkun();
      expect(
        await gagal(
          q(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id, min_akun)
             VALUES ('${kodeLink()}', '${h}', '${id["zona"]}', '${id["slot"]}', '${id["gudang"]}', 2)`),
        ),
      ).toMatch(/grup_min_akun/);
      expect(
        await gagal(
          q(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id)
             VALUES ('AB1O0I', '${h}', '${id["zona"]}', '${id["slot"]}', '${id["gudang"]}')`),
        ),
      ).toMatch(/grup_kode_link_format/);
    });

    it("satu akun hanya sekali hidup per grup; ikut lagi setelah dikeluarkan dengan keranjang baru", async () => {
      const h = await buatAkun();
      const g = await buatGrup(h);
      const a = await buatAkun();
      const p1 = await ikut(a, g);
      // Keranjang kedua untuk grup yang sama ditolak selama keranjang lama belum ditinggalkan.
      expect(await gagal(buatKeranjangGrup(a, g))).toMatch(/keranjang_grup_aktif_uk/);
      await q(
        `UPDATE peserta_grup SET status = 'DIKELUARKAN', dikeluarkan_pada = now() WHERE id = '${p1}'`,
      );
      await q(
        `UPDATE keranjang SET status = 'DITINGGALKAN' WHERE id = (SELECT keranjang_id FROM peserta_grup WHERE id = '${p1}')`,
      );
      await ikut(a, g);
      // Lapisan kedua: walau ada keranjang lain milik akun itu, peserta hidup kedua tetap ditolak.
      const k3 = await satu(
        `INSERT INTO keranjang (akun_id, grup_id, status) VALUES ('${a}', '${g}', 'DITINGGALKAN') RETURNING id`,
      );
      expect(
        await gagal(
          q(
            `INSERT INTO peserta_grup (grup_id, akun_id, keranjang_id) VALUES ('${g}', '${a}', '${k3}')`,
          ),
        ),
      ).toMatch(/peserta_grup_akun_aktif_uk/);
    });

    it("keranjang peserta wajib milik akun & grup yang sama (FK komposit)", async () => {
      const h = await buatAkun();
      const g = await buatGrup(h);
      const lain = await buatAkun();
      const kLain = await buatKeranjangGrup(lain, g);
      const a = await buatAkun();
      expect(
        await gagal(
          q(
            `INSERT INTO peserta_grup (grup_id, akun_id, keranjang_id) VALUES ('${g}', '${a}', '${kLain}')`,
          ),
        ),
      ).toMatch(/peserta_grup_keranjang_milik_akun_grup_fk/);
    });

    it("satu host hidup per grup", async () => {
      const h = await buatAkun();
      const g = await buatGrup(h);
      await ikut(h, g, "HOST");
      expect(await gagal(ikut(await buatAkun(), g, "HOST"))).toMatch(/peserta_grup_satu_host_uk/);
    });

    it("cara kirim antar rumah wajib alamat, drop point wajib drop point (bukan keduanya)", async () => {
      const h = await buatAkun();
      const g = await buatGrup(h);
      const p = await ikut(h, g, "HOST");
      expect(
        await gagal(q(`UPDATE peserta_grup SET cara_kirim = 'ANTAR_RUMAH' WHERE id = '${p}'`)),
      ).toMatch(/peserta_tujuan_kirim_konsisten/);
    });

    it("K-22: setelah tagihan terbit tidak bisa tambah anggota maupun barang", async () => {
      const h = await buatAkun();
      const g = await buatGrup(h);
      const pHost = await ikut(h, g, "HOST");
      const kHost = await nilai(`SELECT keranjang_id AS v FROM peserta_grup WHERE id = '${pHost}'`);
      await q(
        `INSERT INTO item_keranjang (keranjang_id, satuan_jual_id, qty) VALUES ('${String(kHost)}', '${id["sj"]}', 2)`,
      );
      expect(
        await gagal(q(`UPDATE grup SET tagihan_diterbitkan_pada = now() WHERE id = '${g}'`)),
      ).toMatch(/grup_tagihan_terbit_konsisten/);
      await q(
        `UPDATE grup SET status = 'TAGIHAN_TERBIT', tagihan_diterbitkan_pada = now() WHERE id = '${g}'`,
      );
      expect(await gagal(ikut(await buatAkun(), g))).toMatch(/tidak bisa menambah anggota/);
      expect(
        await gagal(q(`UPDATE item_keranjang SET qty = 5 WHERE keranjang_id = '${String(kHost)}'`)),
      ).toMatch(/terkunci setelah tagihan terbit/);
      expect(
        await gagal(q(`DELETE FROM item_keranjang WHERE keranjang_id = '${String(kHost)}'`)),
      ).toMatch(/terkunci setelah tagihan terbit/);
    });

    it("F-07/K-40: peserta tidak bisa batal setelah bayar; dana kembali hanya lewat DIREFUND", async () => {
      const h = await buatAkun();
      const g = await buatGrup(h);
      const p = await ikut(h, g, "HOST");
      await q(`UPDATE peserta_grup SET status = 'LUNAS' WHERE id = '${p}'`);
      expect(await gagal(q(`UPDATE peserta_grup SET status = 'BATAL' WHERE id = '${p}'`))).toMatch(
        /peserta_tidak_batal_setelah_bayar/,
      );
      expect(
        await gagal(
          q(
            `UPDATE peserta_grup SET status = 'DIKELUARKAN', dikeluarkan_pada = now() WHERE id = '${p}'`,
          ),
        ),
      ).toMatch(/peserta_tidak_batal_setelah_bayar/);
      await q(`UPDATE peserta_grup SET status = 'DIREFUND' WHERE id = '${p}'`);
    });
  });

  describe("invoice, baris, reservasi", () => {
    let g: string;
    let pembayar: string;
    let peserta: string;

    beforeAll(async () => {
      pembayar = await buatAkun();
      g = await buatGrup(pembayar);
      peserta = await ikut(pembayar, g, "HOST");
    });

    it("total wajib = komponen; sisa bayar = total − saldo; saldo dipakai ≤ total", async () => {
      expect(await gagal(buatInvoice(g, pembayar, { subtotal: 10000, total: 9000 }))).toMatch(
        /invoice_total_konsisten/,
      );
      expect(await gagal(buatInvoice(g, pembayar, { subtotal: 10000, saldo: 10001 }))).toMatch(
        /invoice_saldo_dipakai/,
      );
    });

    it("kedaluwarsa = terbit + TTL untuk invoice biasa (K-07)", async () => {
      expect(
        await gagal(buatInvoice(g, pembayar, { kedaluwarsa: "'2026-11-20T02:00:00Z'" })),
      ).toMatch(/invoice_kedaluwarsa_ttl/);
    });

    it("peserta grup lain tidak bisa ditagih di invoice ini; satu invoice aktif per peserta", async () => {
      const inv = await buatInvoice(g, pembayar);
      const hLain = await buatAkun();
      const gLain = await buatGrup(hLain);
      const pLain = await ikut(hLain, gLain, "HOST");
      expect(await gagal(tagihPeserta(inv, pLain, g))).toMatch(/invoice_peserta_peserta_grup_fk/);
      expect(await gagal(tagihPeserta(inv, pLain, gLain))).toMatch(
        /invoice_peserta_invoice_grup_fk/,
      );
      await tagihPeserta(inv, peserta, g);
      const inv2 = await buatInvoice(g, pembayar);
      expect(await gagal(tagihPeserta(inv2, peserta, g))).toMatch(/invoice_peserta_satu_aktif_uk/);
      await q(`UPDATE invoice_peserta SET aktif = false WHERE invoice_id = '${inv}'`);
      await tagihPeserta(inv2, peserta, g);
    });

    it("HARGA DI BAWAH ATAU SAMA DENGAN MODAL DITOLAK; nilai bersih setelah potongan ≥ modal", async () => {
      const inv = await nilai(
        `SELECT invoice_id AS v FROM invoice_peserta WHERE peserta_id = '${peserta}' AND aktif`,
      );
      const i = String(inv);
      expect(await gagal(barisBarang(i, peserta, { harga: 1000, modal: 1000 }))).toMatch(
        /baris_harga_di_atas_modal/,
      );
      expect(
        await gagal(barisBarang(i, peserta, { harga: 1200, modal: 1000, qty: 2, potongan: 401 })),
      ).toMatch(/baris_bersih_tidak_di_bawah_modal/);
      expect(await gagal(barisBarang(i, peserta, { harga: 1200, modal: 1000, nilai: 1 }))).toMatch(
        /baris_nilai_konsisten/,
      );
      const b = await barisBarang(i, peserta, { harga: 1200, modal: 1000, qty: 2, potongan: 400 });
      // P-19: harga final tidak pernah > harga dibayar; P-09: tidak di bawah modal cut-off.
      expect(
        await gagal(
          q(
            `UPDATE baris_invoice SET modal_cutoff_rp = 1000, harga_final_rp = 1300 WHERE id = '${b}'`,
          ),
        ),
      ).toMatch(/baris_harga_final/);
      expect(
        await gagal(
          q(
            `UPDATE baris_invoice SET modal_cutoff_rp = 1100, harga_final_rp = 1050 WHERE id = '${b}'`,
          ),
        ),
      ).toMatch(/baris_harga_final/);
      await q(
        `UPDATE baris_invoice SET modal_cutoff_rp = 1000, harga_final_rp = 1100 WHERE id = '${b}'`,
      );
    });

    it("baris wajib milik peserta yang ditagih di invoice itu", async () => {
      const inv = await buatInvoice(g, pembayar);
      expect(await gagal(barisBarang(inv, peserta, { harga: 1200, modal: 1000 }))).toMatch(
        /baris_invoice_invoice_peserta_fk/,
      );
    });

    it("biaya admin flat satu kali per akun peserta (K-06, K-26)", async () => {
      const i = String(
        await nilai(
          `SELECT invoice_id AS v FROM invoice_peserta WHERE peserta_id = '${peserta}' AND aktif`,
        ),
      );
      const biaya = () =>
        q(`INSERT INTO baris_invoice (invoice_id, peserta_id, jenis, nama_snapshot, nilai_rp)
           VALUES ('${i}', '${peserta}', 'BIAYA_ADMIN', 'Biaya admin', 0)`);
      await biaya();
      expect(await gagal(biaya())).toMatch(/baris_biaya_admin_satu_uk/);
    });

    it("reservasi stok: satu per baris, qty > 0, wajib ada baris stok lokasi", async () => {
      const i = String(
        await nilai(
          `SELECT invoice_id AS v FROM invoice_peserta WHERE peserta_id = '${peserta}' AND aktif`,
        ),
      );
      const b = await barisBarang(i, peserta, { harga: 1500, modal: 1000 });
      const res = (qty: number, gudang = id["gudang"]) =>
        q(`INSERT INTO reservasi_stok (baris_invoice_id, sku_id, gudang_id, qty_satuan_dasar)
           VALUES ('${b}', '${id["sku"]}', '${gudang}', ${qty})`);
      expect(await gagal(res(0))).toMatch(/reservasi_qty_positif/);
      const gLain = await satu(
        "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-trx-2', 'Cabang', 'CABANG') RETURNING id",
      );
      expect(await gagal(res(1, gLain))).toMatch(/reservasi_stok_lokasi_fk/);
      await res(1);
      expect(await gagal(res(1))).toMatch(/reservasi_baris_uk/);
      expect(
        await gagal(
          q(`UPDATE reservasi_stok SET status = 'DILEPAS' WHERE baris_invoice_id = '${b}'`),
        ),
      ).toMatch(/reservasi_selesai_konsisten/);
    });
  });

  describe("pembayaran & webhook", () => {
    let inv: string;

    beforeAll(async () => {
      const h = await buatAkun();
      const g = await buatGrup(h);
      inv = await buatInvoice(g, h, { subtotal: 50000 });
    });

    const bayar = (metode: string, kunci: string, status = "MENUNGGU") =>
      satu(`INSERT INTO pembayaran (invoice_id, metode, jumlah_rp, kunci_idempotensi, status)
            VALUES ('${inv}', '${metode}', 50000, '${kunci}', '${status}') RETURNING id`);

    it("K-36: hanya QRIS/VA untuk tagihan grup", async () => {
      expect(await gagal(bayar("EWALLET", `k-${hex(4)}`))).toMatch(/pembayaran_metode/);
    });

    it("satu pembayaran hidup per invoice; kunci idempotensi unik", async () => {
      const kunci = `k-${hex(4)}`;
      const p1 = await bayar("QRIS", kunci);
      expect(await gagal(bayar("VA", kunci, "GAGAL"))).toMatch(/pembayaran_kunci_idempotensi_uk/);
      expect(await gagal(bayar("VA", `k-${hex(4)}`))).toMatch(/pembayaran_satu_hidup_uk/);
      await q(`UPDATE pembayaran SET status = 'KEDALUWARSA' WHERE id = '${p1}'`);
      await bayar("VA", `k-${hex(4)}`);
    });

    it("webhook dedup per event & per (external_id, status); event append-only", async () => {
      const ev = (eventId: string, status: string) =>
        satu(`INSERT INTO webhook_event (gateway, event_id_gateway, external_id, status)
              VALUES ('xendit', '${eventId}', 'ext-1', '${status}') RETURNING id`);
      const e1 = await ev("ev-1", "PAID");
      expect(await gagal(ev("ev-1", "EXPIRED"))).toMatch(/webhook_event_id_gateway_uk/);
      expect(await gagal(ev("ev-2", "PAID"))).toMatch(/webhook_event_external_status_uk/);
      expect(await gagal(q(`UPDATE webhook_event SET status = 'X' WHERE id = '${e1}'`))).toMatch(
        /append-only/,
      );
      await q(`INSERT INTO webhook_payload (webhook_event_id, payload_redaksi, dibuat_pada)
               VALUES ('${e1}', '{"status":"PAID"}', now() - interval '100 days')`);
      expect(
        await gagal(q(`DELETE FROM webhook_payload WHERE webhook_event_id = '${e1}'`)),
      ).toMatch(/pangkas_webhook_payload/);
      expect(await nilai("SELECT pangkas_webhook_payload(now() - interval '90 days') AS v")).toBe(
        1,
      );
      expect(await nilai("SELECT count(*)::int AS v FROM webhook_payload")).toBe(0);
      expect(await nilai("SELECT count(*)::int AS v FROM webhook_event")).toBe(1);
    });
  });

  describe("saldo satu ledger (K-13)", () => {
    let a: string;
    const ledger = (jumlah: number, jenis: string, sesudah: number, kunci = `l-${hex(6)}`) =>
      q(`INSERT INTO ledger_saldo (akun_id, jumlah_rp, jenis, kunci_idempotensi, saldo_sesudah_rp)
         VALUES ('${a}', ${jumlah}, '${jenis}', '${kunci}', ${sesudah})`);
    const saldo = async () =>
      Number(await nilai(`SELECT saldo_rp AS v FROM akun_saldo WHERE akun_id = '${a}'`));

    beforeAll(async () => {
      a = await buatAkun();
    });

    it("kredit menambah saldo; debit melebihi saldo ditolak dan saldo tidak berubah", async () => {
      await ledger(5000, "SELISIH_HARGA", 5000, "selisih:uji:1");
      expect(await saldo()).toBe(5000);
      expect(await gagal(ledger(-6000, "PAKAI_CHECKOUT", -1000))).toMatch(
        /ledger_saldo_sesudah_nonneg|akun_saldo_tidak_negatif/,
      );
      expect(await saldo()).toBe(5000);
      await ledger(-2000, "PAKAI_CHECKOUT", 3000);
      expect(await saldo()).toBe(3000);
    });

    it("akun tanpa saldo tidak bisa langsung didebit (tidak negatif)", async () => {
      const b = await buatAkun();
      expect(
        await gagal(
          q(`INSERT INTO ledger_saldo (akun_id, jumlah_rp, jenis, kunci_idempotensi, saldo_sesudah_rp)
             VALUES ('${b}', -1, 'PAKAI_CHECKOUT', 'l-${hex(6)}', 0)`),
        ),
      ).toMatch(/akun_saldo_tidak_negatif/);
    });

    it("saldo_sesudah_rp salah hitung ditolak", async () => {
      expect(await gagal(ledger(1000, "REFUND", 999999))).toMatch(
        /ledger_saldo_sesudah_tidak_cocok/,
      );
      expect(await saldo()).toBe(3000);
    });

    it("kunci idempotensi ganda ditolak; ON CONFLICT DO NOTHING tidak mengubah saldo", async () => {
      expect(await gagal(ledger(5000, "SELISIH_HARGA", 8000, "selisih:uji:1"))).toMatch(
        /ledger_kunci_idempotensi_uk/,
      );
      await q(`INSERT INTO ledger_saldo (akun_id, jumlah_rp, jenis, kunci_idempotensi, saldo_sesudah_rp)
               VALUES ('${a}', 5000, 'SELISIH_HARGA', 'selisih:uji:1', 8000)
               ON CONFLICT (kunci_idempotensi) DO NOTHING`);
      expect(await saldo()).toBe(3000);
    });

    it("tanda jumlah sesuai jenis (refund tidak boleh negatif, debit tidak boleh positif)", async () => {
      expect(await gagal(ledger(-1, "REFUND", 2999))).toMatch(/ledger_tanda_sesuai_jenis/);
      expect(await gagal(ledger(1, "PAKAI_CHECKOUT", 3001))).toMatch(/ledger_tanda_sesuai_jenis/);
      expect(await gagal(ledger(1, "KOREKSI_ADMIN", 3001))).toMatch(/ledger_koreksi_lengkap/);
    });

    it("akun_saldo tidak bisa diubah langsung; ledger append-only; saldo = Σ ledger", async () => {
      expect(
        await gagal(q(`UPDATE akun_saldo SET saldo_rp = 999999 WHERE akun_id = '${a}'`)),
      ).toMatch(/hanya berubah lewat ledger_saldo/);
      expect(
        await gagal(
          q(`INSERT INTO akun_saldo (akun_id, saldo_rp) VALUES ('${await buatAkun()}', 10)`),
        ),
      ).toMatch(/hanya berubah lewat ledger_saldo/);
      expect(await gagal(q(`DELETE FROM akun_saldo WHERE akun_id = '${a}'`))).toMatch(
        /hanya berubah lewat ledger_saldo/,
      );
      expect(
        await gagal(q(`UPDATE ledger_saldo SET jumlah_rp = 1 WHERE akun_id = '${a}'`)),
      ).toMatch(/append-only/);
      const selisih = await nilai(`SELECT count(*)::int AS v FROM akun_saldo s
        WHERE s.saldo_rp <> (SELECT coalesce(sum(l.jumlah_rp), 0) FROM ledger_saldo l WHERE l.akun_id = s.akun_id)`);
      expect(selisih).toBe(0);
    });

    it("multi-baris satu statement untuk akun yang sama diterapkan berurutan", async () => {
      const b = await buatAkun();
      await q(`INSERT INTO ledger_saldo (akun_id, jumlah_rp, jenis, kunci_idempotensi, saldo_sesudah_rp) VALUES
        ('${b}', 1000, 'REFUND', 'l-${hex(6)}', 1000),
        ('${b}', -400, 'PAKAI_CHECKOUT', 'l-${hex(6)}', 600)`);
      expect(
        Number(await nilai(`SELECT saldo_rp AS v FROM akun_saldo WHERE akun_id = '${b}'`)),
      ).toBe(600);
    });

    it("four-eyes: pengaju tidak boleh memutuskan koreksinya sendiri", async () => {
      const pj =
        await satu(`INSERT INTO pengajuan_koreksi_saldo (akun_id, jumlah_rp, alasan, diajukan_oleh)
        VALUES ('${a}', 1000, 'Koreksi uji', '${id["admin1"]}') RETURNING id`);
      expect(
        await gagal(
          q(`INSERT INTO keputusan_koreksi_saldo (pengajuan_id, hasil, diputuskan_oleh)
             VALUES ('${pj}', 'DISETUJUI', '${id["admin1"]}')`),
        ),
      ).toMatch(/koreksi_four_eyes/);
      await q(`INSERT INTO keputusan_koreksi_saldo (pengajuan_id, hasil, diputuskan_oleh)
               VALUES ('${pj}', 'DITOLAK', '${id["admin2"]}')`);
      expect(await gagal(q(`DELETE FROM pengajuan_koreksi_saldo WHERE id = '${pj}'`))).toMatch(
        /append-only/,
      );
    });

    it("pencairan hanya ke tujuan milik akun sendiri", async () => {
      const b = await buatAkun();
      const tujuanB =
        await satu(`INSERT INTO tujuan_pencairan_terverifikasi (akun_id, tujuan_jenis, tujuan_kode,
          nomor_tujuan_enc, nomor_kunci_versi, nomor_tujuan_akhir, nama_cocok, divalidasi_pada, boleh_dipakai_sejak)
        VALUES ('${b}', 'BANK', 'BANK_UJI', '\\x${hex()}', 1, '1234', true, now(), now()) RETURNING id`);
      expect(
        await gagal(
          q(`INSERT INTO pencairan_saldo (akun_id, jumlah_rp, tujuan_id, reauth_sesi_pada, kunci_idempotensi)
             VALUES ('${a}', 1000, '${tujuanB}', now(), 'cair:${hex(4)}')`),
        ),
      ).toMatch(/pencairan_tujuan_milik_akun_fk/);
    });
  });

  describe("promo & COD", () => {
    it("diskon aktif wajib bernilai; diskon tidak menumpuk dalam satu invoice (P-15)", async () => {
      expect(
        await gagal(
          q(`INSERT INTO aturan_diskon (nama, jenis, berlaku_mulai, berlaku_sampai, aktif)
             VALUES ('Promo kosong', 'PERSEN', now(), now() + interval '1 day', true)`),
        ),
      ).toMatch(/diskon_aktif_butuh_nilai/);
      const d = () =>
        satu(`INSERT INTO aturan_diskon (nama, jenis, berlaku_mulai, berlaku_sampai)
              VALUES ('Promo uji', 'NOMINAL', now(), now() + interval '1 day') RETURNING id`);
      const d1 = await d();
      const d2 = await d();
      const h = await buatAkun();
      const inv = await buatInvoice(await buatGrup(h), h);
      const pakai = (aturan: string) =>
        q(
          `INSERT INTO pemakaian_promo (aturan_diskon_id, invoice_id, akun_id) VALUES ('${aturan}', '${inv}', '${h}')`,
        );
      await pakai(d1);
      expect(await gagal(pakai(d2))).toMatch(/promo_satu_diskon_per_invoice_uk/);
    });

    it("COD aktif hanya setelah lolos 3 minggu berturut-turut; cabut manual wajib alasan", async () => {
      const a = await buatAkun();
      expect(
        await gagal(
          q(
            `INSERT INTO status_cod (akun_id, minggu_lolos_berturut, aktif) VALUES ('${a}', 2, true)`,
          ),
        ),
      ).toMatch(/status_cod_aktif_tiga_minggu/);
      await q(
        `INSERT INTO status_cod (akun_id, minggu_lolos_berturut, aktif) VALUES ('${a}', 3, true)`,
      );
      expect(
        await gagal(
          q(
            `UPDATE status_cod SET aktif = false, dicabut_manual_pada = now(), dicabut_oleh = '${id["admin1"]}' WHERE akun_id = '${a}'`,
          ),
        ),
      ).toMatch(/status_cod_cabut_lengkap/);
    });
  });

  describe("idempotensi InventorySource tahan lama (T-018)", () => {
    it("entri pertama menang, tidak tertimpa, dan atomik saat paralel", async () => {
      const penyimpan = buatPenyimpanIdempotensiPg(db);
      const kunci = `picking:${hex(8)}:v1`;
      const pertama = await penyimpan.simpanBilaBelumAda("picking", kunci, {
        hash: SHA("a"),
        hasil: { referensiSumber: null },
      });
      expect(pertama.baru).toBe(true);
      const kedua = await penyimpan.simpanBilaBelumAda("picking", kunci, {
        hash: SHA("b"),
        hasil: { referensiSumber: "lain" },
      });
      expect(kedua).toEqual({
        baru: false,
        entri: { hash: SHA("a"), hasil: { referensiSumber: null } },
      });
      // Ruang berbeda = kunci berbeda.
      expect(
        (await penyimpan.simpanBilaBelumAda("konfirmasi", kunci, { hash: SHA("c"), hasil: 1 }))
          .baru,
      ).toBe(true);

      const kunciParalel = `konfirmasi:${hex(8)}:v1`;
      const hasil = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          penyimpan.simpanBilaBelumAda("konfirmasi", kunciParalel, {
            hash: SHA(String(i)),
            hasil: i,
          }),
        ),
      );
      expect(hasil.filter((h) => h.baru)).toHaveLength(1);
      expect(new Set(hasil.map((h) => h.entri.hash)).size).toBe(1);

      expect(
        await gagal(
          q(`UPDATE idempotensi_inventori SET hash = '${SHA("d")}' WHERE kunci = '${kunci}'`),
        ),
      ).toMatch(/append-only/);
      expect(
        await gagal(
          q(
            `INSERT INTO idempotensi_inventori (ruang, kunci, hash, hasil) VALUES ('picking', 'x', 'bukan-hash', '{}')`,
          ),
        ),
      ).toMatch(/idempotensi_hash_sha256/);
    });
  });
});
