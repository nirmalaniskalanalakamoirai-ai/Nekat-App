// Use case masuk admin (T-036, H9/K-04): kata sandi → sesi "pra" → TOTP (atau kode pemulihan)
// → sesi penuh dengan ID BARU (rotasi, CWE-384). Pesan gagal seragam (tanpa enumerasi akun).
//
// Penguncian (CWE-307), aman terhadap tebakan PARALEL:
// - Setiap percobaan memesan satu jatah secara atomik di DB SEBELUM verifikasi; jatah habis /
//   sedang dikunci → ditolak tanpa verifikasi. Kata sandi & TOTP memakai penghitung yang sama.
// - Kata sandi benar mengembalikan jatahnya sendiri (tidak mereset penghitung), sehingga TOTP
//   tidak bisa ditebak tanpa batas oleh orang yang tahu kata sandi. TOTP/kode pemulihan benar → reset.
// - Per sesi pra paling banyak `BATAS_PERCOBAAN_PRA` percobaan, lalu sesi pra dicabut.
// - Akun terkunci → semua sesinya dicabut.
// scrypt dijalankan di bawah semafor global (DoS CPU/RAM).
import type { RepoAuthAdmin, SesiAdminAktif } from "@nekat/db";
import { KEBIJAKAN_KUNCI_BAWAAN, sedangDikunci, type KebijakanKunci } from "@nekat/domain";
import { PRA_MENIT } from "./http-util.js";
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
import { GalatSibuk, Semafor, type OpsiSemafor } from "./semafor.js";

export const BATAS_PERCOBAAN_PRA = 3;

export const SEMAFOR_SCRYPT_BAWAAN: OpsiSemafor = { maks: 2, maksAntre: 20, tungguMs: 5_000 };

export interface OpsiLayananAuth {
  readonly repo: RepoAuthAdmin;
  readonly konfig: KonfigAdmin;
  readonly sekarang?: () => Date;
  readonly scrypt?: ParameterScrypt;
  readonly kebijakanKunci?: KebijakanKunci;
  readonly semaforScrypt?: OpsiSemafor;
}

export type HasilMasuk =
  { ok: true; token: string; kedaluwarsaPada: Date } | { ok: false; sibuk?: true };

export type FaktorKedua = { kode: string } | { kodePemulihan: string };

export class LayananAuthAdmin {
  readonly #repo: RepoAuthAdmin;
  readonly #k: KonfigAdmin;
  readonly #sekarang: () => Date;
  readonly #kunci: KebijakanKunci;
  readonly #scrypt: ParameterScrypt;
  readonly #semafor: Semafor;
  #dummy: Promise<string> | null = null;

  constructor(o: OpsiLayananAuth) {
    this.#repo = o.repo;
    this.#k = o.konfig;
    this.#sekarang = o.sekarang ?? (() => new Date());
    this.#kunci = o.kebijakanKunci ?? KEBIJAKAN_KUNCI_BAWAAN;
    this.#scrypt = o.scrypt ?? SCRYPT_BAWAAN;
    this.#semafor = new Semafor(o.semaforScrypt ?? SEMAFOR_SCRYPT_BAWAAN);
    // Hash dummy dihitung SEKALI saat start, di luar semafor (tidak bisa gagal karena sibuk).
    void this.#hashDummy().catch(() => undefined);
  }

  get sesiMenit(): number {
    return this.#k.sesiMenit;
  }

  /**
   * Hash pengganti agar waktu respons akun tak dikenal ≈ akun dikenal. Dihitung di luar semafor;
   * bila (sangat jarang) gagal, cache dikosongkan agar dicoba lagi — tidak pernah tersimpan sebagai
   * penolakan permanen (yang akan membedakan HP tak dikenal = celah enumerasi).
   */
  #hashDummy(): Promise<string> {
    this.#dummy ??= hashKataSandi(tokenAcak(), this.#scrypt).catch((err: unknown) => {
      this.#dummy = null;
      throw err;
    });
    return this.#dummy;
  }

  #cocok(sandi: string, hash: string): Promise<boolean> {
    return this.#semafor.jalankan(() => cocokKataSandi(sandi, hash));
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

  /**
   * Akun baru saja terkunci. Kunci selalu menahan login BARU. Sesi yang sedang berjalan hanya dicabut
   * bila kegagalan terjadi di langkah TOTP (`cabutSesi`): penebak sudah lolos kata sandi = indikasi
   * kata sandi bocor. Kegagalan kata sandi saja tidak mencabut sesi, agar orang yang hanya tahu nomor
   * HP tidak bisa "menendang" admin yang sedang bekerja.
   */
  async #setelahTerkunci(
    adminId: string,
    kini: Date,
    data: Record<string, unknown>,
    cabutSesi: boolean,
  ) {
    if (cabutSesi) await this.#repo.cabutSemuaSesi(adminId, kini);
    await this.#audit("LOGIN_ADMIN_DIKUNCI", adminId, { ...data, sesiDicabut: cabutSesi });
  }

  /** Langkah 1: nomor HP + kata sandi → token sesi pra (5 menit). */
  async masukKataSandi(nomorHpE164: string, sandi: string, ipHmac: Buffer): Promise<HasilMasuk> {
    try {
      return await this.#masukKataSandi(nomorHpE164, sandi, ipHmac);
    } catch (err) {
      if (err instanceof GalatSibuk) return { ok: false, sibuk: true };
      throw err;
    }
  }

  async #masukKataSandi(nomorHpE164: string, sandi: string, ipHmac: Buffer): Promise<HasilMasuk> {
    const kini = this.#sekarang();
    const ip = ipHmac.toString("hex").slice(0, 16);
    const a = await this.#repo.cariUntukMasuk(nomorHpE164);
    if (!a?.kataSandiHash) {
      await this.#cocok(sandi, await this.#hashDummy());
      await this.#audit("LOGIN_ADMIN_GAGAL", null, { alasan: "TIDAK_DIKENAL", ip });
      return { ok: false };
    }
    const jatah = await this.#repo.pesanPercobaan(a.id, kini, this.#kunci);
    if (!jatah) {
      await this.#cocok(sandi, await this.#hashDummy());
      await this.#audit("LOGIN_ADMIN_GAGAL", a.id, { alasan: "DIKUNCI", ip });
      return { ok: false };
    }
    let benar: boolean;
    try {
      benar = await this.#cocok(sandi, a.kataSandiHash);
    } catch (err) {
      // Sibuk: jatah dikembalikan (bukan kesalahan pengguna).
      await this.#repo.kembalikanPercobaan(a.id, this.#kunci);
      throw err;
    }
    if (!benar) {
      const data = { alasan: "KATA_SANDI_SALAH", gagalBeruntun: jatah.gagalBeruntun, ip };
      if (sedangDikunci(jatah, kini)) await this.#setelahTerkunci(a.id, kini, data, false);
      else await this.#audit("LOGIN_ADMIN_GAGAL", a.id, data);
      return { ok: false };
    }
    // Kata sandi benar: jatah sendiri dikembalikan, penghitung TIDAK direset.
    await this.#repo.kembalikanPercobaan(a.id, this.#kunci);
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
      sekarang: kini,
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
    const pra = await this.#repo.cariSesi(hashPra, kini, this.#k.sesiIdleMenit);
    if (pra?.faktorKeduaPada !== null) return { ok: false }; // tidak ada / sudah sesi penuh
    const ke = await this.#repo.pesanPercobaanPra(hashPra, BATAS_PERCOBAAN_PRA);
    if (ke === null) {
      await this.#repo.cabutSesi(hashPra, kini);
      return { ok: false };
    }
    const a = await this.#repo.cariUntukMasukPerId(pra.adminId);
    const jatah = a?.totpRahasiaEnc
      ? await this.#repo.pesanPercobaan(a.id, kini, this.#kunci)
      : null;
    if (!a?.totpRahasiaEnc || !jatah) {
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
        // Kunci env salah / versi lain: bukan kesalahan pengguna, jatah dikembalikan.
        await this.#repo.kembalikanPercobaan(a.id, this.#kunci);
        await this.#audit("LOGIN_ADMIN_GAGAL", a.id, { alasan: "KUNCI_TOTP_TIDAK_COCOK", ip });
        return { ok: false };
      }
      const langkah = cocokTotp(rahasia, faktor.kode, kini);
      rahasia.fill(0);
      // terimaLangkahTotp sekaligus mereset penghitung bila lolos.
      lolos = langkah !== null && (await this.#repo.terimaLangkahTotp(a.id, langkah));
    } else {
      metode = "KODE_PEMULIHAN";
      lolos = await this.#repo.pakaiKodePemulihan(
        a.id,
        hashKodePemulihan(this.#k.kunciHmac, a.id, faktor.kodePemulihan),
      );
      if (lolos) await this.#repo.resetGagal(a.id);
    }

    if (!lolos) {
      const data = {
        alasan: metode === "TOTP" ? "TOTP_SALAH" : "KODE_PEMULIHAN_SALAH",
        gagalBeruntun: jatah.gagalBeruntun,
        ip,
      };
      if (sedangDikunci(jatah, kini)) {
        await this.#setelahTerkunci(a.id, kini, data, true);
      } else {
        if (ke >= BATAS_PERCOBAAN_PRA) await this.#repo.cabutSesi(hashPra, kini);
        await this.#audit("LOGIN_ADMIN_GAGAL", a.id, data);
      }
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
      sekarang: kini,
    });
    await this.#audit("LOGIN_ADMIN_BERHASIL", a.id, { metode, ip });
    return { ok: true, token, kedaluwarsaPada };
  }

  /** Sesi penuh (sudah TOTP, tidak idle) atau null. Menyentuh waktu aktif terakhir. */
  async sesi(token: string): Promise<SesiAdminAktif | null> {
    const kini = this.#sekarang();
    const hash = sha256(token);
    const s = await this.#repo.cariSesi(hash, kini, this.#k.sesiIdleMenit);
    if (s?.faktorKeduaPada == null) return null;
    await this.#repo.sentuhSesi(hash, kini);
    return s;
  }

  /** Sesi pra yang masih hidup (untuk validasi CSRF langkah 2). */
  async adaSesiPra(token: string): Promise<boolean> {
    const s = await this.#repo.cariSesi(sha256(token), this.#sekarang(), this.#k.sesiIdleMenit);
    return s !== null && s.faktorKeduaPada === null;
  }

  async keluar(token: string, adminId: string): Promise<void> {
    await this.#repo.cabutSesi(sha256(token), this.#sekarang());
    await this.#audit("LOGOUT_ADMIN", adminId, {});
  }
}
