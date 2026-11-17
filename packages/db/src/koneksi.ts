import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import * as skema from "./skema/index.js";

// int8 (bigint, dipakai untuk rupiah & stok) → number, ditolak bila di luar batas aman (ADR-0001, M1).
pg.types.setTypeParser(pg.types.builtins.INT8, (nilai: string) => {
  const n = Number(nilai);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Nilai bigint di luar batas aman JavaScript: ${nilai}`);
  }
  return n;
});

export type Db = NodePgDatabase<typeof skema>;

export interface KoneksiDb {
  db: Db;
  pool: pg.Pool;
  tutup: () => Promise<void>;
}

export function bukaKoneksi(url: string): KoneksiDb {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema: skema });
  return { db, pool, tutup: () => pool.end() };
}

export const FOLDER_MIGRASI = fileURLToPath(new URL("../migrasi", import.meta.url));

/** Menjalankan semua migrasi SQL yang belum diterapkan (hanya maju). */
export async function jalankanMigrasi(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: FOLDER_MIGRASI });
}
