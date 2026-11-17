import { sql } from "drizzle-orm";
import { bigint, customType, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

// Konvensi T-004 §1:
// M1 uang = bigint rupiah penuh; M3 waktu timestamptz, ID uuid v7 (dibuat aplikasi);
// M4 status = text + CHECK (bukan ENUM).

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** Primary key uuid v7 (urut waktu). Bukan pengaman (M10). */
export const idUtama = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** Rupiah penuh (M1). Di TS berupa `number` yang dijaga aman (`Number.isSafeInteger`) oleh parser koneksi. */
export const rupiah = (nama: string) => bigint(nama, { mode: "number" });

export const waktu = (nama: string) => timestamp(nama, { withTimezone: true, mode: "date" });

/** Kolom audit standar T-004. */
export const kolomAudit = {
  dibuatPada: waktu("dibuat_pada").notNull().defaultNow(),
  diubahPada: waktu("diubah_pada").notNull().defaultNow(),
};

/** Ekspresi CHECK `kolom IN (...)` untuk status/jenis (M4). */
export function cekDalam(kolom: string, nilai: readonly string[]) {
  const daftar = nilai.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");
  return sql.raw(`"${kolom}" IN (${daftar})`);
}
