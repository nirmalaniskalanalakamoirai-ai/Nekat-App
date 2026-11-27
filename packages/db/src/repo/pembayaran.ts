// Repositori pembayaran (T-029, port RepoPembayaran — docs/flow/pembayaran.md §4.2, §5.1).
// Urutan kunci §3.5: invoice (FOR UPDATE) → pembayaran. Tidak ada panggilan gateway di sini.
// Kepemilikan: invoice hanya terlihat bila `pembayar_akun_id` = akun sesi (lainnya → 404, CWE-639).
import {
  cekBolehBayar,
  GalatBayar,
  kunciBayar,
  type AlasanGagal,
  type HasilSiapkan,
  type PembayaranTersimpan,
  type RepoPembayaran,
  type StatusPembayaran,
  type StatusTagihan,
  type TagihanUntukBayar,
} from "@nekat/domain";
import { instruksiSchema, keRupiah, type Instruksi } from "@nekat/shared";
import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../koneksi.js";
import { invoice, pembayaran } from "../skema/index.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Pembaca = Db | Tx;

const kolomTagihan = {
  id: invoice.id,
  nomor: invoice.nomor,
  status: invoice.status,
  totalRp: invoice.totalRp,
  saldoDipakaiRp: invoice.saldoDipakaiRp,
  sisaBayarRp: invoice.sisaBayarRp,
  kedaluwarsaPada: invoice.kedaluwarsaPada,
  gabungan: invoice.gabungan,
};

interface BarisTagihan {
  id: string;
  nomor: string;
  status: string;
  totalRp: number;
  saldoDipakaiRp: number;
  sisaBayarRp: number;
  kedaluwarsaPada: Date;
  gabungan: boolean;
}

function keTagihan(b: BarisTagihan): TagihanUntukBayar {
  return {
    id: b.id,
    nomor: b.nomor,
    status: b.status as StatusTagihan,
    totalRp: keRupiah(b.totalRp),
    saldoDipakaiRp: keRupiah(b.saldoDipakaiRp),
    sisaBayarRp: keRupiah(b.sisaBayarRp),
    kedaluwarsaPada: b.kedaluwarsaPada,
    gabungan: b.gabungan,
    jenis: "GRUP",
  };
}

type BarisPembayaran = typeof pembayaran.$inferSelect;

function keInstruksi(v: unknown): Instruksi | null {
  if (v === null || v === undefined) return null;
  const h = instruksiSchema.safeParse(v);
  return h.success ? h.data : null;
}

function kePembayaran(b: BarisPembayaran): PembayaranTersimpan {
  if (b.kedaluwarsaPada === null) throw new Error("pembayaran tanpa kedaluwarsa_pada");
  return {
    id: b.id,
    invoiceId: b.invoiceId,
    metode: b.metode as "QRIS" | "VA",
    kanal: b.kanal,
    jumlahRp: keRupiah(b.jumlahRp),
    status: b.status as StatusPembayaran,
    xenditRef: b.xenditRef,
    instruksi: keInstruksi(b.instruksi),
    kedaluwarsaPada: b.kedaluwarsaPada,
    kunciIdempotensi: b.kunciIdempotensi,
    alasanGagal: (b.alasanGagal as AlasanGagal | null) ?? null,
  };
}

function kodePg(err: unknown): { kode?: string; constraint?: string } {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const kode = (e as { code?: unknown }).code;
    if (typeof kode === "string") {
      const c = (e as { constraint?: unknown }).constraint;
      return { kode, ...(typeof c === "string" ? { constraint: c } : {}) };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return {};
}

const tidakDitemukan = () => new GalatBayar("TAGIHAN_TIDAK_DITEMUKAN", "Tagihan tidak ditemukan.");

async function bacaHidup(tx: Pembaca, invoiceId: string): Promise<BarisPembayaran | undefined> {
  const [b] = await tx
    .select()
    .from(pembayaran)
    .where(
      and(
        eq(pembayaran.invoiceId, invoiceId),
        or(eq(pembayaran.status, "MENUNGGU"), eq(pembayaran.status, "LUNAS")),
      ),
    )
    .limit(1);
  return b;
}

export function buatRepoPembayaran(db: Db): RepoPembayaran {
  const siapkanSekali = (i: Parameters<RepoPembayaran["siapkan"]>[0]) =>
    db.transaction(async (tx): Promise<HasilSiapkan> => {
      const [bt] = await tx
        .select(kolomTagihan)
        .from(invoice)
        .where(and(eq(invoice.id, i.invoiceId), eq(invoice.pembayarAkunId, i.akunId)))
        .for("update");
      if (!bt) throw tidakDitemukan();
      const tagihan = keTagihan(bt);

      const hidup = await bacaHidup(tx, tagihan.id);
      if (hidup?.status === "LUNAS")
        throw new GalatBayar("SUDAH_LUNAS", "Tagihan ini sudah lunas.");
      // Aturan dicek di dalam kunci (status & kedaluwarsa tidak bisa berubah sampai commit).
      cekBolehBayar(tagihan, i.metode, i.kanal, i.sekarang, i.kanalVaDiizinkan);
      if (hidup) {
        const p = kePembayaran(hidup);
        if (p.metode === i.metode && p.kanal === i.kanal)
          return { jenis: "ADA", tagihan, pembayaran: p };
        return { jenis: "GANTI", tagihan, lama: p };
      }

      const [c] = await tx
        .select({ n: count() })
        .from(pembayaran)
        .where(eq(pembayaran.invoiceId, tagihan.id));
      const n = (c?.n ?? 0) + 1;
      const [baru] = await tx
        .insert(pembayaran)
        .values({
          invoiceId: tagihan.id,
          metode: i.metode,
          kanal: i.kanal,
          jumlahRp: tagihan.sisaBayarRp,
          status: "MENUNGGU",
          kedaluwarsaPada: tagihan.kedaluwarsaPada, // absolut = TTL invoice (§5.1.3)
          kunciIdempotensi: kunciBayar(tagihan.id, n),
        })
        .returning();
      if (!baru) throw new Error("insert pembayaran tidak mengembalikan baris");
      return { jenis: "BARU", tagihan, pembayaran: kePembayaran(baru) };
    });

  return {
    async siapkan(i) {
      try {
        return await siapkanSekali(i);
      } catch (e) {
        // Pertahanan berlapis: kunci invoice seharusnya mencegah ini. Bila UK satu-hidup/kunci idempotensi
        // tetap bentrok (balapan di luar kunci), baca ulang → kembalikan pembayaran hidup yang ada (§4.2).
        const { kode, constraint } = kodePg(e);
        if (
          kode === "23505" &&
          (constraint === "pembayaran_satu_hidup_uk" ||
            constraint === "pembayaran_kunci_idempotensi_uk")
        ) {
          return siapkanSekali(i);
        }
        throw e;
      }
    },

    async simpanHasilBuat(pembayaranId, h) {
      const [b] = await db
        .update(pembayaran)
        .set({ xenditRef: h.xenditRef, instruksi: h.instruksi })
        .where(
          and(
            eq(pembayaran.id, pembayaranId),
            eq(pembayaran.status, "MENUNGGU"),
            or(isNull(pembayaran.xenditRef), eq(pembayaran.xenditRef, h.xenditRef)),
          ),
        )
        .returning();
      return b ? kePembayaran(b) : null;
    },

    async tandaiGagal(pembayaranId, alasan) {
      const r = await db
        .update(pembayaran)
        .set({ status: "GAGAL", alasanGagal: alasan })
        .where(and(eq(pembayaran.id, pembayaranId), eq(pembayaran.status, "MENUNGGU")))
        .returning({ id: pembayaran.id });
      return r.length > 0;
    },

    async tutupUntukGanti(pembayaranId) {
      // Kunci invoice dulu (urutan §3.5) agar tidak balapan dengan siapkan() untuk invoice yang sama.
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM ${invoice} WHERE ${invoice.id} = (SELECT ${pembayaran.invoiceId} FROM ${pembayaran} WHERE ${pembayaran.id} = ${pembayaranId}) FOR UPDATE`,
        );
        const r = await tx
          .update(pembayaran)
          .set({ status: "KEDALUWARSA" })
          .where(and(eq(pembayaran.id, pembayaranId), eq(pembayaran.status, "MENUNGGU")))
          .returning({ id: pembayaran.id });
        return r.length > 0;
      });
    },

    async baca(invoiceId, akunId) {
      const [bt] = await db
        .select(kolomTagihan)
        .from(invoice)
        .where(and(eq(invoice.id, invoiceId), eq(invoice.pembayarAkunId, akunId)));
      if (!bt) return null;
      const hidup = await bacaHidup(db, invoiceId);
      let b = hidup;
      if (!b) {
        [b] = await db
          .select()
          .from(pembayaran)
          .where(eq(pembayaran.invoiceId, invoiceId))
          .orderBy(desc(pembayaran.dibuatPada), desc(pembayaran.id))
          .limit(1);
      }
      return { tagihan: keTagihan(bt), pembayaran: b ? kePembayaran(b) : null };
    },
  };
}
