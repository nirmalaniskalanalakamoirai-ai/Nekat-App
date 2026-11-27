// Konfigurasi gateway pembayaran dari environment (T-029, docs/flow/pembayaran.md §3.8, FP-02).
// Dibaca SEKALI saat start; salah → aplikasi gagal start. Pesan error hanya NAMA variabel, tidak pernah nilai.
//
// Pagar mode (FP-02): production WAJIB kunci live, non-production WAJIB kunci test. Mode ditentukan
// NODE_ENV (bukan variabel terpisah) agar tidak bisa "salah pasang" mode di server production.
// Prefiks kunci Xendit (ASUMSI X-02, format publik Xendit): test `xnd_development_`, live `xnd_production_`.
import { POLA_KODE_BANK } from "@nekat/shared";
import type { ModeGateway } from "@nekat/domain";

export const NAMA_GATEWAY_PEMBAYARAN = ["nonaktif", "palsu", "xendit"] as const;
export type NamaGatewayPembayaran = (typeof NAMA_GATEWAY_PEMBAYARAN)[number];

/** Bank VA bawaan (DEFAULT SEMENTARA X-04; daftar final mengikuti kanal yang diaktifkan di akun Xendit). */
export const KANAL_VA_BAWAAN = ["BNI", "BRI", "MANDIRI", "PERMATA"] as const;

export const PREFIKS_KUNCI: Readonly<Record<ModeGateway, string>> = {
  test: "xnd_development_",
  live: "xnd_production_",
};

export interface KonfigPembayaran {
  readonly gateway: NamaGatewayPembayaran;
  readonly mode: ModeGateway;
  /** Nama pemilik VA & nama penerima yang tampil = nama merchant/badan usaha NEKAT (§5.3, H7). */
  readonly namaMerchant: string;
  readonly kanalVa: readonly string[];
  /** Hanya bila gateway = xendit. Fungsi agar kunci tidak ikut ter-serialisasi saat objek dicatat. */
  readonly ambilKunci: (() => string) | null;
}

export class KonfigPembayaranTidakValidError extends Error {
  readonly variabel: readonly string[];
  constructor(variabel: readonly string[]) {
    super(`Konfigurasi pembayaran tidak valid: ${variabel.join(", ")}`);
    this.name = "KonfigPembayaranTidakValidError";
    this.variabel = variabel;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function ambil(env: Env, nama: string): string | undefined {
  const v = env[nama]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

/** Nama merchant: huruf/angka/spasi/titik/koma/tanda hubung, 3–64 karakter (batas aman nama VA). */
const POLA_NAMA_MERCHANT = /^[A-Za-z0-9][A-Za-z0-9 .,&-]{2,63}$/;
/** Kunci: karakter aman saja (tanpa spasi/baris baru yang bisa menyusup ke header). */
const POLA_KUNCI = /^[A-Za-z0-9_]{20,200}$/;

export function bacaKonfigPembayaran(env: Env): KonfigPembayaran {
  const salah: string[] = [];
  const produksi = env["NODE_ENV"] === "production";
  const mode: ModeGateway = produksi ? "live" : "test";

  const namaGateway = ambil(env, "PEMBAYARAN_GATEWAY") ?? "nonaktif";
  let gateway: NamaGatewayPembayaran = "nonaktif";
  if ((NAMA_GATEWAY_PEMBAYARAN as readonly string[]).includes(namaGateway)) {
    gateway = namaGateway as NamaGatewayPembayaran;
  } else {
    salah.push("PEMBAYARAN_GATEWAY");
  }
  // Gateway palsu tidak boleh di production (uang tidak benar-benar diterima).
  if (produksi && gateway === "palsu") salah.push("PEMBAYARAN_GATEWAY");

  const namaMerchant = ambil(env, "PEMBAYARAN_NAMA_MERCHANT") ?? "";
  if (gateway !== "nonaktif" && !POLA_NAMA_MERCHANT.test(namaMerchant)) {
    salah.push("PEMBAYARAN_NAMA_MERCHANT");
  }

  let kanalVa: readonly string[] = KANAL_VA_BAWAAN;
  const kanalTeks = ambil(env, "XENDIT_KANAL_VA");
  if (kanalTeks !== undefined) {
    const daftar = [...new Set(kanalTeks.split(",").map((k) => k.trim().toUpperCase()))].filter(
      (k) => k !== "",
    );
    if (daftar.length === 0 || daftar.length > 12 || !daftar.every((k) => POLA_KODE_BANK.test(k))) {
      salah.push("XENDIT_KANAL_VA");
    } else {
      kanalVa = daftar;
    }
  }

  let ambilKunci: (() => string) | null = null;
  const kunci = ambil(env, "XENDIT_SECRET_KEY");
  if (gateway === "xendit") {
    if (kunci === undefined || !POLA_KUNCI.test(kunci) || !kunci.startsWith(PREFIKS_KUNCI[mode])) {
      // Termasuk: production + kunci test, non-production + kunci live (FP-02). Nilai tidak dicetak.
      salah.push("XENDIT_SECRET_KEY");
    } else {
      ambilKunci = () => kunci;
    }
  } else if (kunci !== undefined && produksi && !kunci.startsWith(PREFIKS_KUNCI.live)) {
    // Kunci test terpasang di production walau gateway belum aktif = salah pasang → gagal start.
    salah.push("XENDIT_SECRET_KEY");
  } else if (kunci !== undefined && !produksi && kunci.startsWith(PREFIKS_KUNCI.live)) {
    salah.push("XENDIT_SECRET_KEY");
  }

  if (salah.length > 0) throw new KonfigPembayaranTidakValidError([...new Set(salah)]);
  return { gateway, mode, namaMerchant, kanalVa, ambilKunci };
}
