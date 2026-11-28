// Gateway WhatsApp mode `log` (dev, tes, CI, preview; T-010 §3.2, §3.3a langkah 6, N-03).
// Tidak mengirim apa pun ke luar. Penjaga start (konfigurasi.ts) menjamin mode ini mustahil di production.
//
// - Kode OTP terakhir per nomor disimpan HANYA di memori proses (TTL = umur OTP), untuk tes dan
//   halaman/endpoint dev. Tidak pernah ditulis ke log, DB, atau disk.
// - Log hanya berisi jenis pesan, nama template, dan kunci idempotensi (tanpa nomor, kode, parameter).
import type { HasilKirimWa, PesanOtp, PesanTemplate, WhatsAppGateway } from "@nekat/domain";
import { randomUUID } from "node:crypto";

export interface CatatanLogWa {
  readonly jenis: "OTP" | "TEMPLATE";
  readonly namaTemplate: string;
  readonly kunciIdempotensi: string;
  readonly idPesanPenyedia: string;
  /** true = kunci sama sudah pernah dikirim; tidak dikirim ulang. */
  readonly duplikat: boolean;
}

export interface OpsiLogGateway {
  /** Umur kode di memori (ms). Samakan dengan umur OTP. */
  readonly ttlKodeMs: number;
  readonly catat?: (c: CatatanLogWa) => void;
  readonly sekarang?: () => number;
  /** Batas entri memori (cegah tumbuh tak terbatas di proses dev yang lama hidup). */
  readonly maksEntri?: number;
}

export class LogGateway implements WhatsAppGateway {
  readonly mode = "log" as const;
  readonly #kode = new Map<string, { kode: string; kedaluwarsa: number }>();
  readonly #terkirim = new Map<string, string>();
  readonly #o: OpsiLogGateway;
  readonly #sekarang: () => number;
  readonly #maks: number;
  /** Jumlah panggilan kirim yang benar-benar "terkirim" (bukan duplikat) — untuk tes. */
  jumlahTerkirim = 0;

  constructor(o: OpsiLogGateway) {
    this.#o = o;
    this.#sekarang = o.sekarang ?? (() => Date.now());
    this.#maks = o.maksEntri ?? 10_000;
  }

  #idempoten(kunci: string): { id: string; duplikat: boolean } {
    const ada = this.#terkirim.get(kunci);
    if (ada) return { id: ada, duplikat: true };
    const id = `log.${randomUUID()}`;
    if (this.#terkirim.size >= this.#maks) {
      const tertua = this.#terkirim.keys().next().value;
      if (tertua !== undefined) this.#terkirim.delete(tertua);
    }
    this.#terkirim.set(kunci, id);
    this.jumlahTerkirim++;
    return { id, duplikat: false };
  }

  kirimOtp(p: PesanOtp): Promise<HasilKirimWa> {
    const { id, duplikat } = this.#idempoten(p.kunciIdempotensi);
    if (!duplikat) {
      this.#bersihkan();
      if (this.#kode.size >= this.#maks) {
        const tertua = this.#kode.keys().next().value;
        if (tertua !== undefined) this.#kode.delete(tertua);
      }
      this.#kode.delete(p.nomorE164); // urutan sisip = urutan umur
      this.#kode.set(p.nomorE164, {
        kode: p.kode,
        kedaluwarsa: this.#sekarang() + this.#o.ttlKodeMs,
      });
    }
    this.#o.catat?.({
      jenis: "OTP",
      namaTemplate: "auth_otp_v1",
      kunciIdempotensi: p.kunciIdempotensi,
      idPesanPenyedia: id,
      duplikat,
    });
    return Promise.resolve({ idPesanPenyedia: id });
  }

  kirimTemplate(p: PesanTemplate): Promise<HasilKirimWa> {
    const { id, duplikat } = this.#idempoten(p.kunciIdempotensi);
    this.#o.catat?.({
      jenis: "TEMPLATE",
      namaTemplate: p.namaTemplate,
      kunciIdempotensi: p.kunciIdempotensi,
      idPesanPenyedia: id,
      duplikat,
    });
    return Promise.resolve({ idPesanPenyedia: id });
  }

  /** Kode OTP terakhir yang "dikirim" ke nomor ini (belum kedaluwarsa), atau null. Dev/tes saja. */
  ambilKodeTerakhir(nomorE164: string): string | null {
    const e = this.#kode.get(nomorE164);
    if (!e) return null;
    if (e.kedaluwarsa <= this.#sekarang()) {
      this.#kode.delete(nomorE164);
      return null;
    }
    return e.kode;
  }

  #bersihkan(): void {
    const kini = this.#sekarang();
    for (const [k, v] of this.#kode) if (v.kedaluwarsa <= kini) this.#kode.delete(k);
  }
}
