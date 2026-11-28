// Use case login OTP WhatsApp pembeli (T-016; T-010 §3.3a; ADR-0001 §4.3, §7).
//
// Alur kirim: batas laju per IP (memori) → satu transaksi DB (jeda kirim ulang, anggaran global, batas
// harian per nomor, OTP lama batal, simpan HMAC kode) → commit → DI LUAR transaksi kirim lewat gateway
// (nomor & kode hanya di variabel request). Gagal kirim → OTP dibatalkan, jatah harian dikembalikan.
// Permintaan kirim TIDAK PERNAH membaca tabel akun: respons & waktu sama untuk nomor terdaftar/belum.
//
// Alur verifikasi: batas laju per IP → repo memesan jatah percobaan ATOMIK lalu membandingkan HMAC kode
// constant-time → akun dibuat bila belum ada (1 akun per nomor) → sesi baru (ID baru, sesi lama di
// perangkat ini dicabut).
import type { RepoMasukPembeli, RingkasanAkunSaya, SesiPembeliAktif } from "@nekat/db";
import {
  awalHariWib,
  KELAS_GALAT_WA_BOLEH_ULANG,
  tanggalWib,
  WaGalat,
  type KelasGalatWa,
  type WhatsAppGateway,
} from "@nekat/domain";
import { BatasLaju } from "../admin/http-util.js";
import type { KonfigMasuk } from "./konfig.js";
import {
  buatKodeOtp,
  hmac,
  hmacHp,
  hmacKodeOtp,
  kunciIp,
  samaBuffer,
  sha256,
  tokenAcak,
} from "./kripto.js";

export type HasilMintaOtp =
  | { readonly ok: true; readonly kedaluwarsaDetik: number; readonly kirimUlangDetik: number }
  | { readonly ok: false; readonly alasan: "TERLALU_CEPAT" | "BATAS"; readonly tungguDetik: number }
  | { readonly ok: false; readonly alasan: "TIDAK_TERKIRIM" };

export type HasilVerifikasi =
  | {
      readonly ok: true;
      readonly token: string;
      readonly kedaluwarsaPada: Date;
      readonly akunId: string;
    }
  | { readonly ok: false; readonly alasan: "KODE_SALAH"; readonly sisaPercobaan: number }
  | {
      readonly ok: false;
      readonly alasan: "TIDAK_BERLAKU" | "AKUN_TIDAK_AKTIF";
    }
  | { readonly ok: false; readonly alasan: "BATAS"; readonly tungguDetik: number };

/** Kontrak yang dipakai rute & hook autentikasi (mudah dipalsukan di tes). */
export interface LayananMasuk {
  readonly sesiHari: number;
  mintaOtp(nomorE164: string, ip: string): Promise<HasilMintaOtp>;
  verifikasi(i: {
    nomorE164: string;
    kode: string;
    waOptin: boolean;
    ip: string;
    tokenLama: string | null;
  }): Promise<HasilVerifikasi>;
  /** Sesi hidup atau null. Menyentuh waktu aktif terakhir. */
  sesi(token: string): Promise<SesiPembeliAktif | null>;
  /** Token CSRF terikat token sesi. */
  csrf(token: string): string;
  keluar(token: string): Promise<void>;
  saya(akunId: string): Promise<RingkasanAkunSaya | null>;
}

/** Peristiwa operasional tanpa PII (nomor/kode/IP mentah tidak pernah ada di sini). */
export type PeristiwaMasuk =
  | { readonly jenis: "OTP_ANGGARAN_HABIS"; readonly cakupan: "JAM" | "HARI" }
  | {
      readonly jenis: "OTP_GAGAL_KIRIM";
      readonly kelas: KelasGalatWa | "TAK_TERDUGA";
      readonly kodePenyedia: string | undefined;
      readonly percobaan: number;
      readonly kritis: boolean;
    }
  | { readonly jenis: "OTP_TERKIRIM"; readonly percobaan: number; readonly mode: string };

export interface OpsiLayananMasuk {
  readonly repo: RepoMasukPembeli;
  readonly gateway: WhatsAppGateway;
  readonly konfig: KonfigMasuk;
  readonly sekarang?: () => Date;
  readonly tidur?: (ms: number) => Promise<void>;
  readonly lapor?: (p: PeristiwaMasuk) => void;
  /** Batas total waktu kirim OTP dalam satu request (ms). DEFAULT 12 dtk (T-010 §3.3a). */
  readonly batasKirimMs?: number;
}

const MAKS_PERCOBAAN_KIRIM = 3;
const KELAS_KRITIS: readonly KelasGalatWa[] = ["TEMPLATE", "OTENTIKASI", "KEBIJAKAN"];

export class LayananMasukPembeli implements LayananMasuk {
  readonly #repo: RepoMasukPembeli;
  readonly #gw: WhatsAppGateway;
  readonly #k: KonfigMasuk;
  readonly #sekarang: () => Date;
  readonly #tidur: (ms: number) => Promise<void>;
  readonly #lapor: (p: PeristiwaMasuk) => void;
  readonly #batasKirimMs: number;
  readonly #lajuKirim: BatasLaju;
  readonly #lajuVerifikasi: BatasLaju;

  constructor(o: OpsiLayananMasuk) {
    this.#repo = o.repo;
    this.#gw = o.gateway;
    this.#k = o.konfig;
    this.#sekarang = o.sekarang ?? (() => new Date());
    this.#tidur = o.tidur ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#lapor = o.lapor ?? (() => undefined);
    this.#batasKirimMs = o.batasKirimMs ?? 12_000;
    const jam = () => this.#sekarang().getTime();
    this.#lajuKirim = new BatasLaju({
      maks: o.konfig.kebijakan.maksKirimPerIpPerJam,
      jendelaMs: 3_600_000,
      sekarang: jam,
    });
    this.#lajuVerifikasi = new BatasLaju({
      maks: o.konfig.kebijakan.maksVerifikasiPerIpPerMenit,
      jendelaMs: 60_000,
      sekarang: jam,
    });
  }

  get sesiHari(): number {
    return this.#k.sesiHari;
  }

  #hpHmac(nomor: string): Buffer {
    const kunci = this.#k.kunciHp.get(this.#k.kunciHpVersi);
    if (!kunci) throw new Error("kunci HMAC HP versi aktif tidak ada");
    return hmacHp(kunci, nomor);
  }

  /** HMAC nomor dengan kunci versi tertentu (untuk daftar izin sandbox). null = versi tidak dikenal. */
  hmacHpVersi(versi: number, nomor: string): Buffer | null {
    const kunci = this.#k.kunciHp.get(versi);
    return kunci ? hmacHp(kunci, nomor) : null;
  }

  #ipHmac(ip: string): Buffer {
    return hmac(this.#k.kunciSesi, "ip", kunciIp(ip));
  }

  csrf(token: string): string {
    return hmac(this.#k.kunciSesi, "csrf-pembeli", token).toString("base64url");
  }

  async mintaOtp(nomorE164: string, ip: string): Promise<HasilMintaOtp> {
    const kIp = kunciIp(ip);
    if (!this.#lajuKirim.ambil(kIp)) {
      return { ok: false, alasan: "BATAS", tungguDetik: this.#lajuKirim.sisaDetik(kIp) };
    }
    const kini = this.#sekarang();
    const keb = this.#k.kebijakan;
    const hpHmac = this.#hpHmac(nomorE164);
    const kode = buatKodeOtp();
    const h = await this.#repo.buatOtp({
      hpHmac,
      kodeHmac: hmacKodeOtp(this.#k.kunciKode, hpHmac, kode),
      kodeKunciVersi: this.#k.kunciKodeVersi,
      ipHmac: this.#ipHmac(ip),
      sekarang: kini,
      tanggalWib: tanggalWib(kini),
      awalHariWib: awalHariWib(kini),
      batas: keb,
    });
    if (!h.ok) {
      if (h.alasan === "TERLALU_CEPAT") {
        return { ok: false, alasan: "TERLALU_CEPAT", tungguDetik: h.tungguDetik };
      }
      if (h.alasan === "BATAS_HP") {
        // Sampai hari WIB berikutnya.
        const besok = awalHariWib(kini).getTime() + 86_400_000;
        return {
          ok: false,
          alasan: "BATAS",
          tungguDetik: Math.max(60, Math.ceil((besok - kini.getTime()) / 1000)),
        };
      }
      this.#lapor({
        jenis: "OTP_ANGGARAN_HABIS",
        cakupan: h.alasan === "ANGGARAN_JAM" ? "JAM" : "HARI",
      });
      return { ok: false, alasan: "TIDAK_TERKIRIM" };
    }

    const terkirim = await this.#kirim(nomorE164, kode, `otp:${h.id}`);
    if (!terkirim) {
      await this.#repo.batalkanOtpGagalKirim(h.id, hpHmac, tanggalWib(kini), this.#sekarang());
      return { ok: false, alasan: "TIDAK_TERKIRIM" };
    }
    return {
      ok: true,
      kedaluwarsaDetik: keb.kedaluwarsaMenit * 60,
      kirimUlangDetik: keb.jedaKirimUlangDetik,
    };
  }

  /** Kirim sinkron dengan retry terbatas (maks 3 percobaan, total ≤ batasKirimMs). */
  async #kirim(nomorE164: string, kode: string, kunciIdempotensi: string): Promise<boolean> {
    const mulai = Date.now();
    for (let n = 1; n <= MAKS_PERCOBAAN_KIRIM; n++) {
      try {
        await this.#gw.kirimOtp({ nomorE164, kode, kunciIdempotensi });
        this.#lapor({ jenis: "OTP_TERKIRIM", percobaan: n, mode: this.#gw.mode });
        return true;
      } catch (err) {
        const kelas = err instanceof WaGalat ? err.kelas : "TAK_TERDUGA";
        const bolehUlang = err instanceof WaGalat && KELAS_GALAT_WA_BOLEH_ULANG.includes(err.kelas);
        const tunda = Math.min(
          err instanceof WaGalat && err.tundaDetik ? err.tundaDetik * 1000 : 400 * n,
          3_000,
        );
        const sisa = this.#batasKirimMs - (Date.now() - mulai);
        const lanjut = bolehUlang && n < MAKS_PERCOBAAN_KIRIM && sisa > tunda + 500;
        if (!lanjut) {
          this.#lapor({
            jenis: "OTP_GAGAL_KIRIM",
            kelas,
            kodePenyedia: err instanceof WaGalat ? err.kodePenyedia : undefined,
            percobaan: n,
            kritis: KELAS_KRITIS.includes(kelas as KelasGalatWa),
          });
          return false;
        }
        await this.#tidur(tunda);
      }
    }
    return false;
  }

  async verifikasi(i: {
    nomorE164: string;
    kode: string;
    waOptin: boolean;
    ip: string;
    tokenLama: string | null;
  }): Promise<HasilVerifikasi> {
    const kIp = kunciIp(i.ip);
    if (!this.#lajuVerifikasi.ambil(kIp)) {
      return { ok: false, alasan: "BATAS", tungguDetik: this.#lajuVerifikasi.sisaDetik(kIp) };
    }
    const kini = this.#sekarang();
    const keb = this.#k.kebijakan;
    const hpHmac = this.#hpHmac(i.nomorE164);
    const semuaVersi = [...this.#k.kunciHp.values()].map((k) => hmacHp(k, i.nomorE164));
    const harap = hmacKodeOtp(this.#k.kunciKode, hpHmac, i.kode);
    const token = tokenAcak();
    const kedaluwarsaPada = new Date(kini.getTime() + this.#k.sesiHari * 86_400_000);
    const h = await this.#repo.verifikasiOtp({
      hpHmac,
      hpHmacKunciVersi: this.#k.kunciHpVersi,
      hpHmacSemuaVersi: semuaVersi,
      nomorHpE164: i.nomorE164,
      // Selalu bandingkan (constant-time), lalu baru periksa versi kunci.
      cocok: (kodeHmac, versi) => samaBuffer(harap, kodeHmac) && versi === this.#k.kunciKodeVersi,
      sekarang: kini,
      tanggalWib: tanggalWib(kini),
      maksPercobaan: keb.maksPercobaan,
      maksGagalPerHari: keb.maksGagalPerHari,
      sesiBaru: { idHash: sha256(token), kedaluwarsaPada },
      sesiLamaHash: i.tokenLama ? sha256(i.tokenLama) : null,
      waOptin: i.waOptin,
      ipRingkas: this.#ipHmac(i.ip).toString("hex").slice(0, 16),
    });
    if (h.ok) return { ok: true, token, kedaluwarsaPada, akunId: h.akunId };
    if (h.alasan === "KODE_SALAH") {
      return { ok: false, alasan: "KODE_SALAH", sisaPercobaan: h.sisaPercobaan };
    }
    if (h.alasan === "BATAS_HARIAN") {
      const besok = awalHariWib(kini).getTime() + 86_400_000;
      return {
        ok: false,
        alasan: "BATAS",
        tungguDetik: Math.max(60, Math.ceil((besok - kini.getTime()) / 1000)),
      };
    }
    return { ok: false, alasan: h.alasan };
  }

  async sesi(token: string): Promise<SesiPembeliAktif | null> {
    const kini = this.#sekarang();
    const hash = sha256(token);
    const s = await this.#repo.cariSesi(hash, kini, this.#k.sesiIdleHari * 86_400_000);
    if (!s) return null;
    await this.#repo.sentuhSesi(hash, kini);
    return s;
  }

  async keluar(token: string): Promise<void> {
    await this.#repo.cabutSesi(sha256(token), this.#sekarang());
  }

  saya(akunId: string): Promise<RingkasanAkunSaya | null> {
    return this.#repo.ringkasanAkun(akunId);
  }
}
