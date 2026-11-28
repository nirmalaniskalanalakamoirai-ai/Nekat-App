// Tes unit login OTP pembeli (T-016) tanpa PostgreSQL: konfigurasi, kriptografi, layanan (retry kirim,
// batas IP), rute (validasi, header keamanan, Origin/JSON, XFF), hook autentikasi kompatibel T-021/T-029.
// SEMUA DATA FIKTIF.
import type { RepoMasukPembeli } from "@nekat/db";
import { KEBIJAKAN_OTP_BAWAAN, WaGalat, type WhatsAppGateway } from "@nekat/domain";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { buatApp } from "../app.js";
import { buatAutentikasiPembeli, COOKIE_SESI_PEMBELI, hookWajibMasuk } from "./autentikasi.js";
import { bacaKonfigMasuk, KonfigMasukTidakValidError, type KonfigMasuk } from "./konfig.js";
import { buatKodeOtp, hmacHp, kunciIp } from "./kripto.js";
import { LayananMasukPembeli, type LayananMasuk } from "./layanan.js";

const K32 = (n: number) => Buffer.alloc(32, n).toString("base64");
const ENV = { HP_HMAC_KUNCI: K32(1), OTP_KODE_KUNCI: K32(2), SESI_PEMBELI_KUNCI: K32(3) };

const KONFIG_MASUK_UJI: KonfigMasuk = {
  kunciHp: new Map([[1, Buffer.alloc(32, 1)]]),
  kunciHpVersi: 1,
  kunciKode: Buffer.alloc(32, 2),
  kunciKodeVersi: 1,
  kunciSesi: Buffer.alloc(32, 3),
  kebijakan: KEBIJAKAN_OTP_BAWAAN,
  sesiHari: 30,
  sesiIdleHari: 14,
  originDiizinkan: ["https://nekat.contoh"],
};

describe("konfigurasi login pembeli", () => {
  it("tanpa rahasia → null (rute 503); lengkap → aktif dengan DEFAULT", () => {
    expect(bacaKonfigMasuk({})).toBeNull();
    const k = bacaKonfigMasuk(ENV);
    expect(k?.kebijakan).toEqual(KEBIJAKAN_OTP_BAWAAN);
    expect(k?.kunciHpVersi).toBe(1);
  });

  it("sebagian / kunci sama / angka di luar batas → gagal start, hanya nama variabel", () => {
    const salah = (env: Record<string, string>) => {
      try {
        bacaKonfigMasuk(env);
      } catch (e) {
        expect(e).toBeInstanceOf(KonfigMasukTidakValidError);
        return (e as KonfigMasukTidakValidError).variabel;
      }
      return [];
    };
    expect(salah({ HP_HMAC_KUNCI: K32(1) })).toEqual(["OTP_KODE_KUNCI", "SESI_PEMBELI_KUNCI"]);
    expect(salah({ ...ENV, SESI_PEMBELI_KUNCI: K32(1) })).toEqual(["SESI_PEMBELI_KUNCI"]);
    expect(salah({ ...ENV, OTP_MAKS_PERCOBAAN: "0" })).toEqual(["OTP_MAKS_PERCOBAAN"]);
    expect(salah({ ...ENV, HP_HMAC_KUNCI: "pendek" })).toEqual(["HP_HMAC_KUNCI"]);
  });

  it("versi kunci HMAC HP lama dikenali untuk pencarian akun", () => {
    const k = bacaKonfigMasuk({
      ...ENV,
      HP_HMAC_KUNCI_VERSI: "2",
      HP_HMAC_KUNCI_LAMA: `v1:${K32(9)}`,
    });
    expect([...(k?.kunciHp.keys() ?? [])].sort()).toEqual([1, 2]);
  });
});

describe("kriptografi", () => {
  it("kode OTP 6 digit, tersebar", () => {
    const kode = Array.from({ length: 300 }, buatKodeOtp);
    expect(kode.every((k) => /^\d{6}$/.test(k))).toBe(true);
    expect(new Set(kode).size).toBeGreaterThan(290);
  });

  it("HMAC nomor deterministik per kunci", () => {
    const a = hmacHp(Buffer.alloc(32, 1), "+6281200001111");
    expect(a.equals(hmacHp(Buffer.alloc(32, 1), "+6281200001111"))).toBe(true);
    expect(a.equals(hmacHp(Buffer.alloc(32, 2), "+6281200001111"))).toBe(false);
  });

  it("kunci IP: IPv6 per /64, IPv4-mapped = IPv4", () => {
    expect(kunciIp("203.0.113.7")).toBe("203.0.113.7");
    expect(kunciIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(kunciIp("2001:db8:aa:bb:1:2:3:4")).toBe("2001:db8:aa:bb::/64");
    expect(kunciIp("2001:db8:aa:bb::99")).toBe("2001:db8:aa:bb::/64");
    expect(kunciIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

function repoPalsu(): RepoMasukPembeli & { batal: string[] } {
  const batal: string[] = [];
  let n = 0;
  return {
    batal,
    buatOtp: (d) => {
      n++;
      return Promise.resolve({
        ok: true,
        id: `otp-${String(n)}`,
        kedaluwarsaPada: new Date(d.sekarang.getTime() + 300_000),
      });
    },
    batalkanOtpGagalKirim: (id) => {
      batal.push(id);
      return Promise.resolve();
    },
    verifikasiOtp: () => Promise.resolve({ ok: false, alasan: "TIDAK_BERLAKU" }),
    cariSesi: () => Promise.resolve(null),
    sentuhSesi: () => Promise.resolve(),
    cabutSesi: () => Promise.resolve(),
    ringkasanAkun: () => Promise.resolve(null),
    catatAudit: () => Promise.resolve(),
  };
}

function gatewayGagal(urutan: (WaGalat | null)[]): WhatsAppGateway & { n: number } {
  const g = {
    mode: "meta" as const,
    n: 0,
    kirimTemplate: () => Promise.reject(new Error("tidak dipakai")),
    kirimOtp: () => {
      const e = urutan[g.n++] ?? null;
      return e ? Promise.reject(e) : Promise.resolve({ idPesanPenyedia: "wamid.X" });
    },
  };
  return g;
}

describe("layanan: kirim OTP sinkron (T-010 §3.3a)", () => {
  const tidur = () => Promise.resolve();

  it("timeout 2× lalu sukses → satu OTP, 3 panggilan (TC-NJ-38)", async () => {
    const gw = gatewayGagal([new WaGalat("SEMENTARA"), new WaGalat("SEMENTARA"), null]);
    const repo = repoPalsu();
    const l = new LayananMasukPembeli({ repo, gateway: gw, konfig: KONFIG_MASUK_UJI, tidur });
    const h = await l.mintaOtp("+6281200001111", "203.0.113.1");
    expect(h.ok).toBe(true);
    expect(gw.n).toBe(3);
    expect(repo.batal).toEqual([]);
  });

  it("gagal 3× → OTP dibatalkan + TIDAK_TERKIRIM; galat kritis dilaporkan tanpa PII", async () => {
    const gw = gatewayGagal([new WaGalat("BATAS"), new WaGalat("BATAS"), new WaGalat("BATAS")]);
    const repo = repoPalsu();
    const lapor = vi.fn();
    const l = new LayananMasukPembeli({
      repo,
      gateway: gw,
      konfig: KONFIG_MASUK_UJI,
      tidur,
      lapor,
    });
    expect(await l.mintaOtp("+6281200001111", "203.0.113.1")).toEqual({
      ok: false,
      alasan: "TIDAK_TERKIRIM",
    });
    expect(repo.batal).toEqual(["otp-1"]);

    const gw2 = gatewayGagal([new WaGalat("OTENTIKASI", { kodePenyedia: "190" })]);
    const l2 = new LayananMasukPembeli({
      repo,
      gateway: gw2,
      konfig: KONFIG_MASUK_UJI,
      tidur,
      lapor,
    });
    await l2.mintaOtp("+6281200001111", "203.0.113.1");
    expect(gw2.n).toBe(1); // OTENTIKASI tidak dicoba ulang
    const terakhir = JSON.stringify(lapor.mock.calls.at(-1));
    expect(terakhir).toContain('"kritis":true');
    expect(terakhir).not.toContain("81200001111");
  });

  it("batas per IP: tidak bisa dilewati dengan memutar alamat di /64 yang sama", async () => {
    const konfig = {
      ...KONFIG_MASUK_UJI,
      kebijakan: { ...KEBIJAKAN_OTP_BAWAAN, maksKirimPerIpPerJam: 2 },
    };
    const l = new LayananMasukPembeli({
      repo: repoPalsu(),
      gateway: gatewayGagal([]),
      konfig,
      tidur,
    });
    expect((await l.mintaOtp("+6281200000001", "2001:db8:1:2::1")).ok).toBe(true);
    expect((await l.mintaOtp("+6281200000002", "2001:db8:1:2::2")).ok).toBe(true);
    const h = await l.mintaOtp("+6281200000003", "2001:db8:1:2:ffff::3");
    expect(h).toMatchObject({ ok: false, alasan: "BATAS" });
    expect((await l.mintaOtp("+6281200000004", "2001:db8:1:3::1")).ok).toBe(true);
  });
});

/** Layanan palsu untuk tes rute (sesi token "sesi-sah-…" → akun tetap). */
function layananPalsu(o: Partial<LayananMasuk> = {}): LayananMasuk & { panggilOtp: string[] } {
  const panggilOtp: string[] = [];
  return {
    panggilOtp,
    sesiHari: 30,
    mintaOtp: (nomor) => {
      panggilOtp.push(nomor);
      return Promise.resolve({ ok: true, kedaluwarsaDetik: 300, kirimUlangDetik: 60 });
    },
    verifikasi: () => Promise.resolve({ ok: false, alasan: "TIDAK_BERLAKU" }),
    sesi: (t) =>
      Promise.resolve(
        t.startsWith("sesi-sah-")
          ? {
              akunId: "0193b9a0-0000-7000-8000-000000000001",
              kedaluwarsaPada: new Date(Date.now() + 1e9),
            }
          : null,
      ),
    csrf: (t) => `csrf-${t}`,
    keluar: () => Promise.resolve(),
    saya: (id) =>
      Promise.resolve({
        id,
        nomorHpE164: "+6281200001111",
        namaPanggilan: "Rahasia",
        jenisPelanggan: "PERORANGAN",
        status: "AKTIF",
      }),
    ...o,
  };
}

const TOKEN = "sesi-sah-0123456789abcdef";
const JSON_H = { "content-type": "application/json" };

describe("rute masuk", () => {
  it("tanpa konfigurasi → 503", async () => {
    const app = buatApp({ logger: false });
    const r = await app.inject({
      method: "POST",
      url: "/api/masuk/otp",
      headers: JSON_H,
      payload: { nomorHp: "0812" },
    });
    expect(r.statusCode).toBe(503);
  });

  it("kirim OTP: normalisasi +62, header keamanan, nomor salah → pesan umum", async () => {
    const l = layananPalsu();
    const app = buatApp({ logger: false, masuk: { layanan: l, originDiizinkan: [] } });
    const ok = await app.inject({
      method: "POST",
      url: "/api/masuk/otp",
      headers: JSON_H,
      payload: { nomorHp: "0812-0000-1111" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ kedaluwarsaDetik: 300, kirimUlangDetik: 60 });
    expect(l.panggilOtp).toEqual(["+6281200001111"]);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.headers["x-frame-options"]).toBe("DENY");
    const salah = await app.inject({
      method: "POST",
      url: "/api/masuk/otp",
      headers: JSON_H,
      payload: { nomorHp: "021-555" },
    });
    expect(salah.statusCode).toBe(400);
    expect(salah.json()).toMatchObject({ kode: "NOMOR_HP_TIDAK_VALID" });
    expect(salah.body).not.toContain("021-555");
  });

  it("mutasi wajib JSON; Origin asing / sec-fetch-site cross-site ditolak", async () => {
    const app = buatApp({
      logger: false,
      masuk: { layanan: layananPalsu(), originDiizinkan: ["https://nekat.contoh"] },
    });
    const form = await app.inject({
      method: "POST",
      url: "/api/masuk/otp",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "nomorHp=081200001111",
    });
    expect(form.statusCode).toBe(415);
    const asing = await app.inject({
      method: "POST",
      url: "/api/masuk/otp",
      headers: { ...JSON_H, origin: "https://jahat.contoh" },
      payload: { nomorHp: "081200001111" },
    });
    expect(asing.statusCode).toBe(403);
    const lintas = await app.inject({
      method: "POST",
      url: "/api/masuk/otp",
      headers: { ...JSON_H, "sec-fetch-site": "cross-site" },
      payload: { nomorHp: "081200001111" },
    });
    expect(lintas.statusCode).toBe(403);
    const sah = await app.inject({
      method: "POST",
      url: "/api/masuk/otp",
      headers: { ...JSON_H, origin: "https://nekat.contoh" },
      payload: { nomorHp: "081200001111" },
    });
    expect(sah.statusCode).toBe(200);
  });

  it("X-Forwarded-For diabaikan tanpa TRUST_PROXY (batas IP tidak bisa dilewati)", async () => {
    const ip: string[] = [];
    const l = layananPalsu({
      mintaOtp: (_n, i) => {
        ip.push(i);
        return Promise.resolve({ ok: true, kedaluwarsaDetik: 300, kirimUlangDetik: 60 });
      },
    });
    const app = buatApp({ logger: false, masuk: { layanan: l, originDiizinkan: [] } });
    for (const xff of ["1.1.1.1", "2.2.2.2"]) {
      await app.inject({
        method: "POST",
        url: "/api/masuk/otp",
        headers: { ...JSON_H, "x-forwarded-for": xff },
        payload: { nomorHp: "081200001111" },
        remoteAddress: "203.0.113.9",
      });
    }
    expect(ip).toEqual(["203.0.113.9", "203.0.113.9"]);
  });

  it("verifikasi sukses → cookie __Host- HttpOnly Secure SameSite=Lax + token CSRF; cookie lama ikut dikirim untuk rotasi", async () => {
    const terima = vi.fn();
    const l = layananPalsu({
      verifikasi: (i) => {
        terima(i);
        return Promise.resolve({
          ok: true,
          token: "token-baru-0123456789",
          kedaluwarsaPada: new Date("2026-12-28T00:00:00Z"),
          akunId: "0193b9a0-0000-7000-8000-000000000001",
        });
      },
    });
    const app = buatApp({ logger: false, masuk: { layanan: l, originDiizinkan: [] } });
    const r = await app.inject({
      method: "POST",
      url: "/api/masuk/verifikasi",
      headers: { ...JSON_H, cookie: `${COOKIE_SESI_PEMBELI}=token-lama-0123456789` },
      payload: { nomorHp: "+6281200001111", kode: "123456" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      csrfToken: "csrf-token-baru-0123456789",
      sesiBerakhir: "2026-12-28T00:00:00.000Z",
    });
    const c = String(r.headers["set-cookie"]);
    expect(c).toMatch(
      /^__Host-nekat_sesi=token-baru-0123456789; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/,
    );
    expect(terima).toHaveBeenCalledWith(
      expect.objectContaining({
        waOptin: false,
        tokenLama: "token-lama-0123456789",
        kode: "123456",
      }),
    );
  });

  it("verifikasi: kode bukan 6 digit → 400; kode salah → sisa percobaan", async () => {
    const l = layananPalsu({
      verifikasi: () => Promise.resolve({ ok: false, alasan: "KODE_SALAH", sisaPercobaan: 2 }),
    });
    const app = buatApp({ logger: false, masuk: { layanan: l, originDiizinkan: [] } });
    const pendek = await app.inject({
      method: "POST",
      url: "/api/masuk/verifikasi",
      headers: JSON_H,
      payload: { nomorHp: "081200001111", kode: "12345" },
    });
    expect(pendek.json()).toMatchObject({ kode: "KODE_TIDAK_VALID" });
    const salah = await app.inject({
      method: "POST",
      url: "/api/masuk/verifikasi",
      headers: JSON_H,
      payload: { nomorHp: "081200001111", kode: "123456", waOptin: true },
    });
    expect(salah.statusCode).toBe(401);
    expect(salah.json()).toMatchObject({
      sisaPercobaan: 2,
      pesan: "Kode salah. Sisa 2 percobaan.",
    });
  });

  it("GET /api/saya minimal (nomor tersamar, tanpa nama); tanpa sesi 401", async () => {
    const app = buatApp({ logger: false, masuk: { layanan: layananPalsu(), originDiizinkan: [] } });
    const tanpa = await app.inject({ method: "GET", url: "/api/saya" });
    expect(tanpa.statusCode).toBe(401);
    const r = await app.inject({
      method: "GET",
      url: "/api/saya",
      headers: { cookie: `${COOKIE_SESI_PEMBELI}=${TOKEN}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ akun: unknown }>().akun).toEqual({
      id: "0193b9a0-0000-7000-8000-000000000001",
      nomorHpSamar: "+62 812•••• 11",
      jenisPelanggan: "PERORANGAN",
      status: "AKTIF",
    });
    expect(r.body).not.toContain("Rahasia");
    expect(r.body).not.toContain("81200001111");
  });

  it("keluar: sesi hidup tanpa CSRF → 403; dengan CSRF → 204 + cookie dihapus", async () => {
    const keluar = vi.fn(() => Promise.resolve());
    const app = buatApp({
      logger: false,
      masuk: { layanan: layananPalsu({ keluar }), originDiizinkan: [] },
    });
    const cookie = `${COOKIE_SESI_PEMBELI}=${TOKEN}`;
    const tanpa = await app.inject({
      method: "POST",
      url: "/api/keluar",
      headers: { ...JSON_H, cookie },
      payload: {},
    });
    expect(tanpa.statusCode).toBe(403);
    const ok = await app.inject({
      method: "POST",
      url: "/api/keluar",
      headers: { ...JSON_H, cookie, "x-csrf-token": `csrf-${TOKEN}` },
      payload: {},
    });
    expect(ok.statusCode).toBe(204);
    expect(String(ok.headers["set-cookie"])).toContain("Max-Age=0");
    expect(keluar).toHaveBeenCalledWith(TOKEN);
  });

  it("endpoint kode dev hanya ada bila diaktifkan (mode log)", async () => {
    const mati = buatApp({
      logger: false,
      masuk: { layanan: layananPalsu(), originDiizinkan: [] },
    });
    const dev = {
      method: "POST" as const,
      url: "/api/dev/otp-terakhir",
      headers: JSON_H,
      payload: { nomorHp: "081200001111" },
    };
    expect((await mati.inject(dev)).statusCode).toBe(404);
    const hidup = buatApp({
      logger: false,
      masuk: {
        layanan: layananPalsu(),
        originDiizinkan: [],
        kodeDev: (n) => (n === "+6281200001111" ? "424242" : null),
      },
    });
    const r = await hidup.inject(dev);
    expect(r.json()).toEqual({ kode: "424242" });
  });
});

describe("hook autentikasi pembeli (kompatibel T-021/T-029)", () => {
  function appUji(l: LayananMasuk | null) {
    const app = Fastify();
    const autentikasi = l ? buatAutentikasiPembeli(l) : null;
    app.get("/lama", async (req) => ({ sesi: autentikasi ? await autentikasi(req) : null }));
    app.post("/lama", async (req) => ({ sesi: autentikasi ? await autentikasi(req) : null }));
    void app.register((r, _o, done) => {
      r.addHook("onRequest", hookWajibMasuk(l));
      r.get("/baru", (req) => ({ akunSesi: req.akunSesi ?? null }));
      r.post("/baru", (req) => ({ akunSesi: req.akunSesi ?? null }));
      done();
    });
    return app;
  }
  const cookie = `${COOKIE_SESI_PEMBELI}=${TOKEN}`;

  it("AutentikasiPembeli: GET dengan sesi → {akunId}; mutasi tanpa CSRF → null", async () => {
    const app = appUji(layananPalsu());
    const get = await app.inject({ method: "GET", url: "/lama", headers: { cookie } });
    expect(get.json()).toEqual({ sesi: { akunId: "0193b9a0-0000-7000-8000-000000000001" } });
    const post = await app.inject({ method: "POST", url: "/lama", headers: { cookie } });
    expect(post.json()).toEqual({ sesi: null });
    const postCsrf = await app.inject({
      method: "POST",
      url: "/lama",
      headers: { cookie, "x-csrf-token": `csrf-${TOKEN}` },
    });
    expect(postCsrf.json()).toEqual({ sesi: { akunId: "0193b9a0-0000-7000-8000-000000000001" } });
    const asing = await app.inject({
      method: "GET",
      url: "/lama",
      headers: { cookie: `${COOKIE_SESI_PEMBELI}=sesi-palsu-0123456789` },
    });
    expect(asing.json()).toEqual({ sesi: null });
  });

  it("hookWajibMasuk: 401 / 403 CSRF / 503 nonaktif; sukses mengisi req.akunSesi", async () => {
    const app = appUji(layananPalsu());
    expect((await app.inject({ method: "GET", url: "/baru" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/baru", headers: { cookie } })).statusCode,
    ).toBe(403);
    const ok = await app.inject({ method: "GET", url: "/baru", headers: { cookie } });
    expect(ok.json()).toEqual({ akunSesi: { akunId: "0193b9a0-0000-7000-8000-000000000001" } });
    expect((await appUji(null).inject({ method: "GET", url: "/baru" })).statusCode).toBe(503);
  });
});
