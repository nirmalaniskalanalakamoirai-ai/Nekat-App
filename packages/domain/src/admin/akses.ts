// T-036: aturan akses admin (fungsi murni): RBAC per izin, penguncian akun, redaksi isi log.
// ADR-0001 §7 & T-004 §3.3: dua peran (`owner`, `admin`), izin per aksi `<domain>.<aksi>`.

/** Izin yang dipakai panel admin T-036. Daftar lengkap & pemetaan peran ada di seed DB (T-004 §3.3). */
export const IZIN = {
  PRODUK_UBAH: "produk.ubah",
  STOK_UBAH: "stok.ubah",
  ADMIN_KELOLA: "admin.kelola",
} as const;

/** true bila admin memegang izin yang diminta (tidak ada wildcard; owner pun lewat tabel izin). */
export function punyaIzin(izinAdmin: ReadonlySet<string>, izin: string): boolean {
  return izinAdmin.has(izin);
}

/** Kebijakan penguncian (CWE-307). Bukan angka bisnis: nilai keamanan, dites. */
export interface KebijakanKunci {
  /** Gagal beruntun (kata sandi ATAU TOTP) sebelum dikunci. */
  readonly batasGagal: number;
  readonly lamaKunciMenit: number;
}

export const KEBIJAKAN_KUNCI_BAWAAN: KebijakanKunci = { batasGagal: 5, lamaKunciMenit: 15 };

export interface StatusKunci {
  readonly gagalBeruntun: number;
  readonly dikunciSampai: Date | null;
}

export function sedangDikunci(s: StatusKunci, sekarang: Date): boolean {
  return s.dikunciSampai !== null && s.dikunciSampai.getTime() > sekarang.getTime();
}

/**
 * Status setelah satu kegagalan. Kunci yang sudah lewat → penghitung mulai dari 1 lagi.
 * Mencapai batas → dikunci `lamaKunciMenit` sejak sekarang.
 */
export function setelahGagal(s: StatusKunci, sekarang: Date, k: KebijakanKunci): StatusKunci {
  const kunciLewat = s.dikunciSampai !== null && s.dikunciSampai.getTime() <= sekarang.getTime();
  const gagal = (kunciLewat ? 0 : s.gagalBeruntun) + 1;
  if (gagal >= k.batasGagal) {
    return {
      gagalBeruntun: gagal,
      dikunciSampai: new Date(sekarang.getTime() + k.lamaKunciMenit * 60_000),
    };
  }
  return { gagalBeruntun: gagal, dikunciSampai: kunciLewat ? null : s.dikunciSampai };
}

/** Kunci yang namanya menandakan rahasia/PII: nilainya tidak pernah masuk `log_admin`. */
const POLA_RAHASIA =
  /(sandi|password|totp|rahasia|secret|token|kode_?hash|pemulihan|otp|nomor_?hp|alamat|^ip$|^ip_|_ip$|ip_?hmac)/i;

export const TEKS_REDAKSI = "[REDAKSI]";

/** Salinan dalam objek untuk `log_admin.sebelum/sesudah` dengan nilai rahasia/PII diganti. */
export function redaksiUntukLog(nilai: unknown): unknown {
  if (Array.isArray(nilai)) return nilai.map(redaksiUntukLog);
  if (nilai instanceof Date) return nilai.toISOString();
  if (nilai !== null && typeof nilai === "object") {
    const hasil: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(nilai)) {
      hasil[k] = POLA_RAHASIA.test(k) ? TEKS_REDAKSI : redaksiUntukLog(v);
    }
    return hasil;
  }
  return nilai;
}

/** Hanya field yang berubah (untuk ringkasan log). Nilai dibandingkan sebagai JSON. */
export function bedaField(
  sebelum: Readonly<Record<string, unknown>>,
  sesudah: Readonly<Record<string, unknown>>,
): string[] {
  const kunci = new Set([...Object.keys(sebelum), ...Object.keys(sesudah)]);
  return [...kunci].filter((k) => JSON.stringify(sebelum[k]) !== JSON.stringify(sesudah[k])).sort();
}
