// Outbox permintaan picking (T-019, T-009 §1/§5): `picking:{grup_id}:v{versi}` dikirim worker lewat
// InventorySource, retry berjenjang sampai 6 jam, lalu GAGAL + antrean tinjauan admin.
// Payload = PermintaanPicking (tanpa nama/HP/alamat; divalidasi skema ketat sebelum disimpan).
import type { EntriOutboxPicking, RepoOutboxPicking } from "@nekat/domain";
import { permintaanPickingSchema } from "@nekat/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../koneksi.js";
import { antreanTinjauan, logAudit, outbox } from "../skema/index.js";

/** Kode galat disimpan tanpa pesan bebas (tanpa PII/rahasia). */
const POLA_KODE = /^[A-Z_]{1,40}$/;
const kodeAman = (k: string) => (POLA_KODE.test(k) ? k : "GALAT_LAIN");

export function buatRepoOutboxPicking(db: Db): RepoOutboxPicking {
  return {
    async antrekan(p) {
      const r = permintaanPickingSchema.parse(p);
      const masuk = await db
        .insert(outbox)
        .values({
          grupId: r.grupId,
          jenis: "PICKING",
          kunciIdempotensi: r.kunciIdempotensi,
          payload: r,
        })
        .onConflictDoNothing({ target: outbox.kunciIdempotensi })
        .returning({ id: outbox.id });
      return { baru: masuk.length > 0 };
    },

    async klaim(batas, sekarang, leaseMs) {
      // Lease: kirim_setelah dimajukan saat klaim (tanpa menahan kunci baris selama HTTP ke Gudang).
      // Worker yang mati di tengah jalan → entri jatuh tempo lagi setelah lease habis.
      const hasil = await db.execute<{
        id: string;
        kunci_idempotensi: string;
        payload: unknown;
        percobaan: number;
        dibuat_pada: Date | string;
      }>(sql`
        UPDATE ${outbox} SET
          percobaan = LEAST(${outbox.percobaan} + 1, 32767),
          kirim_setelah = ${new Date(sekarang.getTime() + leaseMs)}
        WHERE ${outbox.id} IN (
          SELECT id FROM ${outbox}
           WHERE jenis = 'PICKING' AND status = 'MENUNGGU' AND kirim_setelah <= ${sekarang}
           ORDER BY kirim_setelah
           LIMIT ${batas}
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, kunci_idempotensi, payload, percobaan, dibuat_pada`);
      return hasil.rows.map((b): EntriOutboxPicking => ({
        id: b.id,
        kunciIdempotensi: b.kunci_idempotensi,
        payload: b.payload,
        percobaan: b.percobaan,
        dibuatPada: new Date(b.dibuat_pada),
      }));
    },

    async tandaiTerkirim(id, hasil, sekarang) {
      await db.transaction(async (tx) => {
        await tx
          .update(outbox)
          .set({ status: "TERKIRIM", terkirimPada: sekarang, galatTerakhir: null })
          .where(eq(outbox.id, id));
        await tx.insert(logAudit).values({
          jenis: "PICKING_TERKIRIM",
          aktor: "SISTEM",
          refJenis: "grup",
          refId: hasil.grupId,
          data: { status: hasil.status, referensiSumber: hasil.referensiSumber },
        });
      });
    },

    async jadwalkanUlang(id, kirimSetelah, kodeGalat) {
      await db
        .update(outbox)
        .set({ kirimSetelah, galatTerakhir: kodeAman(kodeGalat) })
        .where(eq(outbox.id, id));
    },

    async tandaiGagal(id, kodeGalat, jenisTinjauan) {
      await db.transaction(async (tx) => {
        const [b] = await tx
          .update(outbox)
          .set({ status: "GAGAL", galatTerakhir: kodeAman(kodeGalat) })
          .where(eq(outbox.id, id))
          .returning({ grupId: outbox.grupId, kunci: outbox.kunciIdempotensi });
        if (!b) return;
        await tx
          .insert(antreanTinjauan)
          .values({
            jenis: jenisTinjauan,
            entitasJenis: b.grupId ? "grup" : "outbox",
            entitasId: b.grupId ?? id,
            data: { outboxId: id, kunciIdempotensi: b.kunci, galat: kodeAman(kodeGalat) },
          })
          .onConflictDoNothing();
      });
    },
  };
}
