// Rute tagihan & pembayaran pembeli (T-029, docs/flow/pembayaran.md §5.1, H-10):
//   POST /api/tagihan/:id/bayar        { metode: QRIS|VA, kanal? } → instruksi bayar (idempoten, §4.2)
//   GET  /api/tagihan/:id/pembayaran   → status tagihan + pembayaran terbaru (dipolling FE)
// Nominal selalu dari server; klien tidak pernah mengirim nominal/akun (§3.1). Tagihan akun lain → 404.
// Respons memuat QR string / nomor VA → `Cache-Control: no-store`; tidak ada log body (Fastify tidak
// mencatat body; jangan tambahkan). GET tidak memanggil Xendit (status lunas datang dari T-030).
import type {
  JenisHasilBayar,
  LayananBayar,
  PembayaranTersimpan,
  RepoPembayaran,
  TagihanUntukBayar,
} from "@nekat/domain";
import { GalatBayar } from "@nekat/domain";
import {
  permintaanBayarSchema,
  tagihanBayarSchema,
  type PembayaranTampil,
  type TagihanBayar,
} from "@nekat/shared";
import type { FastifyReply } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  type FastifyPluginCallbackZod,
} from "fastify-type-provider-zod";
import { z } from "zod";
import {
  GALAT_BELUM_MASUK,
  hookAutentikasi,
  tolakSemuaSampaiT016,
  type AutentikasiPembeli,
} from "../pembeli/autentikasi.js";

export interface OpsiRuteTagihan {
  /** null = DB/gateway belum dikonfigurasi (503 setelah lolos autentikasi). */
  readonly layanan: LayananBayar | null;
  readonly repoBaca: Pick<RepoPembayaran, "baca"> | null;
  readonly autentikasi?: AutentikasiPembeli;
  readonly jam?: () => Date;
}

const skemaGalat = z.object({ kode: z.string(), pesan: z.string() });
const skemaParam = z.object({ id: z.uuid() });

const GALAT = {
  INPUT_TIDAK_VALID: { kode: "INPUT_TIDAK_VALID", pesan: "Permintaan tidak valid." },
  BELUM_SIAP: {
    kode: "PEMBAYARAN_GANGGUAN",
    pesan: "Pembayaran sedang gangguan. Coba lagi beberapa menit.",
  },
  TIDAK_DITEMUKAN: { kode: "TAGIHAN_TIDAK_DITEMUKAN", pesan: "Tagihan tidak ditemukan." },
  INTERNAL: { kode: "INTERNAL", pesan: "Terjadi kesalahan. Coba lagi nanti." },
} as const;

const STATUS_GALAT: Record<GalatBayar["kode"], 404 | 409 | 422 | 503> = {
  TAGIHAN_TIDAK_DITEMUKAN: 404,
  TAGIHAN_TIDAK_AKTIF: 409,
  TAGIHAN_KEDALUWARSA: 409,
  SUDAH_LUNAS: 409,
  METODE_TIDAK_DIIZINKAN: 422,
  KANAL_TIDAK_VALID: 422,
  GATEWAY_TIDAK_AKTIF: 503,
};

function kePembayaranTampil(p: PembayaranTersimpan): PembayaranTampil {
  // Instruksi hanya untuk pembayaran yang masih bisa dibayar (kurangi paparan QR/VA lama).
  const instruksi = p.status === "MENUNGGU" ? p.instruksi : null;
  return {
    id: p.id,
    metode: p.metode,
    kanal: p.kanal,
    jumlahRp: p.jumlahRp,
    status: p.status,
    tahap:
      p.status === "MENUNGGU" && (p.instruksi === null || p.xenditRef === null)
        ? "MENYIAPKAN"
        : "SIAP",
    instruksi,
    kedaluwarsaPada: p.kedaluwarsaPada.toISOString(),
    alasanGagal: p.alasanGagal,
  };
}

export const ruteTagihan: FastifyPluginCallbackZod<OpsiRuteTagihan> = (r, opsi, selesai) => {
  const jam = opsi.jam ?? (() => new Date());

  const keDto = (
    tagihan: TagihanUntukBayar,
    p: PembayaranTersimpan | null,
    hasil: JenisHasilBayar | null,
  ): TagihanBayar => {
    const gw = opsi.layanan?.gateway ?? null;
    const terbuka = tagihan.status === "DITERBITKAN" && gw !== null;
    return {
      tagihan: {
        id: tagihan.id,
        nomor: tagihan.nomor,
        status: tagihan.status,
        totalRp: tagihan.totalRp,
        saldoDipakaiRp: tagihan.saldoDipakaiRp,
        sisaBayarRp: tagihan.sisaBayarRp,
        kedaluwarsaPada: tagihan.kedaluwarsaPada.toISOString(),
        gabungan: tagihan.gabungan,
      },
      pembayaran: p ? kePembayaranTampil(p) : null,
      metodeTersedia: terbuka
        ? [
            { metode: "QRIS" as const, kanal: [] },
            { metode: "VA" as const, kanal: [...gw.kanalVa] },
          ]
        : [],
      waktuServer: jam().toISOString(),
      hasil,
    };
  };

  r.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send(GALAT.INPUT_TIDAK_VALID);
    }
    if (err instanceof GalatBayar) {
      return reply.code(STATUS_GALAT[err.kode]).send({ kode: err.kode, pesan: err.message });
    }
    // Objek galat bisa memuat isi query (instruksi); catat nama & pesan saja.
    req.log.error(
      { galat: err instanceof Error ? err.name : "unknown" },
      "tagihan: galat tak terduga",
    );
    return reply.code(500).send(GALAT.INTERNAL);
  });

  r.addHook("onRequest", hookAutentikasi(opsi.autentikasi ?? tolakSemuaSampaiT016));
  r.addHook("onSend", async (_req, reply: FastifyReply) => {
    void reply.header("cache-control", "no-store");
  });

  const respons = {
    200: tagihanBayarSchema,
    400: skemaGalat,
    401: skemaGalat,
    404: skemaGalat,
    409: skemaGalat,
    422: skemaGalat,
    503: skemaGalat,
  };

  r.post(
    "/api/tagihan/:id/bayar",
    { schema: { params: skemaParam, body: permintaanBayarSchema, response: respons } },
    async (req, reply) => {
      const sesi = req.akunSesi;
      if (!sesi) return reply.code(401).send(GALAT_BELUM_MASUK);
      if (!opsi.layanan) return reply.code(503).send(GALAT.BELUM_SIAP);
      const h = await opsi.layanan.mulaiBayar({
        invoiceId: req.params.id,
        akunId: sesi.akunId,
        metode: req.body.metode,
        kanal: req.body.kanal ?? null,
      });
      return keDto(h.tagihan, h.pembayaran, h.hasil);
    },
  );

  r.get(
    "/api/tagihan/:id/pembayaran",
    { schema: { params: skemaParam, response: respons } },
    async (req, reply) => {
      const sesi = req.akunSesi;
      if (!sesi) return reply.code(401).send(GALAT_BELUM_MASUK);
      if (!opsi.repoBaca) return reply.code(503).send(GALAT.BELUM_SIAP);
      const d = await opsi.repoBaca.baca(req.params.id, sesi.akunId);
      if (!d) return reply.code(404).send(GALAT.TIDAK_DITEMUKAN);
      return keDto(d.tagihan, d.pembayaran, null);
    },
  );

  selesai();
};
