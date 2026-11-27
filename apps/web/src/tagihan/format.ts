// Fungsi murni halaman tagihan (H-10). Tidak ada perhitungan harga: nominal hanya diformat dari server.
import { T } from "./teks";

/** Rupiah integer dari server → "Rp130.000" (tanpa pembulatan, H6). */
export function rupiah(n: number): string {
  return `Rp${Math.trunc(n).toLocaleString("id-ID")}`;
}

/**
 * Selisih jam HP terhadap jam server (T-007 §4.5): `waktuServer` dari respons dikurangi jam HP saat respons
 * diterima. Jam HP yang salah tidak memperpanjang/memperpendek hitung mundur.
 */
export function selisihJamMs(waktuServerIso: string, jamHpSaatTerimaMs: number): number {
  const s = Date.parse(waktuServerIso);
  return Number.isNaN(s) ? 0 : s - jamHpSaatTerimaMs;
}

/** Sisa detik (≥ 0) sampai kedaluwarsa menurut jam server. */
export function sisaDetik(kedaluwarsaIso: string, jamHpMs: number, selisihMs: number): number {
  const k = Date.parse(kedaluwarsaIso);
  if (Number.isNaN(k)) return 0;
  return Math.max(0, Math.floor((k - (jamHpMs + selisihMs)) / 1000));
}

/** "mm:ss" (≥ 60 menit tetap menit total, mis. "60:00"). */
export function mmss(detik: number): string {
  const d = Math.max(0, Math.floor(detik));
  return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
}

/** T-007 §4.5: ≤ 10 menit peringatan, ≤ 2 menit bahaya. */
export function tingkatHitungMundur(detik: number): "normal" | "warning" | "danger" {
  if (detik <= 120) return "danger";
  if (detik <= 600) return "warning";
  return "normal";
}

/** Jam WIB "HH.mm" untuk "Bayar sebelum {jam} WIB" (server UTC, konversi di tepi). */
export function jamWib(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(":", ".");
}

/** Nomor VA dikelompokkan 4 digit agar mudah dibaca/didikte ("8808 1234 5678"). */
export function kelompokDigit(nomor: string): string {
  return nomor.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Label pembaca layar: digit dibaca satu per satu per kelompok. */
export function labelDigit(nomor: string): string {
  return kelompokDigit(nomor)
    .split(" ")
    .map((g) => g.split("").join(" "))
    .join(", ");
}

const NAMA_BANK: Readonly<Record<string, string>> = {
  BCA: "BCA",
  BNI: "BNI",
  BRI: "BRI",
  BSI: "BSI",
  MANDIRI: "Mandiri",
  PERMATA: "Permata",
  CIMB: "CIMB Niaga",
  BJB: "BJB",
};

export function namaBank(kode: string): string {
  return NAMA_BANK[kode] ?? kode;
}

const AMBANG_UMUM_MENIT = [2, 5, 10, 30] as const;

/**
 * Teks live region pembaca layar: ambang terkecil yang sudah dilewati (≤ 30/10/5/2 menit). Teks hanya
 * berubah saat melewati ambang, jadi pengumuman tidak terjadi tiap detik.
 */
export function pengumumanSisa(sisa: number): string {
  const m = AMBANG_UMUM_MENIT.find((a) => sisa <= a * 60);
  return m === undefined ? "" : T.sisaMenit(m);
}
