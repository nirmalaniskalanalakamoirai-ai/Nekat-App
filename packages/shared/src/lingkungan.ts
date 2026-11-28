// Lingkungan proses (T-016). NODE_ENV yang tidak dikenal/kosong membuat proses gagal start, agar
// pagar mode (WhatsApp, pembayaran) tidak pernah "gagal terbuka" karena salah ketik.

export const NODE_ENV_SAH = ["development", "test", "staging", "production"] as const;
export type NodeEnv = (typeof NODE_ENV_SAH)[number];

export function nodeEnvSah(v: string | undefined): v is NodeEnv {
  return (NODE_ENV_SAH as readonly (string | undefined)[]).includes(v);
}
