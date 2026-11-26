// Tes integrasi ujung ke ujung T-019: mock server Gudang → GudangApiInventory → job sinkron → snapshot
// PostgreSQL NYATA → pembaca snapshot (yang dipakai katalog); outbox picking → Gudang.
// Jalan bila DATABASE_URL_TEST diisi (CI: service container postgres). Angka fiktif.
import { randomBytes } from "node:crypto";
import { GudangApiInventory } from "@nekat/adapters";
import {
  buatDb,
  buatPembacaSnapshotInventori,
  buatPemetaanSumberPg,
  buatPenyimpanIdempotensiPg,
  buatRepoOutboxPicking,
  buatRepoSinkronInventori,
  jalankanMigrasi,
  jalankanSeed,
  type Db,
} from "@nekat/db";
import { statusStokSnapshot } from "@nekat/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Mock server Gudang khusus tes (tidak diekspor paket adapters, tidak ikut build).
import {
  mulaiMockGudang,
  type MockGudang,
} from "../../../../packages/adapters/src/inventori/mock-gudang.test-util.js";
import { kirimOutboxPicking } from "./picking.js";
import { PengumpulPeristiwaSinkron, sinkronInventori } from "./sinkron.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];

describe.skipIf(!URL_ADMIN)("T-019 Gudang ujung ke ujung (mock Gudang + PostgreSQL nyata)", () => {
  let db: Db;
  let mock: MockGudang;
  const namaDb = `nekat_uji_gudang_${randomBytes(4).toString("hex")}`;
  const id: Record<string, string> = {};
  const v = (k: string) => id[k] ?? "";
  const q = async (s: string) => (await db.$client.query<Record<string, unknown>>(s)).rows;
  /** Perintah admin (CREATE/DROP DATABASE) lewat koneksi ke database admin. */
  const sqlAdmin = async (s: string) => {
    const admin = buatDb(URL_ADMIN ?? "");
    try {
      await admin.$client.query(s);
    } finally {
      await admin.$client.end();
    }
  };
  const satu = async (s: string) => String((await q(s))[0]?.["id"]);
  let waktu = new Date();
  const pengumpul = new PengumpulPeristiwaSinkron();

  const inventory = () =>
    new GudangApiInventory({
      klien: { baseUrl: mock.url, ambilToken: () => mock.token, izinkanHttpLokalUntukTes: true },
      pemetaan: buatPemetaanSumberPg(db),
      idempotensi: buatPenyimpanIdempotensiPg(db),
      catat: pengumpul.catat,
      sekarang: () => waktu,
      retry: { tidur: () => Promise.resolve() },
    });

  beforeAll(async () => {
    await sqlAdmin(`CREATE DATABASE ${namaDb}`);
    const u = new URL(URL_ADMIN ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
    await jalankanSeed(db);
    mock = await mulaiMockGudang();

    id["g"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('gudang-pusat', 'Pusat', 'PUSAT') RETURNING id",
    );
    id["p"] = await satu(
      "INSERT INTO produk (kategori_id, nama) SELECT id, 'Minyak Goreng' FROM kategori WHERE kode = 'minyak-goreng' RETURNING id",
    );
    for (const k of ["a", "b"]) {
      id[k] = await satu(
        `INSERT INTO sku (produk_id, kode_sku, satuan_dasar) VALUES ('${v("p")}', 'K-${k}', 'pcs') RETURNING id`,
      );
      id[`${k}1`] = await satu(
        `INSERT INTO satuan_jual (sku_id, jenis, isi_satuan_dasar, berat_gram) VALUES ('${v(k)}', 'PCS_1', 1, 900) RETURNING id`,
      );
    }
    await q(`INSERT INTO pemetaan_sku_sumber (sku_id, sku_sumber_id) VALUES
      ('${v("a")}', 'G-A'), ('${v("b")}', 'G-B')`);

    const sku = (gid: string) => ({
      id: gid,
      nama: `Produk ${gid}`,
      kategori: "sembako",
      satuanDasar: "pcs",
      konversi: [],
      beratGram: 900,
      barcode: null,
      aktif: true,
      diubahPada: "2026-11-26T04:00:00+07:00",
    });
    mock.sku = [sku("G-A"), sku("G-B"), sku("G-BARU")];
    // G-B tidak punya baris stok di Gudang → tak dikenal sumber = stok 0 (HABIS, bukan basi).
    mock.stok = [];
    mock.modal = [];

    id["zona"] = await satu(
      `INSERT INTO zona (kode_konfig, nama_kelurahan, gudang_id) VALUES ('z-uji', 'Kelurahan Uji', '${v("g")}') RETURNING id`,
    );
    id["slot"] = await satu(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
      VALUES ('${v("zona")}', '2026-11-27', '09:00', '12:00', '2026-11-26T20:00:00Z') RETURNING id`);
    id["akun"] =
      await satu(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
      VALUES ('+6281300008888', '\\x${"cd".repeat(32)}', 1, now()) RETURNING id`);
    id["grup"] =
      await satu(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id)
      VALUES ('GDUJXA', '${v("akun")}', '${v("zona")}', '${v("slot")}', '${v("g")}') RETURNING id`);
  });

  afterAll(async () => {
    await mock.tutup();
    await db.$client.end();
    await sqlAdmin(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
  });

  async function status(kunci: string, sekarang: Date) {
    const [stok] = await buatPembacaSnapshotInventori(db).stok([v(kunci)], v("g"));
    return statusStokSnapshot({
      sumber: "gudang",
      stok,
      reservasi: 0,
      isiSatuanDasar: 1,
      sekarang,
      maksUmurDataMenit: 15,
    });
  }

  it("sinkron: stok & modal Gudang masuk snapshot lokal; modal hanya modal (tanpa harga jual)", async () => {
    waktu = new Date();
    const dataPada = waktu.toISOString();
    mock.stok = [{ skuId: "G-A", lokasi: "gudang-pusat", tersedia: 40, satuan: "pcs", dataPada }];
    mock.modal = [
      { skuId: "G-A", satuan: "PCS_1", modal: 15_000, dataPada },
      { skuId: "G-B", satuan: "PCS_1", modal: 7_250.5, dataPada },
    ];
    // Belum pernah disinkron → tidak diketahui (bukan habis).
    expect(await status("a", waktu)).toBe("TIDAK_DIKETAHUI");

    const h = await sinkronInventori({
      inventory: inventory(),
      repo: buatRepoSinkronInventori(db),
      pengumpul,
      sekarang: () => waktu,
    });
    expect(h.gagal).toEqual([]);
    expect(await status("a", waktu)).toBe("TERSEDIA");
    expect(await status("b", waktu)).toBe("HABIS");

    const modal = await buatPembacaSnapshotInventori(db).modal([v("a"), v("b")]);
    expect(modal.map((m) => [m.skuId, m.modalRp])).toEqual(
      expect.arrayContaining([
        [v("a"), 15_000],
        [v("b"), null],
      ]),
    );
    expect(await q("SELECT count(*)::int AS n FROM harga_level")).toEqual([{ n: 0 }]);
    // Modal pecahan & SKU tanpa pemetaan → antrean tinjauan admin.
    const t = await q("SELECT jenis FROM antrean_tinjauan ORDER BY jenis");
    expect(t).toEqual([{ jenis: "MODAL_PECAHAN" }, { jenis: "SKU_BELUM_DIPETAKAN" }]);
    // Token tidak tersimpan di log audit.
    expect(JSON.stringify(await q("SELECT data FROM log_audit"))).not.toContain(mock.token);
  });

  it("Gudang mati + 20 menit: snapshot menua → 'tidak diketahui', BUKAN 'stok habis'", async () => {
    mock.gangguan.set("/v1/sku", { status: 503 });
    mock.gangguan.set("/v1/stok/cari", { status: 503 });
    mock.gangguan.set("/v1/modal/cari", { status: 503 });
    const nanti = new Date(waktu.getTime() + 20 * 60_000);
    const h = await sinkronInventori({
      inventory: inventory(),
      repo: buatRepoSinkronInventori(db),
      pengumpul,
      sekarang: () => nanti,
    });
    expect(h.gagal.map((g) => g.kode)).toEqual([
      "SUMBER_TIDAK_TERJANGKAU",
      "SUMBER_TIDAK_TERJANGKAU",
      "SUMBER_TIDAK_TERJANGKAU",
    ]);
    expect(await status("a", nanti)).toBe("TIDAK_DIKETAHUI");
    expect(await status("b", nanti)).toBe("TIDAK_DIKETAHUI");
    // Snapshot lama tidak ditimpa nol.
    expect(
      await q(`SELECT tersedia::int AS t FROM stok_lokasi WHERE sku_id = '${v("a")}'`),
    ).toEqual([{ t: 40 }]);
    mock.gangguan.clear();
  });

  it("outbox picking: terkirim sekali ke Gudang; gangguan → dijadwalkan ulang lalu terkirim", async () => {
    const outbox = buatRepoOutboxPicking(db);
    const grupId = v("grup");
    const req = (versi: number) => ({
      grupId,
      lokasiId: v("g"),
      kunciIdempotensi: `picking:${grupId}:v${versi}`,
      slotKirim: { tanggal: "2026-11-27", mulai: "09:00", selesai: "12:00" },
      baris: [
        {
          anggotaId: "anggota-1",
          skuId: v("a"),
          qty: 3,
          caraKirim: "DROP_POINT" as const,
          dropPointId: "dp-1",
        },
      ],
    });
    await outbox.antrekan(req(1));
    await outbox.antrekan(req(1));
    const kini = () => new Date(Date.now() + 1_000);
    const h1 = await kirimOutboxPicking({ inventory: inventory(), repo: outbox, sekarang: kini });
    expect(h1).toEqual({ terkirim: 1, dijadwalkanUlang: 0, gagal: 0 });
    expect(mock.picking.size).toBe(1);
    expect(
      await kirimOutboxPicking({ inventory: inventory(), repo: outbox, sekarang: kini }),
    ).toEqual({ terkirim: 0, dijadwalkanUlang: 0, gagal: 0 });
    // Body ke Gudang tanpa data pribadi.
    const kiriman = mock.permintaan.find((p) => p.path === "/v1/picking");
    expect(JSON.stringify(kiriman?.body)).not.toMatch(/nama|nomorHp|alamat|\+62/);

    mock.gangguan.set("/v1/picking", { status: 503, kali: 1 });
    await outbox.antrekan(req(2));
    const h2 = await kirimOutboxPicking({ inventory: inventory(), repo: outbox, sekarang: kini });
    expect(h2.dijadwalkanUlang).toBe(1);
    const nanti = () => new Date(Date.now() + 5 * 60_000);
    const h3 = await kirimOutboxPicking({ inventory: inventory(), repo: outbox, sekarang: nanti });
    expect(h3.terkirim).toBe(1);
    expect(mock.picking.size).toBe(2);
    const st = await q(`SELECT status, percobaan FROM outbox ORDER BY kunci_idempotensi`);
    expect(st).toEqual([
      { status: "TERKIRIM", percobaan: 1 },
      { status: "TERKIRIM", percobaan: 2 },
    ]);
    // Referensi Gudang tersimpan di idempotensi NEKAT (I-02: cek dulu sebelum kirim ulang).
    const ref = await buatPenyimpanIdempotensiPg(db).ambil<{ referensiSumber: string }>(
      "picking",
      `picking:${grupId}:v1`,
    );
    expect(ref?.hasil.referensiSumber).toMatch(/^PK-/);
  });
});
