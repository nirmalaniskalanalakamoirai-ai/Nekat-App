// Hook autentikasi pembeli (sementara sampai T-016 login OTP WhatsApp).
// Bawaan menolak SEMUA permintaan dengan 401 di onRequest (sebelum validasi & sebelum DB disentuh).
// T-016 cukup menyuntikkan fungsi yang mengembalikan `akunId` dari sesi. `akunId` TIDAK PERNAH dibaca dari
// query/body/header buatan klien. Pola & nama sama dengan rute saldo T-021 (PR #36) agar mudah disatukan.
import type { FastifyReply, FastifyRequest } from "fastify";

/** Mengembalikan akun sesi, atau null bila tidak masuk. */
export type AutentikasiPembeli = (req: FastifyRequest) => Promise<{ akunId: string } | null>;

/** Bawaan sampai T-016: tidak ada sesi pembeli → selalu 401. */
export const tolakSemuaSampaiT016: AutentikasiPembeli = () => Promise.resolve(null);

declare module "fastify" {
  interface FastifyRequest {
    akunSesi?: { akunId: string };
  }
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const GALAT_BELUM_MASUK = {
  kode: "BELUM_MASUK",
  pesan: "Silakan masuk dulu untuk melihat tagihan.",
} as const;

/** Buat hook onRequest. Sesi dengan akunId rusak diperlakukan sebagai tidak masuk (401), bukan 500. */
export function hookAutentikasi(autentikasi: AutentikasiPembeli) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const sesi = await autentikasi(req);
    const akunId = sesi?.akunId.toLowerCase();
    if (akunId === undefined || !POLA_UUID.test(akunId)) {
      await reply.code(401).header("cache-control", "no-store").send(GALAT_BELUM_MASUK);
      return;
    }
    req.akunSesi = { akunId };
  };
}
