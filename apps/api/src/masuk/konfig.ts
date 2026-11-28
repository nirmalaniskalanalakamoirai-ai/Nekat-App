// Konfigurasi login OTP pembeli dari environment (T-016). Rahasia hanya dari env (CLAUDE.md #6).
// Pesan galat hanya menyebut NAMA variabel, tidak pernah nilainya (ADR-0001 §6).
//
// Aktif bila ketiga rahasia diisi. Belum ada satu pun → null (rute /api/masuk* menjawab 503; aman
// untuk dev tanpa DB). Sebagian diisi / tidak valid → melempar (gagal start).
import { KEBIJAKAN_OTP_BAWAAN, type KebijakanOtp } from "@nekat/domain";

export interface KonfigMasuk {
  /** Kunci HMAC nomor HP (`akun.hp_hmac`, `otp_permintaan.hp_hmac`, daftar izin sandbox) per versi. */
  readonly kunciHp: ReadonlyMap<number, Buffer>;
  /** Versi yang dipakai untuk menulis (HP_HMAC_KUNCI_VERSI). */
  readonly kunciHpVersi: number;
  /** Pepper HMAC kode OTP (`otp_permintaan.kode_hmac`). */
  readonly kunciKode: Buffer;
  readonly kunciKodeVersi: number;
  /** HMAC token CSRF & ip_hmac pembeli. */
  readonly kunciSesi: Buffer;
  readonly kebijakan: KebijakanOtp;
  /** Umur absolut sesi pembeli (hari). */
  readonly sesiHari: number;
  /** Sesi berakhir bila tidak dipakai selama ini (hari). */
  readonly sesiIdleHari: number;
  /** Origin yang boleh memanggil (dari APP_BASE_URL). Kosong = harus sama dengan Host. */
  readonly originDiizinkan: readonly string[];
}

export class KonfigMasukTidakValidError extends Error {
  constructor(readonly variabel: readonly string[]) {
    super(`Konfigurasi login pembeli tidak valid: ${variabel.join(", ")}`);
    this.name = "KonfigMasukTidakValidError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function ambil(env: Env, nama: string): string | undefined {
  const v = env[nama]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

function dariBase64(v: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return null;
  return Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function kunci(env: Env, nama: string, salah: string[]): Buffer | null {
  const v = ambil(env, nama);
  const b = v === undefined ? null : dariBase64(v);
  if (!b || b.length < 32) {
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

export const NAMA_RAHASIA_MASUK = [
  "HP_HMAC_KUNCI",
  "OTP_KODE_KUNCI",
  "SESI_PEMBELI_KUNCI",
] as const;

export function bacaKonfigMasuk(env: Env): KonfigMasuk | null {
  if (!NAMA_RAHASIA_MASUK.some((n) => ambil(env, n) !== undefined)) return null;
  const salah: string[] = [];
  const kHp = kunci(env, "HP_HMAC_KUNCI", salah);
  const kKode = kunci(env, "OTP_KODE_KUNCI", salah);
  const kSesi = kunci(env, "SESI_PEMBELI_KUNCI", salah);
  const kunciHpVersi = bulat(env, "HP_HMAC_KUNCI_VERSI", 1, 1, 32767, salah);
  const kunciKodeVersi = bulat(env, "OTP_KODE_KUNCI_VERSI", 1, 1, 32767, salah);

  const kunciHp = new Map<number, Buffer>();
  if (kHp) kunciHp.set(kunciHpVersi, kHp);
  // Versi lama (hanya untuk MENCARI akun & daftar izin sandbox), format `v{n}:{base64}` dipisah koma.
  const lama = ambil(env, "HP_HMAC_KUNCI_LAMA");
  if (lama !== undefined) {
    for (const e of lama
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      const m = /^v([1-9][0-9]{0,4}):(.+)$/.exec(e);
      const versi = Number(m?.[1]);
      const b = m?.[2] ? dariBase64(m[2]) : null;
      if (!b || b.length < 32 || kunciHp.has(versi) || versi > 32767) {
        salah.push("HP_HMAC_KUNCI_LAMA");
        break;
      }
      kunciHp.set(versi, b);
    }
  }

  // Pemisahan fungsi: ketiga kunci wajib berbeda.
  const daftar = [kHp, kKode, kSesi].filter((k): k is Buffer => k !== null);
  if (daftar.length === 3 && new Set(daftar.map((k) => k.toString("hex"))).size !== 3) {
    salah.push("SESI_PEMBELI_KUNCI");
  }

  const B = KEBIJAKAN_OTP_BAWAAN;
  const kebijakan: KebijakanOtp = {
    kedaluwarsaMenit: bulat(env, "OTP_KEDALUWARSA_MENIT", B.kedaluwarsaMenit, 2, 10, salah),
    maksPercobaan: bulat(env, "OTP_MAKS_PERCOBAAN", B.maksPercobaan, 1, 10, salah),
    jedaKirimUlangDetik: bulat(
      env,
      "OTP_JEDA_KIRIM_ULANG_DETIK",
      B.jedaKirimUlangDetik,
      30,
      600,
      salah,
    ),
    maksKirimPerHari: bulat(env, "OTP_MAKS_KIRIM_PER_HARI", B.maksKirimPerHari, 1, 50, salah),
    maksGagalPerHari: bulat(env, "OTP_MAKS_GAGAL_PER_HARI", B.maksGagalPerHari, 1, 100, salah),
    maksKirimPerIpPerJam: bulat(
      env,
      "OTP_MAKS_KIRIM_PER_IP_PER_JAM",
      B.maksKirimPerIpPerJam,
      1,
      10_000,
      salah,
    ),
    maksVerifikasiPerIpPerMenit: bulat(
      env,
      "OTP_MAKS_VERIFIKASI_PER_IP_PER_MENIT",
      B.maksVerifikasiPerIpPerMenit,
      1,
      10_000,
      salah,
    ),
    anggaranPerJam: bulat(env, "OTP_ANGGARAN_JAM", B.anggaranPerJam, 0, 1_000_000, salah),
    anggaranPerHari: bulat(env, "OTP_ANGGARAN_HARI", B.anggaranPerHari, 0, 10_000_000, salah),
  };
  const sesiHari = bulat(env, "SESI_PEMBELI_HARI", 30, 1, 180, salah);
  const sesiIdleHari = bulat(env, "SESI_PEMBELI_IDLE_HARI", 14, 1, 180, salah);

  const originDiizinkan: string[] = [];
  const base = ambil(env, "APP_BASE_URL");
  if (base !== undefined) {
    try {
      originDiizinkan.push(new URL(base).origin);
    } catch {
      salah.push("APP_BASE_URL");
    }
  }

  if (salah.length > 0 || !kHp || !kKode || !kSesi) {
    throw new KonfigMasukTidakValidError([...new Set(salah)]);
  }
  return {
    kunciHp,
    kunciHpVersi,
    kunciKode: kKode,
    kunciKodeVersi,
    kunciSesi: kSesi,
    kebijakan,
    sesiHari,
    sesiIdleHari,
    originDiizinkan,
  };
}
