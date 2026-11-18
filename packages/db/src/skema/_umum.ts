// Kolom & tipe bersama skema NEKAT (T-004 §1).
import { sql } from "drizzle-orm";
import { bigint, customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** M3: ID uuid v7 (urut waktu). Default dibuat fungsi SQL `uuid_v7()` (migrasi kustom). */
export const idUuid = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuid_v7()`);

/** M1: uang = bigint rupiah penuh. `mode: "number"` aman sampai 2^53 (≈ 9 kuadriliun rupiah). */
export const rupiah = (nama: string) => bigint(nama, { mode: "number" });

/** Kolom HMAC/terenkripsi (M8, M11). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** Kolom audit standar (T-004 §1: tidak diulang per tabel). */
export const kolomAudit = {
  dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
  diubahPada: timestamp("diubah_pada", { withTimezone: true }).notNull().defaultNow(),
};

/** Untuk tabel append-only: hanya waktu dibuat (M5). */
export const kolomDibuat = {
  dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
};

export const ts = (nama: string) => timestamp(nama, { withTimezone: true });

/** `CHECK (kolom IN (...))` (M4: status = text + CHECK, bukan ENUM). */
export const dalam = (kolom: string, nilai: readonly string[]) =>
  sql.raw(`${kolom} IN (${nilai.map((n) => `'${n}'`).join(", ")})`);
