// Tes integrasi login OTP WhatsApp pembeli (T-016) terhadap PostgreSQL NYATA + LogGateway:
// alur penuh, 1 akun per nomor, jeda kirim ulang, kedaluwarsa, jatah percobaan, tebakan PARALEL,
// OTP ganda paralel, batas harian, anggaran global, enumerasi, log tanpa PII, opt-in WA, rotasi sesi
// & kunci HMAC, akun dihapus, hook autentikasi untuk rute lain.
// Jalan bila DATABASE_URL_TEST diisi. Tiap run membuat database sementara. SEMUA DATA FIKTIF.
import { LogGateway } from "@nekat/adapters";
import { buatDb, buatRepoMasukPembeli, jalankanMigrasi, type Db } from "@nekat/db";
import { KEBIJAKAN_OTP_BAWAAN, type KebijakanOtp } from "@nekat/domain";
import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buatApp } from "../app.js";
import { buatAutentikasiPembeli, COOKIE_SESI_PEMBELI } from "./autentikasi.js";
import type { KonfigMasuk } from "./konfig.js";
import { hmacHp } from "./kripto.js";
import { LayananMasukPembeli } from "./layanan.js";

const URL_UJI = process.env["DATABASE_URL_TEST"];
const JSON_H = { "content-type": "application/json" };

function cookieDari(setCookie: string | string[] | undefined): string {
  const daftar = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of daftar) {
    const m = new RegExp(`^${COOKIE_SESI_PEMBELI}=([^;]*)`).exec(c);
    if (m?.[1]) return m[1];
  }
  return "";
}

describe.skipIf(!URL_UJI)("login OTP pembeli (PostgreSQL nyata)", () => {
  let db: Db;
  const namaDb = `nekat_uji_otp_${randomBytes(4).toString("hex")}`;
  let jam = new Date("2026-11-28T03:00:00Z");
  let log = "";
  let nomorKe = 0;
  /** Nomor fiktif unik per tes (hindari batas harian antar tes). */
  const nomorBaru = () => `+62812990${String(++nomorKe).padStart(5, "0")}`;
  const q = async (s: string, p: unknown[] = []) =>
    (await db.$client.query<Record<string, unknown>>(s, p)).rows;

  const KUNCI_V1 = Buffer.alloc(32, 11);
  const KUNCI_V2 = Buffer.alloc(32, 12);

  function konfig(o: Partial<KebijakanOtp> = {}, kunci?: Partial<KonfigMasuk>): KonfigMasuk {
    return {
      kunciHp: new Map([[1, KUNCI_V1]]),
      kunciHpVersi: 1,
      kunciKode: Buffer.alloc(32, 22),
      kunciKodeVersi: 1,
      kunciSesi: Buffer.alloc(32, 33),
      kebijakan: {
        ...KEBIJAKAN_OTP_BAWAAN,
        maksKirimPerIpPerJam: 10_000,
        maksVerifikasiPerIpPerMenit: 10_000,
        ...o,
      },
      sesiHari: 30,
      sesiIdleHari: 14,
      originDiizinkan: [],
      ...kunci,
    };
  }

  function rakit(o: Partial<KebijakanOtp> = {}, kunci?: Partial<KonfigMasuk>) {
    const gw = new LogGateway({ ttlKodeMs: 5 * 60_000, sekarang: () => jam.getTime() });
    const layanan = new LayananMasukPembeli({
      repo: buatRepoMasukPembeli(db),
      gateway: gw,
      konfig: konfig(o, kunci),
      sekarang: () => jam,
    });
    const logStream = new Writable({
      write(c: Buffer, _e, cb) {
        log += c.toString();
        cb();
      },
    });
    const app = buatApp({
      logStream,
      masuk: { layanan, originDiizinkan: [], kodeDev: (n) => gw.ambilKodeTerakhir(n) },
    });
    const minta = (nomorHp: string, ip = "203.0.113.10") =>
      app.inject({
        method: "POST",
        url: "/api/masuk/otp",
        headers: JSON_H,
        payload: { nomorHp },
        remoteAddress: ip,
      });
    const verif = (
      nomorHp: string,
      kode: string,
      extra: Record<string, unknown> = {},
      cookie?: string,
    ) =>
      app.inject({
        method: "POST",
        url: "/api/masuk/verifikasi",
        headers: { ...JSON_H, ...(cookie ? { cookie: `${COOKIE_SESI_PEMBELI}=${cookie}` } : {}) },
        payload: { nomorHp, kode, ...extra },
      });
    const kode = (n: string) => gw.ambilKodeTerakhir(n) ?? "";
    return { app, gw, layanan, minta, verif, kode };
  }

  /** Kode 6 digit yang pasti salah. */
  const salahDari = (k: string) => String((Number(k) + 1) % 1_000_000).padStart(6, "0");

  beforeAll(async () => {
    const a = buatDb(URL_UJI ?? "");
    await a.$client.query(`CREATE DATABASE ${namaDb}`);
    await a.$client.end();
    const u = new URL(URL_UJI ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
  });

  afterAll(async () => {
    await db.$client.end();
    const a = buatDb(URL_UJI ?? "");
    await a.$client.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await a.$client.end();
  });

  beforeEach(() => {
    jam = new Date(jam.getTime() + 3_600_000); // tiap tes 1 jam kemudian (jeda & anggaran jam bersih)
  });

  it("alur penuh: kirim → verifikasi → sesi → /api/saya → keluar", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    const r1 = await t.minta(nomor.replace("+62", "0"));
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ kedaluwarsaDetik: 300, kirimUlangDetik: 60 });
    const kode = t.kode(nomor);
    expect(kode).toMatch(/^\d{6}$/);

    // DB hanya menyimpan HMAC (tidak ada kode/nomor asli di otp_permintaan).
    const [otp] = await q("SELECT * FROM otp_permintaan ORDER BY dibuat_pada DESC LIMIT 1");
    expect(JSON.stringify(otp)).not.toContain(kode);
    expect(JSON.stringify(otp)).not.toContain(nomor.slice(3));

    const r2 = await t.verif(nomor, kode);
    expect(r2.statusCode).toBe(200);
    const token = cookieDari(r2.headers["set-cookie"]);
    expect(token.length).toBeGreaterThan(30);
    const { csrfToken } = r2.json<{ csrfToken: string }>();

    const saya = await t.app.inject({
      method: "GET",
      url: "/api/saya",
      headers: { cookie: `${COOKIE_SESI_PEMBELI}=${token}` },
    });
    expect(saya.statusCode).toBe(200);
    expect(saya.json()).toMatchObject({
      akun: { status: "AKTIF", jenisPelanggan: "PERORANGAN" },
      csrfToken,
    });

    // Sesi di DB hanya hash.
    const [s] = await q("SELECT count(*)::int AS n FROM sesi WHERE id_hash = sha256($1::bytea)", [
      Buffer.from(token),
    ]);
    expect(s?.["n"]).toBe(1);

    const keluar = await t.app.inject({
      method: "POST",
      url: "/api/keluar",
      headers: { ...JSON_H, cookie: `${COOKIE_SESI_PEMBELI}=${token}`, "x-csrf-token": csrfToken },
      payload: {},
    });
    expect(keluar.statusCode).toBe(204);
    const lagi = await t.app.inject({
      method: "GET",
      url: "/api/saya",
      headers: { cookie: `${COOKIE_SESI_PEMBELI}=${token}` },
    });
    expect(lagi.statusCode).toBe(401);
  });

  it("satu akun per nomor (format apa pun); login ulang merotasi sesi lama", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    await t.minta(nomor);
    const a = await t.verif(nomor, t.kode(nomor));
    const tokenA = cookieDari(a.headers["set-cookie"]);

    jam = new Date(jam.getTime() + 120_000);
    const lokal = `0${nomor.slice(3, 6)}-${nomor.slice(6)}`;
    await t.minta(lokal);
    const b = await t.verif(lokal, t.kode(nomor), {}, tokenA);
    expect(b.statusCode).toBe(200);
    const tokenB = cookieDari(b.headers["set-cookie"]);
    expect(tokenB).not.toBe(tokenA);

    const [n] = await q("SELECT count(*)::int AS n FROM akun WHERE nomor_hp_e164 = $1", [nomor]);
    expect(n?.["n"]).toBe(1);
    // Sesi lama (cookie yang sama dikirim saat login) dicabut.
    const lama = await t.app.inject({
      method: "GET",
      url: "/api/saya",
      headers: { cookie: `${COOKIE_SESI_PEMBELI}=${tokenA}` },
    });
    expect(lama.statusCode).toBe(401);
  });

  it("jeda kirim ulang; OTP baru membatalkan OTP lama", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    expect((await t.minta(nomor)).statusCode).toBe(200);
    const kodeLama = t.kode(nomor);
    const cepat = await t.minta(nomor);
    expect(cepat.statusCode).toBe(429);
    expect(cepat.json()).toMatchObject({ kode: "TERLALU_CEPAT", tungguDetik: 60 });
    expect(cepat.headers["retry-after"]).toBe("60");

    jam = new Date(jam.getTime() + 61_000);
    expect((await t.minta(nomor)).statusCode).toBe(200);
    const kodeBaru = t.kode(nomor);
    const pakaiLama = await t.verif(nomor, kodeLama === kodeBaru ? salahDari(kodeBaru) : kodeLama);
    expect(pakaiLama.statusCode).toBe(401);
    expect((await t.verif(nomor, kodeBaru)).statusCode).toBe(200);
    const [hidup] = await q(
      "SELECT count(*)::int AS n FROM otp_permintaan WHERE terpakai_pada IS NULL AND digantikan_pada IS NULL",
    );
    expect(hidup?.["n"]).toBe(0);
  });

  it("kedaluwarsa: kode lewat 5 menit tidak berlaku", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    await t.minta(nomor);
    const kode = t.kode(nomor);
    jam = new Date(jam.getTime() + 5 * 60_000 + 1);
    const r = await t.verif(nomor, kode);
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ kode: "KODE_TIDAK_BERLAKU" });
  });

  it("maks percobaan per kode → hangus; kode benar sesudahnya ditolak", async () => {
    const t = rakit({ maksPercobaan: 3 });
    const nomor = nomorBaru();
    await t.minta(nomor);
    const kode = t.kode(nomor);
    const sisa: unknown[] = [];
    for (let i = 0; i < 3; i++) sisa.push((await t.verif(nomor, salahDari(kode))).json());
    expect(sisa.map((s) => (s as { sisaPercobaan: number }).sisaPercobaan)).toEqual([2, 1, 0]);
    expect((await t.verif(nomor, kode)).json()).toMatchObject({ kode: "KODE_TIDAK_BERLAKU" });
    const [a] = await q(
      "SELECT count(*)::int AS n FROM log_audit WHERE jenis = 'OTP_PEMBELI_HANGUS'",
    );
    expect(a?.["n"]).toBeGreaterThanOrEqual(1);
  });

  it("tebakan PARALEL tidak melebihi jatah percobaan", async () => {
    const t = rakit({ maksPercobaan: 5, maksGagalPerHari: 100 });
    const nomor = nomorBaru();
    await t.minta(nomor);
    const kode = t.kode(nomor);
    const tebak = Array.from({ length: 30 }, (_, i) =>
      String((Number(kode) + 1 + i) % 1_000_000).padStart(6, "0"),
    );
    const hasil = await Promise.all(tebak.map((k) => t.verif(nomor, k)));
    const kodeGalat = hasil.map((r) => r.json<{ kode: string }>().kode);
    expect(kodeGalat.filter((k) => k === "KODE_SALAH")).toHaveLength(5);
    expect(kodeGalat.filter((k) => k === "KODE_TIDAK_BERLAKU")).toHaveLength(25);
    const [o] = await q("SELECT percobaan FROM otp_permintaan ORDER BY dibuat_pada DESC LIMIT 1");
    expect(o?.["percobaan"]).toBe(5);
  });

  it("kode benar dikirim PARALEL → tepat satu sesi", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    await t.minta(nomor);
    const kode = t.kode(nomor);
    const hasil = await Promise.all(Array.from({ length: 10 }, () => t.verif(nomor, kode)));
    expect(hasil.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const [s] = await q(
      "SELECT count(*)::int AS n FROM sesi s JOIN akun a ON a.id = s.akun_id WHERE a.nomor_hp_e164 = $1",
      [nomor],
    );
    expect(s?.["n"]).toBe(1);
  });

  it("OTP ganda PARALEL → satu OTP hidup, satu WA terkirim", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    const hasil = await Promise.all(Array.from({ length: 12 }, () => t.minta(nomor)));
    expect(hasil.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(hasil.filter((r) => r.statusCode === 429)).toHaveLength(11);
    expect(t.gw.jumlahTerkirim).toBe(1);
    const [n] = await q(
      `SELECT count(*)::int AS n FROM otp_permintaan o
        WHERE terpakai_pada IS NULL AND digantikan_pada IS NULL AND dibuat_pada = $1`,
      [jam],
    );
    expect(n?.["n"]).toBe(1);
  });

  it("batas gagal harian per nomor TIDAK di-reset oleh kirim ulang", async () => {
    const t = rakit({ maksPercobaan: 5, maksGagalPerHari: 3 });
    const nomor = nomorBaru();
    await t.minta(nomor);
    await t.verif(nomor, salahDari(t.kode(nomor)));
    await t.verif(nomor, salahDari(t.kode(nomor)));
    jam = new Date(jam.getTime() + 61_000);
    await t.minta(nomor); // kirim ulang
    const kode = t.kode(nomor);
    expect((await t.verif(nomor, salahDari(kode))).statusCode).toBe(401);
    // Jatah harian habis: kode BENAR pun ditolak tanpa dibandingkan, dan percobaan kode tidak berkurang.
    const r = await t.verif(nomor, kode);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ kode: "TERLALU_SERING" });
    const [o] = await q("SELECT percobaan FROM otp_permintaan ORDER BY dibuat_pada DESC LIMIT 1");
    expect(o?.["percobaan"]).toBe(1);
    const [a] = await q(
      "SELECT count(*)::int AS n FROM log_audit WHERE jenis = 'OTP_PEMBELI_BATAS_HARIAN'",
    );
    expect(a?.["n"]).toBeGreaterThanOrEqual(1);
  });

  it("batas kirim harian per nomor", async () => {
    const t = rakit({ maksKirimPerHari: 2 });
    const nomor = nomorBaru();
    // Pakai jam yang pasti di tengah hari WIB (tidak melewati pergantian hari di tengah tes).
    jam = new Date("2026-12-10T03:00:00Z");
    expect((await t.minta(nomor)).statusCode).toBe(200);
    jam = new Date(jam.getTime() + 61_000);
    expect((await t.minta(nomor)).statusCode).toBe(200);
    jam = new Date(jam.getTime() + 61_000);
    const r = await t.minta(nomor);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ kode: "TERLALU_SERING" });
  });

  it("anggaran global per jam habis → 503 untuk semua nomor (anti pumping)", async () => {
    jam = new Date("2026-12-11T03:00:00Z");
    const t = rakit({ anggaranPerJam: 2 });
    expect((await t.minta(nomorBaru())).statusCode).toBe(200);
    expect((await t.minta(nomorBaru())).statusCode).toBe(200);
    const r = await t.minta(nomorBaru());
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ kode: "KODE_BELUM_TERKIRIM" });
  });

  it("enumerasi: respons kirim OTP identik untuk nomor terdaftar dan belum", async () => {
    const t = rakit();
    const terdaftar = nomorBaru();
    await t.minta(terdaftar);
    expect((await t.verif(terdaftar, t.kode(terdaftar))).statusCode).toBe(200);
    jam = new Date(jam.getTime() + 61_000);
    const a = await t.minta(terdaftar);
    const b = await t.minta(nomorBaru());
    expect([a.statusCode, a.body]).toEqual([b.statusCode, b.body]);
    const kunciHeader = (h: Record<string, unknown>) =>
      Object.keys(h)
        .filter((k) => !["date", "content-length"].includes(k))
        .sort();
    expect(kunciHeader(a.headers)).toEqual(kunciHeader(b.headers));
  });

  it("log tidak memuat nomor HP maupun kode OTP", async () => {
    log = "";
    const t = rakit();
    const nomor = nomorBaru();
    await t.minta(nomor);
    const kode = t.kode(nomor);
    await t.verif(nomor, salahDari(kode));
    await t.verif(nomor, kode);
    const dev = await t.app.inject({
      method: "POST",
      url: "/api/dev/otp-terakhir",
      headers: JSON_H,
      payload: { nomorHp: nomor },
    });
    expect(dev.json()).toEqual({ kode });
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain(nomor.slice(3));
    expect(log).not.toContain(kode);
    // Tabel lain juga bersih dari kode.
    const [audit] = await q("SELECT string_agg(data::text, ' ') AS t FROM log_audit");
    expect(String(audit?.["t"])).not.toContain(kode);
    expect(String(audit?.["t"])).not.toContain(nomor.slice(3));
  });

  it("opt-in WA (N-13): dicentang → tercatat; bawaan tidak dicentang → tidak ada catatan", async () => {
    const t = rakit();
    const ya = nomorBaru();
    const tidak = nomorBaru();
    await t.minta(ya);
    await t.minta(tidak);
    expect((await t.verif(ya, t.kode(ya), { waOptin: true })).statusCode).toBe(200);
    expect((await t.verif(tidak, t.kode(tidak))).statusCode).toBe(200);
    const baris = await q(
      `SELECT a.nomor_hp_e164 AS nomor, l.data FROM log_audit l JOIN akun a ON a.id::text = l.ref_id
        WHERE l.jenis = 'WA_OPTIN'`,
    );
    expect(baris.map((b) => b["nomor"])).toContain(ya);
    expect(baris.map((b) => b["nomor"])).not.toContain(tidak);
    expect(baris.find((b) => b["nomor"] === ya)?.["data"]).toMatchObject({ sumber: "LOGIN_OTP" });
  });

  it("akun dihapus tidak bisa masuk (pesan khusus setelah OTP terbukti)", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    await q(
      `INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada, status)
       VALUES ($1, $2, 1, now(), 'DIHAPUS')`,
      [nomor, hmacHp(KUNCI_V1, nomor)],
    );
    await t.minta(nomor);
    const r = await t.verif(nomor, t.kode(nomor));
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ kode: "AKUN_TIDAK_AKTIF" });
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("rotasi kunci HMAC HP: akun versi lama dikenali lalu di-HMAC ulang (tetap 1 akun)", async () => {
    const nomor = nomorBaru();
    const t1 = rakit();
    await t1.minta(nomor);
    await t1.verif(nomor, t1.kode(nomor));
    jam = new Date(jam.getTime() + 120_000);
    const t2 = rakit(
      {},
      {
        kunciHp: new Map([
          [2, KUNCI_V2],
          [1, KUNCI_V1],
        ]),
        kunciHpVersi: 2,
      },
    );
    await t2.minta(nomor);
    expect((await t2.verif(nomor, t2.kode(nomor))).statusCode).toBe(200);
    const baris = await q(
      "SELECT hp_hmac, hp_hmac_kunci_versi FROM akun WHERE nomor_hp_e164 = $1",
      [nomor],
    );
    expect(baris).toHaveLength(1);
    expect(baris[0]?.["hp_hmac_kunci_versi"]).toBe(2);
    expect(Buffer.from(baris[0]?.["hp_hmac"] as Buffer).equals(hmacHp(KUNCI_V2, nomor))).toBe(true);
  });

  it("hook autentikasi untuk rute lain (T-021/T-029) memakai sesi DB; CSRF wajib untuk mutasi", async () => {
    const t = rakit();
    const nomor = nomorBaru();
    await t.minta(nomor);
    const r = await t.verif(nomor, t.kode(nomor));
    const token = cookieDari(r.headers["set-cookie"]);
    const { csrfToken } = r.json<{ csrfToken: string }>();
    const autentikasi = buatAutentikasiPembeli(t.layanan);
    const lain = Fastify();
    lain.get("/api/uji-saldo", async (req) => ({ sesi: await autentikasi(req) }));
    lain.post("/api/uji-bayar", async (req) => ({ sesi: await autentikasi(req) }));
    const cookie = `${COOKIE_SESI_PEMBELI}=${token}`;
    const get = await lain.inject({ method: "GET", url: "/api/uji-saldo", headers: { cookie } });
    const [a] = await q("SELECT id FROM akun WHERE nomor_hp_e164 = $1", [nomor]);
    expect(get.json()).toEqual({ sesi: { akunId: a?.["id"] } });
    const tanpaCsrf = await lain.inject({
      method: "POST",
      url: "/api/uji-bayar",
      headers: { cookie },
    });
    expect(tanpaCsrf.json()).toEqual({ sesi: null });
    const denganCsrf = await lain.inject({
      method: "POST",
      url: "/api/uji-bayar",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(denganCsrf.json()).toEqual({ sesi: { akunId: a?.["id"] } });
    // Idle > 14 hari → sesi tidak berlaku.
    jam = new Date(jam.getTime() + 15 * 86_400_000);
    const basi = await lain.inject({ method: "GET", url: "/api/uji-saldo", headers: { cookie } });
    expect(basi.json()).toEqual({ sesi: null });
  });
});
