// Tes integrasi snapshot inventori & outbox picking (T-019) terhadap PostgreSQL NYATA.
// Jalan bila DATABASE_URL_TEST diisi (CI: service container postgres). Tiap run membuat database sementara.
// Angka contoh fiktif.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { keRupiah } from "@nekat/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatDb, jalankanMigrasi, type Db } from "./koneksi.js";
import { buatPenyimpanIdempotensiPg } from "./repo/idempotensi-inventori.js";
import { buatRepoOutboxPicking } from "./repo/outbox-picking.js";
import {
  buatPembacaSnapshotInventori,
  buatPemetaanSumberPg,
  buatRepoSinkronInventori,
  uuidDariTeks,
} from "./repo/snapshot-inventori.js";
import { jalankanSeed } from "./seed.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];
const SHA = (c: string) => c.repeat(64);

describe.skipIf(!URL_ADMIN)("snapshot inventori & outbox picking (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_snap_${randomBytes(4).toString("hex")}`;
  const id: Record<string, string> = {};
  const q = async (s: string) => (await db.execute(sql.raw(s))).rows;
  const satu = async (s: string) => String((await q(s))[0]?.["id"]);
  const v = (k: string) => id[k] ?? "";

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

    id["g1"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('gudang-pusat', 'Pusat', 'PUSAT') RETURNING id",
    );
    id["g2"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis, aktif) VALUES ('gudang-tutup', 'Tutup', 'CABANG', false) RETURNING id",
    );
    id["produk"] = await satu(
      "INSERT INTO produk (kategori_id, nama) SELECT id, 'Minyak Goreng' FROM kategori WHERE kode = 'minyak-goreng' RETURNING id",
    );
    for (const [k, kode, satuan] of [
      ["a", "MG-1L", "pcs"],
      ["b", "MG-2L", "pcs"],
      ["c", "BERAS-CURAH", "gram"],
      ["lokal", "LOKAL-SAJA", "pcs"],
    ] as const) {
      id[k] = await satu(
        `INSERT INTO sku (produk_id, kode_sku, satuan_dasar) VALUES ('${v("produk")}', '${kode}', '${satuan}') RETURNING id`,
      );
    }
    await q(`INSERT INTO pemetaan_sku_sumber (sku_id, sku_sumber_id) VALUES
      ('${v("a")}', 'G-A'), ('${v("b")}', 'G-B'), ('${v("c")}', 'G-C')`);
    id["a1"] = await satu(
      `INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram) VALUES ('${v("a")}', 'PCS_1', 1, 950) RETURNING id`,
    );
    id["aDus"] = await satu(
      `INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram) VALUES ('${v("a")}', 'DUS', 12, 11800) RETURNING id`,
    );
    id["b1"] = await satu(
      `INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram) VALUES ('${v("b")}', 'PCS_1', 1, 1900) RETURNING id`,
    );
    // Modal lama dari Gudang (untuk deteksi penurunan, K-02) dan modal MANUAL lama SKU b.
    await q(`INSERT INTO modal_satuan_jual (satuan_jual_id, modal_rp, sumber, modal_gudang_rp, data_pada, disinkron_pada) VALUES
      ('${v("a1")}', 16000, 'GUDANG', 16000, '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z'),
      ('${v("b1")}', 30000, 'MANUAL', NULL, '2026-11-20T00:00:00Z', NULL)`);
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await admin.end();
  });

  describe("pemetaan sumber", () => {
    it("SKU dua arah; ID bukan UUID / tanpa pemetaan tidak muncul; lokasi = kode_konfig gudang aktif", async () => {
      const p = buatPemetaanSumberPg(db);
      expect(await p.skuKeSumber([v("a"), v("lokal"), "bukan-uuid", v("a").toUpperCase()])).toEqual(
        new Map([[v("a"), "G-A"]]),
      );
      expect(await p.skuDariSumber(["G-B", "G-TIDAK-ADA"])).toEqual(new Map([["G-B", v("b")]]));
      expect(await p.lokasiKeSumber(v("g1"))).toBe("gudang-pusat");
      expect(await p.lokasiKeSumber(v("g2"))).toBeNull();
      expect(await p.lokasiKeSumber("x")).toBeNull();
    });
  });

  describe("penulis snapshot (job sinkron)", () => {
    const W = new Date("2026-11-26T05:00:00Z");

    it("skuTerpetakan & lokasiAktif", async () => {
      const r = buatRepoSinkronInventori(db);
      expect((await r.skuTerpetakan()).sort()).toEqual([v("a"), v("b"), v("c")].sort());
      expect(await r.lokasiAktif()).toEqual([v("g1")]);
    });

    it("terapkanSku penuh: status aktif diterapkan; terpetakan yang hilang & satuan beda dinonaktifkan", async () => {
      const r = buatRepoSinkronInventori(db);
      const dasar = {
        skuSumberId: "G-A",
        nama: "Minyak",
        kategori: "minyak",
        konversiSatuan: [],
        beratGram: null,
        barcode: null,
        diubahPada: "2026-11-26T04:00:00+07:00",
      };
      const hasil = await r.terapkanSku(
        [
          { ...dasar, skuId: v("a"), satuanDasar: "pcs", aktifDiSumber: true },
          // NEKAT: gram, Gudang: pcs → tidak bisa dibandingkan → nonaktif.
          { ...dasar, skuId: v("c"), satuanDasar: "pcs", aktifDiSumber: true },
        ],
        { penuh: true, maksNonaktif: 10, waktu: W },
      );
      expect(hasil).toEqual({ diubah: 2, dinonaktifkan: 1, satuanBeda: 1, ditahan: false });
      const aktif = await q(
        `SELECT kode_sku, aktif_di_sumber FROM sku WHERE id IN ('${v("a")}','${v("b")}','${v("c")}','${v("lokal")}') ORDER BY kode_sku`,
      );
      expect(aktif).toEqual([
        { kode_sku: "BERAS-CURAH", aktif_di_sumber: false },
        { kode_sku: "LOKAL-SAJA", aktif_di_sumber: true },
        { kode_sku: "MG-1L", aktif_di_sumber: true },
        { kode_sku: "MG-2L", aktif_di_sumber: false },
      ]);
      // Pulihkan untuk tes berikutnya.
      await q(`UPDATE sku SET aktif_di_sumber = true`);
    });

    it("simpanStok: upsert + disinkron_pada; yang hilang = 0 hanya bila isiNol; data lebih tua tidak menimpa", async () => {
      const r = buatRepoSinkronInventori(db);
      const stok = [
        { skuId: v("a"), lokasiId: v("g1"), tersedia: 30, dataPada: "2026-11-26T04:59:00Z" },
      ];
      expect(await r.simpanStok(v("g1"), [v("a"), v("b")], stok, { isiNol: false, waktu: W })).toBe(
        1,
      );
      expect(
        await q(`SELECT count(*)::int AS n FROM stok_lokasi WHERE sku_id = '${v("b")}'`),
      ).toEqual([{ n: 0 }]);
      expect(await r.simpanStok(v("g1"), [v("a"), v("b")], stok, { isiNol: true, waktu: W })).toBe(
        2,
      );
      const b = await q(
        `SELECT tersedia::int AS tersedia, disinkron_pada = '2026-11-26T05:00:00Z' AS disinkron_pada FROM stok_lokasi WHERE sku_id = '${v("b")}'`,
      );
      expect(b).toEqual([{ tersedia: 0, disinkron_pada: true }]);
      // Respons lama datang belakangan: tidak menimpa data lebih baru.
      const lama = [
        { skuId: v("a"), lokasiId: v("g1"), tersedia: 999, dataPada: "2026-11-26T03:00:00Z" },
      ];
      await r.simpanStok(v("g1"), [v("a")], lama, { isiNol: false, waktu: W });
      expect(
        await q(`SELECT tersedia::int AS tersedia FROM stok_lokasi WHERE sku_id = '${v("a")}'`),
      ).toEqual([{ tersedia: 30 }]);
    });

    it("simpanModal: modal Gudang per satuan jual; tidak dikembalikan → kosong; penurunan dicatat (K-02)", async () => {
      const r = buatRepoSinkronInventori(db);
      const hasil = await r.simpanModal(
        [v("a"), v("b")],
        [
          {
            skuId: v("a"),
            satuan: "PCS_1",
            modalPerSatuan: keRupiah(15_000),
            dataPada: "2026-11-26T04:58:00Z",
          },
          // DUS tidak dikembalikan; SKU b dikembalikan null.
          {
            skuId: v("b"),
            satuan: "PCS_1",
            modalPerSatuan: null,
            dataPada: "2026-11-26T04:58:00Z",
          },
        ],
        W,
      );
      expect(hasil).toEqual({
        disimpan: 1,
        dikosongkan: 2,
        turun: 1,
        naik: 0,
        peringatanRupiah: 0,
      });
      const m =
        await q(`SELECT sj.jenis, s.kode_sku, m.modal_rp::int AS modal_rp, m.modal_gudang_rp::int AS modal_gudang_rp, m.sumber, m.disinkron_pada = '2026-11-26T05:00:00Z' AS disinkron_pada
        FROM modal_satuan_jual m JOIN satuan_jual sj ON sj.id = m.satuan_jual_id JOIN sku s ON s.id = sj.sku_id
        ORDER BY s.kode_sku, sj.jenis`);
      expect(m).toEqual([
        {
          jenis: "DUS",
          kode_sku: "MG-1L",
          modal_rp: null,
          modal_gudang_rp: null,
          sumber: "GUDANG",
          disinkron_pada: true,
        },
        {
          jenis: "PCS_1",
          kode_sku: "MG-1L",
          modal_rp: 15000,
          modal_gudang_rp: 15000,
          sumber: "GUDANG",
          disinkron_pada: true,
        },
        // Modal MANUAL lama TIDAK dipakai lagi: Gudang = sumber (timpaan admin lewat modal_timpaan, P-25).
        {
          jenis: "PCS_1",
          kode_sku: "MG-2L",
          modal_rp: null,
          modal_gudang_rp: null,
          sumber: "GUDANG",
          disinkron_pada: true,
        },
      ]);
      const audit = await q(
        `SELECT ref_id, data FROM log_audit WHERE jenis = 'MODAL_GUDANG_TURUN'`,
      );
      expect(audit).toEqual([{ ref_id: v("a1"), data: { sebelumRp: 16000, sesudahRp: 15000 } }]);
      // Tidak ada harga jual/margin yang ditulis job sinkron.
      expect(await q(`SELECT count(*)::int AS n FROM harga_level`)).toEqual([{ n: 0 }]);
      expect(await q(`SELECT count(*)::int AS n FROM harga_terhitung`)).toEqual([{ n: 0 }]);
    });

    it("terapkanSku: calon nonaktif > maksNonaktif → ditahan (anomali) + log audit, tidak ada yang dinonaktifkan", async () => {
      const r = buatRepoSinkronInventori(db);
      const hasil = await r.terapkanSku(
        [
          {
            skuId: v("a"),
            skuSumberId: "G-A",
            nama: "Minyak",
            kategori: "minyak",
            satuanDasar: "pcs",
            konversiSatuan: [],
            beratGram: null,
            barcode: null,
            aktifDiSumber: true,
            diubahPada: "2026-11-26T04:00:00+07:00",
          },
        ],
        // b & c hilang (2 calon) > batas 1.
        { penuh: true, maksNonaktif: 1, waktu: W },
      );
      expect(hasil).toEqual({ diubah: 0, dinonaktifkan: 0, satuanBeda: 0, ditahan: true });
      expect(await q(`SELECT count(*)::int AS n FROM sku WHERE aktif_di_sumber = false`)).toEqual([
        { n: 0 },
      ]);
      expect(
        await q(`SELECT data FROM log_audit WHERE jenis = 'SINKRON_GUDANG_ANOMALI_NONAKTIF'`),
      ).toEqual([{ data: { calon: 2, batas: 1, terpetakan: 3 } }]);
    });

    it("simpanModal: data lebih tua tidak menimpa; kenaikan dicatat + peringatan harga RUPIAH berhenti tayang", async () => {
      const r = buatRepoSinkronInventori(db);
      await q(`INSERT INTO harga_level (satuan_jual_id, level, mode, harga_jual_rp)
        VALUES ('${v("a1")}', 'SATUAN', 'RUPIAH', 17000)`);
      // Lebih tua dari snapshot (04:58) → diabaikan.
      const tua = await r.simpanModal(
        [v("a")],
        [
          {
            skuId: v("a"),
            satuan: "PCS_1",
            modalPerSatuan: keRupiah(99_000),
            dataPada: "2026-11-26T03:00:00Z",
          },
        ],
        W,
      );
      expect(tua.disimpan).toBe(0);
      expect(
        await q(
          `SELECT modal_rp::int AS m FROM modal_satuan_jual WHERE satuan_jual_id = '${v("a1")}'`,
        ),
      ).toEqual([{ m: 15000 }]);
      // Naik 15.000 → 18.000: harga SATUAN RUPIAH 17.000 ≤ modal → peringatan.
      const naik = await r.simpanModal(
        [v("a")],
        [
          {
            skuId: v("a"),
            satuan: "PCS_1",
            modalPerSatuan: keRupiah(18_000),
            dataPada: "2026-11-26T05:01:00Z",
          },
        ],
        W,
      );
      expect(naik).toMatchObject({ disimpan: 1, naik: 1, peringatanRupiah: 1, turun: 0 });
      expect(await q(`SELECT data FROM log_audit WHERE jenis = 'MODAL_GUDANG_NAIK'`)).toEqual([
        { data: { sebelumRp: 15000, sesudahRp: 18000 } },
      ]);
      expect(
        await q(
          `SELECT ref_id, data FROM log_audit WHERE jenis = 'MODAL_NAIK_HARGA_RUPIAH_TIDAK_TAYANG'`,
        ),
      ).toEqual([{ ref_id: v("a1"), data: { modalBaruRp: 18000, level: ["SATUAN"] } }]);
      // Pulihkan untuk tes pembaca.
      await q(`DELETE FROM harga_level`);
      await q(`UPDATE modal_satuan_jual SET modal_rp = 15000, modal_gudang_rp = 15000, data_pada = '2026-11-26T04:58:00Z'
        WHERE satuan_jual_id = '${v("a1")}'`);
    });

    it("catatTinjauan: modal pecahan & SKU belum dipetakan masuk antrean tanpa dobel", async () => {
      const r = buatRepoSinkronInventori(db);
      for (let i = 0; i < 2; i++) {
        await r.catatTinjauan({
          jenis: "MODAL_PECAHAN",
          skuId: v("a"),
          satuan: "DUS",
          nilaiMentah: "12500.5",
        });
        await r.catatTinjauan({
          jenis: "SKU_BELUM_DIPETAKAN",
          skuSumberId: "G-BARU",
          nama: "Produk Baru",
        });
      }
      const t = await q(
        `SELECT jenis, entitas_jenis, entitas_id::text AS entitas_id, data FROM antrean_tinjauan ORDER BY jenis`,
      );
      expect(t).toEqual([
        {
          jenis: "MODAL_PECAHAN",
          entitas_jenis: "satuan_jual",
          entitas_id: v("aDus"),
          data: { sumber: "gudang", nilaiMentah: "12500.5" },
        },
        {
          jenis: "SKU_BELUM_DIPETAKAN",
          entitas_jenis: "sku_sumber",
          entitas_id: uuidDariTeks("sku_sumber", "G-BARU"),
          data: { skuSumberId: "G-BARU", nama: "Produk Baru" },
        },
      ]);
    });
  });

  describe("pembaca snapshot (katalog)", () => {
    it("dataPada = yang tertua dari data_pada & disinkron_pada", async () => {
      await q(`UPDATE stok_lokasi SET data_pada = '2026-11-26T05:10:00Z', disinkron_pada = '2026-11-26T04:00:00Z'
        WHERE sku_id = '${v("a")}'`);
      const p = buatPembacaSnapshotInventori(db);
      const stok = await p.stok([v("a"), "bukan-uuid"], v("g1"));
      expect(stok).toEqual([
        {
          skuId: v("a"),
          gudangId: v("g1"),
          tersedia: 30,
          dataPada: new Date("2026-11-26T04:00:00Z"),
        },
      ]);
      expect(await p.stok([v("a")], "x")).toEqual([]);
    });

    it("modal per satuan jual; baris MANUAL tanpa disinkron_pada tetap punya dataPada", async () => {
      await q(`UPDATE modal_satuan_jual SET modal_rp = 30000, sumber = 'MANUAL', data_pada = '2026-11-20T00:00:00Z', disinkron_pada = NULL
        WHERE satuan_jual_id = '${v("b1")}'`);
      const p = buatPembacaSnapshotInventori(db);
      const modal = await p.modal([v("a"), v("b")]);
      expect(modal).toContainEqual({
        skuId: v("b"),
        jenis: "PCS_1",
        modalRp: 30000,
        dataPada: new Date("2026-11-20T00:00:00Z"),
      });
      expect(modal).toContainEqual({
        skuId: v("a"),
        jenis: "PCS_1",
        modalRp: 15000,
        dataPada: new Date("2026-11-26T04:58:00Z"),
      });
    });
  });

  describe("idempotensi: ambil", () => {
    it("null bila belum ada; entri pertama setelah simpan", async () => {
      const p = buatPenyimpanIdempotensiPg(db);
      expect(await p.ambil("picking", "picking:x:v1")).toBeNull();
      await p.simpanBilaBelumAda("picking", "picking:x:v1", {
        hash: SHA("a"),
        hasil: { referensiSumber: "PK-1" },
      });
      expect(await p.ambil("picking", "picking:x:v1")).toEqual({
        hash: SHA("a"),
        hasil: { referensiSumber: "PK-1" },
      });
      expect(await p.ambil("konfirmasi", "picking:x:v1")).toBeNull();
    });
  });

  describe("outbox picking", () => {
    let grupId = "";
    const permintaan = () => ({
      grupId,
      lokasiId: v("g1"),
      kunciIdempotensi: `picking:${grupId}:v1`,
      slotKirim: { tanggal: "2026-11-27", mulai: "09:00", selesai: "12:00" },
      baris: [
        {
          anggotaId: "anggota-1",
          skuId: v("a"),
          qty: 2,
          caraKirim: "DROP_POINT" as const,
          dropPointId: "dp-1",
        },
      ],
    });

    beforeAll(async () => {
      id["zona"] = await satu(
        `INSERT INTO zona (kode_konfig, nama_kelurahan, gudang_id) VALUES ('z-uji', 'Kelurahan Uji', '${v("g1")}') RETURNING id`,
      );
      id["slot"] =
        await satu(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
        VALUES ('${v("zona")}', '2026-11-27', '09:00', '12:00', '2026-11-26T20:00:00Z') RETURNING id`);
      id["akun"] =
        await satu(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
        VALUES ('+6281300009999', '\\x${"ab".repeat(32)}', 1, now()) RETURNING id`);
      grupId =
        await satu(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id)
        VALUES ('PKUJX2', '${v("akun")}', '${v("zona")}', '${v("slot")}', '${v("g1")}') RETURNING id`);
    });

    it("antrekan idempoten; payload tanpa data pribadi ditolak skema bila ada field tambahan", async () => {
      const o = buatRepoOutboxPicking(db);
      expect(await o.antrekan(permintaan())).toEqual({ baru: true });
      expect(await o.antrekan(permintaan())).toEqual({ baru: false });
      const kotor = { ...permintaan(), kunciIdempotensi: `picking:${grupId}:v2`, alamat: "Jl. X" };
      await expect(o.antrekan(kotor as ReturnType<typeof permintaan>)).rejects.toThrow();
    });

    it("klaim memakai lease: entri yang diklaim tidak bisa diklaim lagi sampai lease habis", async () => {
      const o = buatRepoOutboxPicking(db);
      const kini = new Date(Date.now() + 1_000);
      const [e] = await o.klaim(10, kini, 120_000);
      expect(e).toMatchObject({ kunciIdempotensi: `picking:${grupId}:v1`, percobaan: 1 });
      expect(e?.payload).toEqual(permintaan());
      expect(await o.klaim(10, kini, 120_000)).toEqual([]);
      const lagi = await o.klaim(10, new Date(kini.getTime() + 121_000), 120_000);
      expect(lagi.map((x) => x.percobaan)).toEqual([2]);

      // Paralel: dua worker tidak mendapat entri yang sama (SKIP LOCKED).
      const klaimLagi = lagi[0] ?? { id: "", percobaan: 0 };
      expect(await o.jadwalkanUlang(klaimLagi, kini, "SUMBER_TIDAK_TERJANGKAU")).toBe(true);
      const [x, y] = await Promise.all([o.klaim(10, kini, 120_000), o.klaim(10, kini, 120_000)]);
      expect(x.length + y.length).toBe(1);
      const g = await q(`SELECT galat_terakhir FROM outbox WHERE grup_id = '${grupId}'`);
      expect(g).toEqual([{ galat_terakhir: "SUMBER_TIDAK_TERJANGKAU" }]);
    });

    it("lease habis → worker lain mengambil alih; worker lama tidak bisa menandai (pemilik klaim)", async () => {
      const o = buatRepoOutboxPicking(db);
      const [row] = await q(
        `SELECT extract(epoch FROM kirim_setelah)::float8 * 1000 AS ms FROM outbox WHERE grup_id = '${grupId}'`,
      );
      const leaseHabis = new Date(Number(row?.["ms"]) + 1_000);
      // Worker B mengklaim setelah lease worker A (klaim sebelumnya) habis.
      const [b] = await o.klaim(10, leaseHabis, 120_000);
      expect(b).toBeDefined();
      const klaimB = { id: b?.id ?? "", percobaan: b?.percobaan ?? 0 };
      const klaimA = { id: klaimB.id, percobaan: klaimB.percobaan - 1 };
      const hasil = { grupId, status: "DITERIMA" as const, referensiSumber: "PK-9" };
      expect(await o.tandaiTerkirim(klaimA, hasil, new Date())).toBe(false);
      expect(await o.jadwalkanUlang(klaimA, new Date(), "X")).toBe(false);
      expect(await o.tandaiGagal(klaimA, "X", "PICKING_GAGAL")).toBe(false);
      expect(await o.tandaiTerkirim(klaimB, hasil, new Date())).toBe(true);
      // Sudah TERKIRIM → tidak bisa diubah lagi (status harus MENUNGGU).
      expect(await o.jadwalkanUlang(klaimB, new Date(), "X")).toBe(false);
      expect(await o.tandaiGagal(klaimB, "X", "PICKING_GAGAL")).toBe(false);
      expect(await q(`SELECT status FROM outbox WHERE id = '${klaimB.id}'`)).toEqual([
        { status: "TERKIRIM" },
      ]);
      expect(await q(`SELECT data FROM log_audit WHERE jenis = 'PICKING_TERKIRIM'`)).toEqual([
        { data: { status: "DITERIMA", referensiSumber: "PK-9" } },
      ]);
      expect(
        await q(`SELECT count(*)::int AS n FROM antrean_tinjauan WHERE jenis = 'PICKING_GAGAL'`),
      ).toEqual([{ n: 0 }]);
    });

    it("tandaiGagal → GAGAL + antrean tinjauan admin; galat bebas disaring", async () => {
      const o = buatRepoOutboxPicking(db);
      await o.antrekan({ ...permintaan(), kunciIdempotensi: `picking:${grupId}:v2` });
      const [k] = await o.klaim(10, new Date(Date.now() + 1_000), 120_000);
      expect(k?.kunciIdempotensi).toBe(`picking:${grupId}:v2`);
      const klaim = k ?? { id: "", percobaan: 0 };
      expect(await o.tandaiGagal(klaim, "pesan bebas: rahasia", "PICKING_GAGAL")).toBe(true);
      expect(await q(`SELECT status, galat_terakhir FROM outbox WHERE id = '${klaim.id}'`)).toEqual(
        [{ status: "GAGAL", galat_terakhir: "GALAT_LAIN" }],
      );
      const t = await q(
        `SELECT entitas_jenis, entitas_id::text AS e FROM antrean_tinjauan WHERE jenis = 'PICKING_GAGAL'`,
      );
      expect(t).toEqual([{ entitas_jenis: "grup", e: grupId }]);
    });
  });
});
