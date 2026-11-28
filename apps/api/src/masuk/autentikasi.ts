// Autentikasi pembeli dari sesi login OTP (T-016) untuk rute pembeli lain.
//
// KOMPATIBEL dengan kontrak sementara di PR T-021 (`apps/api/src/saldo/rute.ts`) dan T-029
// (`apps/api/src/pembeli/autentikasi.ts`):
//   type AutentikasiPembeli = (req: FastifyRequest) => Promise<{ akunId: string } | null>;
//   FastifyRequest.akunSesi?: { akunId: string }
// Cara pasang setelah PR itu di-merge (server.ts):
//   const autentikasi = masuk ? buatAutentikasiPembeli(masuk.layanan) : undefined;
//   buatApp({ …, saldo: { repo: repoSaldo, autentikasi }, tagihan: { …, autentikasi } });
// lalu hapus `tolakSemuaSampaiT016` sebagai bawaan (atau biarkan sebagai bawaan saat login nonaktif).
//
// CSRF: untuk metode mutasi (POST/PUT/PATCH/DELETE) fungsi ini HANYA mengembalikan akun bila header
// `x-csrf-token` cocok dengan token sesi. Tanpa itu → null (rute lama menjawab 401). Rute baru
// sebaiknya memakai `hookWajibMasuk` yang membedakan 401 (belum masuk) dan 403 (CSRF).
// `akunId` TIDAK PERNAH dibaca dari query/body/header buatan klien.
import type { FastifyReply, FastifyRequest } from "fastify";
import { bacaCookie } from "../admin/http-util.js";
import { samaConstantTime } from "./kripto.js";
import type { LayananMasuk } from "./layanan.js";

/** Cookie sesi pembeli. `__Host-` = wajib Secure, Path=/, tanpa Domain (tidak bisa ditimpa subdomain). */
export const COOKIE_SESI_PEMBELI = "__Host-nekat_sesi";

export type AutentikasiPembeli = (req: FastifyRequest) => Promise<{ akunId: string } | null>;

declare module "fastify" {
  interface FastifyRequest {
    akunSesi?: { akunId: string };
  }
}

const MUTASI = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type HasilSesiPembeli =
  | { readonly status: "OK"; readonly akunId: string; readonly token: string }
  | { readonly status: "BELUM_MASUK" }
  | { readonly status: "CSRF" };

/** Baca & periksa sesi + CSRF (untuk mutasi). Tidak menulis respons. */
export async function periksaSesiPembeli(
  layanan: LayananMasuk,
  req: FastifyRequest,
): Promise<HasilSesiPembeli> {
  const token = bacaCookie(req.headers.cookie, COOKIE_SESI_PEMBELI);
  if (!token) return { status: "BELUM_MASUK" };
  const s = await layanan.sesi(token);
  if (!s) return { status: "BELUM_MASUK" };
  if (MUTASI.has(req.method)) {
    const kiriman = req.headers["x-csrf-token"];
    if (typeof kiriman !== "string" || !samaConstantTime(kiriman, layanan.csrf(token))) {
      return { status: "CSRF" };
    }
  }
  return { status: "OK", akunId: s.akunId, token };
}

/** Untuk rute T-021/T-029 (`opsi.autentikasi`). CSRF gagal pada mutasi → null (401). */
export function buatAutentikasiPembeli(layanan: LayananMasuk): AutentikasiPembeli {
  return async (req) => {
    const h = await periksaSesiPembeli(layanan, req);
    return h.status === "OK" ? { akunId: h.akunId } : null;
  };
}

export const GALAT_SESI = {
  BELUM_MASUK: { kode: "BELUM_MASUK", pesan: "Sesi kamu habis. Masuk lagi untuk lanjut." },
  CSRF: {
    kode: "CSRF_TIDAK_VALID",
    pesan: "Permintaan ditolak. Muat ulang halaman lalu coba lagi.",
  },
  BELUM_SIAP: { kode: "MASUK_BELUM_SIAP", pesan: "Login belum tersedia di server ini." },
} as const;

/**
 * Hook onRequest untuk rute pembeli BARU: 401 belum masuk / 403 CSRF / 503 login nonaktif; sukses
 * → `req.akunSesi = { akunId }`. Dipasang sebelum validasi body agar tanpa sesi tidak ada detail
 * validasi yang bocor.
 */
export function hookWajibMasuk(layanan: LayananMasuk | null) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    void reply.header("cache-control", "no-store");
    if (!layanan) {
      await reply.code(503).send(GALAT_SESI.BELUM_SIAP);
      return;
    }
    const h = await periksaSesiPembeli(layanan, req);
    if (h.status === "BELUM_MASUK") {
      await reply.code(401).send(GALAT_SESI.BELUM_MASUK);
      return;
    }
    if (h.status === "CSRF") {
      await reply.code(403).send(GALAT_SESI.CSRF);
      return;
    }
    req.akunSesi = { akunId: h.akunId };
  };
}
