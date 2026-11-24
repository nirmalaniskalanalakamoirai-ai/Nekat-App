// Tes integrasi repo katalog (T-025) terhadap PostgreSQL NYATA (pola sama dengan inventori-lokal).
// Jalan bila DATABASE_URL_TEST diisi. SEMUA ANGKA CONTOH FIKTIF (keputusan #6).
import { randomBytes } from "node:crypto";
import {
  KONFIGURASI_HARGA_BAWAAN,
  kunciModal,
  susunKatalog,
  type ModalKatalog,
  type StokKatalog,
} from "@nekat/domain";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatDb, jalankanMigrasi, type Db } from "./koneksi.js";
import { buatRepoInventoriLokal } from "./repo/inventori-lokal.js";
import { buatRepoKatalog } from "./repo/katalog.js";
import { jalankanSeed } from "./seed.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];

describe.skipIf(!URL_ADMIN)("repo katalog (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_kat_${randomBytes(4).toString("hex")}`;
  const id: Record<string, string> = {};

  const q = async (s: string) => (await db.execute(sql.raw(s))).rows;
  const satu = async (s: string) => {
    const [baris] = await q(s);
    return String(baris?.["id"]);
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
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-uji', 'Gudang Uji', 'PUSAT') RETURNING id",
    );
    id["admin"] = await satu(
      "INSERT INTO admin (nama, nomor_hp_e164) VALUES ('Admin Uji', '+6280000000001') RETURNING id",
    );
    const produk = (nama: string, kode: string, aktif = true) =>
      satu(`INSERT INTO produk (kategori_id, nama, bebas_ppn, aktif)
        SELECT id, '${nama}', true, ${aktif} FROM kategori WHERE kode = '${kode}' RETURNING id`);
    id["pBeras"] = await produk("Beras Uji", "beras");
    id["pNonaktif"] = await produk("Produk Nonaktif", "gula", false);
    id["pTanpaHarga"] = await produk("Tanpa Harga", "gula");

    const skuBaru = (produkId: string, kode: string) =>
      satu(
        `INSERT INTO sku (produk_id, kode_sku, satuan_dasar) VALUES ('${produkId}', '${kode}', 'pcs') RETURNING id`,
      );
    id["sBeras"] = await skuBaru(id["pBeras"], "UJI-BERAS");
    id["sNonaktif"] = await skuBaru(id["pNonaktif"], "UJI-NONAKTIF");
    id["sTanpaHarga"] = await skuBaru(id["pTanpaHarga"], "UJI-TANPA");

    const sj = (skuId: string, jenis: string, isi: number) =>
      satu(`INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram)
        VALUES ('${skuId}', '${jenis}', ${isi}, 1000) RETURNING id`);
    id["sjPcs"] = await sj(id["sBeras"], "PCS_1", 1);
    id["sjDus"] = await sj(id["sBeras"], "DUS", 10);
    id["sjNonaktif"] = await sj(id["sNonaktif"], "PCS_1", 1);
    id["sjTanpa"] = await sj(id["sTanpaHarga"], "PCS_1", 1);

    await q(`INSERT INTO modal_satuan_jual (satuan_jual_id, modal_rp, sumber, data_pada) VALUES
      ('${id["sjPcs"]}', 1000, 'MANUAL', '2026-11-19T00:00:00Z'),
      ('${id["sjDus"]}', 9000, 'MANUAL', '2026-11-19T00:00:00Z'),
      ('${id["sjNonaktif"]}', 1000, 'MANUAL', '2026-11-19T00:00:00Z'),
      ('${id["sjTanpa"]}', 1000, 'MANUAL', '2026-11-19T00:00:00Z')`);
    await q(`INSERT INTO harga_level (satuan_jual_id, level, mode, margin_persen, harga_jual_rp) VALUES
      ('${id["sjPcs"]}', 'SATUAN', 'PERSEN', 20, NULL),
      ('${id["sjPcs"]}', 'MITRA_GROSIR', 'RUPIAH', NULL, 1100),
      ('${id["sjDus"]}', 'SATUAN', 'RUPIAH', NULL, 11000),
      ('${id["sjNonaktif"]}', 'SATUAN', 'RUPIAH', NULL, 1200)`);
    // Timpaan aktif (P-25) dan yang sudah dicabut: hanya yang aktif dimuat.
    await q(`INSERT INTO modal_timpaan (satuan_jual_id, modal_rp, catatan, dibuat_oleh, dicabut_oleh, dicabut_pada) VALUES
      ('${id["sjDus"]}', 9500, 'uji aktif', '${id["admin"]}', NULL, NULL),
      ('${id["sjPcs"]}', 1150, 'uji dicabut', '${id["admin"]}', '${id["admin"]}', now())`);
    await q(`INSERT INTO stok_lokasi (sku_id, gudang_id, tersedia, data_pada, disinkron_pada) VALUES
      ('${id["sBeras"]}', '${id["gudang"]}', 5, now(), now())`);
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await admin.end();
  });

  it("idGudang: dari kode_konfig; tidak dikenal → null", async () => {
    const repo = buatRepoKatalog(db);
    expect(await repo.idGudang("g-uji")).toBe(id["gudang"]);
    expect(await repo.idGudang("tidak-ada")).toBeNull();
  });

  it("muatData: produk/SKU nonaktif tidak dimuat; persen sebagai teks desimal", async () => {
    const repo = buatRepoKatalog(db);
    const data = await repo.muatData();
    expect(data.kategori.length).toBeGreaterThan(0);
    expect(data.produk.map((p) => p.id).sort()).toEqual([id["pBeras"], id["pTanpaHarga"]].sort());
    expect(data.satuanJual.map((s) => s.id)).not.toContain(id["sjNonaktif"]);
    const persen = data.hargaLevel.find(
      (h) => h.satuanJualId === id["sjPcs"] && h.level === "SATUAN",
    );
    expect(persen).toEqual({
      satuanJualId: id["sjPcs"],
      level: "SATUAN",
      mode: "PERSEN",
      marginPersen: "20.0000",
      hargaJualRp: null,
    });
    expect(data.timpaanModal).toEqual([{ satuanJualId: id["sjDus"], modalRp: 9500 }]);
  });

  it("alur penuh: repo katalog + modal & stok lokal → engine → hanya produk berharga tayang", async () => {
    const repo = buatRepoKatalog(db);
    const inv = buatRepoInventoriLokal(db);
    const data = await repo.muatData();
    const skuIds = data.sku.map((s) => s.id);
    const modal = new Map<string, ModalKatalog>();
    for (const m of await inv.modal(skuIds)) {
      modal.set(kunciModal(m.skuId, m.jenis), { modal: m.modalRp, dataPada: m.dataPada });
    }
    const stok = new Map<string, StokKatalog>();
    for (const s of await inv.stok(skuIds, id["gudang"] ?? "")) {
      stok.set(s.skuId, { tersedia: s.tersedia, dataPada: s.dataPada });
    }
    const snap = susunKatalog({
      data,
      stok,
      modal,
      reservasi: new Map(),
      sumber: "local",
      maksUmurDataMenit: 15,
      konfigurasiHarga: KONFIGURASI_HARGA_BAWAAN,
      sekarang: new Date(),
    });
    expect(snap.produk.map((p) => p.nama)).toEqual(["Beras Uji"]);
    const [pcs, dus] = snap.produk[0]?.varian[0]?.satuan ?? [];
    expect(pcs?.harga).toEqual({ hargaSatuan: 1200, hargaBelanjaBareng: 1100 });
    expect(pcs?.stok.tersedia).toBe(true);
    // Stok 5 pcs < isi dus 10 → dus stok habis (K-20), tetap tampil.
    expect(dus?.harga).toEqual({ hargaSatuan: 11000, hargaBelanjaBareng: null });
    expect(dus?.stok.tersedia).toBe(false);
    expect(snap.kategori.find((k) => k.kode === "sembako")?.subkategori).toEqual([
      { kode: "beras", nama: "Beras", jumlahProduk: 1 },
    ]);
    expect(snap.ditahan.map((d) => d.idSatuanJual)).toEqual([id["sjTanpa"]]);
  });
});
