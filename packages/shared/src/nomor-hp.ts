// Nomor HP Indonesia (T-016). Dipakai API (normalisasi sebelum HMAC) dan web (pratinjau & samaran).
// Satu sumber agar "0812…", "62812…", "+62 812-…" dan "812…" selalu menjadi nomor E.164 yang sama,
// sehingga satu orang tidak bisa membuat dua akun hanya dengan menulis nomornya berbeda.

/**
 * Nomor seluler Indonesia dalam E.164: +62, lalu 8, lalu 7–12 digit (total 8–13 digit setelah 62,
 * sesuai CHECK `akun_nomor_hp_format`). Nomor telepon rumah (+6221…) tidak menerima WhatsApp OTP.
 */
export const POLA_HP_E164 = /^\+628[0-9]{7,12}$/;

/** Panjang maksimum teks masukan sebelum dinormalisasi (tolak masukan raksasa lebih awal). */
export const PANJANG_MASUKAN_HP_MAKS = 32;

/**
 * Normalisasi masukan pengguna ke E.164. Hasil `null` = bukan nomor seluler Indonesia yang sah.
 * Spasi, titik, tanda hubung, dan kurung dibuang. Awalan yang diterima: `+62`, `62`, `0`, atau
 * langsung `8` (kolom web memakai awalan +62 tetap). `+620…` dirapikan menjadi `+62…`.
 */
export function normalisasiNomorHp(masukan: string): string | null {
  if (masukan.length > PANJANG_MASUKAN_HP_MAKS) return null;
  let d = masukan.replace(/[\s().-]/g, "");
  if (d.startsWith("+")) {
    if (!d.startsWith("+62")) return null;
    d = d.slice(3);
  } else if (d.startsWith("62")) {
    d = d.slice(2);
  }
  if (d.startsWith("0")) d = d.slice(1);
  const hasil = `+62${d}`;
  return POLA_HP_E164.test(hasil) ? hasil : null;
}

/**
 * Nomor tersamar untuk tampilan ("+62 812•••• 34"). Hanya untuk UI pemilik nomor itu sendiri,
 * bukan untuk log (log tidak memuat nomor sama sekali).
 */
export function samarkanNomorHp(e164: string): string {
  if (!POLA_HP_E164.test(e164)) return "+62 ••••";
  const lokal = e164.slice(3);
  return `+62 ${lokal.slice(0, 3)}${"•".repeat(4)} ${lokal.slice(-2)}`;
}
