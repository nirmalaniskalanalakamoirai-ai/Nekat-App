import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as skema from "./skema/index.js";

export type Db = NodePgDatabase<typeof skema> & { $client: pg.Pool };

/** Folder migrasi SQL (sejajar src/ dan dist/). */
export const FOLDER_MIGRASI = fileURLToPath(new URL("../migrasi", import.meta.url));

export function buatDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return drizzle(pool, { schema: skema, casing: "snake_case" });
}

/** Jalankan semua migrasi yang belum diterapkan (hanya maju, ADR-0001). */
export async function jalankanMigrasi(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: FOLDER_MIGRASI, migrationsSchema: "public" });
}
