import Fastify, { type FastifyServerOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { tentukanZona } from "@nekat/domain";
import { ruteAdmin, type OpsiRuteAdmin } from "./admin/rute.js";
import type { LayananKatalog } from "./katalog/layanan.js";
import { ruteKatalog } from "./katalog/rute.js";
import { ruteSaldo, type OpsiRuteSaldo } from "./saldo/rute.js";
import { keZonaLayanan, type KonfigLokasi } from "./lokasi.js";
import { ruteTagihan, type OpsiRuteTagihan } from "./tagihan/rute.js";

/** Header yang tidak boleh pernah muncul di log (ADR-0001 §7). PII di body ditambah per rute. */
export const REDAKSI_LOG = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-callback-token']",
  'res.headers["set-cookie"]',
  // Juga saat kode mencatat `{ headers: request.headers }` langsung (temuan QA 12 Nov).
  "headers.authorization",
  "headers.cookie",
  "headers['x-callback-token']",
  'headers["set-cookie"]',
];

const skemaHealth = z.object({ status: z.literal("ok") });

export interface OpsiApp {
  /** `false` di tes agar output bersih; default logger JSON pino dengan redaksi. */
  readonly logger?: boolean;
  /** Tujuan log (hanya untuk tes redaksi). Default: stdout. */
  readonly logStream?: NodeJS.WritableStream;
  /** Isi config/lokasi.json; null/undefined = zona belum diatur (rute zona menjawab 503). */
  readonly lokasi?: KonfigLokasi | null;
  /** Katalog (T-025); null/undefined = DB belum dikonfigurasi (rute katalog menjawab 503). */
  readonly katalog?: LayananKatalog | null;
  /** Panel admin (T-036); null/undefined = belum dikonfigurasi (rute /api/admin menjawab 503). */
  readonly admin?: OpsiRuteAdmin | null;
  /**
   * Alamat/CIDR reverse proxy tepercaya (mis. ["127.0.0.1"]). X-Forwarded-For hanya dipakai bila
   * koneksi datang dari alamat ini. Kosong = XFF diabaikan (req.ip = alamat koneksi).
   */
  readonly trustProxy?: readonly string[];
  /**
   * Tagihan & pembayaran Xendit (T-029). Tanpa `autentikasi` (T-016 belum ada) rute selalu 401.
   * Tanpa layanan/repo: 503 setelah lolos autentikasi.
   */
  readonly tagihan?: OpsiRuteTagihan | null;
  /**
   * Saldo pengguna (T-021). Tanpa `autentikasi` (T-016 belum ada) rute selalu menjawab 401.
   * Tanpa repo: 503 setelah lolos autentikasi.
   */
  readonly saldo?: OpsiRuteSaldo | null;
}

const skemaGalat = z.object({ kode: z.string(), pesan: z.string() });

const skemaDaftarZona = z.object({
  zona: z.array(
    z.object({
      kode: z.string(),
      namaKelurahan: z.string(),
      dropPoint: z.array(
        z.object({
          kode: z.string(),
          nama: z.string(),
          alamatPublik: z.string().nullable(),
          jamAmbil: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const skemaCekZona = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const skemaHasilZona = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("DALAM_ZONA"),
    zonaKode: z.string(),
    namaKelurahan: z.string(),
    dropPointKode: z.string(),
    dropPointNama: z.string(),
    jarakMeter: z.number(),
  }),
  z.object({ status: z.literal("DI_LUAR_ZONA") }),
]);

const GALAT_ZONA_BELUM_DIATUR = {
  kode: "ZONA_BELUM_DIATUR",
  pesan: "Zona layanan belum diatur. Hubungi admin NEKAT.",
} as const;

export function buatApp(opsi: OpsiApp = {}) {
  const logger: FastifyServerOptions["logger"] =
    opsi.logger === false
      ? false
      : {
          redact: { paths: REDAKSI_LOG, censor: "[disensor]" },
          ...(opsi.logStream ? { stream: opsi.logStream } : {}),
        };

  const app = Fastify({
    logger,
    ...(opsi.trustProxy && opsi.trustProxy.length > 0 ? { trustProxy: [...opsi.trustProxy] } : {}),
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Liveness saja. `/ready` (cek DB) menyusul setelah T-013.
  app.get("/health", { schema: { response: { 200: skemaHealth } } }, () => ({
    status: "ok" as const,
  }));

  // H-01 Pilih zona (T-015). Koordinat pembeli tidak disimpan dan tidak dicatat di log
  // (Fastify tidak mencatat body; jangan tambahkan log body di rute ini).
  const lokasi = opsi.lokasi ?? null;
  const daftarZona = lokasi ? keZonaLayanan(lokasi) : [];

  app.get(
    "/api/zona",
    { schema: { response: { 200: skemaDaftarZona, 503: skemaGalat } } },
    (_req, reply) => {
      if (!lokasi) {
        void reply.code(503).send(GALAT_ZONA_BELUM_DIATUR);
        return;
      }
      return {
        zona: lokasi.zona.map((z) => ({
          kode: z.kode,
          namaKelurahan: z.namaKelurahan,
          dropPoint: z.dropPoint.map((d) => ({
            kode: d.kode,
            nama: d.nama,
            alamatPublik: d.alamatPublik ?? null,
            jamAmbil: d.jamAmbil ?? null,
          })),
        })),
      };
    },
  );

  app.post(
    "/api/zona/cek",
    { schema: { body: skemaCekZona, response: { 200: skemaHasilZona, 503: skemaGalat } } },
    (req, reply) => {
      if (!lokasi) {
        void reply.code(503).send(GALAT_ZONA_BELUM_DIATUR);
        return;
      }
      return tentukanZona(req.body, daftarZona);
    },
  );

  // T-025 katalog pembeli: kategori + jumlah, daftar/pencarian, detail.
  void app.register(ruteKatalog, { layanan: opsi.katalog ?? null, lokasi });

  // T-036 panel admin: login + TOTP, RBAC, CSRF, CRUD katalog, stok, log.
  void app.register(ruteAdmin, {
    prefix: "/api/admin",
    ...(opsi.admin ?? {
      auth: null,
      katalog: null,
      sumberInventori: "local",
      originDiizinkan: [],
    }),
  });

  // T-029 bayar tagihan (QRIS/VA) + status pembayaran. Ditolak 401 sampai login pembeli (T-016).
  void app.register(ruteTagihan, opsi.tagihan ?? { layanan: null, repoBaca: null });
  // T-021 saldo pengguna: GET /api/saldo (saldo + riwayat). Ditolak 401 sampai login pembeli (T-016).
  void app.register(ruteSaldo, opsi.saldo ?? { repo: null });

  return app;
}
