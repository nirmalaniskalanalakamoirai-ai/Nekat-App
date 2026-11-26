// Use case masuk admin (T-036, H9/K-04): kata sandi → sesi "pra" → TOTP (atau kode pemulihan)
// → sesi penuh dengan ID BARU (rotasi, CWE-384). Gagal kata sandi & gagal TOTP dihitung bersama
// untuk penguncian (CWE-307); lolos kata sandi TIDAK mereset penghitung (cegah tebak TOTP tanpa
// batas). Pesan gagal seragam (tanpa enumerasi akun).
import type { RepoAuthAdmin, SesiAdminAktif } from "@nekat/db";
import { KEBIJAKAN_KUNCI_BAWAAN, sedangDikunci, type KebijakanKunci } from "@nekat/domain";
import type { KonfigAdmin } from "./konfig.js";
import {
  cocokKataSandi,
  cocokTotp,
  dekripsiRahasia,
  hashKataSandi,
  hashKodePemulihan,
  hmac,
  SCRYPT_BAWAAN,
  sha256,
  tokenAcak,
  type ParameterScrypt,
} from "./kripto.js";
import { PRA_MENIT } from "./http-util.js";

export interface OpsiLayananAuth {
  readonly repo: RepoAuthAdmin;
  readonly konfig: KonfigAdmin;
  readonly sekarang?: () => Date;
  readonly scrypt?: ParameterScrypt;
  readonly kebijakanKunci?: KebijakanKunci;
}

export type HasilMasuk = { ok: true; token: string; kedaluwarsaPada: Date } | { ok: false };

export type FaktorKedua = { kode: string } | { kodePemulihan: string };

export class LayananAuthAdmin {
  readonly #repo: RepoAuthAdmin;
  readonly #k: KonfigAdmin;
  readonly #sekarang: () => Date;
  readonly #kunci: KebijakanKunci;
  readonly #scrypt: ParameterScrypt;
  #dummy: Promise<string> | null = null;

  constructor(o: OpsiLayananAuth) {
    this.#repo = o.repo;
    this.#k = o.konfig;
    this.#sekarang = o.sekarang ?? (() => new Date());
    this.#kunci = o.kebijakanKunci ?? KEBIJAKAN_KUNCI_BAWAAN;
    this.#scrypt = o.scrypt ?? SCRYPT_BAWAAN;
  }

  get sesiMenit(): number {
    return this.#k.sesiMenit;
  }

  /** Hash pengganti agar waktu respons akun tak dikenal ≈ akun dikenal. */
  #hashDummy(): Promise<string> {
    this.#dummy ??= hashKataSandi(tokenAcak(), this.#scrypt);
    return this.#dummy;
  }

  ipHmac(ip: string): Buffer {
    return hmac(this.#k.kunciHmac, "ip", ip);
  }

  /** Token CSRF terikat ID sesi (pra maupun penuh). */
  csrf(token: string): string {
    return hmac(this.#k.kunciHmac, "csrf", token).toString("base64url");
  }

  async #audit(jenis: string, adminId: string | null, data: Record<string, unknown>) {
    await this.#repo.catatAudit(jenis, data, adminId);
  }

  /** Langkah 1: nomor HP + kata sandi → token sesi pra (5 menit). */
  async masukKataSandi(nomorHpE164: string, sandi: string, ipHmac: Buffer): Promise<HasilMasuk> {
    const kini = this.#sekarang();
    const ip = ipHmac.toString("hex").slice(0, 16);
    const a = await this.#repo.cariUntukMasuk(nomorHpE164);
    if (!a?.kataSandiHash) {
      await cocokKataSandi(sandi, await this.#hashDummy());
      await this.#audit("LOGIN_ADMIN_GAGAL", null, { alasan: "TIDAK_DIKENAL", ip });
      return { ok: false };
    }
    if (sedangDikunci(a, kini)) {
      await cocokKataSandi(sandi, await this.#hashDummy());
      await this.#audit("LOGIN_ADMIN_GAGAL", a.id, { alasan: "DIKUNCI", ip });
      return { ok: false };
    }
    if (!(await cocokKataSandi(sandi, a.kataSandiHash))) {
      const st = await this.#repo.catatGagal(a.id, kini, this.#kunci);
      await this.#audit(
        sedangDikunci(st, kini) ? "LOGIN_ADMIN_DIKUNCI" : "LOGIN_ADMIN_GAGAL",
        a.id,
        { alasan: "KATA_SANDI_SALAH", gagalBeruntun: st.gagalBeruntun, ip },
      );
      return { ok: false };
    }
    if (a.status !== "AKTIF" || a.totpAktifPada === null || a.totpRahasiaEnc === null) {
      await this.#audit("LOGIN_ADMIN_GAGAL", a.id, {
        alasan: a.status !== "AKTIF" ? "NONAKTIF" : "TOTP_BELUM_AKTIF",
        ip,
      });
      return { ok: false };
    }
    const token = tokenAcak();
    const kedaluwarsaPada = new Date(kini.getTime() + PRA_MENIT * 60_000);
    await this.#repo.buatSesi({
      idHash: sha256(token),
      adminId: a.id,
      faktorKeduaPada: null,
      kedaluwarsaPada,
    });
    return { ok: true, token, kedaluwarsaPada };
  }

  /** Langkah 2: token pra + TOTP / kode pemulihan → token sesi penuh (ID baru). */
  async masukFaktorKedua(
    tokenPra: string,
    faktor: FaktorKedua,
    ipHmac: Buffer,
  ): Promise<HasilMasuk> {
    const kini = this.#sekarang();
    const ip = ipHmac.toString("hex").slice(0, 16);
    const hashPra = sha256(tokenPra);
    const pra = await this.#repo.cariSesi(hashPra, kini);
    if (pra?.faktorKeduaPada !== null) return { ok: false }; // tidak ada / sudah sesi penuh
    const a = await this.#repo.cariUntukMasukPerId(pra.adminId);
    if (!a?.totpRahasiaEnc || sedangDikunci(a, kini)) {
      await this.#repo.cabutSesi(hashPra, kini);
      await this.#audit("LOGIN_ADMIN_GAGAL", pra.adminId, { alasan: "DIKUNCI", ip });
      return { ok: false };
    }

    let lolos: boolean;
    let metode: "TOTP" | "KODE_PEMULIHAN";
    if ("kode" in faktor) {
      metode = "TOTP";
      let rahasia: Buffer | null = null;
      if (a.totpKunciVersi === this.#k.kunciTotpVersi) {
        try {
          rahasia = dekripsiRahasia(this.#k.kunciTotp, a.id, a.totpRahasiaEnc);
        } catch {
          rahasia = null;
        }
      }
      if (!rahasia) {
        // Kunci env salah / versi lain: bukan kesalahan pengguna, jangan dihitung gagal.
        await this.#audit("LOGIN_ADMIN_GAGAL", a.id, { alasan: "KUNCI_TOTP_TIDAK_COCOK", ip });
        return { ok: false };
      }
      const langkah = cocokTotp(rahasia, faktor.kode, kini);
      rahasia.fill(0);
      lolos = langkah !== null && (await this.#repo.terimaLangkahTotp(a.id, langkah));
    } else {
      metode = "KODE_PEMULIHAN";
      lolos = await this.#repo.pakaiKodePemulihan(
        a.id,
        hashKodePemulihan(a.id, faktor.kodePemulihan),
      );
      if (lolos) await this.#repo.resetGagal(a.id);
    }

    if (!lolos) {
      const st = await this.#repo.catatGagal(a.id, kini, this.#kunci);
      const terkunci = sedangDikunci(st, kini);
      if (terkunci) await this.#repo.cabutSesi(hashPra, kini);
      await this.#audit(terkunci ? "LOGIN_ADMIN_DIKUNCI" : "LOGIN_ADMIN_GAGAL", a.id, {
        alasan: metode === "TOTP" ? "TOTP_SALAH" : "KODE_PEMULIHAN_SALAH",
        gagalBeruntun: st.gagalBeruntun,
        ip,
      });
      return { ok: false };
    }

    // Rotasi: sesi pra dicabut, sesi penuh memakai ID baru.
    await this.#repo.cabutSesi(hashPra, kini);
    const token = tokenAcak();
    const kedaluwarsaPada = new Date(kini.getTime() + this.#k.sesiMenit * 60_000);
    await this.#repo.buatSesi({
      idHash: sha256(token),
      adminId: a.id,
      faktorKeduaPada: kini,
      kedaluwarsaPada,
    });
    await this.#audit("LOGIN_ADMIN_BERHASIL", a.id, { metode, ip });
    return { ok: true, token, kedaluwarsaPada };
  }

  /** Sesi penuh (sudah TOTP) atau null. */
  async sesi(token: string): Promise<SesiAdminAktif | null> {
    const s = await this.#repo.cariSesi(sha256(token), this.#sekarang());
    return s && s.faktorKeduaPada !== null ? s : null;
  }

  /** Sesi pra yang masih hidup (untuk validasi CSRF langkah 2). */
  async adaSesiPra(token: string): Promise<boolean> {
    const s = await this.#repo.cariSesi(sha256(token), this.#sekarang());
    return s !== null && s.faktorKeduaPada === null;
  }

  async keluar(token: string, adminId: string): Promise<void> {
    await this.#repo.cabutSesi(sha256(token), this.#sekarang());
    await this.#audit("LOGOUT_ADMIN", adminId, {});
  }
}
