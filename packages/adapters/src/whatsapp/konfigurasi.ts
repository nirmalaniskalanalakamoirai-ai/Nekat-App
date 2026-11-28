// Konfigurasi gateway WhatsApp dari environment (T-016, T-010 §3.2, ADR-0001 §4.3, H2).
// Dibaca SEKALI saat start; salah → proses gagal start. Pesan galat hanya NAMA variabel.
//
// Penjaga start (pagar mode):
// - NODE_ENV wajib salah satu dari development/test/staging/production (kosong/salah ketik → gagal).
// - production WAJIB `meta`; `log` dan `sandbox` ditolak di production.
// - `meta` HANYA di production (staging/dev memakai `sandbox` atau `log`, T-010 TC-NJ-03).
// - `sandbox` wajib punya daftar izin; setiap entri `v{versi}:{hex}` harus memakai versi kunci HMAC
//   nomor HP yang dikenal proses ini (rotasi kunci tidak membuka nomor lain, TC-NJ-49).
// - WA_MODE kosong: `log` di development/test; staging/production wajib mengisi.
import type { ModeWhatsApp } from "@nekat/domain";
import { nodeEnvSah, type NodeEnv } from "@nekat/shared";

export const MODE_WHATSAPP: readonly ModeWhatsApp[] = ["log", "sandbox", "meta"];

export interface IzinSandbox {
  readonly versi: number;
  /** HMAC-SHA256(kunci HMAC nomor HP versi itu, nomor E.164) — sama dengan `akun.hp_hmac`. */
  readonly hmac: Buffer;
}

export interface KonfigMetaCloud {
  /** Versi Graph API yang dipin, mis. "v21.0" (ASUMSI W-04: verifikasi di dokumentasi Meta). */
  readonly apiVersi: string;
  readonly phoneNumberId: string;
  /** Fungsi agar token tidak ikut ter-serialisasi bila objek konfigurasi dicatat. */
  readonly ambilToken: () => string;
  /** Nama template authentication OTP (T-010 WA-01). */
  readonly templateOtp: string;
  readonly bahasa: "id";
  /** Batas waktu per panggilan (ms). DEFAULT 5000 (T-010 §3.3a). */
  readonly timeoutMs: number;
  /** URL dasar Graph API (hanya untuk tes/mock; bawaan https://graph.facebook.com). */
  readonly urlDasar: string;
}

export interface KonfigWhatsApp {
  readonly nodeEnv: NodeEnv;
  readonly mode: ModeWhatsApp;
  /** Hanya untuk sandbox & meta. */
  readonly meta: KonfigMetaCloud | null;
  /** Hanya untuk sandbox. */
  readonly izinSandbox: readonly IzinSandbox[];
}

export class KonfigWhatsAppTidakValidError extends Error {
  readonly variabel: readonly string[];
  constructor(variabel: readonly string[]) {
    super(`Konfigurasi WhatsApp tidak valid: ${variabel.join(", ")}`);
    this.name = "KonfigWhatsAppTidakValidError";
    this.variabel = variabel;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function ambil(env: Env, nama: string): string | undefined {
  const v = env[nama]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

const POLA_IZIN = /^v([1-9][0-9]{0,4}):([0-9a-f]{64})$/;

export interface OpsiBacaKonfigWhatsApp {
  /** Versi kunci HMAC nomor HP yang dikenal proses (HP_HMAC_KUNCI_VERSI + versi lama). */
  readonly versiKunciHp: readonly number[];
}

export function bacaKonfigWhatsApp(env: Env, opsi: OpsiBacaKonfigWhatsApp): KonfigWhatsApp {
  const salah: string[] = [];
  const nodeEnvMentah = env["NODE_ENV"];
  const nodeEnv: NodeEnv = nodeEnvSah(nodeEnvMentah) ? nodeEnvMentah : "production";
  if (!nodeEnvSah(nodeEnvMentah)) salah.push("NODE_ENV");
  const produksi = nodeEnv === "production";

  const modeMentah = ambil(env, "WA_MODE");
  let mode: ModeWhatsApp = "log";
  if (modeMentah === undefined) {
    // Kosong hanya boleh di dev/test (mode log). Staging/production wajib eksplisit.
    if (nodeEnv !== "development" && nodeEnv !== "test") salah.push("WA_MODE");
  } else if ((MODE_WHATSAPP as readonly string[]).includes(modeMentah)) {
    mode = modeMentah as ModeWhatsApp;
  } else {
    salah.push("WA_MODE");
  }
  // Pagar: production ⇔ meta.
  if (produksi && mode !== "meta" && !salah.includes("WA_MODE")) salah.push("WA_MODE");
  if (!produksi && mode === "meta") salah.push("WA_MODE");

  let meta: KonfigMetaCloud | null = null;
  if (mode === "meta" || mode === "sandbox") {
    const apiVersi = ambil(env, "WA_API_VERSI");
    const phoneNumberId = ambil(env, "WA_PHONE_NUMBER_ID");
    const token = ambil(env, "WA_ACCESS_TOKEN");
    const templateOtp = ambil(env, "WA_TEMPLATE_OTP") ?? "auth_otp_v1";
    const timeoutMentah = ambil(env, "WA_TIMEOUT_MS") ?? "5000";
    const urlDasar = ambil(env, "WA_API_URL") ?? "https://graph.facebook.com";
    if (apiVersi === undefined || !/^v[0-9]{1,3}\.[0-9]$/.test(apiVersi))
      salah.push("WA_API_VERSI");
    if (phoneNumberId === undefined || !/^[0-9]{5,25}$/.test(phoneNumberId)) {
      salah.push("WA_PHONE_NUMBER_ID");
    }
    // Token tanpa spasi/baris baru (tidak bisa menyusup ke header).
    if (token === undefined || !/^[A-Za-z0-9_.-]{20,2048}$/.test(token)) {
      salah.push("WA_ACCESS_TOKEN");
    }
    if (!/^[a-z0-9_]{1,512}$/.test(templateOtp)) salah.push("WA_TEMPLATE_OTP");
    const timeoutMs = /^[0-9]{3,5}$/.test(timeoutMentah) ? Number(timeoutMentah) : Number.NaN;
    if (!(timeoutMs >= 500 && timeoutMs <= 10_000)) salah.push("WA_TIMEOUT_MS");
    let urlOk: boolean;
    try {
      const u = new URL(urlDasar);
      urlOk =
        (u.protocol === "https:" || (!produksi && u.hostname === "127.0.0.1")) &&
        u.username === "" &&
        u.password === "" &&
        u.search === "" &&
        u.hash === "";
      // Production hanya ke Graph API resmi (H2).
      if (produksi && u.origin !== "https://graph.facebook.com") urlOk = false;
    } catch {
      urlOk = false;
    }
    if (!urlOk) salah.push("WA_API_URL");
    if (apiVersi && phoneNumberId && token) {
      meta = {
        apiVersi,
        phoneNumberId,
        ambilToken: () => token,
        templateOtp,
        bahasa: "id",
        timeoutMs,
        urlDasar: urlDasar.replace(/\/+$/, ""),
      };
    }
  }

  const izinSandbox: IzinSandbox[] = [];
  const izinMentah = ambil(env, "WA_SANDBOX_NOMOR_IZIN");
  if (mode === "sandbox") {
    const entri = (izinMentah ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    let rusak = entri.length === 0 || entri.length > 200;
    for (const e of entri) {
      const m = POLA_IZIN.exec(e);
      const versi = Number(m?.[1]);
      if (!m?.[2] || !opsi.versiKunciHp.includes(versi)) {
        rusak = true;
        continue;
      }
      izinSandbox.push({ versi, hmac: Buffer.from(m[2], "hex") });
    }
    if (rusak) salah.push("WA_SANDBOX_NOMOR_IZIN");
  } else if (izinMentah !== undefined && produksi) {
    // Daftar izin di production = salah pasang (mode sandbox tertinggal).
    salah.push("WA_SANDBOX_NOMOR_IZIN");
  }

  if (salah.length > 0) throw new KonfigWhatsAppTidakValidError([...new Set(salah)]);
  return { nodeEnv, mode, meta, izinSandbox };
}
