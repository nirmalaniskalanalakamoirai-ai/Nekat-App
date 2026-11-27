// Aturan murni mulai bayar (docs/flow/pembayaran.md §5, §5.1 langkah 2, K-36). Dipanggil repo DI DALAM
// kunci invoice agar status/kedaluwarsa yang dicek sama dengan yang dipakai insert.
import type { TagihanUntukBayar } from "./port.js";

export type KodeGalatBayar =
  | "TAGIHAN_TIDAK_DITEMUKAN"
  | "TAGIHAN_TIDAK_AKTIF"
  | "TAGIHAN_KEDALUWARSA"
  | "SUDAH_LUNAS"
  | "METODE_TIDAK_DIIZINKAN"
  | "KANAL_TIDAK_VALID"
  | "GATEWAY_TIDAK_AKTIF";

/** Galat use case. Pesan aman ditampilkan (tanpa data internal). */
export class GalatBayar extends Error {
  constructor(
    readonly kode: KodeGalatBayar,
    pesan: string,
  ) {
    super(pesan);
    this.name = "GalatBayar";
  }
}

const METODE_PER_JENIS: Readonly<Record<TagihanUntukBayar["jenis"], readonly ("QRIS" | "VA")[]>> = {
  GRUP: ["QRIS", "VA"],
};

/**
 * K-36: tagihan grup hanya QRIS/VA. E-wallet hanya untuk pesanan individu, yang skemanya belum ada (K-57);
 * saat jenis INDIVIDU ditambahkan, EWALLET masuk di sini untuk jenis itu saja.
 */
export function metodeUntukJenis(jenis: TagihanUntukBayar["jenis"]): readonly ("QRIS" | "VA")[] {
  return METODE_PER_JENIS[jenis];
}

/**
 * §5.1.2: invoice DITERBITKAN, `sekarang < kedaluwarsa_pada`, sisa bayar > 0, metode diizinkan untuk jenis
 * tagihan, kanal VA wajib & terdaftar, QRIS tanpa kanal. Kepemilikan dicek repo (bukan milik → 404).
 * Minimum nominal kanal menunggu K-50: penolakan gateway dipetakan ke NOMINAL_DI_BAWAH_MINIMUM (FP-25).
 */
export function cekBolehBayar(
  t: TagihanUntukBayar,
  metode: string,
  kanal: string | null,
  sekarang: Date,
  kanalVaDiizinkan: readonly string[],
): void {
  if (t.status === "LUNAS") throw new GalatBayar("SUDAH_LUNAS", "Tagihan ini sudah lunas.");
  if (t.status !== "DITERBITKAN") {
    throw new GalatBayar("TAGIHAN_TIDAK_AKTIF", "Tagihan ini sudah tidak bisa dibayar.");
  }
  if (sekarang.getTime() >= t.kedaluwarsaPada.getTime()) {
    throw new GalatBayar("TAGIHAN_KEDALUWARSA", "Waktu bayar tagihan ini sudah habis.");
  }
  if (t.sisaBayarRp <= 0) throw new GalatBayar("SUDAH_LUNAS", "Tagihan ini sudah lunas.");
  if (!(metodeUntukJenis(t.jenis) as readonly string[]).includes(metode)) {
    throw new GalatBayar(
      "METODE_TIDAK_DIIZINKAN",
      "Metode bayar ini tidak tersedia untuk tagihan ini.",
    );
  }
  if (metode === "VA") {
    if (kanal === null || !kanalVaDiizinkan.includes(kanal)) {
      throw new GalatBayar("KANAL_TIDAK_VALID", "Pilih bank Virtual Account yang tersedia.");
    }
  } else if (kanal !== null) {
    throw new GalatBayar("KANAL_TIDAK_VALID", "Metode ini tidak memakai pilihan bank.");
  }
}

/** §4.2: kunci idempotensi per upaya, `n` dihitung di dalam kunci invoice. */
export function kunciBayar(invoiceId: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError("urutan upaya bayar tidak valid");
  return `bayar:${invoiceId}:${String(n)}`;
}

/** Keterangan ke gateway tanpa PII (hanya nomor tagihan). */
export function keteranganTagihan(nomor: string): string {
  return `Tagihan NEKAT ${nomor}`.slice(0, 100);
}
