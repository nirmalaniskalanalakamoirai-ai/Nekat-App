// Ledger saldo pengguna (T-021). Fungsi murni: jenis entri, kunci idempotensi deterministik, nominal.
// Sumber: docs/flow/pembayaran.md §3 (invarian uang), §8 (refund & selisih → saldo), §9 (pemakaian saldo),
// §12.1 (kontrak SAL); keputusan K-13 (satu ledger, saldo = loyalty point), F-03, G-06 (1 poin = Rp1).
// Pencairan (PENCAIRAN / PENCAIRAN_BATAL) SENGAJA tidak punya pembuat entri di sini: dikunci sampai H5 (K-34).
//
// Semua nominal = rupiah integer, tanpa pembulatan. Tidak ada angka harga/margin di modul ini.

import { isRupiah, keRupiah, type Rupiah } from "@nekat/shared";

/** Jenis kredit (+). Harus sama dengan `JENIS_KREDIT_SALDO` skema DB (dites di @nekat/db). */
export const JENIS_KREDIT = [
  "SELISIH_HARGA",
  "REFUND",
  "REFUND_ONGKIR",
  "BAYAR_TERLAMBAT",
  "SALDO_BALIK",
  "PENCAIRAN_BATAL",
] as const;
/** Jenis debit (−). */
export const JENIS_DEBIT = ["PAKAI_CHECKOUT", "PENCAIRAN"] as const;
export const JENIS_LEDGER = [...JENIS_KREDIT, ...JENIS_DEBIT, "KOREKSI_ADMIN"] as const;

export type JenisLedger = (typeof JENIS_LEDGER)[number];

/** Jenis kredit yang boleh ditulis lewat `kredit()` (kontrak §12.1). SALDO_BALIK punya jalur sendiri. */
export type JenisKreditUmum = "REFUND" | "REFUND_ONGKIR" | "SELISIH_HARGA" | "BAYAR_TERLAMBAT";

/** Nilai `ledger_saldo.referensi_jenis`. `PENGAJUAN_KOREKSI` khusus KOREKSI_ADMIN (trigger migrasi 0004). */
export const REFERENSI_LEDGER = [
  "INVOICE",
  "PESERTA_GRUP",
  "BARIS_INVOICE",
  "PEMBAYARAN",
  "KELUHAN",
  "PENGAJUAN_KOREKSI",
] as const;
export type ReferensiLedger = (typeof REFERENSI_LEDGER)[number];

/**
 * Sumber kredit (pembayaran.md §8.2). Pemanggil menyebut IDENTITAS sumber, bukan kunci: kunci, jenis,
 * dan referensi diturunkan di sini sehingga eksekusi ulang dari sumber yang sama selalu menghasilkan
 * kunci yang sama (tanpa nomor urut / id percobaan).
 *
 * `invoiceId` = invoice LUNAS sumber dana (tidak masuk kunci; dipakai repo untuk mengikat akun pembayar,
 * memverifikasi peserta/baris milik invoice itu, dan menjaga Σ kredit per invoice ≤ total_rp).
 * Untuk STOK_HABIS/ALOKASI invoice diturunkan dari baris; untuk BAYAR_TERLAMBAT dari pembayaran.
 */
export type SumberKredit =
  | {
      readonly jenis: "REFUND";
      readonly alasan: "GRUP_BATAL";
      readonly invoiceId: string;
      readonly pesertaId: string;
      readonly grupId: string;
    }
  | {
      readonly jenis: "REFUND";
      readonly alasan: "SLOT_BATAL";
      readonly invoiceId: string;
      readonly pesertaId: string;
      readonly slotId: string;
    }
  | { readonly jenis: "REFUND"; readonly alasan: "STOK_HABIS"; readonly barisInvoiceId: string }
  | {
      readonly jenis: "REFUND";
      readonly alasan: "ALOKASI";
      readonly barisInvoiceId: string;
      /**
       * Identitas STABIL satu cut-off: `cutoff:{slot_id}` (kunci job_run), bukan id percobaan/lease.
       * Dikanonikkan (huruf kecil, format wajib) agar variasi penulisan tidak menghasilkan kunci baru.
       */
      readonly jobCutoffId: string;
    }
  | {
      readonly jenis: "REFUND";
      readonly alasan: "KELUHAN";
      readonly invoiceId: string;
      readonly keluhanId: string;
    }
  | {
      readonly jenis: "SELISIH_HARGA";
      readonly invoiceId: string;
      readonly grupId: string;
      readonly pesertaId: string;
    }
  | { readonly jenis: "REFUND_ONGKIR"; readonly invoiceId: string; readonly pesertaId: string }
  | { readonly jenis: "BAYAR_TERLAMBAT"; readonly pembayaranId: string };

export interface IdentitasEntri {
  readonly jenis: JenisLedger;
  readonly kunciIdempotensi: string;
  readonly referensiJenis: ReferensiLedger;
  readonly referensiId: string;
}

export class GalatSaldo extends Error {
  constructor(
    readonly kode:
      | "ID_TIDAK_VALID"
      | "NOMINAL_TIDAK_VALID"
      | "SALDO_KURANG"
      | "KUNCI_BENTROK"
      | "AKUN_TIDAK_ADA"
      | "INVOICE_TIDAK_SESUAI"
      | "AKUN_TIDAK_SESUAI"
      | "MELEBIHI_DIBAYAR"
      | "SUMBER_TIDAK_SESUAI"
      | "KOREKSI_TIDAK_SAH"
      | "BUKAN_TRANSAKSI",
    pesan: string,
  ) {
    // Pesan tidak memuat nilai masukan mentah (bisa dari pengguna); id internal boleh.
    super(pesan);
    this.name = "GalatSaldo";
  }
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Identitas stabil satu cut-off: `cutoff:{slot_id}`. */
const POLA_JOB_CUTOFF = /^cutoff:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** UUID huruf kecil (bentuk kanonik PostgreSQL) agar kunci tidak berbeda karena huruf besar/kecil. */
export function uuidKanonik(nilai: string): string {
  const v = nilai.toLowerCase();
  if (!POLA_UUID.test(v)) throw new GalatSaldo("ID_TIDAK_VALID", "ID harus UUID");
  return v;
}

/** Kanonik `cutoff:{uuid huruf kecil}`; bentuk lain ditolak (bukan dinormalkan diam-diam). */
export function jobCutoffKanonik(nilai: string): string {
  const v = nilai.toLowerCase();
  if (!POLA_JOB_CUTOFF.test(v)) {
    throw new GalatSaldo("ID_TIDAK_VALID", "ID cut-off harus berbentuk cutoff:{slot_id}");
  }
  return v;
}

/** `debit:{invoice_id}` — saldo dipakai saat tagihan terbit (§8.2). */
export function kunciDebitCheckout(invoiceId: string): string {
  return `debit:${uuidKanonik(invoiceId)}`;
}

/** `saldo-balik:{invoice_id}` — invoice KEDALUWARSA / DIBATALKAN / DIGANTI sebelum lunas (§8.2). */
export function kunciSaldoBalik(invoiceId: string): string {
  return `saldo-balik:${uuidKanonik(invoiceId)}`;
}

/** `koreksi:{pengajuan_id}` — koreksi admin four-eyes (§8.2). */
export function kunciKoreksi(pengajuanId: string): string {
  return `koreksi:${uuidKanonik(pengajuanId)}`;
}

type SumberRefund = Extract<SumberKredit, { jenis: "REFUND" }>;

function identitasRefund(s: SumberRefund): IdentitasEntri {
  switch (s.alasan) {
    case "GRUP_BATAL": {
      const p = uuidKanonik(s.pesertaId);
      return {
        jenis: "REFUND",
        kunciIdempotensi: `refund:${p}:GRUP_BATAL:${uuidKanonik(s.grupId)}`,
        referensiJenis: "PESERTA_GRUP",
        referensiId: p,
      };
    }
    case "SLOT_BATAL": {
      const p = uuidKanonik(s.pesertaId);
      return {
        jenis: "REFUND",
        kunciIdempotensi: `refund:${p}:SLOT_BATAL:${uuidKanonik(s.slotId)}`,
        referensiJenis: "PESERTA_GRUP",
        referensiId: p,
      };
    }
    case "STOK_HABIS": {
      const b = uuidKanonik(s.barisInvoiceId);
      return {
        jenis: "REFUND",
        kunciIdempotensi: `refund:${b}:STOK_HABIS`,
        referensiJenis: "BARIS_INVOICE",
        referensiId: b,
      };
    }
    case "ALOKASI": {
      const b = uuidKanonik(s.barisInvoiceId);
      return {
        jenis: "REFUND",
        kunciIdempotensi: `refund:${b}:ALOKASI:${jobCutoffKanonik(s.jobCutoffId)}`,
        referensiJenis: "BARIS_INVOICE",
        referensiId: b,
      };
    }
    case "KELUHAN": {
      const k = uuidKanonik(s.keluhanId);
      return {
        jenis: "REFUND",
        kunciIdempotensi: `keluhan:${k}`,
        referensiJenis: "KELUHAN",
        referensiId: k,
      };
    }
  }
  // Pagar untuk data dari luar TypeScript.
  throw new GalatSaldo("ID_TIDAK_VALID", "Alasan refund tidak dikenal");
}

/** Turunkan jenis, kunci, dan referensi dari sumber kredit (tabel pembayaran.md §8.2). */
export function identitasKredit(s: SumberKredit): IdentitasEntri {
  switch (s.jenis) {
    case "REFUND":
      return identitasRefund(s);
    case "SELISIH_HARGA": {
      const p = uuidKanonik(s.pesertaId);
      return {
        jenis: "SELISIH_HARGA",
        kunciIdempotensi: `selisih:${uuidKanonik(s.grupId)}:${p}`,
        referensiJenis: "PESERTA_GRUP",
        referensiId: p,
      };
    }
    case "REFUND_ONGKIR": {
      const i = uuidKanonik(s.invoiceId);
      return {
        jenis: "REFUND_ONGKIR",
        kunciIdempotensi: `refund_ongkir:${i}:${uuidKanonik(s.pesertaId)}`,
        referensiJenis: "INVOICE",
        referensiId: i,
      };
    }
    case "BAYAR_TERLAMBAT": {
      const p = uuidKanonik(s.pembayaranId);
      return {
        jenis: "BAYAR_TERLAMBAT",
        kunciIdempotensi: `bayar_terlambat:${p}`,
        referensiJenis: "PEMBAYARAN",
        referensiId: p,
      };
    }
  }
  // Tidak terjangkau bila tipe dipatuhi; pagar untuk data dari luar TypeScript.
  throw new GalatSaldo("ID_TIDAK_VALID", "Sumber kredit tidak dikenal");
}

/** Nominal kredit/debit (besaran, tanpa tanda): rupiah integer aman dan > 0. */
export function nominalPositif(nilai: number): Rupiah {
  if (!isRupiah(nilai) || nilai === 0) {
    throw new GalatSaldo("NOMINAL_TIDAK_VALID", "Nominal harus bilangan bulat rupiah > 0");
  }
  return nilai;
}

/** Nominal bertanda koreksi admin: bilangan bulat aman, ≠ 0. */
export function nominalKoreksi(nilai: number): number {
  if (!Number.isSafeInteger(nilai) || nilai === 0) {
    throw new GalatSaldo("NOMINAL_TIDAK_VALID", "Nominal koreksi harus bilangan bulat ≠ 0");
  }
  return nilai;
}

/**
 * Saldo yang dipakai checkout (§9.1): `min(saldo, maks)`. Dihitung DI DALAM kunci `akun_saldo`.
 * Penyesuaian agar sisa bayar ≥ minimum kanal menunggu K-50 (belum diterapkan).
 */
export function hitungPakaiSaldo(saldoRp: Rupiah, maksRp: Rupiah): Rupiah {
  return keRupiah(Math.min(keRupiah(saldoRp), keRupiah(maksRp)));
}

/** Saldo sesudah entri; melempar SALDO_KURANG bila negatif (pagar kode, DB CHECK = pagar terakhir). */
export function saldoSesudah(saldoRp: Rupiah, jumlahBertandaRp: number): Rupiah {
  const hasil = keRupiah(saldoRp) + jumlahBertandaRp;
  if (!Number.isSafeInteger(hasil)) {
    throw new GalatSaldo("NOMINAL_TIDAK_VALID", "Saldo melewati batas bilangan bulat aman");
  }
  if (hasil < 0) throw new GalatSaldo("SALDO_KURANG", "Saldo tidak cukup");
  return keRupiah(hasil);
}

/** Label jenis untuk riwayat pengguna (§9.8: bahasa pengguna; saldo tampil sebagai "Poin NEKAT"). */
export const LABEL_JENIS_LEDGER: Readonly<Record<JenisLedger, string>> = {
  SELISIH_HARGA: "Selisih harga grup",
  REFUND: "Pengembalian dana",
  REFUND_ONGKIR: "Pengembalian ongkir",
  BAYAR_TERLAMBAT: "Pembayaran masuk setelah batas waktu",
  SALDO_BALIK: "Poin dikembalikan (tagihan batal)",
  PENCAIRAN_BATAL: "Pencairan dibatalkan",
  PAKAI_CHECKOUT: "Dipakai untuk bayar tagihan",
  PENCAIRAN: "Pencairan",
  KOREKSI_ADMIN: "Koreksi oleh admin",
};

export function labelJenisLedger(jenis: string): string {
  return (LABEL_JENIS_LEDGER as Readonly<Record<string, string>>)[jenis] ?? "Mutasi poin";
}

/** Cursor riwayat: id entri terakhir yang sudah ditampilkan (keyset, urut id menurun). */
export function bacaCursorRiwayat(cursor: string | undefined): number | undefined {
  if (cursor === undefined || cursor === "") return undefined;
  if (!/^[1-9][0-9]{0,15}$/.test(cursor)) {
    throw new GalatSaldo("ID_TIDAK_VALID", "Cursor tidak valid");
  }
  const n = Number(cursor);
  if (!Number.isSafeInteger(n)) throw new GalatSaldo("ID_TIDAK_VALID", "Cursor tidak valid");
  return n;
}
