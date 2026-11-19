import {
  bacaKonfigInventory,
  KonfigInventoryTidakValidError,
  type KonfigInventory,
} from "@nekat/adapters";
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
  /** Toggle InventorySource (T-018), dibaca sekali saat start. */
  readonly inventory: KonfigInventory;
}

/**
 * Membaca konfigurasi worker dari environment (ADR-0001 §6). Pesan error hanya menyebut
 * NAMA variabel yang salah, tidak pernah nilainya (bisa berisi password DB).
 */
export function bacaKonfigurasi(env: NodeJS.ProcessEnv): KonfigurasiWorker {
  const hasil = skemaKonfigurasi.safeParse(env);
  const nama = hasil.success ? [] : hasil.error.issues.map((isu) => isu.path.join("."));
  let inventory: KonfigInventory | null = null;
  try {
    inventory = bacaKonfigInventory(env);
  } catch (e) {
    if (!(e instanceof KonfigInventoryTidakValidError)) throw e;
    nama.push(...e.variabel);
  }
  if (!hasil.success || inventory === null) {
    throw new Error(`Konfigurasi worker tidak valid: ${[...new Set(nama)].join(", ")}`);
  }
  return { databaseUrl: hasil.data.DATABASE_URL, inventory };
}
