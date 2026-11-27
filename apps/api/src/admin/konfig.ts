// Konfigurasi panel admin dari environment (T-036). Rahasia hanya dari env (CLAUDE.md #6).
// Pesan galat hanya menyebut NAMA variabel, tidak pernah nilainya (ADR-0001 §6).

import { isIP } from "node:net";

export interface KonfigAdmin {
  /** AES-256-GCM untuk `admin.totp_rahasia_enc`. */
  readonly kunciTotp: Buffer;
  readonly kunciTotpVersi: number;
  /** HMAC untuk token CSRF & `ip_hmac`. */
  readonly kunciHmac: Buffer;
  /** Umur absolut sesi admin (menit); lebih pendek dari sesi pembeli (ADR §7). */
  readonly sesiMenit: number;
  /** Sesi admin berakhir bila tidak ada permintaan selama ini (menit). */
  readonly sesiIdleMenit: number;
  /**
   * Batas laju masuk GLOBAL per menit (semua IP), 0 = mati. Hanya rem darurat di atas semafor scrypt
   * (yang sudah membatasi beban); dibuat tinggi agar tidak mudah dipakai untuk mengunci semua admin.
   */
  readonly masukGlobalPerMenit: number;
  /** Origin yang boleh memanggil API admin (dari APP_BASE_URL). Kosong = harus sama dengan Host. */
  readonly originDiizinkan: readonly string[];
}

export class KonfigAdminTidakValidError extends Error {
  constructor(readonly variabel: readonly string[]) {
    super(`Konfigurasi admin tidak valid: ${variabel.join(", ")}`);
    this.name = "KonfigAdminTidakValidError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function ambil(env: Env, nama: string): string | undefined {
  const v = env[nama]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

/** Kunci base64 (standar atau url-safe) minimal/tepat `panjang` byte. */
function kunci(
  env: Env,
  nama: string,
  panjang: number,
  tepat: boolean,
  salah: string[],
): Buffer | null {
  const v = ambil(env, nama);
  if (v === undefined || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) {
    salah.push(nama);
    return null;
  }
  const b = Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (tepat ? b.length !== panjang : b.length < panjang) {
    salah.push(nama);
    return null;
  }
  return b;
}

function bulat(env: Env, nama: string, bawaan: number, min: number, maks: number, salah: string[]) {
  const v = ambil(env, nama);
  if (v === undefined) return bawaan;
  const n = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < min || n > maks) {
    salah.push(nama);
    return bawaan;
  }
  return n;
}

/**
 * Panel admin aktif hanya bila SEMUA rahasia diisi. Belum ada satu pun → null (rute admin 503,
 * aman untuk dev). Sebagian diisi / tidak valid → melempar (gagal start).
 */
export function bacaKonfigAdmin(env: Env): KonfigAdmin | null {
  const adaSalahSatu = ["ADMIN_TOTP_KUNCI", "ADMIN_HMAC_KUNCI"].some(
    (n) => ambil(env, n) !== undefined,
  );
  if (!adaSalahSatu) return null;
  const salah: string[] = [];
  const kunciTotp = kunci(env, "ADMIN_TOTP_KUNCI", 32, true, salah);
  const kunciHmac = kunci(env, "ADMIN_HMAC_KUNCI", 32, false, salah);
  const kunciTotpVersi = bulat(env, "ADMIN_TOTP_KUNCI_VERSI", 1, 1, 32767, salah);
  const sesiMenit = bulat(env, "ADMIN_SESI_MENIT", 240, 5, 720, salah);
  const sesiIdleMenit = bulat(env, "ADMIN_SESI_IDLE_MENIT", 30, 5, 240, salah);
  const masukGlobalPerMenit = bulat(env, "ADMIN_MASUK_GLOBAL_PER_MENIT", 600, 0, 100_000, salah);
  // Dua kunci harus berbeda (pemisahan fungsi enkripsi vs HMAC).
  if (kunciTotp && kunciHmac && kunciTotp.equals(kunciHmac.subarray(0, kunciTotp.length))) {
    salah.push("ADMIN_HMAC_KUNCI");
  }
  const originDiizinkan: string[] = [];
  const base = ambil(env, "APP_BASE_URL");
  if (base !== undefined) {
    try {
      originDiizinkan.push(new URL(base).origin);
    } catch {
      salah.push("APP_BASE_URL");
    }
  }
  if (salah.length > 0 || !kunciTotp || !kunciHmac) throw new KonfigAdminTidakValidError(salah);
  return {
    kunciTotp,
    kunciTotpVersi,
    kunciHmac,
    sesiMenit,
    sesiIdleMenit,
    masukGlobalPerMenit,
    originDiizinkan,
  };
}

/**
 * Entri TRUST_PROXY: "a.b.c.d", "::1", atau CIDR "10.0.0.0/8". Jumlah hop / kata kunci
 * ("loopback", "true") sengaja DITOLAK: mempercayai hop tanpa alamat bisa dipalsukan (XFF spoofing).
 */
export function alamatAtauCidr(v: string): boolean {
  const [ip, prefiks, ...lebih] = v.split("/");
  const versi = isIP(ip ?? "");
  if (versi === 0 || lebih.length > 0) return false;
  if (prefiks === undefined) return true;
  const n = /^\d{1,3}$/.test(prefiks) ? Number(prefiks) : -1;
  return n >= 0 && n <= (versi === 4 ? 32 : 128);
}
