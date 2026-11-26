// Pembuatan akun admin (T-036) — dipakai CLI `cli-admin.ts`, BUKAN endpoint publik.
// Tidak ada kredensial bawaan di kode: kata sandi diketik operator, rahasia TOTP dibuat acak dan
// ditampilkan sekali, TOTP wajib dikonfirmasi dengan satu kode sebelum akun tersimpan (H9).
import { randomBytes } from "node:crypto";
import type { RepoAuthAdmin } from "@nekat/db";
import type { KonfigAdmin } from "./konfig.js";
import {
  buatKodePemulihan,
  cocokTotp,
  enkripsiRahasia,
  hashKataSandi,
  hashKodePemulihan,
  SCRYPT_BAWAAN,
  type ParameterScrypt,
} from "./kripto.js";

export const PERAN_ADMIN = ["owner", "admin"] as const;
export type PeranAdmin = (typeof PERAN_ADMIN)[number];

export const SANDI_MIN = 12;
export const SANDI_MAKS = 128;
export const JUMLAH_KODE_PEMULIHAN = 10;

export class GalatBuatAdmin extends Error {
  constructor(pesan: string) {
    super(pesan);
    this.name = "GalatBuatAdmin";
  }
}

/** UUID v7 (urut waktu, M3) — sama formatnya dengan `uuid_v7()` di DB. */
export function uuidV7(sekarang: Date = new Date()): string {
  const b = randomBytes(16);
  const ms = BigInt(sekarang.getTime());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Aturan kata sandi minimal (NIST 800-63B: panjang, bukan komposisi). */
export function cekKataSandi(sandi: string, nomorHp: string): string | null {
  const n = Array.from(sandi).length; // titik kode Unicode (cukup untuk batas panjang)
  if (n < SANDI_MIN) return `Kata sandi minimal ${String(SANDI_MIN)} karakter.`;
  if (n > SANDI_MAKS) return `Kata sandi maksimal ${String(SANDI_MAKS)} karakter.`;
  if (new Set(sandi).size < 4) return "Kata sandi terlalu mudah ditebak.";
  if (sandi.includes(nomorHp.replace(/^\+62/, "")))
    return "Kata sandi tidak boleh memuat nomor HP.";
  return null;
}

export interface InputAdminBaru {
  readonly nama: string;
  readonly nomorHpE164: string;
  readonly peran: PeranAdmin;
  readonly kataSandi: string;
  /** Rahasia TOTP yang sudah ditampilkan ke operator. */
  readonly rahasiaTotp: Buffer;
  /** Kode 6 digit dari aplikasi authenticator (konfirmasi). */
  readonly kodeKonfirmasi: string;
}

export async function buatAdminBaru(
  repo: RepoAuthAdmin,
  konfig: KonfigAdmin,
  input: InputAdminBaru,
  opsi: { sekarang?: Date; scrypt?: ParameterScrypt } = {},
): Promise<{ id: string; kodePemulihan: string[] }> {
  const sekarang = opsi.sekarang ?? new Date();
  const nama = input.nama.trim();
  if (nama.length < 1 || nama.length > 100) throw new GalatBuatAdmin("Nama wajib 1–100 karakter.");
  if (!/^\+62[0-9]{8,13}$/.test(input.nomorHpE164)) {
    throw new GalatBuatAdmin("Nomor HP wajib format +62xxxxxxxxxx.");
  }
  if (!(PERAN_ADMIN as readonly string[]).includes(input.peran)) {
    throw new GalatBuatAdmin("Peran wajib owner atau admin.");
  }
  const galatSandi = cekKataSandi(input.kataSandi, input.nomorHpE164);
  if (galatSandi) throw new GalatBuatAdmin(galatSandi);
  if ((await repo.jumlahAdmin()) === 0 && input.peran !== "owner") {
    throw new GalatBuatAdmin("Admin pertama wajib berperan owner.");
  }
  if (await repo.adaNomorHp(input.nomorHpE164)) {
    throw new GalatBuatAdmin("Nomor HP sudah dipakai admin lain.");
  }
  const langkah = cocokTotp(input.rahasiaTotp, input.kodeKonfirmasi, sekarang);
  if (langkah === null) {
    throw new GalatBuatAdmin("Kode authenticator salah. Periksa jam HP lalu coba lagi.");
  }

  const id = uuidV7(sekarang);
  const kodePemulihan = Array.from({ length: JUMLAH_KODE_PEMULIHAN }, buatKodePemulihan);
  await repo.buatAdmin({
    id,
    nama,
    nomorHpE164: input.nomorHpE164,
    kataSandiHash: await hashKataSandi(input.kataSandi, opsi.scrypt ?? SCRYPT_BAWAAN),
    totpRahasiaEnc: enkripsiRahasia(konfig.kunciTotp, id, input.rahasiaTotp),
    totpKunciVersi: konfig.kunciTotpVersi,
    // Kode konfirmasi tidak bisa dipakai ulang untuk masuk.
    totpLangkahTerakhir: langkah,
    peran: [input.peran],
    kodePemulihanHash: kodePemulihan.map((k) => hashKodePemulihan(id, k)),
  });
  return { id, kodePemulihan };
}
