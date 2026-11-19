// Tes integrasi repo LocalInventory (T-018) terhadap PostgreSQL NYATA, pola sama dengan skema.int.test.ts.
// Jalan bila DATABASE_URL_TEST diisi (CI: service container postgres). Tiap run membuat database sementara.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatDb, jalankanMigrasi, type Db } from "./koneksi.js";
import { buatRepoInventoriLokal } from "./repo/inventori-lokal.js";
import { jalankanSeed } from "./seed.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];

describe.skipIf(!URL_ADMIN)("repo LocalInventory (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_inv_${randomBytes(4).toString("hex")}`;
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

    id["g1"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-uji-1', 'Gudang 1', 'PUSAT') RETURNING id",
    );
    id["g2"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-uji-2', 'Cabang 2', 'CABANG') RETURNING id",
    );
    id["produk"] = await satu(`INSERT INTO produk (kategori_id, nama, diubah_pada)
      SELECT id, 'Minyak Goreng', '2026-11-01T00:00:00Z' FROM kategori WHERE kode = 'minyak-goreng' RETURNING id`);
    id["a"] =
      await satu(`INSERT INTO sku (produk_id, kode_sku, nama_varian, satuan_dasar, diubah_pada)
      VALUES ('${id["produk"]}', 'MG-1L', '1 L', 'pcs', '2026-11-01T00:00:00Z') RETURNING id`);
    id["b"] =
      await satu(`INSERT INTO sku (produk_id, kode_sku, satuan_dasar, aktif_di_sumber, diubah_pada)
      VALUES ('${id["produk"]}', 'MG-2L', 'pcs', false, '2026-11-01T00:00:00Z') RETURNING id`);
    id["a1"] =
      await satu(`INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram, diubah_pada)
      VALUES ('${id["a"]}', 'PCS_1', 1, 950, '2026-11-01T00:00:00Z') RETURNING id`);
    // Satuan jual DUS diubah belakangan → diubahPada SKU A ikut maju.
    id["aDus"] =
      await satu(`INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram, diubah_pada)
      VALUES ('${id["a"]}', 'DUS', 12, 11800, '2026-11-10T00:00:00Z') RETURNING id`);
    await q(`INSERT INTO stok_lokasi (sku_id, gudang_id, tersedia, data_pada, disinkron_pada) VALUES
      ('${id["a"]}', '${id["g1"]}', 30, '2026-11-19T03:00:00Z', '2026-11-19T03:00:00Z'),
      ('${id["a"]}', '${id["g2"]}', 999, '2026-11-19T03:00:00Z', '2026-11-19T03:00:00Z')`);
    await q(`INSERT INTO modal_satuan_jual (satuan_jual_id, modal_rp, sumber, data_pada)
      VALUES ('${id["a1"]}', 15000, 'MANUAL', '2026-11-18T00:00:00Z')`);
  });

  afterAll(async () => {
    await db.$client.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await admin.end();
  });

  it("daftarSku: gabung produk, kategori induk, satuan jual; diubahPada = perubahan terakhir", async () => {
    const repo = buatRepoInventoriLokal(db);
    const daftar = await repo.daftarSku();
    const a = daftar.find((s) => s.skuId === id["a"]);
    expect(a).toEqual({
      skuId: id["a"],
      namaProduk: "Minyak Goreng",
      namaVarian: "1 L",
      kategoriKode: "minyak-goreng",
      indukKategoriKode: "sembako",
      satuanDasar: "pcs",
      barcode: null,
      aktif: true,
      diubahPada: new Date("2026-11-10T00:00:00Z"),
      satuanJual: [
        { jenis: "PCS_1", isi: 1, beratGram: 950 },
        { jenis: "DUS", isi: 12, beratGram: 11800 },
      ],
    });
    expect(daftar.find((s) => s.skuId === id["b"])).toMatchObject({ aktif: false, satuanJual: [] });
  });

  it("daftarSku(sejak): hanya yang berubah setelahnya", async () => {
    const repo = buatRepoInventoriLokal(db);
    const daftar = await repo.daftarSku(new Date("2026-11-05T00:00:00Z"));
    expect(daftar.map((s) => s.skuId)).toEqual([id["a"]]);
  });

  it("stok: hanya gudang yang diminta", async () => {
    const repo = buatRepoInventoriLokal(db);
    expect(await repo.stok([id["a"] ?? "", id["b"] ?? ""], id["g1"] ?? "")).toEqual([
      {
        skuId: id["a"],
        gudangId: id["g1"],
        tersedia: 30,
        dataPada: new Date("2026-11-19T03:00:00Z"),
      },
    ]);
  });

  it("modal: per satuan jual; satuan tanpa baris modal → null", async () => {
    const repo = buatRepoInventoriLokal(db);
    const modal = await repo.modal([id["a"] ?? ""]);
    expect(modal).toHaveLength(2);
    expect(modal[0]).toEqual({
      skuId: id["a"],
      jenis: "PCS_1",
      modalRp: 15000,
      dataPada: new Date("2026-11-18T00:00:00Z"),
    });
    expect(modal[1]).toMatchObject({ jenis: "DUS", modalRp: null });
    expect(modal[1]?.dataPada).toBeInstanceOf(Date);
  });
});
