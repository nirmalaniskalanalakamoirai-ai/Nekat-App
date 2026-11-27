import { PgBoss } from "pg-boss";
import type { KonfigurasiWorker } from "./config.js";

/**
 * Membuat instans pg-boss TANPA menyambung ke database (koneksi baru dibuka saat `start()`).
 * Pendaftaran job (cut-off, picking, laporan, outbox WA/Gudang) menyusul di task masing-masing
 * (ADR-0001 §3.3).
 */
export function buatWorker(konfigurasi: Pick<KonfigurasiWorker, "databaseUrl">): PgBoss {
  return new PgBoss({
    connectionString: konfigurasi.databaseUrl,
    application_name: "nekat-worker",
  });
}

/** Nama antrean pg-boss job inventori (T-019). */
export const ANTREAN_INVENTORI = {
  sinkron: "inventori-sinkron",
  kirimPicking: "inventori-kirim-picking",
} as const;

/**
 * Cron dari `INVENTORY_INTERVAL_SINKRON_MENIT` (1–1440). < 60 → tiap N menit; ≥ 60 → tiap
 * floor(N/60) jam (pembulatan ke bawah = lebih sering, lebih aman untuk umur data P-10).
 */
export function cronSinkron(intervalMenit: number): string {
  if (!Number.isInteger(intervalMenit) || intervalMenit < 1) {
    throw new RangeError("interval sinkron harus bilangan bulat >= 1");
  }
  if (intervalMenit < 60) return intervalMenit === 1 ? "* * * * *" : `*/${intervalMenit} * * * *`;
  const jam = Math.floor(intervalMenit / 60);
  return jam >= 24 ? "0 0 * * *" : `0 */${jam} * * *`;
}

export interface JobInventori {
  /** null = mode `local` (tidak ada yang disinkron). */
  readonly sinkron: (() => Promise<unknown>) | null;
  readonly kirimPicking: () => Promise<unknown>;
  readonly intervalSinkronMenit: number;
}

type BossJob = Pick<PgBoss, "getQueue" | "createQueue" | "schedule" | "work">;

/**
 * Mendaftarkan job inventori. Antrean `singleton`: satu putaran aktif sekaligus walau worker lebih
 * dari satu (sinkron & kirim picking tidak berjalan ganda).
 */
export async function daftarkanJobInventori(boss: BossJob, job: JobInventori): Promise<void> {
  const siapkan = async (nama: string, cron: string, kerja: () => Promise<unknown>) => {
    if ((await boss.getQueue(nama)) === null) await boss.createQueue(nama, { policy: "singleton" });
    await boss.schedule(nama, cron);
    await boss.work(nama, async () => {
      await kerja();
    });
  };
  if (job.sinkron) {
    await siapkan(ANTREAN_INVENTORI.sinkron, cronSinkron(job.intervalSinkronMenit), job.sinkron);
  }
  // Tiap menit; jadwal kirim ulang per entri diatur kolom `outbox.kirim_setelah`.
  await siapkan(ANTREAN_INVENTORI.kirimPicking, "* * * * *", job.kirimPicking);
}
