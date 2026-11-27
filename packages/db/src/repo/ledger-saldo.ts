// Ledger saldo pengguna (T-021, SAL). Kontrak: docs/flow/pembayaran.md §12.1.
//
// Semua fungsi tulis dipanggil DI DALAM transaksi pemanggil (invarian §3.3: ledger ditulis di transaksi
// yang sama dengan perubahan status penyebabnya, tidak pernah lewat outbox). Gagal = pemanggil rollback.
//
// Penguncian (ADR §3.2, pembayaran.md §3.5): `akun` FOR SHARE (status beku tidak berubah di tengah jalan)
// lalu `akun_saldo` FOR UPDATE — selalu TERAKHIR dalam urutan kunci pemanggil. Baris `akun_saldo` dibuat
// bersaldo 0 bila belum ada (diizinkan trigger migrasi 0004) supaya selalu ada baris untuk dikunci; dua
// transaksi untuk akun yang sama karenanya berurutan, dan transaksi kedua membaca saldo terkini (READ
// COMMITTED: tiap statement memakai snapshot baru setelah kunci didapat).
//
// Pagar saldo tidak negatif berlapis: (1) kode menghitung `min(saldo, maks)` / menolak SALDO_KURANG di
// dalam kunci; (2) trigger `terapkan_ledger_saldo` mencocokkan `saldo_sesudah_rp` dengan saldo hasil;
// (3) CHECK `akun_saldo_tidak_negatif` & `ledger_saldo_sesudah_nonneg`.
//
// Idempotensi (§3.4, §8.2): kunci diturunkan dari identitas sumber di @nekat/domain. Kunci yang sudah ada
// = sukses tanpa efek (entri lama dikembalikan); kunci sama dengan isi berbeda = KUNCI_BENTROK (bug
// penghitung, rollback + alert, jangan ditelan).
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
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { Db } from "../koneksi.js";
import {
  akun,
  akunSaldo,
  invoice,
  keputusanKoreksiSaldo,
  ledgerSaldo,
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
      /** null = saldo 0 atau `maksRp` 0: tidak ada entri (CHECK jumlah ≠ 0). */
      readonly idEntri: number | null;
      readonly dipakaiRp: Rupiah;
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
  /** Dari sesi / pembayar invoice, tidak pernah dari body klien. */
  readonly akunId: string;
  readonly invoiceId: string;
  /** = total_rp tagihan. */
  readonly maksRp: number;
}

export interface MasukanKredit {
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

function wajibTransaksi(tx: Tx): void {
  // Pool biasa = autocommit per statement: FOR UPDATE langsung lepas & ledger lepas dari status penyebab.
  if (!(tx instanceof PgTransaction)) {
    throw new GalatSaldo("BUKAN_TRANSAKSI", "Ledger saldo wajib dipanggil di dalam transaksi");
  }
}

interface InfoPg {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
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

interface AkunTerkunci {
  readonly status: string;
  readonly saldoRp: Rupiah;
}

/** Kunci akun (FOR SHARE) lalu `akun_saldo` (FOR UPDATE, terakhir). Membuat baris saldo 0 bila belum ada. */
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

function tolakBilaTidakAktif(status: string): DitolakAkun | null {
  if (status === "AKTIF") return null;
  return {
    ok: false,
    kode: status === "DIBEKUKAN" ? "AKUN_DIBEKUKAN" : "AKUN_TIDAK_AKTIF",
    retryable: false,
  };
}

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
  readonly saldoSesudahRp: Rupiah;
  readonly dapatDicairkanSejak?: Date | null;
  readonly alasan?: string;
  readonly dibuatOlehAdminId?: string;
  readonly disetujuiOlehAdminId?: string;
}

function samaIsi(lama: BarisLedger, baru: Pick<EntriBaru, "akunId" | "jumlahRp" | "jenis">) {
  return (
    lama.akunId === baru.akunId && lama.jumlahRp === baru.jumlahRp && lama.jenis === baru.jenis
  );
}

/**
 * Insert entri. `ON CONFLICT DO NOTHING` pada kunci: trigger AFTER INSERT tidak jalan untuk baris yang
 * dilewati, jadi saldo tidak berubah. Konflik di sini hanya mungkin bila transaksi lain (akun BERBEDA,
 * tidak tertahan kunci kita) memakai kunci yang sama → dibandingkan dengan entri pemenang.
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
        saldoSesudahRp: e.saldoSesudahRp,
        dapatDicairkanSejak: e.dapatDicairkanSejak ?? null,
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
  if (!lama || !samaIsi(lama, e)) {
    throw new GalatSaldo("KUNCI_BENTROK", "Kunci idempotensi ledger dipakai entri berbeda");
  }
  return { id: lama.id, duplikat: true };
}

/**
 * SAL.debitCheckout (§9, §12.1): pakai saldo saat tagihan terbit, `dipakai = min(saldo, maks)` dihitung
 * di dalam kunci. Menutup penuh (`dipakai = maks`) atau sebagian; sisanya urusan pemanggil
 * (`sisa_bayar_rp = total − dipakai`). Kunci `debit:{invoice_id}`; duplikat = entri lama.
 *
 * Catatan: bila saldo 0 tidak ada entri yang ditulis, jadi pemanggil TIDAK BOLEH memanggil ulang untuk
 * invoice yang sudah terbit (nilai `saldo_dipakai_rp` di invoice itulah yang berlaku).
 */
export async function debitCheckout(tx: Tx, m: MasukanDebitCheckout): Promise<HasilDebitCheckout> {
  wajibTransaksi(tx);
  const akunId = uuidKanonik(m.akunId);
  const kunci = kunciDebitCheckout(m.invoiceId);
  const maks = keRupiahAtauGalat(m.maksRp);

  const terkunci = await kunciAkunSaldo(tx, akunId);
  const lama = await cariEntri(tx, kunci);
  if (lama) {
    if (lama.akunId !== akunId || lama.jenis !== "PAKAI_CHECKOUT") {
      throw new GalatSaldo("KUNCI_BENTROK", "Kunci debit dipakai akun/jenis lain");
    }
    return {
      ok: true,
      idEntri: lama.id,
      dipakaiRp: keRupiah(-lama.jumlahRp),
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }
  // §9.6: akun DIBEKUKAN tidak bisa memakai saldo (dicek di dalam kunci).
  const tolak = tolakBilaTidakAktif(terkunci.status);
  if (tolak) return tolak;

  const dipakai = hitungPakaiSaldo(terkunci.saldoRp, maks);
  if (dipakai === 0) {
    return {
      ok: true,
      idEntri: null,
      dipakaiRp: dipakai,
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
    referensiId: uuidKanonik(m.invoiceId),
    saldoSesudahRp: sesudah,
  });
  return {
    ok: true,
    idEntri: hasil.id,
    dipakaiRp: dipakai,
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

/**
 * SAL.kredit (§8, §12.1): REFUND / REFUND_ONGKIR / SELISIH_HARGA / BAYAR_TERLAMBAT ke akun pembayar.
 * Nominal dihitung pemanggil (engine-harga §5); kunci & referensi diturunkan dari `sumber`.
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

  const terkunci = await kunciAkunSaldo(tx, akunId);
  const lama = await cariEntri(tx, id.kunciIdempotensi);
  if (lama) {
    if (!samaIsi(lama, { akunId, jumlahRp: jumlah, jenis: id.jenis })) {
      throw new GalatSaldo("KUNCI_BENTROK", "Kunci idempotensi ledger dipakai entri berbeda");
    }
    return {
      ok: true,
      idEntri: lama.id,
      jumlahRp: jumlah,
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }
  const tolak = tolakBilaTidakAktif(terkunci.status);
  if (tolak) return tolak;

  const sesudah = saldoSesudah(terkunci.saldoRp, jumlah);
  const hasil = await sisipkan(tx, {
    akunId,
    jumlahRp: jumlah,
    jenis: id.jenis,
    kunciIdempotensi: id.kunciIdempotensi,
    referensiJenis: id.referensiJenis,
    referensiId: id.referensiId,
    saldoSesudahRp: sesudah,
    dapatDicairkanSejak: m.dapatDicairkanSejak ?? null,
  });
  return {
    ok: true,
    idEntri: hasil.id,
    jumlahRp: jumlah,
    saldoSesudahRp: sesudah,
    duplikat: hasil.duplikat,
  };
}

/**
 * SALDO_BALIK (§8.2, §9.4): saldo yang dipakai invoice kembali ketika invoice berakhir tanpa lunas.
 * Pemanggil (I4/I5/I6, job TTL §7 langkah 5) WAJIB sudah mengubah status invoice ke KEDALUWARSA /
 * DIBATALKAN / DIGANTI di transaksi yang sama — invoice LUNAS ditolak karena saldonya menjadi bagian
 * REFUND (§8.1.3), sehingga saldo yang sama tidak bisa kembali dua kali.
 * Nominal & akun TIDAK dari pemanggil: diambil dari entri `debit:{invoice_id}` (harus cocok dengan
 * `invoice.saldo_dipakai_rp` & pembayar).
 */
export async function kembalikanSaldoInvoice(
  tx: Tx,
  m: { readonly invoiceId: string },
): Promise<HasilKredit> {
  wajibTransaksi(tx);
  const invoiceId = uuidKanonik(m.invoiceId);
  const [inv] = await tx
    .select({
      status: invoice.status,
      pembayarAkunId: invoice.pembayarAkunId,
      saldoDipakaiRp: invoice.saldoDipakaiRp,
    })
    .from(invoice)
    .where(eq(invoice.id, invoiceId));
  if (!inv) throw new GalatSaldo("INVOICE_TIDAK_SESUAI", "Invoice tidak ditemukan");
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
  const lama = await cariEntri(tx, kunci);
  if (lama) {
    if (!samaIsi(lama, { akunId, jumlahRp: jumlah, jenis: "SALDO_BALIK" })) {
      throw new GalatSaldo("KUNCI_BENTROK", "Kunci saldo-balik dipakai entri berbeda");
    }
    return {
      ok: true,
      idEntri: lama.id,
      jumlahRp: jumlah,
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }
  // Mengikuti §8.1.6 / kontrak §12.1 apa adanya: akun DIBEKUKAN tidak dikredit (lihat L-01).
  const tolak = tolakBilaTidakAktif(terkunci.status);
  if (tolak) return tolak;

  const sesudah = saldoSesudah(terkunci.saldoRp, jumlah);
  const hasil = await sisipkan(tx, {
    akunId,
    jumlahRp: jumlah,
    jenis: "SALDO_BALIK",
    kunciIdempotensi: kunci,
    referensiJenis: "INVOICE",
    referensiId: invoiceId,
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

// ---- Koreksi admin four-eyes (T-004 §3.11; trigger migrasi 0004 + indeks 0005) ----
// Default paling aman skema: SEMUA koreksi (kredit & debit) butuh persetujuan admin lain.
// Izin RBAC (`saldo.koreksi`, `saldo.setujui`) dicek lapisan API/panel admin — belum ada rute di task ini.

export const PANJANG_ALASAN_KOREKSI_MAKS = 500;

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
  const [b] = await tx
    .insert(pengajuanKoreksiSaldo)
    .values({
      akunId: uuidKanonik(m.akunId),
      jumlahRp: nominalKoreksi(m.jumlahRp),
      alasan,
      diajukanOleh: uuidKanonik(m.adminId),
    })
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
 * Keputusan koreksi oleh admin LAIN (pemutus ≠ pengaju). DISETUJUI → ledger KOREKSI_ADMIN di transaksi
 * yang sama (kunci `koreksi:{pengajuan_id}`). Koreksi debit yang membuat saldo negatif → SALDO_KURANG dan
 * seluruh keputusan rollback (admin harus menolak atau mengajukan nominal lain).
 * Koreksi tetap berlaku untuk akun DIBEKUKAN (tindakan admin, bukan dana masuk dari pembayaran).
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
  const lama = await cariEntri(tx, kunci);
  if (lama) {
    if (!samaIsi(lama, { akunId: pj.akunId, jumlahRp: pj.jumlahRp, jenis: "KOREKSI_ADMIN" })) {
      throw new GalatSaldo("KUNCI_BENTROK", "Kunci koreksi dipakai entri berbeda");
    }
    return {
      hasil: "DISETUJUI",
      idEntri: lama.id,
      saldoSesudahRp: keRupiah(lama.saldoSesudahRp),
      duplikat: true,
    };
  }
  const sesudah = saldoSesudah(terkunci.saldoRp, pj.jumlahRp);
  const hasil = await sisipkan(tx, {
    akunId: pj.akunId,
    jumlahRp: pj.jumlahRp,
    jenis: "KOREKSI_ADMIN",
    kunciIdempotensi: kunci,
    referensiJenis: "PENGAJUAN_KOREKSI",
    referensiId: pengajuanId,
    saldoSesudahRp: sesudah,
    dapatDicairkanSejak: pj.jumlahRp > 0 ? (m.dapatDicairkanSejak ?? null) : null,
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
             WHERE i.pembayar_akun_id = ${ledgerSaldo.akunId}
               AND i.id = CASE ${ledgerSaldo.referensiJenis}
                 WHEN 'INVOICE' THEN ${ledgerSaldo.referensiId}
                 WHEN 'BARIS_INVOICE' THEN (SELECT b.invoice_id FROM baris_invoice b WHERE b.id = ${ledgerSaldo.referensiId})
                 WHEN 'PEMBAYARAN' THEN (SELECT p.invoice_id FROM pembayaran p WHERE p.id = ${ledgerSaldo.referensiId})
               END)`;
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
