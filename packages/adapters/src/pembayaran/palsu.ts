// GatewayPalsu (FakeGateway, §12.2): PaymentGateway di memori untuk dev & tes. Tidak pernah dipakai di
// production (ditolak `bacaKonfigPembayaran`). Bisa mensimulasikan PAID, EXPIRED, FAILED, nominal beda,
// paid_at di tepi TTL, timeout (sebelum/sesudah tagihan tercatat), dan gagal permanen.
// QR string & nomor VA di sini PALSU (tidak bisa dibayar di aplikasi bank mana pun).
import { createHash } from "node:crypto";
import {
  GalatGateway,
  type HasilBuatPembayaran,
  type HasilCekStatus,
  type InstruksiGateway,
  type KodeGalatGateway,
  type PaymentGateway,
  type PermintaanBuatPembayaran,
  type RujukanPembayaran,
  type StatusNormal,
} from "@nekat/domain";

export type OperasiPalsu = "buat" | "cek" | "batal";

/**
 * Perilaku satu panggilan berikutnya:
 * - `{ galat }`: lempar galat tanpa efek.
 * - `TIMEOUT_SETELAH_TERCATAT`: tagihan tercatat di "gateway" tetapi pemanggil menerima TIMEOUT (FP-01).
 */
export type PerilakuPalsu = { readonly galat: KodeGalatGateway } | "TIMEOUT_SETELAH_TERCATAT";

interface TagihanPalsu {
  readonly ref: string;
  readonly externalId: string;
  readonly jumlahRp: number;
  readonly mataUang: string;
  readonly instruksi: InstruksiGateway;
  readonly kedaluwarsaPada: Date;
  status: StatusNormal;
  paidAt: Date | null;
  jumlahDibayarRp: number;
}

export interface OpsiGatewayPalsu {
  readonly kanalVa?: readonly string[];
  readonly namaMerchant?: string;
  readonly jam?: () => Date;
  /** Nominal minimum palsu (uji NOMINAL_DI_BAWAH_MINIMUM). Bawaan 1. */
  readonly minimumRp?: number;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export class GatewayPalsu implements PaymentGateway {
  readonly nama = "palsu" as const;
  readonly mode = "test" as const;
  readonly kanalVa: readonly string[];
  readonly #jam: () => Date;
  readonly #minimum: number;
  readonly #tagihan = new Map<string, TagihanPalsu>();
  readonly #antrean: Record<OperasiPalsu, PerilakuPalsu[]> = { buat: [], cek: [], batal: [] };
  /** Jumlah panggilan per operasi (untuk tes). */
  readonly panggilan: Record<OperasiPalsu, number> = { buat: 0, cek: 0, batal: 0 };

  constructor(o: OpsiGatewayPalsu = {}) {
    this.kanalVa = o.kanalVa ?? ["BNI", "BRI", "MANDIRI", "PERMATA"];
    this.#jam = o.jam ?? (() => new Date());
    this.#minimum = o.minimumRp ?? 1;
  }

  /** Antrekan perilaku untuk panggilan berikutnya pada operasi itu. */
  aturBerikut(op: OperasiPalsu, p: PerilakuPalsu): void {
    this.#antrean[op].push(p);
  }

  async buatPembayaran(p: PermintaanBuatPembayaran): Promise<HasilBuatPembayaran> {
    this.panggilan.buat++;
    await Promise.resolve();
    const perilaku = this.#antrean.buat.shift();
    if (perilaku !== undefined && perilaku !== "TIMEOUT_SETELAH_TERCATAT") {
      throw new GalatGateway(perilaku.galat, "simulasi gateway palsu");
    }
    if (p.metode === "EWALLET")
      throw new GalatGateway("METODE_TIDAK_DIDUKUNG", "e-wallet palsu belum ada");
    if (p.metode === "VA" && (p.kanal === null || !this.kanalVa.includes(p.kanal))) {
      throw new GalatGateway("METODE_TIDAK_DIDUKUNG", "bank tidak didukung");
    }
    if (p.jumlahRp < this.#minimum)
      throw new GalatGateway("NOMINAL_DI_BAWAH_MINIMUM", "di bawah minimum");
    // Idempoten per external_id (meniru idempotency-key, X-03).
    let t = this.#tagihan.get(p.pembayaranId);
    if (!t) {
      const h = hash(p.pembayaranId);
      const ref = `pr-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
      const instruksi: InstruksiGateway =
        p.metode === "QRIS"
          ? {
              jenis: "QRIS",
              qrString: `00020101021226PALSU${h.slice(0, 40)}5303360540${String(p.jumlahRp)}6304PALS`,
            }
          : {
              jenis: "VA",
              bank: p.kanal ?? "",
              nomorVa: `8808${BigInt(`0x${h.slice(0, 12)}`)
                .toString()
                .padStart(12, "0")
                .slice(0, 12)}`,
              namaPenerima: p.namaVa,
            };
      t = {
        ref,
        externalId: p.pembayaranId,
        jumlahRp: p.jumlahRp,
        mataUang: "IDR",
        instruksi,
        kedaluwarsaPada: p.kedaluwarsaPada,
        status: "MENUNGGU",
        paidAt: null,
        jumlahDibayarRp: p.jumlahRp,
      };
      this.#tagihan.set(p.pembayaranId, t);
    }
    if (perilaku === "TIMEOUT_SETELAH_TERCATAT") {
      throw new GalatGateway("TIMEOUT", "simulasi timeout setelah tercatat");
    }
    return { xenditRef: t.ref, instruksi: t.instruksi, kedaluwarsaPada: t.kedaluwarsaPada };
  }

  async cekStatus(r: RujukanPembayaran): Promise<HasilCekStatus> {
    this.panggilan.cek++;
    await Promise.resolve();
    const perilaku = this.#antrean.cek.shift();
    if (perilaku !== undefined && perilaku !== "TIMEOUT_SETELAH_TERCATAT") {
      throw new GalatGateway(perilaku.galat, "simulasi gateway palsu");
    }
    const t = this.#cari(r.pembayaranId, r.xenditRef);
    if (!t) return { ditemukan: false };
    this.#kedaluwarsakanBilaLewat(t);
    return {
      ditemukan: true,
      statusNormal: t.status,
      jumlahRp: t.status === "PAID" ? t.jumlahDibayarRp : t.jumlahRp,
      mataUang: t.mataUang,
      externalId: t.externalId,
      paidAt: t.paidAt,
      xenditRef: t.ref,
      instruksi: t.status === "MENUNGGU" ? t.instruksi : null,
    };
  }

  async batalkan(r: { pembayaranId: string; xenditRef: string }): Promise<void> {
    this.panggilan.batal++;
    await Promise.resolve();
    const perilaku = this.#antrean.batal.shift();
    if (perilaku !== undefined && perilaku !== "TIMEOUT_SETELAH_TERCATAT") {
      throw new GalatGateway(perilaku.galat, "simulasi gateway palsu");
    }
    const t = this.#cari(r.pembayaranId, r.xenditRef);
    if (!t) throw new GalatGateway("TIDAK_AKTIF", "tidak ditemukan");
    this.#kedaluwarsakanBilaLewat(t);
    if (t.status !== "MENUNGGU") throw new GalatGateway("TIDAK_AKTIF", "sudah tidak aktif");
    t.status = "EXPIRED";
  }

  kedaluwarsakan(r: { pembayaranId: string; xenditRef: string }): Promise<void> {
    return this.batalkan(r);
  }

  // ---- Simulasi (dev/tes) ----

  /** Pembeli membayar. `jumlahRp` beda = simulasi nominal tidak cocok. */
  simulasiBayar(pembayaranId: string, o: { paidAt?: Date; jumlahRp?: number } = {}): boolean {
    const t = this.#tagihan.get(pembayaranId);
    if (t?.status !== "MENUNGGU") return false;
    t.status = "PAID";
    t.paidAt = o.paidAt ?? this.#jam();
    t.jumlahDibayarRp = o.jumlahRp ?? t.jumlahRp;
    return true;
  }

  simulasiKedaluwarsa(pembayaranId: string): void {
    const t = this.#tagihan.get(pembayaranId);
    if (t?.status === "MENUNGGU") t.status = "EXPIRED";
  }

  simulasiGagal(pembayaranId: string): void {
    const t = this.#tagihan.get(pembayaranId);
    if (t?.status === "MENUNGGU") t.status = "FAILED";
  }

  /** Untuk tes: lupakan tagihan seolah permintaan tidak pernah sampai. */
  lupakan(pembayaranId: string): void {
    this.#tagihan.delete(pembayaranId);
  }

  jumlahTagihan(): number {
    return this.#tagihan.size;
  }

  #cari(pembayaranId: string, ref: string | null): TagihanPalsu | undefined {
    const t = this.#tagihan.get(pembayaranId);
    if (!t) return undefined;
    if (ref !== null && t.ref !== ref) return undefined;
    return t;
  }

  #kedaluwarsakanBilaLewat(t: TagihanPalsu): void {
    if (t.status === "MENUNGGU" && this.#jam().getTime() >= t.kedaluwarsaPada.getTime()) {
      t.status = "EXPIRED";
    }
  }
}
