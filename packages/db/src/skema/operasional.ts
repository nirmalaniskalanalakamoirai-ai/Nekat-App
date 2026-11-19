// T-004 §3.15 (bagian T-013b): outbox, job_run, dan penyimpan idempotensi tahan lama InventorySource (T-018).
// Ledger saldo TIDAK pernah lewat outbox.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dalam, idUuid, kolomAudit, kolomDibuat, ts } from "./_umum.js";
import { grup } from "./grup.js";

export const JENIS_OUTBOX = ["WA", "PICKING", "BATAL_PEMBAYARAN_XENDIT"] as const;
export const STATUS_OUTBOX = ["MENUNGGU", "TERKIRIM", "GAGAL", "KEDALUWARSA"] as const;

export const outbox = pgTable(
  "outbox",
  {
    id: idUuid(),
    grupId: uuid("grup_id").references(() => grup.id, { onDelete: "restrict" }),
    jenis: text("jenis").notNull(),
    kunciIdempotensi: text("kunci_idempotensi").notNull(),
    // Hanya id; PICKING tanpa nama/HP/alamat (T-009 §2).
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("MENUNGGU"),
    percobaan: smallint("percobaan").notNull().default(0),
    kirimSetelah: ts("kirim_setelah").notNull().defaultNow(),
    kedaluwarsaPesan: ts("kedaluwarsa_pesan"),
    terkirimPada: ts("terkirim_pada"),
    galatTerakhir: text("galat_terakhir"), // tanpa PII
    ...kolomAudit,
  },
  (t) => [
    uniqueIndex("outbox_kunci_idempotensi_uk").on(t.kunciIdempotensi),
    check("outbox_jenis", dalam("jenis", JENIS_OUTBOX)),
    check("outbox_status", dalam("status", STATUS_OUTBOX)),
    check("outbox_percobaan_nonneg", sql`percobaan >= 0`),
    check("outbox_terkirim_lengkap", sql`status <> 'TERKIRIM' OR terkirim_pada IS NOT NULL`),
    index("outbox_antrean_idx")
      .on(t.kirimSetelah)
      .where(sql`status = 'MENUNGGU'`),
    index("outbox_grup_idx").on(t.grupId),
  ],
);

export const STATUS_JOB = ["BERJALAN", "SELESAI", "GAGAL"] as const;

/** Kunci eksekusi job (mis. `cutoff:{slot_id}`) dengan lease agar tidak jalan ganda. */
export const jobRun = pgTable(
  "job_run",
  {
    kunci: text("kunci").primaryKey(),
    status: text("status").notNull(),
    pemegang: text("pemegang"),
    leaseSampai: ts("lease_sampai"),
    mulaiPada: ts("mulai_pada").notNull().defaultNow(),
    selesaiPada: ts("selesai_pada"),
    ...kolomAudit,
  },
  () => [
    check("job_status", dalam("status", STATUS_JOB)),
    check("job_berjalan_butuh_lease", sql`status <> 'BERJALAN' OR lease_sampai IS NOT NULL`),
    check("job_selesai_lengkap", sql`status = 'BERJALAN' OR selesai_pada IS NOT NULL`),
  ],
);

export const RUANG_IDEMPOTENSI_INVENTORI = ["konfirmasi", "picking"] as const;

/**
 * Hasil operasi idempoten `InventorySource` (konfirmasiStok, kirimPermintaanPicking; T-009 §5).
 * Baris tidak pernah diubah (trigger migrasi 0004): kunci sama + hash beda → KONFLIK_IDEMPOTENSI di domain.
 */
export const idempotensiInventori = pgTable(
  "idempotensi_inventori",
  {
    ruang: text("ruang").notNull(),
    kunci: text("kunci").notNull(),
    hash: text("hash").notNull(), // SHA-256 hex payload kanonik
    hasil: jsonb("hasil").notNull(),
    ...kolomDibuat,
  },
  (t) => [
    primaryKey({ columns: [t.ruang, t.kunci] }),
    check("idempotensi_ruang", dalam("ruang", RUANG_IDEMPOTENSI_INVENTORI)),
    check("idempotensi_hash_sha256", sql`hash ~ '^[0-9a-f]{64}$'`),
    check("idempotensi_kunci_isi", sql`char_length(kunci) BETWEEN 1 AND 200`),
  ],
);
