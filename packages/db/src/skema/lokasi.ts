// T-004 §3.4: gudang, zona, drop point, slot kirim.
// Koordinat & radius TIDAK disimpan di DB; hanya `kode_konfig` → config/lokasi.json (M7).
// FK melingkar zona.drop_point_pusat_id ↔ drop_point.zona_id: FK zona → drop_point dibuat
// DEFERRABLE INITIALLY DEFERRED di migrasi kustom (Drizzle belum mendukung DEFERRABLE).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dalam, idUuid, kolomAudit, ts } from "./_umum.js";

export const gudang = pgTable(
  "gudang",
  {
    id: idUuid(),
    kodeKonfig: text("kode_konfig").notNull(),
    nama: text("nama").notNull(),
    jenis: text("jenis").notNull(),
    aktif: boolean("aktif").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("gudang_kode_konfig_uk").on(t.kodeKonfig),
    check("gudang_jenis", dalam("jenis", ["PUSAT", "CABANG"])),
  ],
);

export const zona = pgTable(
  "zona",
  {
    id: idUuid(),
    kodeKonfig: text("kode_konfig").notNull(),
    namaKelurahan: text("nama_kelurahan").notNull(),
    dropPointPusatId: uuid("drop_point_pusat_id"), // FK DEFERRABLE di migrasi kustom
    gudangId: uuid("gudang_id")
      .notNull()
      .references(() => gudang.id, { onDelete: "restrict" }),
    aktif: boolean("aktif").notNull().default(false),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("zona_kode_konfig_uk").on(t.kodeKonfig),
    check("zona_aktif_butuh_drop_point", sql`NOT aktif OR drop_point_pusat_id IS NOT NULL`),
  ],
);

export const dropPoint = pgTable(
  "drop_point",
  {
    id: idUuid(),
    kodeKonfig: text("kode_konfig").notNull(),
    zonaId: uuid("zona_id")
      .notNull()
      .references(() => zona.id, { onDelete: "restrict" }),
    gudangId: uuid("gudang_id")
      .notNull()
      .references(() => gudang.id, { onDelete: "restrict" }),
    nama: text("nama").notNull(),
    alamatPublik: text("alamat_publik"),
    jamAmbil: text("jam_ambil"),
    aktif: boolean("aktif").notNull().default(true),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("drop_point_kode_konfig_uk").on(t.kodeKonfig),
    index("drop_point_zona_idx").on(t.zonaId),
  ],
);

export const STATUS_SLOT = ["DIBUKA", "DITUTUP", "DIBATALKAN"] as const;

export const slotKirim = pgTable(
  "slot_kirim",
  {
    id: idUuid(),
    zonaId: uuid("zona_id")
      .notNull()
      .references(() => zona.id, { onDelete: "restrict" }),
    tanggal: date("tanggal").notNull(), // WIB
    mulai: time("mulai").notNull(), // WIB
    selesai: time("selesai").notNull(),
    cutOffPada: ts("cut_off_pada").notNull(),
    kapasitasGram: bigint("kapasitas_gram", { mode: "number" }),
    status: text("status").notNull().default("DIBUKA"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("slot_zona_tanggal_mulai_uk").on(t.zonaId, t.tanggal, t.mulai),
    check("slot_selesai_setelah_mulai", sql`selesai > mulai`),
    // Cut-off sebelum awal slot (tanggal + mulai dalam WIB).
    check(
      "slot_cutoff_sebelum_mulai",
      sql`cut_off_pada < ((tanggal + mulai) AT TIME ZONE 'Asia/Jakarta')`,
    ),
    check("slot_kapasitas", sql`kapasitas_gram IS NULL OR kapasitas_gram > 0`),
    check("slot_status", dalam("status", STATUS_SLOT)),
    index("slot_cutoff_dibuka_idx")
      .on(t.cutOffPada)
      .where(sql`status = 'DIBUKA'`),
  ],
);
