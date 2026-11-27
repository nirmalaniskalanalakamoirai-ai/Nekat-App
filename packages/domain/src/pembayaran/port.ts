// Port PaymentGateway (docs/flow/pembayaran.md §12.2) dan port repositori pembayaran (T-029).
// Dipanggil DI LUAR transaksi DB. Implementasi: XenditGateway & GatewayPalsu (@nekat/adapters).
import type { Instruksi, Rupiah } from "@nekat/shared";

/** Metode di port. EWALLET disiapkan untuk pesanan individu (K-57); adapter Xendit belum mendukungnya. */
export type MetodeGateway = "QRIS" | "VA" | "EWALLET";

/** Instruksi bayar. QRIS/VA = bentuk API (`@nekat/shared`); e-wallet menyusul bersama skema K-57. */
export type InstruksiGateway =
  Instruksi | { readonly jenis: "EWALLET"; readonly urlRedirect: string };

export type ModeGateway = "test" | "live";

/**
 * Kode galat gateway (§12.2). `bolehUlang` = boleh diulang dengan external_id SAMA (FP-01).
 * - TIMEOUT / GATEWAY_5XX / DIBATASI: sementara.
 * - METODE_TIDAK_DIDUKUNG / NOMINAL_DI_BAWAH_MINIMUM: permanen → pembayaran GAGAL (FP-25).
 * - DITOLAK: permintaan ditolak permanen karena alasan lain (validasi) → GAGAL.
 * - DUPLIKAT: external_id/idempotency-key sudah dipakai → cekStatus.
 * - TIDAK_AKTIF: batalkan atas tagihan yang sudah tidak aktif (dibayar/kedaluwarsa/dibatalkan) → cekStatus.
 * - KONFIGURASI: kunci salah/tidak berhak (401/403). Fail closed, bukan salah pembeli.
 * - RESPONS_TIDAK_VALID: respons tidak sesuai kontrak (diperlakukan sementara; cekStatus sebelum ulang).
 */
export type KodeGalatGateway =
  | "TIMEOUT"
  | "GATEWAY_5XX"
  | "DIBATASI"
  | "METODE_TIDAK_DIDUKUNG"
  | "NOMINAL_DI_BAWAH_MINIMUM"
  | "DITOLAK"
  | "DUPLIKAT"
  | "TIDAK_AKTIF"
  | "KONFIGURASI"
  | "RESPONS_TIDAK_VALID";

const SEMENTARA: ReadonlySet<KodeGalatGateway> = new Set([
  "TIMEOUT",
  "GATEWAY_5XX",
  "DIBATASI",
  "RESPONS_TIDAK_VALID",
]);

/** Galat gateway. Pesan TIDAK PERNAH memuat kunci, QR string, nomor VA, atau isi respons mentah. */
export class GalatGateway extends Error {
  readonly bolehUlang: boolean;
  constructor(
    readonly kode: KodeGalatGateway,
    pesan: string,
  ) {
    super(pesan);
    this.name = "GalatGateway";
    this.bolehUlang = SEMENTARA.has(kode);
  }
}

export interface PermintaanBuatPembayaran {
  /** = external_id / reference_id Xendit (= pembayaran.id). */
  readonly pembayaranId: string;
  readonly invoiceId: string;
  readonly jumlahRp: Rupiah;
  readonly metode: MetodeGateway;
  /** Kode bank VA (wajib untuk VA). */
  readonly kanal: string | null;
  /** Waktu ABSOLUT = invoice.kedaluwarsa_pada (bukan durasi baru, §5.1.3). */
  readonly kedaluwarsaPada: Date;
  /** Keterangan tanpa PII (mis. nomor tagihan). */
  readonly keterangan: string;
  /** Nama pemilik VA = nama merchant NEKAT dari konfigurasi, BUKAN nama pembeli/host (§5.3). */
  readonly namaVa: string;
}

export interface HasilBuatPembayaran {
  readonly xenditRef: string;
  readonly instruksi: InstruksiGateway;
  readonly kedaluwarsaPada: Date;
}

/** Status ternormalisasi (W2/§12.2). MENUNGGU = masih bisa dibayar. */
export type StatusNormal = "MENUNGGU" | "PAID" | "EXPIRED" | "FAILED" | "LAINNYA";

export interface StatusGateway {
  readonly ditemukan: true;
  readonly statusNormal: StatusNormal;
  readonly jumlahRp: number;
  readonly mataUang: string;
  readonly externalId: string;
  readonly paidAt: Date | null;
  readonly xenditRef: string;
  /** Instruksi bila masih tersedia (pemulihan setelah timeout, FP-01). */
  readonly instruksi: InstruksiGateway | null;
}

export type HasilCekStatus = StatusGateway | { readonly ditemukan: false };

export interface RujukanPembayaran {
  readonly pembayaranId: string;
  /** NULL bila buatPembayaran sempat timeout → adapter mencari dengan external_id = pembayaranId (W4). */
  readonly xenditRef: string | null;
}

export interface PaymentGateway {
  readonly nama: "xendit" | "palsu";
  readonly mode: ModeGateway;
  /** Kode bank VA yang didukung adapter (urut tampil). */
  readonly kanalVa: readonly string[];
  buatPembayaran(p: PermintaanBuatPembayaran): Promise<HasilBuatPembayaran>;
  cekStatus(r: RujukanPembayaran): Promise<HasilCekStatus>;
  /** Tutup QR/VA lebih awal (ganti metode). Sukses = Xendit mengonfirmasi batal. */
  batalkan(r: { readonly pembayaranId: string; readonly xenditRef: string }): Promise<void>;
  /** Sama dengan batalkan; dipakai job TTL (§7 langkah 4, T-030). */
  kedaluwarsakan(r: { readonly pembayaranId: string; readonly xenditRef: string }): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Port repositori (diimplementasikan @nekat/db). Semua metode satu transaksi pendek.

export type StatusPembayaran =
  "MENUNGGU" | "LUNAS" | "KEDALUWARSA" | "GAGAL" | "NOMINAL_TIDAK_COCOK" | "LUNAS_TERLAMBAT";

export type StatusTagihan = "DITERBITKAN" | "LUNAS" | "KEDALUWARSA" | "DIBATALKAN" | "DIGANTI";

export type AlasanGagal =
  "METODE_TIDAK_DIDUKUNG" | "NOMINAL_DI_BAWAH_MINIMUM" | "DITOLAK_GATEWAY" | "GAGAL_GATEWAY";

export interface TagihanUntukBayar {
  readonly id: string;
  readonly nomor: string;
  readonly status: StatusTagihan;
  readonly totalRp: Rupiah;
  readonly saldoDipakaiRp: Rupiah;
  readonly sisaBayarRp: Rupiah;
  readonly kedaluwarsaPada: Date;
  readonly gabungan: boolean;
  /** Fase 1 semua tagihan lewat grup (`invoice.grup_id` NN). INDIVIDU menunggu K-57. */
  readonly jenis: "GRUP";
}

export interface PembayaranTersimpan {
  readonly id: string;
  readonly invoiceId: string;
  readonly metode: "QRIS" | "VA";
  readonly kanal: string | null;
  readonly jumlahRp: Rupiah;
  readonly status: StatusPembayaran;
  readonly xenditRef: string | null;
  readonly instruksi: Instruksi | null;
  readonly kedaluwarsaPada: Date;
  readonly kunciIdempotensi: string;
  readonly alasanGagal: AlasanGagal | null;
}

export type HasilSiapkan =
  /** Baris MENUNGGU baru dibuat (xendit_ref NULL). */
  | {
      readonly jenis: "BARU";
      readonly tagihan: TagihanUntukBayar;
      readonly pembayaran: PembayaranTersimpan;
    }
  /** Sudah ada pembayaran MENUNGGU dengan metode & kanal sama (POST ganda, §4.2). */
  | {
      readonly jenis: "ADA";
      readonly tagihan: TagihanUntukBayar;
      readonly pembayaran: PembayaranTersimpan;
    }
  /** Ada pembayaran MENUNGGU dengan metode/kanal lain → ganti metode. */
  | {
      readonly jenis: "GANTI";
      readonly tagihan: TagihanUntukBayar;
      readonly lama: PembayaranTersimpan;
    };

export interface InputSiapkan {
  readonly invoiceId: string;
  /** Selalu dari sesi (pembayar). */
  readonly akunId: string;
  readonly metode: "QRIS" | "VA";
  readonly kanal: string | null;
  readonly sekarang: Date;
  readonly kanalVaDiizinkan: readonly string[];
}

export interface RepoPembayaran {
  /**
   * Di dalam kunci invoice (FOR UPDATE): cek kepemilikan & aturan (`cekBolehBayar`), lalu kembalikan
   * pembayaran hidup atau sisipkan baris MENUNGGU baru `bayar:{invoice_id}:{n}`. Melempar GalatBayar.
   */
  siapkan(i: InputSiapkan): Promise<HasilSiapkan>;
  /** Simpan xendit_ref + instruksi bila baris masih MENUNGGU dan ref kosong/sama. null = tidak berubah. */
  simpanHasilBuat(
    pembayaranId: string,
    h: { readonly xenditRef: string; readonly instruksi: Instruksi | null },
  ): Promise<PembayaranTersimpan | null>;
  /** MENUNGGU → GAGAL (update bersyarat). */
  tandaiGagal(pembayaranId: string, alasan: AlasanGagal): Promise<boolean>;
  /** MENUNGGU → KEDALUWARSA setelah Xendit mengonfirmasi batal (ganti metode). */
  tutupUntukGanti(pembayaranId: string): Promise<boolean>;
  /** Tagihan milik akun + pembayaran terbaru (hidup lebih dulu). null = bukan milik akun / tidak ada. */
  baca(
    invoiceId: string,
    akunId: string,
  ): Promise<{ tagihan: TagihanUntukBayar; pembayaran: PembayaranTersimpan | null } | null>;
}
