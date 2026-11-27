// Ledger saldo pengguna (T-021, SAL). Kontrak: docs/flow/pembayaran.md §12.1.
//
// Semua fungsi tulis dipanggil DI DALAM transaksi pemanggil (invarian §3.3: ledger ditulis di transaksi
// yang sama dengan perubahan status penyebabnya, tidak pernah lewat outbox). Gagal = pemanggil rollback.
//
// URUTAN KUNCI (pembayaran.md §3.5, ADR-0001 §3.2):
//   grup → stok SKU → peserta → invoice (FOR UPDATE) → pembayaran → akun (FOR SHARE) → akun_saldo (FOR UPDATE)
// - `invoice` dikunci di sini (no-op bila pemanggil sudah memegangnya; pemanggil yang memegang kunci yang
//   lebih belakang, mis. pembayaran, WAJIB sudah mengunci invoice lebih dulu).
// - `akun` FOR SHARE: status (AKTIF/DIBEKUKAN) tidak bisa berubah sampai transaksi selesai — UPDATE akun
//   (pembekuan) menunggu. Konsekuensi: transaksi yang meng-UPDATE akun tidak boleh sudah memegang
//   `akun_saldo` (tidak ada jalur seperti itu; pembekuan cukup UPDATE akun).
// - Beberapa invoice/akun dalam satu transaksi (mis. grup batal → refund semua peserta): panggil
//   `kunciLedgerBatch` dulu (urut id), baru kredit satu per satu.
//
// Pagar saldo tidak negatif berlapis: (1) kode `min(saldo, maks)` / SALDO_KURANG di dalam kunci;
// (2) trigger `terapkan_ledger_saldo` (saldo_sesudah_rp harus cocok); (3) CHECK DB.
//
// Pagar dana per invoice (kode, di bawah kunci invoice): REFUND/REFUND_ONGKIR/SELISIH_HARGA hanya untuk
// invoice LUNAS dan Σ-nya ≤ invoice.total_rp (= dibayar + saldo_dipakai); SALDO_BALIK hanya untuk invoice
// KEDALUWARSA/DIBATALKAN/DIGANTI; keduanya tidak pernah sama-sama ada untuk satu invoice.
//
// Idempotensi (§3.4, §8.2): kunci diturunkan dari identitas sumber di @nekat/domain. Kunci yang sudah ada
// dengan isi identik (akun, jumlah, jenis, referensi, invoice, dapat_dicairkan_sejak) = sukses tanpa efek;
// isi berbeda = KUNCI_BENTROK (bug penghitung → rollback + alert).
//
// Pencairan (PENCAIRAN / PENCAIRAN_BATAL) TIDAK diimplementasikan: dikunci sampai H5 (K-34).
import {
  GalatSaldo,
  hitungPakaiSaldo,
  identitasKredit,
  kunciDebitCheckout,
  kunciKoreksi,
  kunciSaldoBalik,
  labelJenisLedger,
  nominalKoreksi,
  nominalPositif,
  saldoSesudah,
  uuidKanonik,
  type JenisKreditUmum,
  type SumberKredit,
} from "@nekat/domain";
import { keRupiah, type Rupiah } from "@nekat/shared";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { Db } from "../koneksi.js";
import {
  admin,
  akun,
  akunSaldo,
  barisInvoice,
  invoice,
  invoicePeserta,
  keputusanKoreksiSaldo,
  konfigurasi,
  ledgerSaldo,
  pembayaran,
  pengajuanKoreksiSaldo,
} from "../skema/index.js";

/** Transaksi Drizzle milik pemanggil. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type KodeTolakAkun = "AKUN_DIBEKUKAN" | "AKUN_TIDAK_AKTIF";

/** Penolakan bisnis tanpa galat DB: transaksi pemanggil masih sehat (mis. untuk menandai DANA_DITAHAN). */
export interface DitolakAkun {
  readonly ok: false;
  readonly kode: KodeTolakAkun;
  readonly retryable: false;
}

export type HasilDebitCheckout =
  | {
      readonly ok: true;
      /** null = saldo 0 / maks 0: tidak ada entri (CHECK jumlah ≠ 0), invoice tidak diubah. */
      readonly idEntri: number | null;
      readonly dipakaiRp: Rupiah;
      /** = invoice.sisa_bayar_rp sesudah debit (0 → saldo menutup penuh, pemanggil menjalankan I2). */
      readonly sisaBayarRp: Rupiah;
      readonly saldoSesudahRp: Rupiah;
      readonly duplikat: boolean;
    }
  | DitolakAkun;

export type HasilKredit =
  | {
      readonly ok: true;
      /** null hanya untuk SALDO_BALIK tanpa saldo yang dipakai. */
      readonly idEntri: number | null;
      readonly jumlahRp: Rupiah;
      readonly saldoSesudahRp: Rupiah;
      readonly duplikat: boolean;
    }
  | DitolakAkun;

export interface MasukanDebitCheckout {
  /** Dari sesi / pembayar; WAJIB sama dengan invoice.pembayar_akun_id. */
  readonly akunId: string;
  readonly invoiceId: string;
  /**
   * Batas tambahan (≤ total_rp), mis. agar sisa ≥ minimum kanal (K-50, belum diputuskan).
   * Tanpa nilai: batasnya invoice.total_rp.
   */
  readonly maksRp?: number;
}

export interface MasukanKredit {
  /** WAJIB sama dengan pembayar invoice sumber dana (G-06: host bayar semua → akun host). */
  readonly akunId: string;
  readonly jumlahRp: number;
  readonly sumber: SumberKredit;
  /** Masa tahan pencairan (K-34, nilai konfigurasi kosong); dihitung pemanggil. */
  readonly dapatDicairkanSejak?: Date | null;
}

// Jenis yang lewat `kredit()`; dipastikan juga saat runtime (data dari luar TypeScript).
const JENIS_KREDIT_UMUM: readonly string[] = [
  "REFUND",
  "REFUND_ONGKIR",
  "SELISIH_HARGA",
  "BAYAR_TERLAMBAT",
] satisfies readonly JenisKreditUmum[];

const STATUS_INVOICE_SALDO_BALIK: readonly string[] = ["KEDALUWARSA", "DIBATALKAN", "DIGANTI"];

/**
 * Status pembayaran PAID terlambat (pembayaran.md §6.3). Nilai ini baru ditambahkan migrasi T-030; sampai
 * itu BAYAR_TERLAMBAT selalu ditolak (gagal tertutup).
 */
export const STATUS_PEMBAYARAN_TERLAMBAT = "LUNAS_TERLAMBAT";

/** Kunci konfigurasi batas nominal satu koreksi admin (|jumlah|). Kosong/tidak ada = tidak dibatasi. */
export const KUNCI_KONFIG_KOREKSI_MAKS = "saldo.koreksi_maks_rp";

function wajibTransaksi(tx: Tx): void {
  // Pool biasa = autocommit per statement: FOR UPDATE langsung lepas & ledger lepas dari status penyebab.
  if (!(tx instanceof PgTransaction)) {
    throw new GalatSaldo("BUKAN_TRANSAKSI", "Ledger saldo wajib dipanggil di dalam transaksi");
  }
}

interface InfoPg {
  readonly code?: string;
  readonly constraint?: string;
}

function infoPg(e: unknown): InfoPg | null {
  let x: unknown = e;
  for (let i = 0; i < 5 && x instanceof Error; i++) {
    const c = x as Error & InfoPg;
    if (typeof c.code === "string") return c;
    x = x.cause;
  }
  return null;
}

/** Ubah pelanggaran pagar saldo dari DB menjadi SALDO_KURANG (transaksi pemanggil sudah batal). */
function petakanGalatDb(e: unknown): never {
  const info = infoPg(e);
  if (
    info?.code === "23514" &&
    (info.constraint === "akun_saldo_tidak_negatif" ||
      info.constraint === "ledger_saldo_sesudah_nonneg")
  ) {
    throw new GalatSaldo("SALDO_KURANG", "Saldo tidak cukup");
  }
  throw e;
}

// ---- Kunci ----

interface InvoiceTerkunci {
  readonly id: string;
  readonly status: string;
  readonly grupId: string;
  readonly pembayarAkunId: string;
  readonly totalRp: Rupiah;
  readonly saldoDipakaiRp: Rupiah;
}

async function kunciInvoice(tx: Tx, invoiceId: string): Promise<InvoiceTerkunci> {
  const [i] = await tx
    .select({
      id: invoice.id,
      status: invoice.status,
      grupId: invoice.grupId,
      pembayarAkunId: invoice.pembayarAkunId,
      totalRp: invoice.totalRp,
      saldoDipakaiRp: invoice.saldoDipakaiRp,
    })
    .from(invoice)
    .where(eq(invoice.id, invoiceId))
    .for("update");
  if (!i) throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Invoice tidak ditemukan");
  return { ...i, totalRp: keRupiah(i.totalRp), saldoDipakaiRp: keRupiah(i.saldoDipakaiRp) };
}

interface AkunTerkunci {
  readonly status: string;
  readonly saldoRp: Rupiah;
}

/** `akun` FOR SHARE lalu `akun_saldo` FOR UPDATE (terakhir). Membuat baris saldo 0 bila belum ada. */
async function kunciAkunSaldo(tx: Tx, akunId: string): Promise<AkunTerkunci> {
  const [a] = await tx
    .select({ status: akun.status })
    .from(akun)
    .where(eq(akun.id, akunId))
    .for("share");
  if (!a) throw new GalatSaldo("AKUN_TIDAK_ADA", "Akun tidak ditemukan");
  await tx.insert(akunSaldo).values({ akunId, saldoRp: 0 }).onConflictDoNothing();
  const [s] = await tx
    .select({ saldoRp: akunSaldo.saldoRp })
    .from(akunSaldo)
    .where(eq(akunSaldo.akunId, akunId))
    .for("update");
  if (!s) throw new GalatSaldo("AKUN_TIDAK_ADA", "Baris saldo akun tidak ditemukan");
  return { status: a.status, saldoRp: keRupiah(s.saldoRp) };
}

/**
 * Untuk transaksi yang menulis ledger ke BEBERAPA invoice/akun (mis. grup batal): kunci semuanya di awal
 * sesuai urutan global dan diurutkan per id, sehingga dua transaksi batch tidak saling deadlock.
 * Panggilan kredit/debit sesudahnya hanya mengunci ulang baris yang sudah dipegang (no-op).
 */
export async function kunciLedgerBatch(
  tx: Tx,
  m: { readonly invoiceIds?: readonly string[]; readonly akunIds: readonly string[] },
): Promise<void> {
  wajibTransaksi(tx);
  const urut = (xs: readonly string[]) => [...new Set(xs.map(uuidKanonik))].sort();
  const invoiceIds = urut(m.invoiceIds ?? []);
  const akunIds = urut(m.akunIds);
  for (const i of invoiceIds) await kunciInvoice(tx, i);
  if (akunIds.length === 0) return;
  // Satu statement per tahap, ORDER BY id: kunci baris diambil berurutan.
  await tx
    .select({ id: akun.id })
    .from(akun)
    .where(inArray(akun.id, akunIds))
    .orderBy(akun.id)
    .for("share");
  for (const a of akunIds)
    await tx.insert(akunSaldo).values({ akunId: a, saldoRp: 0 }).onConflictDoNothing();
  await tx
    .select({ id: akunSaldo.akunId })
    .from(akunSaldo)
    .where(inArray(akunSaldo.akunId, akunIds))
    .orderBy(akunSaldo.akunId)
    .for("update");
}

function tolakBilaTidakAktif(status: string, izinkanBeku = false): DitolakAkun | null {
  if (status === "AKTIF" || (izinkanBeku && status === "DIBEKUKAN")) return null;
  return {
    ok: false,
    kode: status === "DIBEKUKAN" ? "AKUN_DIBEKUKAN" : "AKUN_TIDAK_AKTIF",
    retryable: false,
  };
}

// ---- Entri ----

type BarisLedger = typeof ledgerSaldo.$inferSelect;

async function cariEntri(tx: Tx, kunci: string): Promise<BarisLedger | null> {
  const [b] = await tx.select().from(ledgerSaldo).where(eq(ledgerSaldo.kunciIdempotensi, kunci));
  return b ?? null;
}

interface EntriBaru {
  readonly akunId: string;
  readonly jumlahRp: number;
  readonly jenis: string;
  readonly kunciIdempotensi: string;
  readonly referensiJenis: string;
  readonly referensiId: string;
  readonly invoiceId: string | null;
  readonly saldoSesudahRp: Rupiah;
  readonly dapatDicairkanSejak: Date | null;
  readonly alasan?: string;
  readonly dibuatOlehAdminId?: string;
  readonly disetujuiOlehAdminId?: string;
}

type IsiEntri = Pick<
  EntriBaru,
  | "akunId"
  | "jumlahRp"
  | "jenis"
  | "referensiJenis"
  | "referensiId"
  | "invoiceId"
  | "dapatDicairkanSejak"
>;

const waktuSama = (a: Date | null, b: Date | null) =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

/** Replay hanya sukses bila SELURUH isi sama; beda apa pun = sumber dihitung ulang berbeda (bug). */
function samaIsi(lama: BarisLedger, baru: IsiEntri): boolean {
  return (
    lama.akunId === baru.akunId &&
    lama.jumlahRp === baru.jumlahRp &&
    lama.jenis === baru.jenis &&
    lama.referensiJenis === baru.referensiJenis &&
    lama.referensiId === baru.referensiId &&
    lama.invoiceId === baru.invoiceId &&
    waktuSama(lama.dapatDicairkanSejak, baru.dapatDicairkanSejak)
  );
}

function wajibSama(lama: BarisLedger, baru: IsiEntri): void {
  if (!samaIsi(lama, baru)) {
    throw new GalatSaldo("KUNCI_BENTROK", "Kunci idempotensi ledger dipakai entri berbeda");
  }
}

/**
 * Insert entri. `ON CONFLICT DO NOTHING` pada kunci: trigger AFTER INSERT tidak jalan untuk baris yang
 * dilewati, jadi saldo tidak berubah. Konflik di sini hanya mungkin bila transaksi lain yang tidak
 * tertahan kunci kita memakai kunci yang sama → dibandingkan dengan entri pemenang.
 */
async function sisipkan(tx: Tx, e: EntriBaru): Promise<{ id: number; duplikat: boolean }> {
  let masuk: { id: number }[];
  try {
    masuk = await tx
      .insert(ledgerSaldo)
      .values({
        akunId: e.akunId,
        jumlahRp: e.jumlahRp,
        jenis: e.jenis,
        kunciIdempotensi: e.kunciIdempotensi,
        referensiJenis: e.referensiJenis,
        referensiId: e.referensiId,
        invoiceId: e.invoiceId,
        saldoSesudahRp: e.saldoSesudahRp,
        dapatDicairkanSejak: e.dapatDicairkanSejak,
        alasan: e.alasan ?? null,
        dibuatOlehAdminId: e.dibuatOlehAdminId ?? null,
        disetujuiOlehAdminId: e.disetujuiOlehAdminId ?? null,
      })
      .onConflictDoNothing({ target: ledgerSaldo.kunciIdempotensi })
      .returning({ id: ledgerSaldo.id });
  } catch (err) {
    petakanGalatDb(err);
  }
  const [baris] = masuk;
  if (baris) return { id: baris.id, duplikat: false };
  const lama = await cariEntri(tx, e.kunciIdempotensi);
  if (!lama) throw new GalatSaldo("KUNCI_BENTROK", "Entri idempotensi hilang setelah konflik");
  wajibSama(lama, e);
  return { id: lama.id, duplikat: true };
}

/** Σ dana yang sudah kembali dari satu invoice (di bawah kunci invoice). */
async function danaKembaliInvoice(
  tx: Tx,
  invoiceId: string,
): Promise<{ kembaliLunasRp: number; saldoBalikRp: number }> {
  const [r] = await tx
    .select({
      kembaliLunasRp: sql<string>`COALESCE(SUM(${ledgerSaldo.jumlahRp}) FILTER (WHERE ${ledgerSaldo.jenis} IN ('REFUND', 'REFUND_ONGKIR', 'SELISIH_HARGA')), 0)`,
      saldoBalikRp: sql<string>`COALESCE(SUM(${ledgerSaldo.jumlahRp}) FILTER (WHERE ${ledgerSaldo.jenis} = 'SALDO_BALIK'), 0)`,
    })
    .from(ledgerSaldo)
    .where(eq(ledgerSaldo.invoiceId, invoiceId));
  return {
    kembaliLunasRp: Number(r?.kembaliLunasRp ?? 0),
    saldoBalikRp: Number(r?.saldoBalikRp ?? 0),
  };
}

// ---- Debit checkout ----

/**
 * SAL.debitCheckout (§9, §12.1): pakai saldo saat tagihan terbit, `dipakai = min(saldo, total, maks)`
 * dihitung di dalam kunci, lalu entri PAKAI_CHECKOUT ditulis DAN `invoice.saldo_dipakai_rp` /
 * `sisa_bayar_rp` diisi di statement yang sama transaksinya (invarian invoice = ledger dibangun di sini).
 *
 * Syarat invoice (L-1, invoice fiktif/lama ditolak): ada, pembayar = `akunId`, DITERBITKAN, belum memakai
 * saldo, dan belum punya pembayaran. Alur penerbitan: insert invoice (saldo_dipakai 0, sisa = total) →
 * debitCheckout → bila `sisaBayarRp = 0` jalankan I2 (LUNAS), selain itu buat pembayaran untuk sisa.
 * Kunci `debit:{invoice_id}`; duplikat = entri lama.
 */
export async function debitCheckout(tx: Tx, m: MasukanDebitCheckout): Promise<HasilDebitCheckout> {
  wajibTransaksi(tx);
  const akunId = uuidKanonik(m.akunId);
  const invoiceId = uuidKanonik(m.invoiceId);
  const kunci = kunciDebitCheckout(invoiceId);
  const maksTambahan = m.maksRp === undefined ? undefined : keRupiahAtauGalat(m.maksRp);

  const inv = await kunciInvoice(tx, invoiceId);
  if (inv.pembayarAkunId !== akunId) {
    throw new GalatSaldo("AKUN_TIDAK_SESUAI", "Saldo hanya boleh dipakai pembayar invoice");
  }
  const terkunci = await kunciAkunSaldo(tx, akunId);

  const lama = await cariEntri(tx, kunci);
  if (lama) {
    if (
      lama.akunId !== akunId ||
      lama.jenis !== "PAKAI_CHECKOUT" ||
      lama.invoiceId !== invoiceId ||
      inv.saldoDipakaiRp !== -lama.jumlahRp
    ) {
      throw new GalatSaldo("KUNCI_BENTROK", "Entri debit tidak cocok dengan invoice");
    }
    return {
      ok: true,
      idEntri: lama.id,
      dipakaiRp: keRupiah(-lama.jumlahRp),
      sisaBayarRp: keRupiah(inv.totalRp - inv.saldoDipakaiRp),
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }

  if (inv.status !== "DITERBITKAN" || inv.saldoDipakaiRp !== 0) {
    throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Saldo hanya dipakai saat invoice baru terbit");
  }
  const [adaBayar] = await tx
    .select({ id: pembayaran.id })
    .from(pembayaran)
    .where(eq(pembayaran.invoiceId, invoiceId))
    .limit(1);
  if (adaBayar) {
    throw new GalatSaldo(
      "INVOICE_TIDAK_SESUAI",
      "Invoice sudah punya pembayaran; saldo tidak bisa ditambahkan",
    );
  }

  // §9.6: akun DIBEKUKAN tidak bisa memakai saldo (dicek di dalam kunci).
  const tolak = tolakBilaTidakAktif(terkunci.status);
  if (tolak) return tolak;

  const batas =
    maksTambahan === undefined ? inv.totalRp : hitungPakaiSaldo(inv.totalRp, maksTambahan);
  const dipakai = hitungPakaiSaldo(terkunci.saldoRp, batas);
  if (dipakai === 0) {
    return {
      ok: true,
      idEntri: null,
      dipakaiRp: dipakai,
      sisaBayarRp: inv.totalRp,
      saldoSesudahRp: terkunci.saldoRp,
      duplikat: false,
    };
  }
  const debit = 0 - dipakai; // bertanda (−)
  const sesudah = saldoSesudah(terkunci.saldoRp, debit);
  const hasil = await sisipkan(tx, {
    akunId,
    jumlahRp: debit,
    jenis: "PAKAI_CHECKOUT",
    kunciIdempotensi: kunci,
    referensiJenis: "INVOICE",
    referensiId: invoiceId,
    invoiceId,
    saldoSesudahRp: sesudah,
    dapatDicairkanSejak: null,
  });
  const sisa = keRupiah(inv.totalRp - dipakai);
  await tx
    .update(invoice)
    .set({ saldoDipakaiRp: dipakai, sisaBayarRp: sisa, diubahPada: sql`now()` })
    .where(eq(invoice.id, invoiceId));
  return {
    ok: true,
    idEntri: hasil.id,
    dipakaiRp: dipakai,
    sisaBayarRp: sisa,
    saldoSesudahRp: sesudah,
    duplikat: false,
  };
}

function keRupiahAtauGalat(n: number): Rupiah {
  try {
    return keRupiah(n);
  } catch {
    throw new GalatSaldo("NOMINAL_TIDAK_VALID", "Nominal harus bilangan bulat rupiah ≥ 0");
  }
}

// ---- Kredit ----

interface SumberTerikat {
  readonly invoiceId: string;
  /** Hanya BAYAR_TERLAMBAT. */
  readonly pembayaran?: { readonly status: string; readonly jumlahRp: number };
}

async function wajibPesertaDiInvoice(
  tx: Tx,
  invoiceId: string,
  pesertaId: string,
  grupId?: string,
): Promise<void> {
  const [p] = await tx
    .select({ grupId: invoicePeserta.grupId })
    .from(invoicePeserta)
    .where(and(eq(invoicePeserta.invoiceId, invoiceId), eq(invoicePeserta.pesertaId, pesertaId)));
  if (!p || (grupId !== undefined && p.grupId !== grupId)) {
    throw new GalatSaldo("SUMBER_TIDAK_SESUAI", "Peserta/grup tidak termasuk invoice sumber dana");
  }
}

/** L-1: turunkan invoice sumber dana dan verifikasi bahwa identitas sumber memang milik invoice itu. */
async function ikatSumber(tx: Tx, s: SumberKredit): Promise<SumberTerikat> {
  switch (s.jenis) {
    case "REFUND":
      switch (s.alasan) {
        case "GRUP_BATAL": {
          const i = uuidKanonik(s.invoiceId);
          await wajibPesertaDiInvoice(tx, i, uuidKanonik(s.pesertaId), uuidKanonik(s.grupId));
          return { invoiceId: i };
        }
        case "SLOT_BATAL": {
          const i = uuidKanonik(s.invoiceId);
          await wajibPesertaDiInvoice(tx, i, uuidKanonik(s.pesertaId));
          return { invoiceId: i };
        }
        case "STOK_HABIS":
        case "ALOKASI": {
          const [b] = await tx
            .select({ invoiceId: barisInvoice.invoiceId })
            .from(barisInvoice)
            .where(eq(barisInvoice.id, uuidKanonik(s.barisInvoiceId)));
          if (!b) throw new GalatSaldo("SUMBER_TIDAK_SESUAI", "Baris invoice tidak ditemukan");
          return { invoiceId: b.invoiceId };
        }
        case "KELUHAN":
          // Tabel keluhan belum ada (spec keluhan menyusul): hanya invoice yang bisa diverifikasi.
          return { invoiceId: uuidKanonik(s.invoiceId) };
      }
      break;
    case "SELISIH_HARGA": {
      const i = uuidKanonik(s.invoiceId);
      await wajibPesertaDiInvoice(tx, i, uuidKanonik(s.pesertaId), uuidKanonik(s.grupId));
      return { invoiceId: i };
    }
    case "REFUND_ONGKIR": {
      const i = uuidKanonik(s.invoiceId);
      await wajibPesertaDiInvoice(tx, i, uuidKanonik(s.pesertaId));
      return { invoiceId: i };
    }
    case "BAYAR_TERLAMBAT": {
      const [p] = await tx
        .select({
          invoiceId: pembayaran.invoiceId,
          status: pembayaran.status,
          jumlahRp: pembayaran.jumlahRp,
        })
        .from(pembayaran)
        .where(eq(pembayaran.id, uuidKanonik(s.pembayaranId)));
      if (!p) throw new GalatSaldo("SUMBER_TIDAK_SESUAI", "Pembayaran tidak ditemukan");
      return { invoiceId: p.invoiceId, pembayaran: { status: p.status, jumlahRp: p.jumlahRp } };
    }
  }
  throw new GalatSaldo("ID_TIDAK_VALID", "Sumber kredit tidak dikenal");
}

/**
 * SAL.kredit (§8, §12.1): REFUND / REFUND_ONGKIR / SELISIH_HARGA / BAYAR_TERLAMBAT ke akun pembayar.
 * Nominal dihitung pemanggil (engine-harga §5); kunci & referensi diturunkan dari `sumber`; akun & invoice
 * diverifikasi terhadap sumber (L-1). Pagar dana: lihat kepala berkas (M-1).
 * Akun DIBEKUKAN (§8.1.6) → `{ ok: false, kode: "AKUN_DIBEKUKAN" }` tanpa galat DB: pemanggil menandai
 * DANA_DITAHAN + tinjauan; saat admin melepas, panggil ulang dengan sumber yang sama (kunci sama).
 */
export async function kredit(tx: Tx, m: MasukanKredit): Promise<HasilKredit> {
  wajibTransaksi(tx);
  const akunId = uuidKanonik(m.akunId);
  const jumlah = nominalPositif(m.jumlahRp);
  if (!JENIS_KREDIT_UMUM.includes(m.sumber.jenis)) {
    throw new GalatSaldo("ID_TIDAK_VALID", "Jenis kredit tidak diizinkan lewat kredit()");
  }
  const id = identitasKredit(m.sumber);
  const dapatDicairkanSejak = m.dapatDicairkanSejak ?? null;

  const terikat = await ikatSumber(tx, m.sumber);
  const inv = await kunciInvoice(tx, terikat.invoiceId);
  if (inv.pembayarAkunId !== akunId) {
    throw new GalatSaldo("AKUN_TIDAK_SESUAI", "Kredit hanya ke akun pembayar invoice sumber dana");
  }
  const terkunci = await kunciAkunSaldo(tx, akunId);

  const isi: IsiEntri = {
    akunId,
    jumlahRp: jumlah,
    jenis: id.jenis,
    referensiJenis: id.referensiJenis,
    referensiId: id.referensiId,
    invoiceId: inv.id,
    dapatDicairkanSejak,
  };
  const lama = await cariEntri(tx, id.kunciIdempotensi);
  if (lama) {
    wajibSama(lama, isi);
    return {
      ok: true,
      idEntri: lama.id,
      jumlahRp: jumlah,
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }

  if (id.jenis === "BAYAR_TERLAMBAT") {
    // §6.3: seluruh jumlah pembayaran ganda/terlambat itu, hanya bila statusnya LUNAS_TERLAMBAT.
    const p = terikat.pembayaran;
    if (p?.status !== STATUS_PEMBAYARAN_TERLAMBAT || p.jumlahRp !== jumlah) {
      throw new GalatSaldo(
        "SUMBER_TIDAK_SESUAI",
        "Pembayaran bukan LUNAS_TERLAMBAT atau nominal beda",
      );
    }
  } else {
    if (inv.status !== "LUNAS") {
      throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Refund/selisih hanya untuk invoice LUNAS");
    }
    const sudah = await danaKembaliInvoice(tx, inv.id);
    if (sudah.saldoBalikRp !== 0) {
      throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Invoice sudah menerima SALDO_BALIK");
    }
    if (sudah.kembaliLunasRp + jumlah > inv.totalRp) {
      throw new GalatSaldo(
        "MELEBIHI_DIBAYAR",
        "Total pengembalian melebihi yang dibayar untuk invoice",
      );
    }
  }

  const tolak = tolakBilaTidakAktif(terkunci.status);
  if (tolak) return tolak;

  const sesudah = saldoSesudah(terkunci.saldoRp, jumlah);
  const hasil = await sisipkan(tx, {
    ...isi,
    kunciIdempotensi: id.kunciIdempotensi,
    saldoSesudahRp: sesudah,
  });
  return {
    ok: true,
    idEntri: hasil.id,
    jumlahRp: jumlah,
    saldoSesudahRp: sesudah,
    duplikat: hasil.duplikat,
  };
}

// ---- Saldo balik ----

/**
 * SALDO_BALIK (§8.2, §9.4): saldo yang dipakai invoice kembali ketika invoice berakhir tanpa lunas.
 * Pemanggil (I4/I5/I6, job TTL §7 langkah 5) WAJIB sudah mengubah status invoice ke KEDALUWARSA /
 * DIBATALKAN / DIGANTI di transaksi yang sama — invoice LUNAS ditolak karena saldonya menjadi bagian
 * REFUND (§8.1.3); invoice yang sudah menerima REFUND/SELISIH juga ditolak.
 * Nominal & akun TIDAK dari pemanggil: diambil dari entri `debit:{invoice_id}` (harus cocok dengan
 * `invoice.saldo_dipakai_rp` & pembayar).
 *
 * Akun DIBEKUKAN: TETAP dikredit — DEFAULT SEMENTARA menunggu L-01 (uang pembeli sendiri; pemakaiannya
 * tetap terblokir karena debit menolak akun beku). Akun DIHAPUS → AKUN_TIDAK_AKTIF (tinjauan, K-35).
 *
 * BELUM DIDUKUNG: SALDO_BALIK parsial untuk COD (pembayaran.md §10.3, stok habis per baris pada invoice
 * COD yang belum lunas). Usulan untuk T-034: kunci `saldo-balik:{invoice_id}:STOK_HABIS:{baris_invoice_id}`
 * per baris, lalu SALDO_BALIK final = sisa `saldo_dipakai_rp` dikurangi yang sudah kembali per baris.
 */
export async function kembalikanSaldoInvoice(
  tx: Tx,
  m: { readonly invoiceId: string },
): Promise<HasilKredit> {
  wajibTransaksi(tx);
  const invoiceId = uuidKanonik(m.invoiceId);
  const inv = await kunciInvoice(tx, invoiceId);
  if (!STATUS_INVOICE_SALDO_BALIK.includes(inv.status)) {
    throw new GalatSaldo(
      "INVOICE_TIDAK_SESUAI",
      "Saldo hanya kembali untuk invoice KEDALUWARSA/DIBATALKAN/DIGANTI",
    );
  }
  const akunId = inv.pembayarAkunId;
  const terkunci = await kunciAkunSaldo(tx, akunId);

  const debit = await cariEntri(tx, kunciDebitCheckout(invoiceId));
  if (!debit) {
    if (inv.saldoDipakaiRp !== 0) {
      throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Invoice memakai saldo tanpa entri debit");
    }
    return {
      ok: true,
      idEntri: null,
      jumlahRp: keRupiah(0),
      saldoSesudahRp: terkunci.saldoRp,
      duplikat: false,
    };
  }
  const jumlah = nominalPositif(-debit.jumlahRp);
  if (debit.akunId !== akunId || jumlah !== inv.saldoDipakaiRp) {
    throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Entri debit tidak cocok dengan invoice");
  }

  const kunci = kunciSaldoBalik(invoiceId);
  const isi: IsiEntri = {
    akunId,
    jumlahRp: jumlah,
    jenis: "SALDO_BALIK",
    referensiJenis: "INVOICE",
    referensiId: invoiceId,
    invoiceId,
    dapatDicairkanSejak: null,
  };
  const lama = await cariEntri(tx, kunci);
  if (lama) {
    wajibSama(lama, isi);
    return {
      ok: true,
      idEntri: lama.id,
      jumlahRp: jumlah,
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }
  const sudah = await danaKembaliInvoice(tx, invoiceId);
  if (sudah.kembaliLunasRp !== 0) {
    throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Invoice sudah menerima REFUND/SELISIH");
  }
  const tolak = tolakBilaTidakAktif(terkunci.status, true);
  if (tolak) return tolak;

  const sesudah = saldoSesudah(terkunci.saldoRp, jumlah);
  const hasil = await sisipkan(tx, { ...isi, kunciIdempotensi: kunci, saldoSesudahRp: sesudah });
  return {
    ok: true,
    idEntri: hasil.id,
    jumlahRp: jumlah,
    saldoSesudahRp: sesudah,
    duplikat: hasil.duplikat,
  };
}

// ---- Koreksi admin four-eyes (T-004 §3.11; trigger migrasi 0004, 0005, 0007) ----
// Default paling aman skema: SEMUA koreksi (kredit & debit) butuh persetujuan admin lain.
// Pengaju & pemutus wajib admin AKTIF (kode: FOR SHARE; DB: trigger 0007).
// Izin RBAC (`saldo.koreksi`, `saldo.setujui`) dicek lapisan API/panel admin — belum ada rute di task ini.

export const PANJANG_ALASAN_KOREKSI_MAKS = 500;

async function wajibAdminAktif(tx: Tx, adminId: string, peran: string): Promise<void> {
  const [a] = await tx
    .select({ status: admin.status })
    .from(admin)
    .where(eq(admin.id, adminId))
    .for("share");
  if (a?.status !== "AKTIF") {
    throw new GalatSaldo("KOREKSI_TIDAK_SAH", `${peran} koreksi harus admin AKTIF`);
  }
}

/** Batas |jumlah| satu koreksi dari konfigurasi; null = tidak dibatasi (nilai kosong / belum diisi). */
async function batasKoreksi(tx: Tx): Promise<number | null> {
  const [k] = await tx
    .select({ nilai: konfigurasi.nilai })
    .from(konfigurasi)
    .where(eq(konfigurasi.kunci, KUNCI_KONFIG_KOREKSI_MAKS));
  const v: unknown = k?.nilai ?? null;
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) {
    // Gagal tertutup: konfigurasi rusak tidak boleh diam-diam menjadi "tanpa batas".
    throw new GalatSaldo("KOREKSI_TIDAK_SAH", "Konfigurasi batas koreksi tidak valid");
  }
  return v;
}

async function wajibDalamBatas(tx: Tx, jumlahRp: number): Promise<void> {
  const batas = await batasKoreksi(tx);
  if (batas !== null && Math.abs(jumlahRp) > batas) {
    throw new GalatSaldo("KOREKSI_TIDAK_SAH", "Nominal koreksi melebihi batas konfigurasi");
  }
}

export async function ajukanKoreksiSaldo(
  tx: Tx,
  m: {
    readonly akunId: string;
    readonly jumlahRp: number;
    readonly alasan: string;
    readonly adminId: string;
  },
): Promise<{ readonly pengajuanId: string }> {
  wajibTransaksi(tx);
  const alasan = m.alasan.trim();
  if (alasan.length === 0 || alasan.length > PANJANG_ALASAN_KOREKSI_MAKS) {
    throw new GalatSaldo("KOREKSI_TIDAK_SAH", "Alasan koreksi wajib (maks 500 karakter)");
  }
  const jumlahRp = nominalKoreksi(m.jumlahRp);
  const adminId = uuidKanonik(m.adminId);
  await wajibAdminAktif(tx, adminId, "Pengaju");
  await wajibDalamBatas(tx, jumlahRp);
  const [b] = await tx
    .insert(pengajuanKoreksiSaldo)
    .values({ akunId: uuidKanonik(m.akunId), jumlahRp, alasan, diajukanOleh: adminId })
    .returning({ id: pengajuanKoreksiSaldo.id });
  if (!b) throw new GalatSaldo("KOREKSI_TIDAK_SAH", "Pengajuan koreksi gagal dibuat");
  return { pengajuanId: b.id };
}

export type HasilKeputusanKoreksi =
  | {
      readonly hasil: "DITOLAK";
      readonly duplikat: boolean;
    }
  | {
      readonly hasil: "DISETUJUI";
      readonly idEntri: number;
      readonly saldoSesudahRp: Rupiah;
      readonly duplikat: boolean;
    };

/**
 * Keputusan koreksi oleh admin LAIN yang AKTIF (pemutus ≠ pengaju; untuk DISETUJUI pengaju juga masih
 * AKTIF). DISETUJUI → ledger KOREKSI_ADMIN di transaksi yang sama (kunci `koreksi:{pengajuan_id}`). Koreksi
 * debit yang membuat saldo negatif → SALDO_KURANG dan seluruh keputusan rollback.
 * Koreksi tetap berlaku untuk akun DIBEKUKAN (tindakan admin, bukan dana masuk dari pembayaran; L-03).
 */
export async function putuskanKoreksiSaldo(
  tx: Tx,
  m: {
    readonly pengajuanId: string;
    readonly hasil: "DISETUJUI" | "DITOLAK";
    readonly adminId: string;
    readonly catatan?: string;
    /** Masa tahan pencairan untuk koreksi kredit (§8.1.5); diabaikan untuk koreksi debit. */
    readonly dapatDicairkanSejak?: Date | null;
  },
): Promise<HasilKeputusanKoreksi> {
  wajibTransaksi(tx);
  const pengajuanId = uuidKanonik(m.pengajuanId);
  const pemutus = uuidKanonik(m.adminId);
  const [pj] = await tx
    .select()
    .from(pengajuanKoreksiSaldo)
    .where(eq(pengajuanKoreksiSaldo.id, pengajuanId));
  if (!pj) throw new GalatSaldo("KOREKSI_TIDAK_SAH", "Pengajuan koreksi tidak ditemukan");
  if (pj.diajukanOleh === pemutus) {
    throw new GalatSaldo("KOREKSI_TIDAK_SAH", "Pemutus koreksi harus admin lain (four-eyes)");
  }
  // Kunci admin diurutkan per id (dua keputusan bersamaan tidak saling deadlock).
  const adminDikunci = m.hasil === "DISETUJUI" ? [pemutus, pj.diajukanOleh].sort() : [pemutus];
  for (const a of adminDikunci) {
    await wajibAdminAktif(tx, a, a === pemutus ? "Pemutus" : "Pengaju");
  }
  if (m.hasil === "DISETUJUI") await wajibDalamBatas(tx, pj.jumlahRp);

  const masuk = await tx
    .insert(keputusanKoreksiSaldo)
    .values({ pengajuanId, hasil: m.hasil, diputuskanOleh: pemutus, catatan: m.catatan ?? null })
    .onConflictDoNothing({ target: keputusanKoreksiSaldo.pengajuanId })
    .returning({ pengajuanId: keputusanKoreksiSaldo.pengajuanId });
  let duplikat = false;
  if (masuk.length === 0) {
    const [k] = await tx
      .select()
      .from(keputusanKoreksiSaldo)
      .where(eq(keputusanKoreksiSaldo.pengajuanId, pengajuanId));
    if (k?.hasil !== m.hasil || k.diputuskanOleh !== pemutus) {
      throw new GalatSaldo("KOREKSI_TIDAK_SAH", "Pengajuan koreksi sudah diputuskan");
    }
    duplikat = true;
  }
  if (m.hasil === "DITOLAK") return { hasil: "DITOLAK", duplikat };

  const terkunci = await kunciAkunSaldo(tx, pj.akunId);
  const kunci = kunciKoreksi(pengajuanId);
  const isi: IsiEntri = {
    akunId: pj.akunId,
    jumlahRp: pj.jumlahRp,
    jenis: "KOREKSI_ADMIN",
    referensiJenis: "PENGAJUAN_KOREKSI",
    referensiId: pengajuanId,
    invoiceId: null,
    dapatDicairkanSejak: pj.jumlahRp > 0 ? (m.dapatDicairkanSejak ?? null) : null,
  };
  const lama = await cariEntri(tx, kunci);
  if (lama) {
    wajibSama(lama, isi);
    return {
      hasil: "DISETUJUI",
      idEntri: lama.id,
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }
  const sesudah = saldoSesudah(terkunci.saldoRp, pj.jumlahRp);
  const hasil = await sisipkan(tx, {
    ...isi,
    kunciIdempotensi: kunci,
    saldoSesudahRp: sesudah,
    alasan: pj.alasan,
    dibuatOlehAdminId: pj.diajukanOleh,
    disetujuiOlehAdminId: pemutus,
  });
  return { hasil: "DISETUJUI", idEntri: hasil.id, saldoSesudahRp: sesudah, duplikat };
}

// ---- Baca: saldo & riwayat pengguna (SAL.riwayat §12.1) ----

export interface EntriRiwayat {
  readonly id: number;
  readonly waktu: Date;
  readonly jenis: string;
  readonly jenisTampil: string;
  /** Bertanda: + masuk, − keluar. */
  readonly jumlahRp: number;
  readonly saldoSesudahRp: Rupiah;
  /** Nomor tagihan terkait (hanya tagihan milik akun ini); null bila tidak ada. */
  readonly referensiTampil: string | null;
}

export interface HalamanRiwayat {
  readonly saldoRp: Rupiah;
  readonly entri: readonly EntriRiwayat[];
  /** Kirim sebagai `cursor` untuk halaman berikut; null = sudah habis. */
  readonly cursorBerikut: string | null;
}

export const BATAS_RIWAYAT_MAKS = 100;

export interface RepoSaldo {
  riwayat(akunId: string, opsi: { sebelumId?: number; batas: number }): Promise<HalamanRiwayat>;
}

/**
 * Pembaca saldo & riwayat untuk akun SESI (akun lain tidak pernah dibaca). Tidak memuat alasan koreksi
 * internal, id admin, kunci idempotensi, atau id referensi mentah. Saldo & entri dibaca dalam satu
 * snapshot (REPEATABLE READ, read only) agar konsisten.
 */
export function buatRepoSaldo(db: Db): RepoSaldo {
  return {
    riwayat(akunIdMentah, opsi) {
      const akunId = uuidKanonik(akunIdMentah);
      const batas = Math.min(Math.max(Math.trunc(opsi.batas), 1), BATAS_RIWAYAT_MAKS);
      return db.transaction(
        async (tx) => {
          const [s] = await tx
            .select({ saldoRp: akunSaldo.saldoRp })
            .from(akunSaldo)
            .where(eq(akunSaldo.akunId, akunId));
          const syarat =
            opsi.sebelumId === undefined
              ? eq(ledgerSaldo.akunId, akunId)
              : and(eq(ledgerSaldo.akunId, akunId), lt(ledgerSaldo.id, opsi.sebelumId));
          // Nomor tagihan hanya bila tagihan itu dibayar akun yang sama (tidak membocorkan milik orang lain).
          const nomorInvoice = sql<string | null>`(
            SELECT i.nomor FROM invoice i
             WHERE i.id = ${ledgerSaldo.invoiceId} AND i.pembayar_akun_id = ${ledgerSaldo.akunId})`;
          const baris = await tx
            .select({
              id: ledgerSaldo.id,
              waktu: ledgerSaldo.dibuatPada,
              jenis: ledgerSaldo.jenis,
              jumlahRp: ledgerSaldo.jumlahRp,
              saldoSesudahRp: ledgerSaldo.saldoSesudahRp,
              nomorInvoice,
            })
            .from(ledgerSaldo)
            .where(syarat)
            .orderBy(desc(ledgerSaldo.id))
            .limit(batas + 1);
          const ada = baris.length > batas;
          const tampil = baris.slice(0, batas);
          const terakhir = tampil.at(-1);
          return {
            saldoRp: keRupiah(s?.saldoRp ?? 0),
            entri: tampil.map((b): EntriRiwayat => ({
              id: b.id,
              waktu: b.waktu,
              jenis: b.jenis,
              jenisTampil: labelJenisLedger(b.jenis),
              jumlahRp: b.jumlahRp,
              saldoSesudahRp: keRupiah(b.saldoSesudahRp),
              referensiTampil: b.nomorInvoice,
            })),
            cursorBerikut: ada && terakhir ? String(terakhir.id) : null,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}

/**
 * Invarian rekonsiliasi (§12.1): akun dengan `saldo_rp ≠ Σ ledger`. Dipakai job harian (menyusul) &
 * tes. Hanya melapor — TANPA koreksi otomatis.
 */
export async function cariSelisihSaldo(
  db: Db | Tx,
): Promise<{ akunId: string; saldoRp: number; totalLedgerRp: number }[]> {
  const r = await db.execute<{ akun_id: string; saldo_rp: string; total_ledger_rp: string }>(sql`
    SELECT s.akun_id, s.saldo_rp, COALESCE(SUM(l.jumlah_rp), 0) AS total_ledger_rp
      FROM akun_saldo s LEFT JOIN ledger_saldo l ON l.akun_id = s.akun_id
     GROUP BY s.akun_id, s.saldo_rp
    HAVING s.saldo_rp <> COALESCE(SUM(l.jumlah_rp), 0)`);
  return r.rows.map((b) => ({
    akunId: b.akun_id,
    saldoRp: Number(b.saldo_rp),
    totalLedgerRp: Number(b.total_ledger_rp),
  }));
}
