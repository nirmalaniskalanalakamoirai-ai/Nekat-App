// Pabrik PaymentGateway dari konfigurasi start-up (T-029). `nonaktif` → null (rute bayar menjawab 503).
import type { PaymentGateway } from "@nekat/domain";
import type { KonfigPembayaran } from "./konfigurasi.js";
import { GatewayPalsu } from "./palsu.js";
import { XenditGateway } from "./xendit.js";

export function buatPaymentGateway(k: KonfigPembayaran): PaymentGateway | null {
  if (k.gateway === "nonaktif") return null;
  if (k.gateway === "palsu") {
    // Pertahanan berlapis: konfigurasi sudah menolak palsu di production.
    if (k.mode !== "test") throw new Error("GatewayPalsu hanya untuk mode test");
    return new GatewayPalsu({ kanalVa: k.kanalVa, namaMerchant: k.namaMerchant });
  }
  if (!k.ambilKunci) throw new Error("XENDIT_SECRET_KEY belum diatur");
  return new XenditGateway({ mode: k.mode, ambilKunci: k.ambilKunci, kanalVa: k.kanalVa });
}
