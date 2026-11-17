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
import { cekDalam, idUtama, kolomAudit, waktu } from "./_umum.js";

// T-004 §3.4. Koordinat & radius HANYA di config/lokasi.json (M7): DB menyimpan kode_konfig.

export const gudang = pgTable(
  "gudang",
  {
    id: idUtama(),
    kodeKonfig: text("kode_konfig").notNull().unique(),
    nama: text("nama").notNull(),
    jenis: text("jenis").notNull(),
    aktif: boolean("aktif").notNull().default(true),
    ...kolomAudit,
  },
  () => [check("gudang_jenis", cekDalam("jenis", ["PUSAT", "CABANG"]))],
);

export const zona = pgTable(
  "zona",
  {
    id: idUtama(),
    kodeKonfig: text("kode_konfig").notNull().unique(),
    namaKelurahan: text("nama_kelurahan").notNull(),
    /** FK melingkar ke drop_point, DEFERRABLE INITIALLY DEFERRED (ditambahkan di migrasi SQL 0001). */
    dropPointPusatId: uuid("drop_point_pusat_id"),
    gudangId: uuid("gudang_id")
      .notNull()
      .references(() => gudang.id, { onDelete: "restrict" }),
    aktif: boolean("aktif").notNull().default(false),
    ...kolomAudit,
  },
  (t) => [
    check("zona_aktif_wajib_drop_point", sql`NOT ${t.aktif} OR ${t.dropPointPusatId} IS NOT NULL`),
  ],
);

export const dropPoint = pgTable("drop_point", {
  id: idUtama(),
  kodeKonfig: text("kode_konfig").notNull().unique(),
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
});

export const slotKirim = pgTable(
  "slot_kirim",
  {
    id: idUtama(),
    zonaId: uuid("zona_id")
      .notNull()
      .references(() => zona.id, { onDelete: "restrict" }),
    /** Tanggal WIB. */
    tanggal: date("tanggal", { mode: "string" }).notNull(),
    mulai: time("mulai").notNull(),
    selesai: time("selesai").notNull(),
    cutOffPada: waktu("cut_off_pada").notNull(),
    /** NULL = tanpa batas (T-006). */
    kapasitasGram: bigint("kapasitas_gram", { mode: "number" }),
    status: text("status").notNull().default("DIBUKA"),
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("slot_kirim_uk").on(t.zonaId, t.tanggal, t.mulai),
    index("slot_kirim_cutoff_idx")
      .on(t.cutOffPada)
      .where(sql`${t.status} = 'DIBUKA'`),
    check("slot_kirim_jam", sql`${t.selesai} > ${t.mulai}`),
    check("slot_kirim_kapasitas", sql`${t.kapasitasGram} IS NULL OR ${t.kapasitasGram} > 0`),
    check("slot_kirim_status", cekDalam("status", ["DIBUKA", "DITUTUP", "DIBATALKAN"])),
  ],
);
