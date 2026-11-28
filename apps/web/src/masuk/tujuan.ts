// Tujuan setelah masuk (T-016, T-007 H-07 "kembali ke niat tersimpan"). Hanya path relatif di
// origin yang sama: mencegah open redirect (`//jahat.contoh`, `https://…`, `/\jahat`, `javascript:`).

const BAWAAN = "/";
const POLA_AMAN = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%+:]*$/;

export function tujuanSetelahMasuk(kembali: string | null): string {
  if (!kembali || kembali.length > 512 || !POLA_AMAN.test(kembali)) return BAWAAN;
  // Jangan kembali ke layar masuk itu sendiri (putaran).
  if (kembali === "/masuk" || kembali.startsWith("/masuk?") || kembali.startsWith("/masuk/")) {
    return BAWAAN;
  }
  return kembali;
}

/** Link ke layar masuk yang membawa halaman asal (dipakai halaman lain saat perlu login). */
export function linkMasuk(asal: string): string {
  const t = tujuanSetelahMasuk(asal);
  return t === BAWAAN ? "/masuk" : `/masuk?kembali=${encodeURIComponent(t)}`;
}

/** Format hitung mundur m:ss. */
export function formatMenitDetik(detik: number): string {
  const d = Math.max(0, Math.ceil(detik));
  return `${String(Math.floor(d / 60))}:${String(d % 60).padStart(2, "0")}`;
}
