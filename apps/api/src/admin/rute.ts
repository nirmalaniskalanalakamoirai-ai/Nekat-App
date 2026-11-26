// Rute API panel admin (T-036) di bawah /api/admin. RBAC per izin, CSRF untuk semua mutasi,
// cookie sesi HttpOnly+Secure+SameSite=Strict, batas laju, log_admin untuk setiap perubahan.
//
// KEAMANAN:
// - Respons tidak pernah memuat hash kata sandi, rahasia TOTP, kode pemulihan, ID sesi mentah di body.
// - Body tidak dicatat di log (Fastify bawaan); jangan tambahkan log body di sini.
// - Harga/modal/margin/MOQ/bebas_ppn tidak bisa diubah lewat rute ini (T-037).
import { GalatRepoAdmin, type RepoAdminKatalog, type SesiAdminAktif } from "@nekat/db";
import {
  cekProduk,
  IZIN,
  JENIS_SATUAN_JUAL_ADMIN,
  kategoriTerlarangAdmin,
  PESAN_GALAT_PRODUK,
  punyaIzin,
  tentukanIsiSatuan,
  type TinjauanKategoriProduk,
} from "@nekat/domain";
import type { NamaSumberInventory } from "@nekat/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  type FastifyPluginCallbackZod,
} from "fastify-type-provider-zod";
import { z } from "zod";
import {
  bacaCookie,
  BatasLaju,
  COOKIE_PRA,
  COOKIE_SESI,
  cookieSesi,
  hapusCookie,
  PRA_MENIT,
} from "./http-util.js";
import { samaConstantTime } from "./kripto.js";
import type { LayananAuthAdmin } from "./layanan-auth.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Izin wajib (`<domain>.<aksi>`). Tanpa nilai = cukup sesi admin penuh. */
    izinAdmin?: string;
    /** Rute masuk: tanpa sesi penuh. */
    publikAdmin?: boolean;
  }
  interface FastifyRequest {
    adminSesi: (SesiAdminAktif & { token: string }) | null;
  }
}

export interface OpsiRuteAdmin {
  readonly auth: LayananAuthAdmin | null;
  readonly katalog: RepoAdminKatalog | null;
  readonly sumberInventori: NamaSumberInventory;
  readonly originDiizinkan: readonly string[];
  /** Batas laju (untuk tes). */
  readonly batasMasukPerMenit?: number;
  readonly batasUmumPerMenit?: number;
}

const GALAT = {
  BELUM_SIAP: { kode: "ADMIN_BELUM_SIAP", pesan: "Panel admin belum dikonfigurasi di server ini." },
  MASUK_GAGAL: {
    kode: "MASUK_GAGAL",
    pesan:
      "Nomor HP, kata sandi, atau kode salah, atau akun sementara dikunci karena terlalu banyak percobaan.",
  },
  SESI_PRA_HABIS: {
    kode: "SESI_PRA_HABIS",
    pesan: "Waktu memasukkan kode habis. Masuk lagi dengan kata sandi.",
  },
  PERLU_MASUK: { kode: "PERLU_MASUK", pesan: "Sesi berakhir. Silakan masuk lagi." },
  CSRF: {
    kode: "CSRF_TIDAK_VALID",
    pesan: "Permintaan ditolak. Muat ulang halaman lalu coba lagi.",
  },
  ORIGIN: { kode: "ORIGIN_DITOLAK", pesan: "Permintaan dari situs lain ditolak." },
  TANPA_IZIN: { kode: "TANPA_IZIN", pesan: "Peranmu tidak punya akses ke menu ini." },
  TERLALU_SERING: {
    kode: "TERLALU_SERING",
    pesan: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  },
  JENIS_KONTEN: { kode: "JENIS_KONTEN", pesan: "Kirim data sebagai JSON." },
  INPUT: { kode: "INPUT_TIDAK_VALID", pesan: "Isian tidak valid. Periksa kembali formulir." },
  STOK_HANYA_BACA: {
    kode: "STOK_HANYA_BACA",
    pesan: "Stok diambil dari Gudang (INVENTORY_SOURCE=gudang) dan hanya bisa dilihat di sini.",
  },
  HANYA_LOKAL: {
    kode: "HANYA_MODE_LOKAL",
    pesan: "Status aktif SKU diatur Gudang saat sumber stok = Gudang.",
  },
  INTERNAL: { kode: "GALAT_INTERNAL", pesan: "Terjadi kesalahan. Coba lagi." },
} as const;

const skemaGalat = z.object({
  kode: z.string(),
  pesan: z.string(),
  isian: z.array(z.string()).optional(),
});

const MUTASI = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ---------- Skema input ----------

const uuid = z.uuid();
const teksOpsional = (maks: number) =>
  z
    .string()
    .trim()
    .max(maks)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const alasan = z.string().trim().max(500).optional();
const urlGambar = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "Gambar wajib URL https://")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const skemaMasuk = z.object({
  nomorHp: z.string().regex(/^\+62[0-9]{8,13}$/),
  kataSandi: z.string().min(1).max(256),
});
const skemaFaktorKedua = z.union([
  z.object({ kode: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ kodePemulihan: z.string().trim().min(12).max(20) }).strict(),
]);

const skemaProdukBaru = z
  .object({
    kategoriId: uuid,
    nama: z.string().trim().min(1).max(200),
    deskripsi: teksOpsional(2000),
    gambarUrl: urlGambar,
    aktif: z.boolean().default(true),
    alasan,
  })
  .strict();
const skemaProdukUbah = z
  .object({
    kategoriId: uuid.optional(),
    nama: z.string().trim().min(1).max(200).optional(),
    deskripsi: teksOpsional(2000),
    gambarUrl: urlGambar,
    aktif: z.boolean().optional(),
    alasan,
  })
  .strict();

const kodeSku = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((v) => v.toUpperCase());
const barcode = z
  .string()
  .trim()
  .regex(/^(\d{8,14})?$/)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const skemaSkuBaru = z
  .object({
    kodeSku,
    barcode,
    namaVarian: teksOpsional(100),
    satuanDasar: z.enum(["pcs", "gram", "ml"]),
    aktif: z.boolean().default(true),
    alasan,
  })
  .strict();
const skemaSkuUbah = z
  .object({
    kodeSku: kodeSku.optional(),
    barcode,
    namaVarian: teksOpsional(100),
    aktif: z.boolean().optional(),
    alasan,
  })
  .strict();

const berat = z.number().int().min(0).max(1_000_000);
const skemaSatuanBaru = z
  .object({
    jenis: z.enum(JENIS_SATUAN_JUAL_ADMIN),
    isiSatuanDasar: z.number().int().positive().optional(),
    beratGram: berat,
    alasan,
  })
  .strict();
const skemaSatuanUbah = z
  .object({
    isiSatuanDasar: z.number().int().positive().optional(),
    beratGram: berat.optional(),
    alasan,
  })
  .strict();

const skemaStok = z
  .object({
    skuId: uuid,
    gudangId: uuid,
    tersedia: z.number().int().min(0).max(1_000_000_000_000),
    alasan: z.string().trim().min(3).max(500),
  })
  .strict();

const halamanQuery = {
  halaman: z.coerce.number().int().min(1).max(10_000).default(1),
  perHalaman: z.coerce.number().int().min(1).max(100).default(25),
};
const cariQuery = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

/** Isian kosong (`deskripsi: ""`) → null; undefined → field tidak diubah. */
function tanpaUndefined<T extends Record<string, unknown>>(
  o: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

export const ruteAdmin: FastifyPluginCallbackZod<OpsiRuteAdmin> = (r, opsi, selesai) => {
  const { auth, katalog } = opsi;
  const batasMasuk = new BatasLaju({ maks: opsi.batasMasukPerMenit ?? 10, jendelaMs: 60_000 });
  const batasUmum = new BatasLaju({ maks: opsi.batasUmumPerMenit ?? 300, jendelaMs: 60_000 });

  r.decorateRequest("adminSesi", null);

  r.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const isian = [
        ...new Set(err.validation.map((v) => v.instancePath.replace(/^\//, "") || "body")),
      ];
      return reply.code(400).send({ ...GALAT.INPUT, isian });
    }
    if (err instanceof GalatRepoAdmin) {
      const status = err.kode === "TIDAK_ADA" ? 404 : err.kode === "DUPLIKAT" ? 409 : 422;
      return reply.code(status).send({ kode: err.kode, pesan: err.alasan });
    }
    const e = err as { statusCode?: number };
    if (e.statusCode === 415) return reply.code(415).send(GALAT.JENIS_KONTEN);
    if (e.statusCode === 400) return reply.code(400).send(GALAT.INPUT);
    req.log.error({ err }, "admin: galat tak terduga");
    return reply.code(500).send(GALAT.INTERNAL);
  });

  // Lapis 1: header keamanan, batas laju umum, jenis konten, origin.
  r.addHook("onRequest", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    void reply.header("x-content-type-options", "nosniff");
    if (!batasUmum.ambil(req.ip)) {
      void reply.header("retry-after", String(batasUmum.sisaDetik(req.ip)));
      return reply.code(429).send(GALAT.TERLALU_SERING);
    }
    if (!MUTASI.has(req.method)) return;
    const jenis = req.headers["content-type"];
    if (jenis !== undefined && !/^application\/json(\s*;|$)/i.test(jenis)) {
      return reply.code(415).send(GALAT.JENIS_KONTEN);
    }
    if (req.headers["sec-fetch-site"] === "cross-site") return reply.code(403).send(GALAT.ORIGIN);
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const ok =
        opsi.originDiizinkan.length > 0
          ? opsi.originDiizinkan.includes(origin)
          : (() => {
              try {
                return new URL(origin).host === req.headers.host;
              } catch {
                return false;
              }
            })();
      if (!ok) return reply.code(403).send(GALAT.ORIGIN);
    }
  });

  // Lapis 2: sesi, CSRF, izin.
  r.addHook("preHandler", async (req, reply) => {
    if (!auth || !katalog) return reply.code(503).send(GALAT.BELUM_SIAP);
    if (req.routeOptions.config.publikAdmin) return;
    const token = bacaCookie(req.headers.cookie, COOKIE_SESI);
    const s = token ? await auth.sesi(token) : null;
    if (!token || !s) {
      void reply.header("set-cookie", hapusCookie(COOKIE_SESI));
      return reply.code(401).send(GALAT.PERLU_MASUK);
    }
    if (MUTASI.has(req.method)) {
      const kiriman = req.headers["x-csrf-token"];
      if (typeof kiriman !== "string" || !samaConstantTime(kiriman, auth.csrf(token))) {
        return reply.code(403).send(GALAT.CSRF);
      }
    }
    const izin = req.routeOptions.config.izinAdmin;
    if (izin !== undefined && !punyaIzin(new Set(s.izin), izin)) {
      return reply.code(403).send(GALAT.TANPA_IZIN);
    }
    req.adminSesi = { ...s, token };
  });

  /** Dipanggil setelah preHandler: sesi pasti ada. */
  function sesiDari(req: FastifyRequest): SesiAdminAktif & { token: string } {
    if (!req.adminSesi) throw new Error("adminSesi kosong setelah preHandler");
    return req.adminSesi;
  }
  function wajib<T>(v: T | null): T {
    if (v === null) throw new Error("dependensi admin kosong setelah preHandler");
    return v;
  }
  function konteks(req: FastifyRequest, izinKode: string, alasanTeks?: string) {
    const s = sesiDari(req);
    return {
      adminId: s.adminId,
      izinKode,
      ipHmac: wajib(auth).ipHmac(req.ip),
      alasan: alasanTeks && alasanTeks.length > 0 ? alasanTeks : null,
    };
  }
  function batasMasukLewat(req: FastifyRequest, reply: FastifyReply): boolean {
    if (batasMasuk.ambil(req.ip)) return false;
    void reply.header("retry-after", String(batasMasuk.sisaDetik(req.ip)));
    void reply.code(429).send(GALAT.TERLALU_SERING);
    return true;
  }

  // ---------- Masuk / keluar ----------

  r.post(
    "/masuk",
    {
      config: { publikAdmin: true },
      schema: {
        body: skemaMasuk,
        response: {
          200: z.object({ langkah: z.literal("TOTP"), csrfToken: z.string() }),
          401: skemaGalat,
          429: skemaGalat,
        },
      },
    },
    async (req, reply) => {
      if (batasMasukLewat(req, reply)) return reply;
      const a = wajib(auth);
      const h = await a.masukKataSandi(req.body.nomorHp, req.body.kataSandi, a.ipHmac(req.ip));
      if (!h.ok) return reply.code(401).send(GALAT.MASUK_GAGAL);
      void reply.header("set-cookie", cookieSesi(COOKIE_PRA, h.token, PRA_MENIT * 60));
      return { langkah: "TOTP" as const, csrfToken: a.csrf(h.token) };
    },
  );

  r.post(
    "/masuk/totp",
    {
      config: { publikAdmin: true },
      schema: {
        body: skemaFaktorKedua,
        response: {
          200: z.object({ csrfToken: z.string(), sesiBerakhir: z.string() }),
          401: skemaGalat,
          403: skemaGalat,
          429: skemaGalat,
        },
      },
    },
    async (req, reply) => {
      if (batasMasukLewat(req, reply)) return reply;
      const a = wajib(auth);
      const pra = bacaCookie(req.headers.cookie, COOKIE_PRA);
      if (!pra || !(await a.adaSesiPra(pra))) {
        void reply.header("set-cookie", hapusCookie(COOKIE_PRA));
        return reply.code(401).send(GALAT.SESI_PRA_HABIS);
      }
      const kiriman = req.headers["x-csrf-token"];
      if (typeof kiriman !== "string" || !samaConstantTime(kiriman, a.csrf(pra))) {
        return reply.code(403).send(GALAT.CSRF);
      }
      const h = await a.masukFaktorKedua(pra, req.body, a.ipHmac(req.ip));
      if (!h.ok) return reply.code(401).send(GALAT.MASUK_GAGAL);
      void reply.header("set-cookie", [
        hapusCookie(COOKIE_PRA),
        cookieSesi(COOKIE_SESI, h.token, a.sesiMenit * 60),
      ]);
      return { csrfToken: a.csrf(h.token), sesiBerakhir: h.kedaluwarsaPada.toISOString() };
    },
  );

  r.post("/keluar", { schema: { response: { 204: z.null() } } }, async (req, reply) => {
    const s = sesiDari(req);
    await wajib(auth).keluar(s.token, s.adminId);
    void reply.header("set-cookie", hapusCookie(COOKIE_SESI));
    return reply.code(204).send(null);
  });

  r.get(
    "/saya",
    {
      schema: {
        response: {
          200: z.object({
            admin: z.object({
              id: z.string(),
              nama: z.string(),
              peran: z.array(z.string()),
              izin: z.array(z.string()),
            }),
            csrfToken: z.string(),
            sesiBerakhir: z.string(),
            sumberInventori: z.enum(["local", "gudang"]),
          }),
        },
      },
    },
    (req) => {
      const s = sesiDari(req);
      return {
        admin: { id: s.adminId, nama: s.nama, peran: [...s.peran], izin: [...s.izin] },
        csrfToken: wajib(auth).csrf(s.token),
        sesiBerakhir: s.kedaluwarsaPada.toISOString(),
        sumberInventori: opsi.sumberInventori,
      };
    },
  );

  // ---------- Katalog: kategori, produk, SKU, satuan jual ----------

  const P = IZIN.PRODUK_UBAH;

  r.get("/kategori", { config: { izinAdmin: P } }, async () => {
    const daftar = await wajib(katalog).daftarKategori();
    return {
      kategori: daftar.map((k) => ({
        id: k.id,
        kode: k.kode,
        nama: k.nama,
        aktif: k.aktif,
        indukId: k.indukId,
        indukNama: k.induk?.nama ?? null,
        terlarang:
          kategoriTerlarangAdmin(k.kode) ||
          (k.induk ? kategoriTerlarangAdmin(k.induk.kode) : false),
      })),
    };
  });

  r.get(
    "/produk",
    {
      config: { izinAdmin: P },
      schema: { querystring: z.object({ cari: cariQuery, ...halamanQuery }) },
    },
    async (req) => {
      const h = await wajib(katalog).daftarProduk(req.query);
      return { produk: h.isi, total: h.total, halaman: req.query.halaman };
    },
  );

  r.get(
    "/produk/:id",
    { config: { izinAdmin: P }, schema: { params: z.object({ id: uuid }) } },
    async (req, reply) => {
      const p = await wajib(katalog).ambilProduk(req.params.id);
      if (!p) return reply.code(404).send({ kode: "TIDAK_ADA", pesan: "Produk tidak ditemukan." });
      return p;
    },
  );

  function cekKeRepo(hasil: ReturnType<typeof cekProduk>) {
    if (!hasil.ok) return { ok: false as const, alasan: PESAN_GALAT_PRODUK[hasil.galat] };
    return {
      ok: true as const,
      tinjauanKategori: hasil.tinjauanKategori,
      kataMencurigakan: hasil.kataMencurigakan,
    };
  }

  r.post(
    "/produk",
    { config: { izinAdmin: P }, schema: { body: skemaProdukBaru } },
    async (req, reply) => {
      const { alasan: a, ...b } = req.body;
      const data = {
        kategoriId: b.kategoriId,
        nama: b.nama,
        deskripsi: b.deskripsi ?? null,
        gambarUrl: b.gambarUrl ?? null,
        aktif: b.aktif,
      };
      const id = await wajib(katalog).buatProduk(
        data,
        (k) =>
          cekKeRepo(
            cekProduk({
              nama: data.nama,
              kategori: k && {
                id: k.id,
                kode: k.kode,
                aktif: k.aktif,
                induk: k.induk && { kode: k.induk.kode, aktif: k.induk.aktif },
              },
            }),
          ),
        konteks(req, P, a),
      );
      return reply.code(201).send({ id });
    },
  );

  r.patch(
    "/produk/:id",
    { config: { izinAdmin: P }, schema: { params: z.object({ id: uuid }), body: skemaProdukUbah } },
    async (req, reply) => {
      const { alasan: a, ...b } = req.body;
      await wajib(katalog).ubahProduk(
        req.params.id,
        tanpaUndefined(b),
        (k, sebelum, namaBaru) =>
          cekKeRepo(
            cekProduk({
              nama: namaBaru,
              kategori: k && {
                id: k.id,
                kode: k.kode,
                aktif: k.aktif,
                induk: k.induk && { kode: k.induk.kode, aktif: k.induk.aktif },
              },
              sebelum: {
                nama: sebelum.nama,
                tinjauanKategori: sebelum.tinjauanKategori as TinjauanKategoriProduk,
              },
            }),
          ),
        konteks(req, P, a),
      );
      return reply.code(204).send();
    },
  );

  r.post(
    "/produk/:id/sku",
    { config: { izinAdmin: P }, schema: { params: z.object({ id: uuid }), body: skemaSkuBaru } },
    async (req, reply) => {
      const { alasan: a, aktif, ...b } = req.body;
      if (!aktif && opsi.sumberInventori !== "local") {
        return reply.code(409).send(GALAT.HANYA_LOKAL);
      }
      const id = await wajib(katalog).buatSku(
        req.params.id,
        {
          kodeSku: b.kodeSku,
          barcode: b.barcode ?? null,
          namaVarian: b.namaVarian ?? null,
          satuanDasar: b.satuanDasar,
          aktifDiSumber: aktif,
        },
        konteks(req, P, a),
      );
      return reply.code(201).send({ id });
    },
  );

  r.patch(
    "/sku/:id",
    { config: { izinAdmin: P }, schema: { params: z.object({ id: uuid }), body: skemaSkuUbah } },
    async (req, reply) => {
      const { alasan: a, aktif, ...b } = req.body;
      if (aktif !== undefined && opsi.sumberInventori !== "local") {
        return reply.code(409).send(GALAT.HANYA_LOKAL);
      }
      await wajib(katalog).ubahSku(
        req.params.id,
        tanpaUndefined({ ...b, aktifDiSumber: aktif }),
        konteks(req, P, a),
      );
      return reply.code(204).send();
    },
  );

  r.post(
    "/sku/:id/satuan",
    {
      config: { izinAdmin: P },
      schema: { params: z.object({ id: uuid }), body: skemaSatuanBaru },
    },
    async (req, reply) => {
      const isi = tentukanIsiSatuan(req.body.jenis, req.body.isiSatuanDasar);
      if (!isi.ok) return reply.code(422).send({ kode: "DITOLAK", pesan: isi.pesan });
      const id = await wajib(katalog).buatSatuan(
        req.params.id,
        { jenis: req.body.jenis, isiSatuanDasar: isi.isi, beratGram: req.body.beratGram },
        konteks(req, P, req.body.alasan),
      );
      return reply.code(201).send({ id });
    },
  );

  r.patch(
    "/satuan/:id",
    {
      config: { izinAdmin: P },
      schema: { params: z.object({ id: uuid }), body: skemaSatuanUbah },
    },
    async (req, reply) => {
      const b = req.body;
      await wajib(katalog).ubahSatuan(
        req.params.id,
        (lama) => {
          const jenis = JENIS_SATUAN_JUAL_ADMIN.find((j) => j === lama.jenis);
          if (!jenis) return { ok: false, alasan: "Jenis satuan jual tidak dikenal." };
          const isi = tentukanIsiSatuan(jenis, b.isiSatuanDasar ?? lama.isiSatuanDasar);
          if (!isi.ok) return { ok: false, alasan: isi.pesan };
          return { ok: true, isiSatuanDasar: isi.isi, beratGram: b.beratGram ?? lama.beratGram };
        },
        konteks(req, P, b.alasan),
      );
      return reply.code(204).send();
    },
  );

  // ---------- Stok ----------

  const S = IZIN.STOK_UBAH;

  r.get("/gudang", { config: { izinAdmin: S } }, async () => ({
    gudang: await wajib(katalog).daftarGudang(),
  }));

  r.get(
    "/stok",
    {
      config: { izinAdmin: S },
      schema: { querystring: z.object({ gudangId: uuid, cari: cariQuery, ...halamanQuery }) },
    },
    async (req) => {
      const h = await wajib(katalog).daftarStok(req.query);
      return {
        sumber: opsi.sumberInventori,
        dapatDiubah: opsi.sumberInventori === "local",
        stok: h.isi,
        total: h.total,
        halaman: req.query.halaman,
      };
    },
  );

  r.put("/stok", { config: { izinAdmin: S }, schema: { body: skemaStok } }, async (req, reply) => {
    if (opsi.sumberInventori !== "local") return reply.code(409).send(GALAT.STOK_HANYA_BACA);
    const b = req.body;
    await wajib(katalog).aturStok(b.skuId, b.gudangId, b.tersedia, konteks(req, S, b.alasan));
    return reply.code(204).send();
  });

  // ---------- Log perubahan ----------
  // Semua admin bersesi penuh boleh membaca (izin baca khusus menunggu keputusan, lihat laporan).

  r.get(
    "/log",
    {
      schema: {
        querystring: z.object({
          entitasJenis: z.enum(["produk", "sku", "satuan_jual", "stok_lokasi"]).optional(),
          entitasId: z.string().max(80).optional(),
          sebelumId: z.coerce.number().int().positive().optional(),
          batas: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const log = await wajib(katalog).daftarLog(req.query);
      const terakhir = log.at(-1);
      return {
        log,
        berikutnya: log.length === req.query.batas && terakhir ? terakhir.id : null,
      };
    },
  );

  selesai();
};
