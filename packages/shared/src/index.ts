// @nekat/shared — skema Zod, tipe Rupiah, kode error, teks UI bersama (ADR-0001 §3.1).
// Boleh dipakai semua paket & app. Tidak boleh mengimpor paket NEKAT lain.

export { isRupiah, keRupiah, rupiahSchema, RupiahTidakValidError, type Rupiah } from "./rupiah.js";

export const NAMA_APLIKASI = "NEKAT";
export * from "./inventori.js";
export * from "./konfig-lokasi.js";
export * from "./pembayaran.js";
