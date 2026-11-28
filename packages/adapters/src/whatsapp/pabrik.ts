// Pabrik gateway WhatsApp dari konfigurasi (T-016). Dipanggil API (OTP) dan, menyusul, worker (outbox).
import type { WhatsAppGateway } from "@nekat/domain";
import type { KonfigWhatsApp } from "./konfigurasi.js";
import { LogGateway, type CatatanLogWa } from "./log-gateway.js";
import { MetaCloudGateway } from "./meta-gateway.js";

export interface DependensiWhatsApp {
  /** HMAC nomor HP per versi kunci (sandbox). */
  readonly hmacHp: (versi: number, nomorE164: string) => Buffer | null;
  /** Umur OTP (ms) untuk memori LogGateway. */
  readonly ttlKodeMs: number;
  readonly catatLog?: (c: CatatanLogWa) => void;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export function buatWhatsAppGateway(k: KonfigWhatsApp, d: DependensiWhatsApp): WhatsAppGateway {
  if (k.mode === "log") {
    // Pertahanan berlapis: konfigurasi sudah menolak ini, tetapi pabrik juga menolak.
    if (k.nodeEnv === "production") throw new Error("WA_MODE=log ditolak di production");
    return new LogGateway({ ttlKodeMs: d.ttlKodeMs, ...(d.catatLog ? { catat: d.catatLog } : {}) });
  }
  if (!k.meta) throw new Error("Konfigurasi Meta Cloud API kosong");
  return new MetaCloudGateway({
    mode: k.mode,
    konfig: k.meta,
    izinSandbox: k.izinSandbox,
    hmacHp: d.hmacHp,
    ...(d.fetch ? { fetch: d.fetch } : {}),
  });
}
