import { z } from "zod";

/**
 * Nominal rupiah penuh (ADR-0001 §5.1): bilangan bulat aman (`Number.isSafeInteger`) dan >= 0.
 * Tidak ada float/pecahan untuk uang. Tipe bermerek agar `number` biasa tidak bisa
 * dipakai sebagai uang tanpa lewat validasi.
 *
 * Catatan: nilai bertanda (debit/kredit ledger) dibuat terpisah di T-021.
 */
export type Rupiah = number & { readonly __merek: "Rupiah" };

export function isRupiah(nilai: unknown): nilai is Rupiah {
  return typeof nilai === "number" && Number.isSafeInteger(nilai) && nilai >= 0;
}

export class RupiahTidakValidError extends Error {
  constructor() {
    // Pesan sengaja tidak memuat nilai masukan (bisa berasal dari input pengguna).
    super("Nominal rupiah harus bilangan bulat aman dan tidak negatif");
    this.name = "RupiahTidakValidError";
  }
}

/** Mengubah `number` menjadi `Rupiah`; melempar `RupiahTidakValidError` bila tidak valid. */
export function keRupiah(nilai: number): Rupiah {
  if (!isRupiah(nilai)) {
    throw new RupiahTidakValidError();
  }
  return nilai;
}

/** Skema Zod untuk kontrak API/worker/PWA. Tipe keluarannya `Rupiah` (dipersempit oleh `isRupiah`). */
export const rupiahSchema = z
  .number()
  .refine(isRupiah, { message: "Nominal rupiah harus bilangan bulat aman dan tidak negatif" });
