import { PgBoss } from "pg-boss";
import type { KonfigurasiWorker } from "./config.js";

/**
 * Membuat instans pg-boss TANPA menyambung ke database (koneksi baru dibuka saat `start()`).
 * Pendaftaran job (cut-off, picking, laporan, outbox WA/Gudang) menyusul di task masing-masing
 * (ADR-0001 §3.3).
 */
export function buatWorker(konfigurasi: KonfigurasiWorker): PgBoss {
  return new PgBoss({
    connectionString: konfigurasi.databaseUrl,
    application_name: "nekat-worker",
  });
}
