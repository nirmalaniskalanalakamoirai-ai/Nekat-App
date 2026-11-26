// Tes integrasi T-019 (tindak lanjut T-025): katalog membaca SNAPSHOT LOKAL di PostgreSQL nyata, tanpa
// InventorySource/Gudang per request; data stok basi tampil "Stok sedang dicek", bukan "Stok habis".
// Jalan bila DATABASE_URL_TEST diisi. Angka fiktif.
import { randomBytes } from "node:crypto";
import {
  buatDb,
  buatPembacaSnapshotInventori,
  buatRepoKatalog,
  jalankanMigrasi,
  jalankanSeed,
  type Db,
} from "@nekat/db";
import { KONFIGURASI_HARGA_BAWAAN } from "@nekat/domain";
import { LABEL_STOK_HABIS, LABEL_STOK_TIDAK_DIKETAHUI } from "@nekat/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LayananKatalog } from "./katalog/layanan.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];

describe.skipIf(!URL_ADMIN)("katalog dari snapshot lokal (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_katsnap_${randomBytes(4).toString("hex")}`;
  const id: Record<string, string> = {};
  const v = (k: string) => id[k] ?? "";
  const q = async (s: string) => (await db.$client.query<Record<string, unknown>>(s)).rows;
  const satu = async (s: string) => String((await q(s))[0]?.["id"]);
  const sqlAdmin = async (s: string) => {
    const admin = buatDb(URL_ADMIN ?? "");
    try {
      await admin.$client.query(s);
    } finally {
      await admin.$client.end();
    }
  };
  const DATA = new Date("2026-11-26T05:00:00Z");

  beforeAll(async () => {
    await sqlAdmin(`CREATE DATABASE ${namaDb}`);
    const u = new URL(URL_ADMIN ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
    await jalankanSeed(db);
    id["g"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-kat', 'Pusat', 'PUSAT') RETURNING id",
    );
    for (const [k, nama, stok] of [
      ["ada", "Minyak Berstok", 10],
      ["habis", "Minyak Habis", 0],
    ] as const) {
      const p = await satu(`INSERT INTO produk (kategori_id, nama, bebas_ppn)
        SELECT id, '${nama}', true FROM kategori WHERE kode = 'minyak-goreng' RETURNING id`);
      id[k] = p;
      const s = await satu(
        `INSERT INTO sku (produk_id, kode_sku, satuan_dasar) VALUES ('${p}', 'KS-${k}', 'pcs') RETURNING id`,
      );
      const sj = await satu(
        `INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram) VALUES ('${s}', 'PCS_1', 1, 900) RETURNING id`,
      );
      await q(`INSERT INTO modal_satuan_jual (satuan_jual_id, modal_rp, sumber, modal_gudang_rp, data_pada, disinkron_pada)
        VALUES ('${sj}', 10000, 'GUDANG', 10000, '${DATA.toISOString()}', '${DATA.toISOString()}')`);
      await q(`INSERT INTO harga_level (satuan_jual_id, level, mode, harga_jual_rp)
        VALUES ('${sj}', 'SATUAN', 'RUPIAH', 12000)`);
      await q(`INSERT INTO stok_lokasi (sku_id, gudang_id, tersedia, data_pada, disinkron_pada)
        VALUES ('${s}', '${v("g")}', ${stok}, '${DATA.toISOString()}', '${DATA.toISOString()}')`);
    }
  });

  afterAll(async () => {
    await db.$client.end();
    await sqlAdmin(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
  });

  const layanan = (sekarang: Date) =>
    new LayananKatalog({
      repo: buatRepoKatalog(db),
      snapshot: buatPembacaSnapshotInventori(db),
      sumber: "gudang",
      konfigurasiHarga: KONFIGURASI_HARGA_BAWAAN,
      maksUmurDataMenit: 15,
      cacheMs: 0,
      sekarang: () => sekarang,
    });

  it("snapshot segar: berstok tersedia, stok 0 = habis (K-20)", async () => {
    const s = await layanan(new Date(DATA.getTime() + 5 * 60_000)).snapshot(v("g"));
    expect(s.produkPerId.get(v("ada"))?.stok).toEqual({
      status: "TERSEDIA",
      tersedia: true,
      label: null,
    });
    expect(s.produkPerId.get(v("habis"))?.stok).toEqual({
      status: "HABIS",
      tersedia: false,
      label: LABEL_STOK_HABIS,
    });
  });

  it("snapshot basi (> 15 menit): keduanya 'tidak diketahui', tetap tampil, bukan 'habis'", async () => {
    const s = await layanan(new Date(DATA.getTime() + 16 * 60_000)).snapshot(v("g"));
    expect(s.produk).toHaveLength(2);
    for (const p of s.produk) {
      expect(p.stok).toEqual({
        status: "TIDAK_DIKETAHUI",
        tersedia: false,
        label: LABEL_STOK_TIDAK_DIKETAHUI,
      });
    }
  });

  it("sinkron terakhir lama walau data_pada sumber baru → tetap basi (umur = yang tertua)", async () => {
    await q(`UPDATE stok_lokasi SET data_pada = '2026-11-26T06:00:00Z'`);
    const s = await layanan(new Date(DATA.getTime() + 30 * 60_000)).snapshot(v("g"));
    expect(s.produkPerId.get(v("ada"))?.stok.status).toBe("TIDAK_DIKETAHUI");
  });
});
