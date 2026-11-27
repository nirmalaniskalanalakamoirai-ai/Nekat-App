// Tes integrasi panel admin (T-036) terhadap PostgreSQL NYATA: CLI buat admin → masuk 2 langkah →
// CRUD produk/SKU/satuan jual → stok lokal → log_admin (sebelum/sesudah, tanpa rahasia).
// Jalan bila DATABASE_URL_TEST diisi (CI: service container). Tiap run membuat database sementara.
// SEMUA DATA FIKTIF.
import { randomBytes } from "node:crypto";
import {
  buatDb,
  buatRepoAdminKatalog,
  buatRepoAuthAdmin,
  jalankanMigrasi,
  jalankanSeed,
  type Db,
} from "@nekat/db";
import { KEBIJAKAN_KUNCI_BAWAAN } from "@nekat/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buatApp } from "../app.js";
import { buatAdminBaru } from "./buat-admin.js";
import { COOKIE_PRA, COOKIE_SESI } from "./http-util.js";
import { buatRahasiaTotp, kodeTotp, langkahTotp, sha256 } from "./kripto.js";
import { LayananAuthAdmin } from "./layanan-auth.js";
import { KONFIG_UJI } from "./palsu.test-util.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];
const SCRYPT_UJI = { logN: 10, r: 8, p: 1 };
const SANDI = "kata-sandi-integrasi-01";

function cookieDari(setCookie: string | string[] | undefined, nama: string): string {
  const daftar = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of daftar) {
    const m = new RegExp(`^${nama}=([^;]*)`).exec(c);
    if (m?.[1]) return m[1];
  }
  return "";
}

describe.skipIf(!URL_ADMIN)("panel admin (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_admin_${randomBytes(4).toString("hex")}`;
  let jam = new Date();
  let app: ReturnType<typeof buatApp>;
  const rahasia = buatRahasiaTotp();
  let ownerId = "";
  let sesi = "";
  let csrf = "";
  const id: Record<string, string> = {};

  const q = async (s: string) => (await db.$client.query<Record<string, unknown>>(s)).rows;
  const h = () => ({ cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": csrf });

  beforeAll(async () => {
    const a = buatDb(URL_ADMIN ?? "");
    await a.$client.query(`CREATE DATABASE ${namaDb}`);
    await a.$client.end();
    const u = new URL(URL_ADMIN ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
    await jalankanSeed(db);

    const [g] = await q(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-uji', 'Gudang Uji', 'PUSAT') RETURNING id",
    );
    id["gudang"] = String(g?.["id"]);
    const [induk] = await q(
      "INSERT INTO kategori (kode, nama) VALUES ('lain-uji', 'Lain') RETURNING id",
    );
    const [terlarang] = await q(
      `INSERT INTO kategori (kode, nama, induk_id) VALUES ('rokok-kretek', 'Rokok', '${String(induk?.["id"])}') RETURNING id`,
    );
    id["kategoriTerlarang"] = String(terlarang?.["id"]);
    const [beras] = await q("SELECT id FROM kategori WHERE kode = 'beras'");
    id["beras"] = String(beras?.["id"]);
    const [sembako] = await q("SELECT id FROM kategori WHERE kode = 'sembako'");
    id["sembako"] = String(sembako?.["id"]);

    const repoAuth = buatRepoAuthAdmin(db);
    const dibuat = await buatAdminBaru(
      repoAuth,
      KONFIG_UJI,
      {
        nama: "Owner Integrasi",
        nomorHpE164: "+6281300000001",
        peran: "owner",
        kataSandi: SANDI,
        rahasiaTotp: rahasia,
        kodeKonfirmasi: kodeTotp(rahasia, langkahTotp(jam)),
      },
      { sekarang: jam, scrypt: SCRYPT_UJI },
    );
    ownerId = dibuat.id;
    jam = new Date(jam.getTime() + 30_000);

    app = buatApp({
      logger: false,
      admin: {
        auth: new LayananAuthAdmin({
          repo: repoAuth,
          konfig: KONFIG_UJI,
          sekarang: () => jam,
          scrypt: SCRYPT_UJI,
        }),
        katalog: buatRepoAdminKatalog(db),
        sumberInventori: "local",
        originDiizinkan: [],
      },
    });
  });

  afterAll(async () => {
    await db.$client.end();
    const a = buatDb(URL_ADMIN ?? "");
    await a.$client.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await a.$client.end();
  });

  it("admin dari CLI: rahasia TOTP terenkripsi, kata sandi scrypt, admin pertama owner, log_audit tanpa PII", async () => {
    const [a] = await q(
      `SELECT kata_sandi_hash, totp_rahasia_enc, totp_aktif_pada, totp_langkah_terakhir FROM admin WHERE id = '${ownerId}'`,
    );
    expect(String(a?.["kata_sandi_hash"])).toMatch(/^scrypt\$/);
    expect(Buffer.from(a?.["totp_rahasia_enc"] as Buffer).includes(rahasia)).toBe(false);
    expect(a?.["totp_aktif_pada"]).not.toBeNull();
    const [p] = await q(`SELECT peran_kode FROM admin_peran WHERE admin_id = '${ownerId}'`);
    expect(p?.["peran_kode"]).toBe("owner");
    const kode = await q(
      `SELECT count(*)::int AS n FROM kode_pemulihan_totp WHERE admin_id = '${ownerId}'`,
    );
    expect(kode[0]?.["n"]).toBe(10);
    const audit = await q("SELECT data::text AS d FROM log_audit WHERE jenis = 'ADMIN_DIBUAT_CLI'");
    expect(audit).toHaveLength(1);
    expect(String(audit[0]?.["d"])).not.toContain("6281300000001");
  });

  it("masuk 2 langkah; DB hanya menyimpan hash ID sesi", async () => {
    const r1 = await app.inject({
      method: "POST",
      url: "/api/admin/masuk",
      payload: { nomorHp: "+6281300000001", kataSandi: SANDI },
    });
    expect(r1.statusCode).toBe(200);
    const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA);
    const r2 = await app.inject({
      method: "POST",
      url: "/api/admin/masuk/totp",
      headers: {
        cookie: `${COOKIE_PRA}=${pra}`,
        "x-csrf-token": r1.json<{ csrfToken: string }>().csrfToken,
      },
      payload: { kode: kodeTotp(rahasia, langkahTotp(jam)) },
    });
    expect(r2.statusCode).toBe(200);
    sesi = cookieDari(r2.headers["set-cookie"], COOKIE_SESI);
    csrf = r2.json<{ csrfToken: string }>().csrfToken;

    const baris = await q(
      `SELECT encode(id_hash, 'hex') AS h, faktor_kedua_pada, dicabut_pada FROM sesi WHERE admin_id = '${ownerId}' ORDER BY dibuat_pada`,
    );
    expect(baris).toHaveLength(2);
    expect(baris[0]?.["dicabut_pada"]).not.toBeNull(); // sesi pra dicabut (rotasi)
    expect(baris[1]?.["h"]).toBe(sha256(sesi).toString("hex"));
    expect(baris.map((b) => b["h"])).not.toContain(Buffer.from(sesi).toString("hex"));
    const audit = await q(
      "SELECT data::text AS d FROM log_audit WHERE jenis = 'LOGIN_ADMIN_BERHASIL'",
    );
    expect(audit).toHaveLength(1);
  });

  it("CRUD produk + aturan kategori terlarang & tinjauan nama", async () => {
    const terlarang = await app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: h(),
      payload: { kategoriId: id["kategoriTerlarang"], nama: "Kretek Filter" },
    });
    expect(terlarang.statusCode).toBe(422);
    expect(terlarang.body).toContain("P-24");

    const bukanSub = await app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: h(),
      payload: { kategoriId: id["sembako"], nama: "Beras" },
    });
    expect(bukanSub.statusCode).toBe(422);

    const baru = await app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: h(),
      payload: {
        kategoriId: id["beras"],
        nama: "Beras Uji Pulen 5 kg",
        deskripsi: "Fiktif",
        gambarUrl: "",
        alasan: "produk baru",
      },
    });
    expect(baru.statusCode).toBe(201);
    id["produk"] = baru.json<{ id: string }>().id;

    const ubah = await app.inject({
      method: "PATCH",
      url: `/api/admin/produk/${id["produk"] ?? ""}`,
      headers: h(),
      payload: { nama: "Beras Uji Pulen 10 kg", aktif: false },
    });
    expect(ubah.statusCode).toBe(204);

    const gambarHttp = await app.inject({
      method: "PATCH",
      url: `/api/admin/produk/${id["produk"] ?? ""}`,
      headers: h(),
      payload: { gambarUrl: "http://tidak-aman.contoh/a.png" },
    });
    expect(gambarHttp.statusCode).toBe(400);

    const curiga = await app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: h(),
      payload: { kategoriId: id["beras"], nama: "Bir Pletok Uji" },
    });
    expect(curiga.statusCode).toBe(201);
    const idCuriga = curiga.json<{ id: string }>().id;
    const [p] = await q(`SELECT tinjauan_kategori FROM produk WHERE id = '${idCuriga}'`);
    expect(p?.["tinjauan_kategori"]).toBe("MENUNGGU");
    const antre = await q(
      `SELECT jenis, status FROM antrean_tinjauan WHERE entitas_id = '${idCuriga}'`,
    );
    expect(antre).toEqual([{ jenis: "KATEGORI", status: "TERBUKA" }]);

    const daftar = await app.inject({
      method: "GET",
      url: "/api/admin/produk?cari=pulen",
      headers: h(),
    });
    expect(daftar.json<{ total: number }>().total).toBe(1);
  });

  it("SKU & satuan jual: duplikat ditolak, isi kanonik, tayang tetap false", async () => {
    const pid = id["produk"] ?? "";
    const s = await app.inject({
      method: "POST",
      url: `/api/admin/produk/${pid}/sku`,
      headers: h(),
      payload: { kodeSku: "brs-uji-10", barcode: "8990000000017", satuanDasar: "pcs" },
    });
    expect(s.statusCode).toBe(201);
    id["sku"] = s.json<{ id: string }>().id;
    const dup = await app.inject({
      method: "POST",
      url: `/api/admin/produk/${pid}/sku`,
      headers: h(),
      payload: { kodeSku: "BRS-UJI-10", satuanDasar: "pcs" },
    });
    expect(dup.statusCode).toBe(409);

    const sid = id["sku"] ?? "";
    const pcs = await app.inject({
      method: "POST",
      url: `/api/admin/sku/${sid}/satuan`,
      headers: h(),
      payload: { jenis: "PCS_1", beratGram: 10_200 },
    });
    expect(pcs.statusCode).toBe(201);
    const dusTanpaIsi = await app.inject({
      method: "POST",
      url: `/api/admin/sku/${sid}/satuan`,
      headers: h(),
      payload: { jenis: "DUS", beratGram: 50_000 },
    });
    expect(dusTanpaIsi.statusCode).toBe(422);
    const dus = await app.inject({
      method: "POST",
      url: `/api/admin/sku/${sid}/satuan`,
      headers: h(),
      payload: { jenis: "DUS", isiSatuanDasar: 5, beratGram: 51_000 },
    });
    expect(dus.statusCode).toBe(201);
    id["dus"] = dus.json<{ id: string }>().id;
    const pcsLagi = await app.inject({
      method: "POST",
      url: `/api/admin/sku/${sid}/satuan`,
      headers: h(),
      payload: { jenis: "PCS_1", beratGram: 1 },
    });
    expect(pcsLagi.statusCode).toBe(409);
    const ubahDus = await app.inject({
      method: "PATCH",
      url: `/api/admin/satuan/${id["dus"] ?? ""}`,
      headers: h(),
      payload: { isiSatuanDasar: 4, beratGram: 41_000 },
    });
    expect(ubahDus.statusCode).toBe(204);

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/produk/${pid}`,
      headers: h(),
    });
    const d = detail.json<{
      sku: {
        kodeSku: string;
        satuan: { jenis: string; isiSatuanDasar: number; tayang: boolean }[];
      }[];
    }>();
    expect(d.sku[0]?.kodeSku).toBe("BRS-UJI-10");
    expect(d.sku[0]?.satuan.map((x) => [x.jenis, x.isiSatuanDasar, x.tayang])).toEqual([
      ["PCS_1", 1, false],
      ["DUS", 4, false],
    ]);
    // Harga/modal tidak diisi task ini.
    const harga = await q("SELECT count(*)::int AS n FROM harga_level");
    expect(harga[0]?.["n"]).toBe(0);
  });

  it("stok lokal: set absolut, alasan wajib, log sebelum/sesudah", async () => {
    const body = {
      skuId: id["sku"],
      gudangId: id["gudang"],
      tersedia: 40,
      tersediaSebelum: null as number | null,
      alasan: "stok awal",
    };
    expect(
      (await app.inject({ method: "PUT", url: "/api/admin/stok", headers: h(), payload: body }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/admin/stok",
          headers: h(),
          payload: { ...body, tersedia: 35, tersediaSebelum: 40, alasan: "opname" },
        })
      ).statusCode,
    ).toBe(204);
    const tanpaAlasan = await app.inject({
      method: "PUT",
      url: "/api/admin/stok",
      headers: h(),
      payload: { ...body, alasan: "" },
    });
    expect(tanpaAlasan.statusCode).toBe(400);
    const r = await app.inject({
      method: "GET",
      url: `/api/admin/stok?gudangId=${id["gudang"] ?? ""}&cari=BRS-UJI`,
      headers: h(),
    });
    const isi = r.json<{ stok: { tersedia: number | null }[]; dapatDiubah: boolean }>();
    expect(isi.dapatDiubah).toBe(true);
    expect(isi.stok[0]?.tersedia).toBe(35);

    // Kunci optimistik: nilai "sebelum" basi → 409, stok tidak tertimpa, tanpa baris log.
    const basi = await app.inject({
      method: "PUT",
      url: "/api/admin/stok",
      headers: h(),
      payload: { ...body, tersedia: 1, tersediaSebelum: 40, alasan: "basi" },
    });
    expect(basi.statusCode).toBe(409);
    expect(basi.json<{ kode: string }>().kode).toBe("KONFLIK");

    // Dua admin menyimpan paralel dari nilai yang sama → tepat satu berhasil.
    const paralel = await Promise.all(
      [30, 31, 32, 33].map((t) =>
        app.inject({
          method: "PUT",
          url: "/api/admin/stok",
          headers: h(),
          payload: { ...body, tersedia: t, tersediaSebelum: 35, alasan: "paralel" },
        }),
      ),
    );
    expect(paralel.map((x) => x.statusCode).sort()).toEqual([204, 409, 409, 409]);
  });

  it("log_admin: setiap perubahan tercatat (siapa, izin, sebelum/sesudah, alasan), tanpa rahasia, append-only", async () => {
    const r = await app.inject({ method: "GET", url: "/api/admin/log?batas=100", headers: h() });
    expect(r.statusCode).toBe(200);
    const { log } = r.json<{
      log: {
        adminId: string;
        izinKode: string;
        entitasJenis: string;
        sebelum: Record<string, unknown> | null;
        sesudah: Record<string, unknown> | null;
        alasan: string | null;
      }[];
    }>();
    const jenis = log.map((l) => l.entitasJenis);
    // 2 produk dibuat + 1 diubah; 1 sku; 2 satuan dibuat + 1 diubah; 2 stok.
    expect(jenis.filter((j) => j === "produk")).toHaveLength(3);
    expect(jenis.filter((j) => j === "sku")).toHaveLength(1);
    expect(jenis.filter((j) => j === "satuan_jual")).toHaveLength(3);
    expect(jenis.filter((j) => j === "stok_lokasi")).toHaveLength(3); // 2 + 1 pemenang paralel
    expect(log.every((l) => l.adminId === ownerId)).toBe(true);

    const stok = log.filter((l) => l.entitasJenis === "stok_lokasi").slice(1);
    expect(stok[0]).toMatchObject({
      izinKode: "stok.ubah",
      sebelum: { tersedia: 40 },
      sesudah: { tersedia: 35 },
      alasan: "opname",
    });
    expect(stok[1]?.sebelum).toBeNull();
    const ubahProduk = log.find((l) => l.entitasJenis === "produk" && l.sebelum !== null);
    expect(ubahProduk?.sebelum).toMatchObject({ nama: "Beras Uji Pulen 5 kg", aktif: true });
    expect(ubahProduk?.sesudah).toMatchObject({ nama: "Beras Uji Pulen 10 kg", aktif: false });

    expect(r.body).not.toMatch(/scrypt|kata_?sandi|totp|6281300000001/i);
    const ip = await q("SELECT count(*)::int AS n FROM log_admin WHERE ip_hmac IS NULL");
    expect(ip[0]?.["n"]).toBe(0);
    await expect(q("UPDATE log_admin SET alasan = 'ubah'")).rejects.toThrow();
    await expect(q("DELETE FROM log_admin")).rejects.toThrow();

    const perEntitas = await app.inject({
      method: "GET",
      url: `/api/admin/log?entitasJenis=produk&entitasId=${id["produk"] ?? ""}`,
      headers: h(),
    });
    expect(perEntitas.json<{ log: unknown[] }>().log).toHaveLength(2);
  });

  it("isi DUS tidak bisa diubah setelah ada modal; berat tetap boleh", async () => {
    await q(
      `INSERT INTO modal_satuan_jual (satuan_jual_id, modal_rp, sumber) VALUES ('${id["dus"] ?? ""}', 50000, 'MANUAL')`,
    );
    const isi = await app.inject({
      method: "PATCH",
      url: `/api/admin/satuan/${id["dus"] ?? ""}`,
      headers: h(),
      payload: { isiSatuanDasar: 6 },
    });
    expect(isi.statusCode).toBe(422);
    expect(isi.body).toContain("Buat satuan jual baru");
    const berat = await app.inject({
      method: "PATCH",
      url: `/api/admin/satuan/${id["dus"] ?? ""}`,
      headers: h(),
      payload: { beratGram: 42_000 },
    });
    expect(berat.statusCode).toBe(204);
    const beratNol = await app.inject({
      method: "POST",
      url: `/api/admin/sku/${id["sku"] ?? ""}/satuan`,
      headers: h(),
      payload: { jenis: "LUSIN", beratGram: 0 },
    });
    expect(beratNol.statusCode).toBe(400);
  });

  it("produk di kategori yang kemudian nonaktif tetap bisa dinonaktifkan, tapi tidak diaktifkan", async () => {
    const baru = await app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: h(),
      payload: { kategoriId: id["beras"], nama: "Beras Kategori Mati" },
    });
    const pid = baru.json<{ id: string }>().id;
    await q("UPDATE kategori SET aktif = false WHERE kode = 'beras'");
    try {
      const nonaktif = await app.inject({
        method: "PATCH",
        url: `/api/admin/produk/${pid}`,
        headers: h(),
        payload: { aktif: false },
      });
      expect(nonaktif.statusCode).toBe(204);
      const aktifLagi = await app.inject({
        method: "PATCH",
        url: `/api/admin/produk/${pid}`,
        headers: h(),
        payload: { aktif: true },
      });
      expect(aktifLagi.statusCode).toBe(422);
    } finally {
      await q("UPDATE kategori SET aktif = true WHERE kode = 'beras'");
    }
  });

  it("tebakan PARALEL: kata sandi & TOTP hanya dievaluasi sebanyak jatah (S1)", async () => {
    const repo = buatRepoAuthAdmin(db);
    await repo.resetGagal(ownerId);
    const layanan = new LayananAuthAdmin({
      repo,
      konfig: KONFIG_UJI,
      scrypt: SCRYPT_UJI,
      semaforScrypt: { maks: 4, maksAntre: 100, tungguMs: 10_000 },
    });
    const ip = layanan.ipHmac("192.0.2.1");
    const auditSalah = async (alasan: string) =>
      Number(
        (
          await q(
            `SELECT count(*)::int AS n FROM log_audit WHERE ref_id = '${ownerId}' AND data->>'alasan' = '${alasan}'`,
          )
        )[0]?.["n"],
      );

    // 40 kode TOTP salah paralel di satu sesi pra → paling banyak 3 dievaluasi (batas per sesi pra).
    const pra = await layanan.masukKataSandi("+6281300000001", SANDI, ip);
    expect(pra.ok).toBe(true);
    const tokenPra = pra.ok ? pra.token : "";
    const benar = new Set([-1, 0, 1].map((d) => kodeTotp(rahasia, langkahTotp(new Date()) + d)));
    const salah: string[] = [];
    for (let i = 0; salah.length < 40; i++) {
      const c = String(100000 + i);
      if (!benar.has(c)) salah.push(c);
    }
    const sebelumTotp = await auditSalah("TOTP_SALAH");
    const hasil = await Promise.all(
      salah.map((kode) => layanan.masukFaktorKedua(tokenPra, { kode }, ip)),
    );
    expect(hasil.every((x) => !x.ok)).toBe(true);
    expect((await auditSalah("TOTP_SALAH")) - sebelumTotp).toBeLessThanOrEqual(3);
    const [a1] = await q(`SELECT gagal_beruntun FROM admin WHERE id = '${ownerId}'`);
    expect(Number(a1?.["gagal_beruntun"])).toBeLessThanOrEqual(3);
    // Sesi pra dicabut setelah jatahnya habis.
    expect(await layanan.adaSesiPra(tokenPra)).toBe(false);

    // 40 kata sandi salah paralel → tepat 5 dievaluasi, lalu terkunci.
    await repo.resetGagal(ownerId);
    const sebelumSandi = await auditSalah("KATA_SANDI_SALAH");
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        layanan.masukKataSandi("+6281300000001", `salah-${String(i)}-xxxxxxxx`, ip),
      ),
    );
    expect((await auditSalah("KATA_SANDI_SALAH")) - sebelumSandi).toBe(5);
    const [a2] = await q(
      `SELECT gagal_beruntun, dikunci_sampai FROM admin WHERE id = '${ownerId}'`,
    );
    expect(Number(a2?.["gagal_beruntun"])).toBe(5);
    expect(a2?.["dikunci_sampai"]).not.toBeNull();
    // Terkunci karena kata sandi salah → login baru ditahan, sesi penuh yang aktif TETAP berlaku.
    expect((await layanan.masukKataSandi("+6281300000001", SANDI, ip)).ok).toBe(false);
    expect(
      (await app.inject({ method: "GET", url: "/api/admin/saya", headers: h() })).statusCode,
    ).toBe(200);
    await repo.resetGagal(ownerId);
  });

  it("repo: penguncian atomik saat gagal paralel & TOTP anti pakai ulang paralel", async () => {
    const repo = buatRepoAuthAdmin(db);
    const kini = new Date();
    // 20 pemesanan jatah paralel → hanya 5 yang mendapat jatah (batas), sisanya ditolak.
    const hasil = await Promise.all(
      Array.from({ length: 20 }, () => repo.pesanPercobaan(ownerId, kini, KEBIJAKAN_KUNCI_BAWAAN)),
    );
    expect(hasil.filter((x) => x !== null)).toHaveLength(5);
    const [a] = await q(`SELECT gagal_beruntun, dikunci_sampai FROM admin WHERE id = '${ownerId}'`);
    expect(a?.["gagal_beruntun"]).toBe(5);
    expect(a?.["dikunci_sampai"]).not.toBeNull();
    // Kunci lewat → hitungan mulai dari 1.
    const nanti = new Date(kini.getTime() + 16 * 60_000);
    expect(await repo.pesanPercobaan(ownerId, nanti, KEBIJAKAN_KUNCI_BAWAAN)).toEqual({
      gagalBeruntun: 1,
      dikunciSampai: null,
    });
    await repo.resetGagal(ownerId);

    const langkah = langkahTotp(new Date()) + 1000;
    const terima = await Promise.all(
      Array.from({ length: 4 }, () => repo.terimaLangkahTotp(ownerId, langkah)),
    );
    expect(terima.filter(Boolean)).toHaveLength(1);
    expect(await repo.terimaLangkahTotp(ownerId, langkah - 1)).toBe(false);
  });

  it("keluar mencabut sesi di DB", async () => {
    // Masuk ulang dengan sesi baru (penguncian di tes sebelumnya sudah direset).
    // Langkah TOTP harus melewati langkah "masa depan" yang diterima tes repo di atas (+1000).
    jam = new Date(Date.now() + 1002 * 30_000);
    const r1 = await app.inject({
      method: "POST",
      url: "/api/admin/masuk",
      payload: { nomorHp: "+6281300000001", kataSandi: SANDI },
    });
    const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA);
    const r2 = await app.inject({
      method: "POST",
      url: "/api/admin/masuk/totp",
      headers: {
        cookie: `${COOKIE_PRA}=${pra}`,
        "x-csrf-token": r1.json<{ csrfToken: string }>().csrfToken,
      },
      payload: { kode: kodeTotp(rahasia, langkahTotp(jam)) },
    });
    expect(r2.statusCode).toBe(200);
    sesi = cookieDari(r2.headers["set-cookie"], COOKIE_SESI);
    csrf = r2.json<{ csrfToken: string }>().csrfToken;
    const r = await app.inject({ method: "POST", url: "/api/admin/keluar", headers: h() });
    expect(r.statusCode).toBe(204);
    const [s] = await q(
      `SELECT dicabut_pada FROM sesi WHERE id_hash = decode('${sha256(sesi).toString("hex")}', 'hex')`,
    );
    expect(s?.["dicabut_pada"]).not.toBeNull();
    expect(
      (await app.inject({ method: "GET", url: "/api/admin/saya", headers: h() })).statusCode,
    ).toBe(401);
  });
});
