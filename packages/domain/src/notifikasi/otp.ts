// Kebijakan OTP login pembeli (T-016, ADR-0001 §4.3, CWE-307/799). Angka = DEFAULT SEMENTARA
// teknis (lihat keputusan terbuka W-01 di laporan T-016); semua bisa diubah lewat env tanpa ubah kode.

export interface KebijakanOtp {
  /** Umur kode (menit). Sama dengan `{n}` di template auth_otp_v1 (T-010 WA-01). */
  readonly kedaluwarsaMenit: number;
  /** Percobaan per kode; habis → kode hangus, wajib minta kode baru. */
  readonly maksPercobaan: number;
  /** Jeda minimal antar kirim ke nomor yang sama (detik). */
  readonly jedaKirimUlangDetik: number;
  /** Kirim per nomor per hari WIB (`otp_gagal_harian.kirim`). */
  readonly maksKirimPerHari: number;
  /** Percobaan salah per nomor per hari WIB, TIDAK di-reset oleh kirim ulang (`otp_gagal_harian.gagal`). */
  readonly maksGagalPerHari: number;
  /** Permintaan kirim per IP (atau /64 IPv6) per jam. */
  readonly maksKirimPerIpPerJam: number;
  /** Percobaan verifikasi per IP per menit. */
  readonly maksVerifikasiPerIpPerMenit: number;
  /** Anggaran global seluruh OTP (anti pumping). 0 = tanpa batas. */
  readonly anggaranPerJam: number;
  readonly anggaranPerHari: number;
}

export const KEBIJAKAN_OTP_BAWAAN: KebijakanOtp = {
  kedaluwarsaMenit: 5,
  maksPercobaan: 5,
  jedaKirimUlangDetik: 60,
  maksKirimPerHari: 8,
  maksGagalPerHari: 15,
  maksKirimPerIpPerJam: 30,
  maksVerifikasiPerIpPerMenit: 30,
  anggaranPerJam: 600,
  anggaranPerHari: 5000,
};

/** Panjang kode OTP. */
export const PANJANG_KODE_OTP = 6;
export const POLA_KODE_OTP = /^[0-9]{6}$/;

const WIB_MS = 7 * 60 * 60_000;

/** Tanggal kalender WIB (YYYY-MM-DD) untuk penghitung harian `otp_gagal_harian`. */
export function tanggalWib(waktu: Date): string {
  return new Date(waktu.getTime() + WIB_MS).toISOString().slice(0, 10);
}

/** Awal hari WIB (00.00 WIB) sebagai instan UTC. */
export function awalHariWib(waktu: Date): Date {
  return new Date(Date.parse(`${tanggalWib(waktu)}T00:00:00.000Z`) - WIB_MS);
}
