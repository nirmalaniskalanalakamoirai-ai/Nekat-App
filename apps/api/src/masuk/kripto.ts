// Kriptografi login OTP pembeli (T-016). Hanya `node:crypto`. Token sesi, CSRF, dan pembanding
// constant-time memakai ulang modul panel admin (admin/kripto.ts).
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export { hmac, samaConstantTime, sha256, tokenAcak } from "../admin/kripto.js";

/**
 * Blind index nomor HP: HMAC-SHA256(kunci, nomor E.164 UTF-8), tanpa label — rumus yang sama dipakai
 * untuk membuat entri daftar izin sandbox `v{versi}:{hex}` (T-010 §3.2), lihat .env.example.
 */
export function hmacHp(kunci: Buffer, nomorE164: string): Buffer {
  return createHmac("sha256", kunci).update(nomorE164, "utf8").digest();
}

/**
 * HMAC kode OTP dengan pepper server, terikat ke nomor (hp_hmac). Kode 6 digit terlalu kecil untuk
 * hash biasa: tanpa pepper, DB bocor = semua kode tertebak offline (T-004 §3.1).
 */
export function hmacKodeOtp(pepper: Buffer, hpHmac: Buffer, kode: string): Buffer {
  return createHmac("sha256", pepper)
    .update(`otp|${hpHmac.toString("hex")}|${kode}`, "utf8")
    .digest();
}

export function samaBuffer(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Kode 6 digit acak kriptografis (seragam, tanpa bias modulo). */
export function buatKodeOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Kunci batas laju per klien. IPv4 = alamat utuh; IPv6 = prefiks /64 (satu pelanggan biasanya
 * mendapat seluruh /64, sehingga memutar alamat di dalamnya tidak melewati batas). IPv4-mapped IPv6
 * (::ffff:a.b.c.d) diperlakukan sebagai IPv4.
 */
export function kunciIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [kiri = "", kanan = ""] = ip.split("::");
  const a = kiri === "" ? [] : kiri.split(":");
  const b = ip.includes("::") ? (kanan === "" ? [] : kanan.split(":")) : [];
  const nol = Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0");
  const penuh = ip.includes("::") ? [...a, ...nol, ...b] : a;
  return `${penuh
    .slice(0, 4)
    .map((h) => h.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
