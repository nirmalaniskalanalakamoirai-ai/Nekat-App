// Utilitas HTTP panel admin (T-036): cookie, batas laju per IP (memori proses).
// Tanpa paket tambahan: Fase 1 berjalan di 1 VPS, satu proses API (H3). Bila API diskalakan
// horizontal, batas laju harus pindah ke penyimpanan bersama (sub-task, lihat laporan T-036).

/** Cookie sesi admin penuh (sudah TOTP). Awalan `__Host-` = wajib Secure, Path=/, tanpa Domain. */
export const COOKIE_SESI = "__Host-nekat_admin";
/** Cookie sesi "pra" (lolos kata sandi, menunggu TOTP). Umur pendek. */
export const COOKIE_PRA = "__Host-nekat_admin_pra";
export const PRA_MENIT = 5;

export function bacaCookie(header: string | undefined, nama: string): string | undefined {
  if (!header) return undefined;
  for (const bagian of header.split(";")) {
    const i = bagian.indexOf("=");
    if (i < 0) continue;
    if (bagian.slice(0, i).trim() === nama) {
      const v = bagian.slice(i + 1).trim();
      // Token kita base64url; nilai lain diabaikan.
      return /^[A-Za-z0-9_-]{16,128}$/.test(v) ? v : undefined;
    }
  }
  return undefined;
}

/** HttpOnly + Secure + SameSite=Strict (lebih ketat dari Lax pembeli; panel tidak dibuka dari link luar). */
export function cookieSesi(nama: string, nilai: string, umurDetik: number): string {
  return `${nama}=${nilai}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${String(umurDetik)}`;
}

export function hapusCookie(nama: string): string {
  return `${nama}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export interface OpsiBatasLaju {
  readonly maks: number;
  readonly jendelaMs: number;
  readonly sekarang?: () => number;
}

/** Jendela tetap per kunci. Entri kedaluwarsa dibersihkan saat dipakai & berkala. */
export class BatasLaju {
  readonly #peta = new Map<string, { mulai: number; jumlah: number }>();
  readonly #o: OpsiBatasLaju;
  readonly #sekarang: () => number;
  #bersihTerakhir = 0;

  constructor(o: OpsiBatasLaju) {
    this.#o = o;
    this.#sekarang = o.sekarang ?? (() => Date.now());
  }

  /** true = diizinkan (dan dihitung). false = melewati batas. */
  ambil(kunci: string): boolean {
    const kini = this.#sekarang();
    if (kini - this.#bersihTerakhir > this.#o.jendelaMs) {
      for (const [k, v] of this.#peta)
        if (kini - v.mulai >= this.#o.jendelaMs) this.#peta.delete(k);
      this.#bersihTerakhir = kini;
    }
    const e = this.#peta.get(kunci);
    if (!e || kini - e.mulai >= this.#o.jendelaMs) {
      this.#peta.set(kunci, { mulai: kini, jumlah: 1 });
      return true;
    }
    if (e.jumlah >= this.#o.maks) return false;
    e.jumlah++;
    return true;
  }

  /** Detik sampai jendela kunci ini habis (untuk header Retry-After). */
  sisaDetik(kunci: string): number {
    const e = this.#peta.get(kunci);
    if (!e) return 0;
    return Math.max(1, Math.ceil((e.mulai + this.#o.jendelaMs - this.#sekarang()) / 1000));
  }
}
