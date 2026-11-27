// Use case mulaiBayar (T-029, docs/flow/pembayaran.md §4.2, §5.1, FP-01, FP-23–FP-25).
//
// Urutan (§5.1.3): transaksi pendek di repo (kunci invoice → insert/baca pembayaran) → COMMIT → panggilan
// gateway DI LUAR transaksi → simpan xendit_ref + instruksi lewat update bersyarat.
// - POST ganda/bersamaan: repo mengembalikan pembayaran MENUNGGU yang sama; di satu proses panggilan gateway
//   untuk pembayaran yang sama digabung (single-flight); antar-proses dilindungi idempotency-key = external_id.
// - Timeout/5xx: baris tetap MENUNGGU, xendit_ref NULL. Upaya berikut memanggil `cekStatus(external_id)` dulu;
//   tidak ditemukan → buat ulang dengan external_id SAMA (tidak pernah external_id baru untuk upaya yang sama).
// - Gagal permanen → GAGAL (UK satu-hidup lepas, pembeli memilih metode lain).
// - Ganti metode: batalkan di gateway DULU; hanya bila terkonfirmasi, baris lama → KEDALUWARSA lalu buat baru.
//   Batal gagal → tidak membuat pembayaran baru (FP-24). Ternyata sudah PAID → `SEDANG_DIPERIKSA`; pelunasan
//   (I3 / LUNAS_TERLAMBAT) adalah tugas jalur konfirmasi T-030, bukan use case ini.
// Use case ini TIDAK PERNAH menandai LUNAS: webhook/redirect/cekStatus di sini bukan jalur pelunasan.
import type { Instruksi } from "@nekat/shared";
import { GalatBayar, keteranganTagihan } from "./aturan.js";
import {
  GalatGateway,
  type AlasanGagal,
  type HasilCekStatus,
  type InstruksiGateway,
  type PaymentGateway,
  type PembayaranTersimpan,
  type RepoPembayaran,
  type TagihanUntukBayar,
} from "./port.js";

export type JenisHasilBayar =
  "OK" | "MENYIAPKAN" | "GANTI_METODE_GAGAL" | "SEDANG_DIPERIKSA" | "METODE_GAGAL";

export interface HasilMulaiBayar {
  readonly hasil: JenisHasilBayar;
  readonly tagihan: TagihanUntukBayar;
  readonly pembayaran: PembayaranTersimpan;
}

/** Peristiwa log terstruktur. Hanya id & kode: tanpa QR string, nomor VA, nama, HP, atau kunci. */
export interface PeristiwaBayar {
  readonly jenis:
    | "BUAT_OK"
    | "BUAT_SEMENTARA_GAGAL"
    | "BUAT_PERMANEN_GAGAL"
    | "PULIH_DARI_CEK"
    | "GANTI_BATAL_OK"
    | "GANTI_BATAL_GAGAL"
    | "SUDAH_DIBAYAR_DI_GATEWAY"
    | "KONFIGURASI_GATEWAY";
  readonly pembayaranId: string;
  readonly kode?: string;
}

export interface DepLayananBayar {
  readonly repo: RepoPembayaran;
  /** null = gateway belum dikonfigurasi (fail closed → 503). */
  readonly gateway: PaymentGateway | null;
  /** Nama pemilik VA = nama merchant NEKAT (konfigurasi), bukan nama pembeli (§5.3). */
  readonly namaMerchant: string;
  readonly jam?: () => Date;
  readonly catat?: (p: PeristiwaBayar) => void;
}

export interface InputMulaiBayar {
  readonly invoiceId: string;
  /** Selalu dari sesi. */
  readonly akunId: string;
  readonly metode: "QRIS" | "VA";
  readonly kanal: string | null;
}

const BATAS_PUTARAN = 3;

function galatGatewayTidakAktif(): GalatBayar {
  return new GalatBayar(
    "GATEWAY_TIDAK_AKTIF",
    "Pembayaran sedang gangguan. Coba lagi beberapa menit.",
  );
}

/** Port memakai InstruksiGateway; tabel pembayaran Fase 1 hanya menyimpan QRIS/VA. */
function keInstruksiTersimpan(i: InstruksiGateway): Instruksi {
  if (i.jenis === "EWALLET") {
    throw new GalatGateway("RESPONS_TIDAK_VALID", "instruksi e-wallet belum didukung");
  }
  return i;
}

export class LayananBayar {
  readonly #d: DepLayananBayar;
  readonly #jam: () => Date;
  readonly #terbang = new Map<string, Promise<HasilMulaiBayar>>();

  constructor(d: DepLayananBayar) {
    this.#d = d;
    this.#jam = d.jam ?? (() => new Date());
  }

  get gateway(): PaymentGateway | null {
    return this.#d.gateway;
  }

  async mulaiBayar(i: InputMulaiBayar): Promise<HasilMulaiBayar> {
    const gw = this.#d.gateway;
    if (!gw) throw galatGatewayTidakAktif();
    return this.#jalankan(gw, i, 0);
  }

  async #jalankan(
    gw: PaymentGateway,
    i: InputMulaiBayar,
    putaran: number,
  ): Promise<HasilMulaiBayar> {
    const s = await this.#d.repo.siapkan({
      invoiceId: i.invoiceId,
      akunId: i.akunId,
      metode: i.metode,
      kanal: i.kanal,
      sekarang: this.#jam(),
      kanalVaDiizinkan: gw.kanalVa,
    });

    if (s.jenis === "GANTI") {
      if (putaran >= BATAS_PUTARAN) {
        return { hasil: "GANTI_METODE_GAGAL", tagihan: s.tagihan, pembayaran: s.lama };
      }
      const r = await this.#tutupLama(gw, s.lama);
      if (r !== "TERTUTUP") return { hasil: r, tagihan: s.tagihan, pembayaran: s.lama };
      return this.#jalankan(gw, i, putaran + 1);
    }

    const p = s.pembayaran;
    if (p.xenditRef !== null && p.instruksi !== null) {
      return { hasil: "OK", tagihan: s.tagihan, pembayaran: p };
    }
    const kunci = p.id;
    const ada = this.#terbang.get(kunci);
    if (ada) return ada;
    const janji = this.#pastikanDibuat(gw, i, s.tagihan, p, s.jenis === "ADA", putaran).finally(
      () => this.#terbang.delete(kunci),
    );
    this.#terbang.set(kunci, janji);
    return janji;
  }

  async #pastikanDibuat(
    gw: PaymentGateway,
    i: InputMulaiBayar,
    t: TagihanUntukBayar,
    p: PembayaranTersimpan,
    mungkinSudahAda: boolean,
    putaran: number,
  ): Promise<HasilMulaiBayar> {
    // FP-01 / M-06: upaya sebelumnya bisa sudah sampai di gateway walau kita tidak menerima jawaban.
    if (mungkinSudahAda) {
      let cek: HasilCekStatus;
      try {
        cek = await gw.cekStatus({ pembayaranId: p.id, xenditRef: p.xenditRef });
      } catch (e) {
        return this.#galatSementara(e, t, p);
      }
      if (cek.ditemukan) {
        if (cek.statusNormal === "PAID") {
          this.#catat("SUDAH_DIBAYAR_DI_GATEWAY", p.id);
          return { hasil: "SEDANG_DIPERIKSA", tagihan: t, pembayaran: p };
        }
        if (cek.statusNormal === "MENUNGGU" && cek.instruksi !== null) {
          this.#catat("PULIH_DARI_CEK", p.id);
          return this.#simpan(i, t, p, cek.xenditRef, cek.instruksi);
        }
        if (cek.statusNormal === "EXPIRED" || cek.statusNormal === "FAILED") {
          // Upaya lama sudah mati di gateway padahal invoice masih hidup → tutup, buat upaya baru (n+1).
          await this.#d.repo.tutupUntukGanti(p.id);
          if (putaran >= BATAS_PUTARAN) return { hasil: "MENYIAPKAN", tagihan: t, pembayaran: p };
          return this.#jalankan(gw, i, putaran + 1);
        }
        return { hasil: "MENYIAPKAN", tagihan: t, pembayaran: p };
      }
    }

    let h;
    try {
      h = await gw.buatPembayaran({
        pembayaranId: p.id,
        invoiceId: t.id,
        jumlahRp: p.jumlahRp,
        metode: p.metode,
        kanal: p.kanal,
        kedaluwarsaPada: p.kedaluwarsaPada,
        keterangan: keteranganTagihan(t.nomor),
        namaVa: this.#d.namaMerchant,
      });
    } catch (e) {
      if (e instanceof GalatGateway && e.kode === "DUPLIKAT") {
        // external_id sudah tercatat di gateway (permintaan lain / upaya lama): ambil status, jangan buat baru.
        try {
          const cek = await gw.cekStatus({ pembayaranId: p.id, xenditRef: p.xenditRef });
          if (cek.ditemukan && cek.statusNormal === "MENUNGGU" && cek.instruksi !== null) {
            return await this.#simpan(i, t, p, cek.xenditRef, cek.instruksi);
          }
          if (cek.ditemukan && cek.statusNormal === "PAID") {
            return { hasil: "SEDANG_DIPERIKSA", tagihan: t, pembayaran: p };
          }
        } catch (e2) {
          return this.#galatSementara(e2, t, p);
        }
        return { hasil: "MENYIAPKAN", tagihan: t, pembayaran: p };
      }
      if (e instanceof GalatGateway && !e.bolehUlang && e.kode !== "KONFIGURASI") {
        const alasan: AlasanGagal =
          e.kode === "METODE_TIDAK_DIDUKUNG" || e.kode === "NOMINAL_DI_BAWAH_MINIMUM"
            ? e.kode
            : "DITOLAK_GATEWAY";
        this.#catat("BUAT_PERMANEN_GAGAL", p.id, alasan);
        await this.#d.repo.tandaiGagal(p.id, alasan);
        const baru = await this.#d.repo.baca(i.invoiceId, i.akunId);
        const bp = baru?.pembayaran?.id === p.id ? baru.pembayaran : null;
        return {
          hasil: "METODE_GAGAL",
          tagihan: baru?.tagihan ?? t,
          pembayaran: bp ?? { ...p, status: "GAGAL", alasanGagal: alasan },
        };
      }
      return this.#galatSementara(e, t, p);
    }
    this.#catat("BUAT_OK", p.id);
    return this.#simpan(i, t, p, h.xenditRef, h.instruksi);
  }

  async #simpan(
    i: InputMulaiBayar,
    t: TagihanUntukBayar,
    p: PembayaranTersimpan,
    xenditRef: string,
    instruksi: InstruksiGateway,
  ): Promise<HasilMulaiBayar> {
    const tersimpan = await this.#d.repo.simpanHasilBuat(p.id, {
      xenditRef,
      instruksi: keInstruksiTersimpan(instruksi),
    });
    if (tersimpan) return { hasil: "OK", tagihan: t, pembayaran: tersimpan };
    // Baris berubah di tengah jalan (mis. ditutup jalur lain): kembalikan keadaan terbaru dari DB.
    const baru = await this.#d.repo.baca(i.invoiceId, i.akunId);
    if (!baru?.pembayaran) return { hasil: "MENYIAPKAN", tagihan: t, pembayaran: p };
    const siap = baru.pembayaran.xenditRef !== null && baru.pembayaran.instruksi !== null;
    return {
      hasil: siap && baru.pembayaran.status === "MENUNGGU" ? "OK" : "MENYIAPKAN",
      tagihan: baru.tagihan,
      pembayaran: baru.pembayaran,
    };
  }

  /** Sementara → MENYIAPKAN (FE: "Menyiapkan pembayaran…" + coba lagi). Kunci salah → 503 (fail closed). */
  #galatSementara(e: unknown, t: TagihanUntukBayar, p: PembayaranTersimpan): HasilMulaiBayar {
    if (e instanceof GalatGateway && e.kode === "KONFIGURASI") {
      this.#catat("KONFIGURASI_GATEWAY", p.id, e.kode);
      throw galatGatewayTidakAktif();
    }
    if (!(e instanceof GalatGateway)) throw e;
    this.#catat("BUAT_SEMENTARA_GAGAL", p.id, e.kode);
    return { hasil: "MENYIAPKAN", tagihan: t, pembayaran: p };
  }

  /** §4.2 ganti metode. */
  async #tutupLama(
    gw: PaymentGateway,
    lama: PembayaranTersimpan,
  ): Promise<"TERTUTUP" | "GANTI_METODE_GAGAL" | "SEDANG_DIPERIKSA"> {
    let ref = lama.xenditRef;
    try {
      if (ref === null) {
        // Upaya lama tidak pernah mendapat jawaban: instruksinya tidak pernah ditampilkan ke pembeli.
        const cek = await gw.cekStatus({ pembayaranId: lama.id, xenditRef: null });
        if (!cek.ditemukan) return await this.#tutup(lama.id);
        if (cek.statusNormal === "PAID") return this.#sudahDibayar(lama.id);
        if (cek.statusNormal === "EXPIRED" || cek.statusNormal === "FAILED") {
          return await this.#tutup(lama.id);
        }
        ref = cek.xenditRef;
      }
      try {
        await gw.batalkan({ pembayaranId: lama.id, xenditRef: ref });
      } catch (e) {
        if (!(e instanceof GalatGateway) || e.kode !== "TIDAK_AKTIF") throw e;
        // Gateway: sudah tidak aktif → pastikan alasannya lewat GET (bisa jadi sudah dibayar).
        const cek = await gw.cekStatus({ pembayaranId: lama.id, xenditRef: ref });
        if (cek.ditemukan && cek.statusNormal === "PAID") return this.#sudahDibayar(lama.id);
        if (!cek.ditemukan || cek.statusNormal === "MENUNGGU") {
          this.#catat("GANTI_BATAL_GAGAL", lama.id, "STATUS_TIDAK_JELAS");
          return "GANTI_METODE_GAGAL";
        }
      }
    } catch (e) {
      if (!(e instanceof GalatGateway)) throw e;
      if (e.kode === "KONFIGURASI") {
        this.#catat("KONFIGURASI_GATEWAY", lama.id, e.kode);
        throw galatGatewayTidakAktif();
      }
      this.#catat("GANTI_BATAL_GAGAL", lama.id, e.kode);
      return "GANTI_METODE_GAGAL";
    }
    this.#catat("GANTI_BATAL_OK", lama.id);
    return this.#tutup(lama.id);
  }

  async #tutup(id: string): Promise<"TERTUTUP"> {
    // false = baris sudah ditutup jalur lain; putaran berikut membaca keadaan terbaru.
    await this.#d.repo.tutupUntukGanti(id);
    return "TERTUTUP";
  }

  #sudahDibayar(id: string): "SEDANG_DIPERIKSA" {
    this.#catat("SUDAH_DIBAYAR_DI_GATEWAY", id);
    return "SEDANG_DIPERIKSA";
  }

  #catat(jenis: PeristiwaBayar["jenis"], pembayaranId: string, kode?: string): void {
    try {
      this.#d.catat?.({ jenis, pembayaranId, ...(kode === undefined ? {} : { kode }) });
    } catch {
      // Log tidak boleh menggagalkan alur uang.
    }
  }
}
