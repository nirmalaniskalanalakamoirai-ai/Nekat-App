// Port gateway WhatsApp (T-010 §3.1, ADR-0001 §4.3, H2 jalur resmi Meta). Implementasi di
// `@nekat/adapters` (mode log / sandbox / meta). Domain hanya mengenal kontrak ini.
//
// ATURAN DATA: nomor & kode OTP hanya hidup di memori pemanggil dan adapter. Tidak pernah masuk
// log, error tracking, outbox, pg-boss, atau tabel mana pun (T-010 §3.3a).

export type ModeWhatsApp = "log" | "sandbox" | "meta";

export type KategoriTemplate = "AUTHENTICATION" | "UTILITY" | "MARKETING";

export interface PesanTemplate {
  /** Hanya di memori adapter; tidak pernah di log. */
  readonly nomorE164: string;
  /** Mis. "tagihan_terbit_v1". */
  readonly namaTemplate: string;
  readonly bahasa: "id";
  /** Sudah disanitasi, urut {{1}}..{{n}}. */
  readonly parameterBody: readonly string[];
  /** Sufiks URL dinamis (kode grup / id pesanan). */
  readonly parameterTombolUrl?: string;
  /** = outbox.kunci_idempotensi. */
  readonly kunciIdempotensi: string;
}

export interface PesanOtp {
  readonly nomorE164: string;
  /** 6 digit. Hanya di memori; dibuang setelah panggilan. */
  readonly kode: string;
  /** `otp:{otp_permintaan_id}` — satu id OTP paling banyak satu pesan terkirim. */
  readonly kunciIdempotensi: string;
}

export type KelasGalatWa =
  /** Jaringan, 5xx, timeout → boleh dicoba lagi. */
  | "SEMENTARA"
  /** Rate limit (throughput / pasangan / tier harian) → tunda. */
  | "BATAS"
  /** Nomor tidak bisa menerima / bukan pengguna WA / diblokir daftar izin sandbox → berhenti. */
  | "PENERIMA"
  /** Pengguna berhenti menerima marketing → berhenti, promo_wa=false. */
  | "OPT_OUT_MARKETING"
  /** Template tidak ada / parameter salah / PAUSED / DISABLED → hentikan template + alert. */
  | "TEMPLATE"
  /** Token kedaluwarsa / izin dicabut → hentikan semua kirim + alert. */
  | "OTENTIKASI"
  /** Akun dibatasi Meta → hentikan semua + alert. */
  | "KEBIJAKAN";

/** Kelas yang boleh dicoba ulang di dalam satu request OTP (T-010 §3.3a langkah 3). */
export const KELAS_GALAT_WA_BOLEH_ULANG: readonly KelasGalatWa[] = ["SEMENTARA", "BATAS"];

export class WaGalat extends Error {
  readonly kelas: KelasGalatWa;
  /** Kode galat penyedia (mis. "131026") atau penanda internal ("DIBLOKIR_SANDBOX", "TIMEOUT"). */
  readonly kodePenyedia: string | undefined;
  /** Saran tunda dari penyedia (detik). */
  readonly tundaDetik: number | undefined;

  constructor(kelas: KelasGalatWa, opsi: { kodePenyedia?: string; tundaDetik?: number } = {}) {
    // Pesan tanpa nomor/kode/isi respons penyedia.
    super(`WhatsApp gagal: ${kelas}${opsi.kodePenyedia ? ` (${opsi.kodePenyedia})` : ""}`);
    this.name = "WaGalat";
    this.kelas = kelas;
    this.kodePenyedia = opsi.kodePenyedia;
    this.tundaDetik = opsi.tundaDetik;
  }
}

export interface HasilKirimWa {
  /** wamid (Meta) atau id buatan adapter log. */
  readonly idPesanPenyedia: string;
}

export interface WhatsAppGateway {
  readonly mode: ModeWhatsApp;
  /** Melempar WaGalat. */
  kirimTemplate(p: PesanTemplate): Promise<HasilKirimWa>;
  /** Melempar WaGalat. Kunci idempotensi sama → tidak mengirim dua kali (dalam umur proses). */
  kirimOtp(p: PesanOtp): Promise<HasilKirimWa>;
}
