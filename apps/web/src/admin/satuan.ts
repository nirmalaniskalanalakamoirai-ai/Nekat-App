// Pilihan satuan jual di form "Tambah satuan" (T-036, perbaikan bug-03).
import type { JenisSatuan } from "./api";

export const SEMUA_JENIS: readonly JenisSatuan[] = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"];

/** Jenis yang belum dipakai SKU ini (urutan tetap). */
export function jenisTersedia(dipakai: ReadonlySet<string>): JenisSatuan[] {
  return SEMUA_JENIS.filter((j) => !dipakai.has(j));
}

/**
 * Jenis yang BENAR-BENAR terpilih: pilihan pengguna bila masih tersedia, selain itu opsi pertama.
 * Dipakai untuk nilai `<select>`, isian "Isi per …", dan data yang dikirim — ketiganya selalu sama
 * (sebelumnya state lama "DUS" tetap terkirim walau dropdown menampilkan opsi lain).
 */
export function jenisTerpilih(
  pilihan: JenisSatuan,
  tersedia: readonly JenisSatuan[],
): JenisSatuan | null {
  if (tersedia.includes(pilihan)) return pilihan;
  return tersedia[0] ?? null;
}

export const isiBebas = (j: JenisSatuan | null) => j === "DUS" || j === "KOLI";
