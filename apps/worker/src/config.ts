import { z } from "zod";

const skemaKonfigurasi = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((nilai) => /^postgres(ql)?:\/\//.test(nilai), {
      message: "DATABASE_URL harus berawalan postgres:// atau postgresql://",
    }),
});

export interface KonfigurasiWorker {
  readonly databaseUrl: string;
}

/**
 * Membaca konfigurasi worker dari environment (ADR-0001 §6). Pesan error hanya menyebut
 * NAMA variabel yang salah, tidak pernah nilainya (bisa berisi password DB).
 */
export function bacaKonfigurasi(env: NodeJS.ProcessEnv): KonfigurasiWorker {
  const hasil = skemaKonfigurasi.safeParse(env);
  if (!hasil.success) {
    const nama = [...new Set(hasil.error.issues.map((isu) => isu.path.join(".")))].join(", ");
    throw new Error(`Konfigurasi worker tidak valid: ${nama}`);
  }
  return { databaseUrl: hasil.data.DATABASE_URL };
}
