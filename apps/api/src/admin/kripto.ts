// Kriptografi panel admin (T-036). Hanya modul bawaan Node (`node:crypto`), tanpa paket native.
// - Kata sandi: scrypt (memory-hard; parameter OWASP N=2^17, r=8, p=1) + garam acak 16 byte.
// - TOTP: RFC 6238 (HMAC-SHA1, 30 dtk, 6 digit) — kompatibel aplikasi authenticator umum.
// - Rahasia TOTP disimpan terenkripsi AES-256-GCM dengan AAD = admin_id (T-004 §3.3).
// - ID sesi: 32 byte acak; DB hanya menyimpan SHA-256-nya.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// ---------- scrypt ----------

export interface ParameterScrypt {
  /** log2(N). */
  readonly logN: number;
  readonly r: number;
  readonly p: number;
}

export const SCRYPT_BAWAAN: ParameterScrypt = { logN: 17, r: 8, p: 1 };
const PANJANG_KUNCI = 32;

function scrypt(sandi: string, garam: Buffer, prm: ParameterScrypt): Promise<Buffer> {
  const N = 2 ** prm.logN;
  const opsi: ScryptOptions = { N, r: prm.r, p: prm.p, maxmem: 256 * N * prm.r + 1024 * 1024 };
  return new Promise((selesai, gagal) => {
    scryptCb(sandi.normalize("NFKC"), garam, PANJANG_KUNCI, opsi, (err, kunci) => {
      if (err) gagal(err);
      else selesai(kunci);
    });
  });
}

const b64u = (b: Buffer) => b.toString("base64url");

/** Format: `scrypt$<logN>$<r>$<p>$<garam b64url>$<hash b64url>` (cocok CHECK `admin_kata_sandi_format`). */
export async function hashKataSandi(
  sandi: string,
  prm: ParameterScrypt = SCRYPT_BAWAAN,
): Promise<string> {
  const garam = randomBytes(16);
  const kunci = await scrypt(sandi, garam, prm);
  return `scrypt$${String(prm.logN)}$${String(prm.r)}$${String(prm.p)}$${b64u(garam)}$${b64u(kunci)}`;
}

/** Verifikasi constant-time. Format rusak / parameter di luar batas → false (tidak melempar). */
export async function cocokKataSandi(sandi: string, tersimpan: string): Promise<boolean> {
  const bagian = tersimpan.split("$");
  if (bagian.length !== 6 || bagian[0] !== "scrypt") return false;
  const [, sN, sR, sP, sGaram, sHash] = bagian;
  const logN = Number(sN);
  const r = Number(sR);
  const p = Number(sP);
  if (![logN, r, p].every(Number.isInteger) || logN < 10 || logN > 20 || r < 1 || r > 32) {
    return false;
  }
  if (p < 1 || p > 16 || !sGaram || !sHash) return false;
  const harap = Buffer.from(sHash, "base64url");
  if (harap.length !== PANJANG_KUNCI) return false;
  const hasil = await scrypt(sandi, Buffer.from(sGaram, "base64url"), { logN, r, p });
  return timingSafeEqual(hasil, harap);
}

// ---------- Base32 (RFC 4648, tanpa padding) ----------

const ALFABET_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(b: Buffer): string {
  let bit = 0;
  let nilai = 0;
  let hasil = "";
  for (const byte of b) {
    nilai = (nilai << 8) | byte;
    bit += 8;
    while (bit >= 5) {
      hasil += ALFABET_B32[(nilai >>> (bit - 5)) & 31] ?? "";
      bit -= 5;
    }
  }
  if (bit > 0) hasil += ALFABET_B32[(nilai << (5 - bit)) & 31] ?? "";
  return hasil;
}

export function dariBase32(s: string): Buffer {
  const bersih = s.replace(/[\s=-]/g, "").toUpperCase();
  let bit = 0;
  let nilai = 0;
  const keluar: number[] = [];
  for (const c of bersih) {
    const i = ALFABET_B32.indexOf(c);
    if (i < 0) throw new Error("base32 tidak valid");
    nilai = (nilai << 5) | i;
    bit += 5;
    if (bit >= 8) {
      keluar.push((nilai >>> (bit - 8)) & 255);
      bit -= 8;
    }
  }
  return Buffer.from(keluar);
}

// ---------- TOTP (RFC 6238) ----------

export const TOTP_PERIODE_DETIK = 30;
export const TOTP_DIGIT = 6;
/** Toleransi jam: ±1 langkah (±30 dtk). */
export const TOTP_JENDELA = 1;

export function buatRahasiaTotp(): Buffer {
  return randomBytes(20); // 160 bit (RFC 4226 §4 menyarankan ≥ 128, dianjurkan 160)
}

export function langkahTotp(waktu: Date): number {
  return Math.floor(waktu.getTime() / 1000 / TOTP_PERIODE_DETIK);
}

/** HOTP (RFC 4226) untuk satu langkah. */
export function kodeTotp(rahasia: Buffer, langkah: number): string {
  const pesan = Buffer.alloc(8);
  pesan.writeBigUInt64BE(BigInt(langkah));
  const h = createHmac("sha1", rahasia).update(pesan).digest();
  const offset = (h[h.length - 1] ?? 0) & 0x0f;
  const bin = h.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** TOTP_DIGIT).padStart(TOTP_DIGIT, "0");
}

/**
 * Cocokkan kode dengan jendela ±1 langkah. Mengembalikan langkah yang cocok (untuk anti pakai ulang
 * di DB) atau null. Semua kandidat dibandingkan constant-time.
 */
export function cocokTotp(rahasia: Buffer, kode: string, waktu: Date): number | null {
  if (!/^\d{6}$/.test(kode)) return null;
  const kini = langkahTotp(waktu);
  let cocok: number | null = null;
  for (let d = -TOTP_JENDELA; d <= TOTP_JENDELA; d++) {
    const calon = Buffer.from(kodeTotp(rahasia, kini + d));
    if (timingSafeEqual(calon, Buffer.from(kode)) && cocok === null) cocok = kini + d;
  }
  return cocok;
}

/** URI untuk QR / input manual di aplikasi authenticator. Label tanpa nomor HP (PII). */
export function uriOtpauth(rahasia: Buffer, label: string): string {
  const penerbit = "NEKAT Admin";
  const l = encodeURIComponent(`${penerbit}:${label}`);
  const q = new URLSearchParams({
    secret: base32(rahasia),
    issuer: penerbit,
    algorithm: "SHA1",
    digits: String(TOTP_DIGIT),
    period: String(TOTP_PERIODE_DETIK),
  });
  return `otpauth://totp/${l}?${q.toString()}`;
}

// ---------- AES-256-GCM untuk rahasia TOTP ----------

const PANJANG_IV = 12;
const PANJANG_TAG = 16;

/** Hasil: iv (12) ‖ tag (16) ‖ ciphertext. AAD = admin_id (ciphertext terikat ke admin itu). */
export function enkripsiRahasia(kunci: Buffer, adminId: string, rahasia: Buffer): Buffer {
  const iv = randomBytes(PANJANG_IV);
  const c = createCipheriv("aes-256-gcm", kunci, iv);
  c.setAAD(Buffer.from(adminId, "utf8"));
  const isi = Buffer.concat([c.update(rahasia), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), isi]);
}

/** Melempar bila kunci salah / data diubah / AAD (admin_id) berbeda. */
export function dekripsiRahasia(kunci: Buffer, adminId: string, data: Buffer): Buffer {
  if (data.length <= PANJANG_IV + PANJANG_TAG) throw new Error("ciphertext terlalu pendek");
  const iv = data.subarray(0, PANJANG_IV);
  const tag = data.subarray(PANJANG_IV, PANJANG_IV + PANJANG_TAG);
  const d = createDecipheriv("aes-256-gcm", kunci, iv);
  d.setAAD(Buffer.from(adminId, "utf8"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data.subarray(PANJANG_IV + PANJANG_TAG)), d.final()]);
}

// ---------- Token sesi, CSRF, HMAC ----------

export function tokenAcak(byte = 32): string {
  return randomBytes(byte).toString("base64url");
}

export function sha256(isi: string): Buffer {
  return createHash("sha256").update(isi, "utf8").digest();
}

export function hmac(kunci: Buffer, label: string, isi: string): Buffer {
  return createHmac("sha256", kunci).update(`${label}|${isi}`, "utf8").digest();
}

export function samaConstantTime(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---------- Kode pemulihan TOTP ----------

/** Alfabet tanpa karakter ambigu (0/O, 1/I/L). 31 simbol. */
const ALFABET_PEMULIHAN = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** 12 simbol (≈ 59 bit), tampil sebagai XXXX-XXXX-XXXX. */
export function buatKodePemulihan(): string {
  const simbol: string[] = [];
  while (simbol.length < 12) {
    for (const b of randomBytes(16)) {
      // Tolak bias modulo.
      if (b < 248 && simbol.length < 12) simbol.push(ALFABET_PEMULIHAN[b % 31] ?? "");
    }
  }
  const s = simbol.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function normalisasiKodePemulihan(kode: string): string {
  return kode.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Hash kode pemulihan: HMAC-SHA256 dengan pepper ADMIN_HMAC_KUNCI (bocornya DB saja tidak cukup
 * untuk menebak offline), terikat admin_id. Ganti ADMIN_HMAC_KUNCI = semua kode pemulihan batal.
 */
export function hashKodePemulihan(kunciHmac: Buffer, adminId: string, kode: string): Buffer {
  return hmac(kunciHmac, "pemulihan", `${adminId}|${normalisasiKodePemulihan(kode)}`);
}
