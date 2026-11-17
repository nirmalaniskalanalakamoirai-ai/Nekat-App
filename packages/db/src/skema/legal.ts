import { boolean, check, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, cekDalam, idUtama, kolomAudit, waktu } from "./_umum.js";
import { akun } from "./akun.js";

// T-004 §3.2 Persetujuan legal berversi. `persetujuan_legal` append-only (M5):
// trigger penolak UPDATE/DELETE dipasang di migrasi SQL 0001.

export const dokumenLegal = pgTable(
  "dokumen_legal",
  {
    id: idUtama(),
    jenis: text("jenis").notNull(),
    versi: text("versi").notNull(),
    hashIsi: bytea("hash_isi").notNull(),
    berlakuMulai: waktu("berlaku_mulai").notNull(),
    /** Menunggu F-23. */
    wajibSetujuUlang: boolean("wajib_setuju_ulang").notNull().default(true),
    dibuatPada: kolomAudit.dibuatPada,
  },
  (t) => [
    uniqueIndex("dokumen_legal_jenis_versi_uk").on(t.jenis, t.versi),
    check("dokumen_legal_jenis", cekDalam("jenis", ["SYARAT_KETENTUAN", "KEBIJAKAN_PRIVASI"])),
  ],
);

export const persetujuanLegal = pgTable(
  "persetujuan_legal",
  {
    id: idUtama(),
    akunId: uuid("akun_id")
      .notNull()
      .references(() => akun.id, { onDelete: "restrict" }),
    dokumenLegalId: uuid("dokumen_legal_id")
      .notNull()
      .references(() => dokumenLegal.id, { onDelete: "restrict" }),
    disetujuiPada: waktu("disetujui_pada").notNull(),
    kanal: text("kanal").notNull(),
    /** [PII] */
    ipHmac: bytea("ip_hmac"),
    /** [PII] */
    userAgentRingkas: text("user_agent_ringkas"),
  },
  (t) => [
    uniqueIndex("persetujuan_legal_uk").on(t.akunId, t.dokumenLegalId),
    check("persetujuan_legal_kanal", cekDalam("kanal", ["PWA", "APP"])),
  ],
);
