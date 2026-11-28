// Rute login OTP WhatsApp pembeli (T-016, H-07):
//   POST /api/masuk/otp          { nomorHp }                     → kirim kode (respons sama untuk nomor
//                                                                  terdaftar/belum: tanpa enumerasi akun)
//   POST /api/masuk/verifikasi   { nomorHp, kode, waOptin? }     → sesi cookie __Host- + token CSRF
//   POST /api/keluar                                              → cabut sesi (CSRF wajib bila ada sesi)
//   GET  /api/saya                                                → ringkasan akun minimal + token CSRF
//   POST /api/dev/otp-terakhir   { nomorHp }                     → HANYA WA_MODE=log & NODE_ENV dev/test
//
// KEAMANAN: body tidak pernah dicatat (bawaan Fastify; jangan tambahkan log body). Nomor HP & kode
// tidak masuk log/respons galat. Mutasi wajib `content-type: application/json` (form lintas situs
// tidak bisa mengirimnya tanpa preflight CORS) + cek Origin/Sec-Fetch-Site. Batas laju per IP memakai
// `req.ip`, yang hanya membaca X-Forwarded-For dari proxy di TRUST_PROXY (alamat/CIDR).
import { normalisasiNomorHp, PANJANG_MASUKAN_HP_MAKS, samarkanNomorHp } from "@nekat/shared";
import type { FastifyReply } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  type FastifyPluginCallbackZod,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { bacaCookie } from "../admin/http-util.js";
import { COOKIE_SESI_PEMBELI, GALAT_SESI, periksaSesiPembeli } from "./autentikasi.js";
import type { LayananMasuk } from "./layanan.js";

export interface OpsiRuteMasuk {
  readonly layanan: LayananMasuk | null;
  readonly originDiizinkan: readonly string[];
  /** Pembaca kode OTP terakhir (LogGateway). Hanya diisi bila WA_MODE=log dan NODE_ENV dev/test. */
  readonly kodeDev?: ((nomorE164: string) => string | null) | null;
}

/** Cookie sesi pembeli: HttpOnly + Secure + SameSite=Lax (link WhatsApp → halaman grup tetap masuk). */
export function cookieSesiPembeli(nilai: string, umurDetik: number): string {
  return `${COOKIE_SESI_PEMBELI}=${nilai}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(umurDetik)}`;
}

export function hapusCookieSesiPembeli(): string {
  return `${COOKIE_SESI_PEMBELI}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export const GALAT_MASUK = {
  BELUM_SIAP: GALAT_SESI.BELUM_SIAP,
  INPUT_HP: { kode: "NOMOR_HP_TIDAK_VALID", pesan: "Nomor HP belum benar. Contoh: 812 3456 7890." },
  INPUT_KODE: { kode: "KODE_TIDAK_VALID", pesan: "Kode terdiri dari 6 angka." },
  INPUT: { kode: "INPUT_TIDAK_VALID", pesan: "Isian belum benar. Periksa lagi." },
  TERLALU_CEPAT: {
    kode: "TERLALU_CEPAT",
    pesan: "Kode baru saja dikirim. Tunggu sebentar sebelum minta kode lagi.",
  },
  BATAS: { kode: "TERLALU_SERING", pesan: "Terlalu banyak percobaan. Coba lagi nanti." },
  TIDAK_TERKIRIM: {
    kode: "KODE_BELUM_TERKIRIM",
    pesan: "Kode belum bisa dikirim. Coba beberapa menit lagi.",
  },
  KODE_SALAH: { kode: "KODE_SALAH", pesan: "Kode salah." },
  TIDAK_BERLAKU: {
    kode: "KODE_TIDAK_BERLAKU",
    pesan: "Kode sudah tidak berlaku. Kirim kode baru.",
  },
  AKUN_TIDAK_AKTIF: {
    kode: "AKUN_TIDAK_AKTIF",
    pesan: "Nomor ini tidak bisa dipakai masuk. Hubungi CS NEKAT.",
  },
  JENIS_KONTEN: { kode: "JENIS_KONTEN", pesan: "Kirim data sebagai JSON." },
  ORIGIN: { kode: "ORIGIN_DITOLAK", pesan: "Permintaan dari situs lain ditolak." },
  CSRF: GALAT_SESI.CSRF,
  BELUM_MASUK: GALAT_SESI.BELUM_MASUK,
  INTERNAL: { kode: "GALAT_INTERNAL", pesan: "Terjadi gangguan. Coba lagi." },
} as const;

const skemaGalat = z.object({
  kode: z.string(),
  pesan: z.string(),
  tungguDetik: z.number().int().optional(),
  sisaPercobaan: z.number().int().optional(),
});

const nomorHp = z.string().max(PANJANG_MASUKAN_HP_MAKS);
const skemaMintaOtp = z.object({ nomorHp }).strict();
const skemaVerifikasi = z
  .object({
    nomorHp,
    kode: z.string().regex(/^[0-9]{6}$/),
    /** N-13: centang "Kirim info pesanan ke WhatsApp nomor ini" — bawaan TIDAK dicentang. */
    waOptin: z.boolean().default(false),
  })
  .strict();

const MUTASI = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BATAS_BODY = 1024;

function headerKeamanan(reply: FastifyReply): void {
  void reply.header("cache-control", "no-store");
  void reply.header("x-content-type-options", "nosniff");
  void reply.header("content-security-policy", "frame-ancestors 'none'");
  void reply.header("x-frame-options", "DENY");
  void reply.header("referrer-policy", "no-referrer");
}

export const ruteMasuk: FastifyPluginCallbackZod<OpsiRuteMasuk> = (r, opsi, selesai) => {
  const { layanan } = opsi;

  r.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const isian = new Set(err.validation.map((v) => v.instancePath.replace(/^\//, "")));
      if (isian.has("nomorHp")) return reply.code(400).send(GALAT_MASUK.INPUT_HP);
      if (isian.has("kode")) return reply.code(400).send(GALAT_MASUK.INPUT_KODE);
      return reply.code(400).send(GALAT_MASUK.INPUT);
    }
    const e = err as { statusCode?: number };
    if (e.statusCode === 415) return reply.code(415).send(GALAT_MASUK.JENIS_KONTEN);
    if (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send(GALAT_MASUK.INPUT);
    }
    req.log.error({ err }, "masuk: galat tak terduga");
    return reply.code(500).send(GALAT_MASUK.INTERNAL);
  });

  r.addHook("onRequest", async (req, reply) => {
    headerKeamanan(reply);
    if (!MUTASI.has(req.method)) return;
    // Wajib JSON (juga untuk body kosong): form HTML lintas situs tidak bisa memakai jenis ini.
    const jenis = req.headers["content-type"];
    if (jenis === undefined || !/^application\/json(\s*;|$)/i.test(jenis)) {
      return reply.code(415).send(GALAT_MASUK.JENIS_KONTEN);
    }
    if (req.headers["sec-fetch-site"] === "cross-site") {
      return reply.code(403).send(GALAT_MASUK.ORIGIN);
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let ok: boolean;
      if (opsi.originDiizinkan.length > 0) ok = opsi.originDiizinkan.includes(origin);
      else {
        try {
          ok = new URL(origin).host === req.headers.host;
        } catch {
          ok = false;
        }
      }
      if (!ok) return reply.code(403).send(GALAT_MASUK.ORIGIN);
    }
  });

  function siap(reply: FastifyReply): LayananMasuk | null {
    if (!layanan) void reply.code(503).send(GALAT_MASUK.BELUM_SIAP);
    return layanan;
  }

  function tunggu(reply: FastifyReply, detik: number): FastifyReply {
    return reply.header("retry-after", String(detik));
  }

  r.post(
    "/api/masuk/otp",
    {
      bodyLimit: BATAS_BODY,
      schema: {
        body: skemaMintaOtp,
        response: {
          200: z.object({ kedaluwarsaDetik: z.number().int(), kirimUlangDetik: z.number().int() }),
          400: skemaGalat,
          429: skemaGalat,
          503: skemaGalat,
        },
      },
    },
    async (req, reply) => {
      const l = siap(reply);
      if (!l) return reply;
      const nomor = normalisasiNomorHp(req.body.nomorHp);
      if (!nomor) return reply.code(400).send(GALAT_MASUK.INPUT_HP);
      const h = await l.mintaOtp(nomor, req.ip);
      if (h.ok) return { kedaluwarsaDetik: h.kedaluwarsaDetik, kirimUlangDetik: h.kirimUlangDetik };
      if (h.alasan === "TIDAK_TERKIRIM") return reply.code(503).send(GALAT_MASUK.TIDAK_TERKIRIM);
      const g = h.alasan === "TERLALU_CEPAT" ? GALAT_MASUK.TERLALU_CEPAT : GALAT_MASUK.BATAS;
      return tunggu(reply, h.tungguDetik)
        .code(429)
        .send({ ...g, tungguDetik: h.tungguDetik });
    },
  );

  r.post(
    "/api/masuk/verifikasi",
    {
      bodyLimit: BATAS_BODY,
      schema: {
        body: skemaVerifikasi,
        response: {
          200: z.object({ csrfToken: z.string(), sesiBerakhir: z.string() }),
          400: skemaGalat,
          401: skemaGalat,
          403: skemaGalat,
          429: skemaGalat,
          503: skemaGalat,
        },
      },
    },
    async (req, reply) => {
      const l = siap(reply);
      if (!l) return reply;
      const nomor = normalisasiNomorHp(req.body.nomorHp);
      if (!nomor) return reply.code(400).send(GALAT_MASUK.INPUT_HP);
      const h = await l.verifikasi({
        nomorE164: nomor,
        kode: req.body.kode,
        waOptin: req.body.waOptin,
        ip: req.ip,
        tokenLama: bacaCookie(req.headers.cookie, COOKIE_SESI_PEMBELI) ?? null,
      });
      if (h.ok) {
        void reply.header("set-cookie", cookieSesiPembeli(h.token, l.sesiHari * 86_400));
        return { csrfToken: l.csrf(h.token), sesiBerakhir: h.kedaluwarsaPada.toISOString() };
      }
      switch (h.alasan) {
        case "KODE_SALAH":
          return reply.code(401).send({
            ...GALAT_MASUK.KODE_SALAH,
            pesan:
              h.sisaPercobaan > 0
                ? `Kode salah. Sisa ${String(h.sisaPercobaan)} percobaan.`
                : "Kode salah dan sudah tidak berlaku. Kirim kode baru.",
            sisaPercobaan: h.sisaPercobaan,
          });
        case "TIDAK_BERLAKU":
          return reply.code(401).send(GALAT_MASUK.TIDAK_BERLAKU);
        case "AKUN_TIDAK_AKTIF":
          return reply.code(403).send(GALAT_MASUK.AKUN_TIDAK_AKTIF);
        case "BATAS":
          return tunggu(reply, h.tungguDetik)
            .code(429)
            .send({ ...GALAT_MASUK.BATAS, tungguDetik: h.tungguDetik });
      }
    },
  );

  r.post(
    "/api/keluar",
    { bodyLimit: BATAS_BODY, schema: { response: { 204: z.null(), 403: skemaGalat } } },
    async (req, reply) => {
      if (layanan && bacaCookie(req.headers.cookie, COOKIE_SESI_PEMBELI)) {
        const h = await periksaSesiPembeli(layanan, req);
        // Sesi hidup tanpa CSRF benar → tolak (cegah "logout paksa" lintas situs).
        if (h.status === "CSRF") return reply.code(403).send(GALAT_MASUK.CSRF);
        if (h.status === "OK") await layanan.keluar(h.token);
      }
      void reply.header("set-cookie", hapusCookieSesiPembeli());
      return reply.code(204).send(null);
    },
  );

  r.get(
    "/api/saya",
    {
      schema: {
        response: {
          200: z.object({
            akun: z.object({
              id: z.string(),
              nomorHpSamar: z.string(),
              jenisPelanggan: z.string(),
              status: z.string(),
            }),
            csrfToken: z.string(),
            sesiBerakhir: z.string(),
          }),
          401: skemaGalat,
          503: skemaGalat,
        },
      },
    },
    async (req, reply) => {
      const l = siap(reply);
      if (!l) return reply;
      const token = bacaCookie(req.headers.cookie, COOKIE_SESI_PEMBELI);
      const s = token ? await l.sesi(token) : null;
      const a = s ? await l.saya(s.akunId) : null;
      if (!token || !s || !a) {
        if (token) void reply.header("set-cookie", hapusCookieSesiPembeli());
        return reply.code(401).send(GALAT_MASUK.BELUM_MASUK);
      }
      return {
        akun: {
          id: a.id,
          nomorHpSamar: a.nomorHpE164 ? samarkanNomorHp(a.nomorHpE164) : "+62 ••••",
          jenisPelanggan: a.jenisPelanggan,
          status: a.status,
        },
        csrfToken: l.csrf(token),
        sesiBerakhir: s.kedaluwarsaPada.toISOString(),
      };
    },
  );

  // Halaman/endpoint dev (T-010 §3.2: "OTP terlihat di halaman dev HANYA di mode log"). Tidak
  // didaftarkan sama sekali di luar mode log + NODE_ENV development/test (server.ts).
  const kodeDev = opsi.kodeDev;
  if (kodeDev) {
    // POST + body (bukan query): URL tercatat di log permintaan, body tidak.
    r.post(
      "/api/dev/otp-terakhir",
      {
        bodyLimit: BATAS_BODY,
        schema: {
          body: skemaMintaOtp,
          response: { 200: z.object({ kode: z.string().nullable() }), 400: skemaGalat },
        },
      },
      (req, reply) => {
        const nomor = normalisasiNomorHp(req.body.nomorHp);
        if (!nomor) return reply.code(400).send(GALAT_MASUK.INPUT_HP);
        return { kode: kodeDev(nomor) };
      },
    );
  }

  selesai();
};
