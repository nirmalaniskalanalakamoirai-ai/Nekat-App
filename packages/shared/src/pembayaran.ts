// Kontrak API tagihan & pembayaran (T-029) yang dipakai bersama apps/api dan apps/web.
// Nominal selalu dari server (rupiah integer, docs/flow/pembayaran.md §3.1). Klien hanya mengirim
// metode + kanal (kode bank VA), tidak pernah nominal/akun.
import { z } from "zod";
import { rupiahSchema } from "./rupiah.js";

/** Metode yang bisa dipilih di API. E-wallet belum ada (K-36/K-57: tagihan grup hanya QRIS/VA). */
export const METODE_BAYAR_API = ["QRIS", "VA"] as const;
export type MetodeBayarApi = (typeof METODE_BAYAR_API)[number];

/** Kode bank VA: huruf besar/angka/garis bawah saja (dipetakan adapter ke channel Xendit). */
export const POLA_KODE_BANK = /^[A-Z][A-Z0-9_]{1,19}$/;

export const permintaanBayarSchema = z.strictObject({
  metode: z.enum(METODE_BAYAR_API),
  kanal: z.string().regex(POLA_KODE_BANK).optional(),
});
export type PermintaanBayar = z.infer<typeof permintaanBayarSchema>;

export const STATUS_TAGIHAN_API = [
  "DITERBITKAN",
  "LUNAS",
  "KEDALUWARSA",
  "DIBATALKAN",
  "DIGANTI",
] as const;

export const STATUS_PEMBAYARAN_API = [
  "MENUNGGU",
  "LUNAS",
  "KEDALUWARSA",
  "GAGAL",
  "NOMINAL_TIDAK_COCOK",
  "LUNAS_TERLAMBAT",
] as const;
export type StatusPembayaranApi = (typeof STATUS_PEMBAYARAN_API)[number];

const isoWaktu = z.iso.datetime({ offset: true });

export const instruksiSchema = z.discriminatedUnion("jenis", [
  z.strictObject({ jenis: z.literal("QRIS"), qrString: z.string().min(1).max(2048) }),
  z.strictObject({
    jenis: z.literal("VA"),
    bank: z.string().regex(POLA_KODE_BANK),
    nomorVa: z.string().regex(/^[0-9]{6,32}$/),
    namaPenerima: z.string().min(1).max(64),
  }),
]);
export type Instruksi = z.infer<typeof instruksiSchema>;

/**
 * `tahap`:
 * - `SIAP`: instruksi tersedia.
 * - `MENYIAPKAN`: gateway belum menjawab (timeout/5xx); kirim ulang POST /bayar (external_id sama, FP-01).
 */
export const pembayaranTampilSchema = z.strictObject({
  id: z.uuid(),
  metode: z.enum(METODE_BAYAR_API),
  kanal: z.string().nullable(),
  jumlahRp: rupiahSchema,
  status: z.enum(STATUS_PEMBAYARAN_API),
  tahap: z.enum(["SIAP", "MENYIAPKAN"]),
  instruksi: instruksiSchema.nullable(),
  kedaluwarsaPada: isoWaktu,
  alasanGagal: z.string().nullable(),
});
export type PembayaranTampil = z.infer<typeof pembayaranTampilSchema>;

export const tagihanBayarSchema = z.strictObject({
  tagihan: z.strictObject({
    id: z.uuid(),
    nomor: z.string(),
    status: z.enum(STATUS_TAGIHAN_API),
    totalRp: rupiahSchema,
    saldoDipakaiRp: rupiahSchema,
    sisaBayarRp: rupiahSchema,
    kedaluwarsaPada: isoWaktu,
    gabungan: z.boolean(),
  }),
  pembayaran: pembayaranTampilSchema.nullable(),
  metodeTersedia: z.array(
    z.strictObject({ metode: z.enum(METODE_BAYAR_API), kanal: z.array(z.string()) }),
  ),
  /** Jam server saat respons dibuat: klien menghitung selisih jam HP (T-007 §4.5). */
  waktuServer: isoWaktu,
  /**
   * Hasil POST /bayar (null pada GET):
   * - `GANTI_METODE_GAGAL`: batal ke Xendit gagal, instruksi lama tetap berlaku (FP-24).
   * - `SEDANG_DIPERIKSA`: pembayaran lama ternyata sudah dibayar; menunggu konfirmasi (T-030).
   * - `METODE_GAGAL`: gagal permanen, pilih metode lain (FP-25).
   */
  hasil: z
    .enum(["OK", "MENYIAPKAN", "GANTI_METODE_GAGAL", "SEDANG_DIPERIKSA", "METODE_GAGAL"])
    .nullable(),
});
export type TagihanBayar = z.infer<typeof tagihanBayarSchema>;
