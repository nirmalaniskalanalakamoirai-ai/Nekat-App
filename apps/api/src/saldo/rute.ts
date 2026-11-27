// Rute saldo pengguna (T-021, SAL.riwayat — docs/flow/pembayaran.md §12.1): saldo saat ini + riwayat.
//
// AUTENTIKASI: login pembeli baru ada di T-016. Sampai itu, `autentikasi` bawaan menolak SEMUA permintaan
// dengan 401 (hook onRequest, sebelum validasi & sebelum DB disentuh). T-016 cukup menyuntikkan fungsi yang
// mengembalikan `akunId` dari sesi. `akunId` TIDAK PERNAH dibaca dari query/body/header buatan klien,
// sehingga akun lain tidak bisa dibaca (tidak ada parameter akun sama sekali).
//
// KEAMANAN DTO: hanya label jenis, nominal, saldo sesudah, waktu, dan nomor tagihan milik akun sendiri.
// Alasan koreksi internal, id admin, kunci idempotensi, id referensi mentah tidak pernah dikirim.
import type { HalamanRiwayat, RepoSaldo } from "@nekat/db";
import { bacaCursorRiwayat, GalatSaldo } from "@nekat/domain";
import type { FastifyRequest } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  type FastifyPluginCallbackZod,
} from "fastify-type-provider-zod";
import { z } from "zod";

export const BATAS_RIWAYAT_BAWAAN = 20;
export const BATAS_RIWAYAT_RUTE_MAKS = 50;

/** Mengembalikan akun sesi, atau null bila tidak masuk. */
export type AutentikasiPembeli = (req: FastifyRequest) => Promise<{ akunId: string } | null>;

/** Bawaan sampai T-016: tidak ada sesi pembeli → selalu 401. */
export const tolakSemuaSampaiT016: AutentikasiPembeli = () => Promise.resolve(null);

export interface OpsiRuteSaldo {
  /** null = DB belum dikonfigurasi (503 setelah lolos autentikasi). */
  readonly repo: RepoSaldo | null;
  readonly autentikasi?: AutentikasiPembeli;
}

const GALAT = {
  BELUM_MASUK: { kode: "BELUM_MASUK", pesan: "Silakan masuk dulu untuk melihat Poin NEKAT." },
  INPUT_TIDAK_VALID: { kode: "INPUT_TIDAK_VALID", pesan: "Permintaan tidak valid." },
  BELUM_SIAP: { kode: "BELUM_SIAP", pesan: "Poin NEKAT belum bisa ditampilkan. Coba lagi nanti." },
  INTERNAL: { kode: "INTERNAL", pesan: "Terjadi kesalahan. Coba lagi nanti." },
} as const;

const skemaGalat = z.object({ kode: z.string(), pesan: z.string() });

const skemaQuery = z.object({
  cursor: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(20).optional()),
  batas: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().min(1).max(BATAS_RIWAYAT_RUTE_MAKS).default(BATAS_RIWAYAT_BAWAAN),
  ),
});

const rupiahBertanda = z.number().int().refine(Number.isSafeInteger);
const rupiahNonNeg = z.number().int().nonnegative().refine(Number.isSafeInteger);

export const skemaRiwayatSaldo = z.object({
  saldoRp: rupiahNonNeg,
  entri: z.array(
    z.object({
      id: z.string(),
      waktu: z.string(),
      jenisTampil: z.string(),
      jumlahRp: rupiahBertanda,
      saldoSesudahRp: rupiahNonNeg,
      referensiTampil: z.string().nullable(),
    }),
  ),
  cursorBerikut: z.string().nullable(),
});

function keDto(h: HalamanRiwayat): z.infer<typeof skemaRiwayatSaldo> {
  return {
    saldoRp: h.saldoRp,
    entri: h.entri.map((e) => ({
      id: String(e.id),
      waktu: e.waktu.toISOString(),
      jenisTampil: e.jenisTampil,
      jumlahRp: e.jumlahRp,
      saldoSesudahRp: e.saldoSesudahRp,
      referensiTampil: e.referensiTampil,
    })),
    cursorBerikut: h.cursorBerikut,
  };
}

declare module "fastify" {
  interface FastifyRequest {
    akunSesi?: { akunId: string };
  }
}

export const ruteSaldo: FastifyPluginCallbackZod<OpsiRuteSaldo> = (r, opsi, selesai) => {
  const autentikasi = opsi.autentikasi ?? tolakSemuaSampaiT016;

  r.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send(GALAT.INPUT_TIDAK_VALID);
    }
    req.log.error({ err }, "saldo: galat tak terduga");
    return reply.code(500).send(GALAT.INTERNAL);
  });

  // onRequest: sebelum parsing/validasi, jadi tanpa sesi tidak ada detail validasi yang bocor.
  r.addHook("onRequest", async (req, reply) => {
    const sesi = await autentikasi(req);
    if (!sesi) return reply.code(401).send(GALAT.BELUM_MASUK);
    req.akunSesi = sesi;
  });

  r.get(
    "/api/saldo",
    {
      schema: {
        querystring: skemaQuery,
        response: {
          200: skemaRiwayatSaldo,
          400: skemaGalat,
          401: skemaGalat,
          503: skemaGalat,
        },
      },
    },
    async (req, reply) => {
      const sesi = req.akunSesi;
      if (!sesi) return reply.code(401).send(GALAT.BELUM_MASUK);
      if (!opsi.repo) return reply.code(503).send(GALAT.BELUM_SIAP);
      let sebelumId: number | undefined;
      try {
        sebelumId = bacaCursorRiwayat(req.query.cursor);
      } catch (e) {
        if (e instanceof GalatSaldo) return reply.code(400).send(GALAT.INPUT_TIDAK_VALID);
        throw e;
      }
      const h = await opsi.repo.riwayat(sesi.akunId, {
        batas: req.query.batas,
        ...(sebelumId === undefined ? {} : { sebelumId }),
      });
      return keDto(h);
    },
  );

  selesai();
};
