// @nekat/adapters — InventorySource, PaymentGateway (Xendit), WhatsAppGateway, Clock (ADR-0001 §3.1, §4).
// T-018: InventorySource (LocalInventory + toggle). T-019: GudangApiInventory.
// T-029: PaymentGateway (XenditGateway QRIS/VA + GatewayPalsu). Menyusul: T-016 (WhatsApp).

export const NAMA_PAKET = "@nekat/adapters";

export {
  bacaKonfigInventory,
  KonfigInventoryTidakValidError,
  MODE_SAAT_GANGGUAN,
  type KonfigInventory,
  type ModeSaatGangguan,
} from "./inventori/konfigurasi.js";
export {
  LocalInventory,
  type OpsiLocalInventory,
  type PeristiwaInventori,
} from "./inventori/local-inventory.js";
export {
  GudangApiInventory,
  kaliSeribuEksak,
  keSatuanDasar,
  type OpsiGudangApiInventory,
} from "./inventori/gudang-api-inventory.js";
export {
  BATAS_RESPONS_BAWAAN_BYTE,
  bacaRetryAfter,
  denganRetry,
  jedaBackoff,
  KlienGudang,
  PROFIL_GUDANG,
  type JenisProfilBaca,
  type OpsiKlienGudang,
  type OpsiRetry,
  type ProfilPanggilan,
} from "./inventori/http-gudang.js";
export {
  buatInventorySource,
  DependensiInventoryKurangError,
  type DependensiInventory,
} from "./inventori/pabrik.js";
export { hashKanonik, jsonKanonik } from "./inventori/kanonik.js";
export {
  bacaKonfigPembayaran,
  KANAL_VA_BAWAAN,
  KonfigPembayaranTidakValidError,
  NAMA_GATEWAY_PEMBAYARAN,
  PREFIKS_KUNCI,
  type KonfigPembayaran,
  type NamaGatewayPembayaran,
} from "./pembayaran/konfigurasi.js";
export {
  channelCode,
  normalkanStatus,
  TIMEOUT_XENDIT_MS,
  XENDIT_API_URL,
  XENDIT_API_VERSION,
  XenditGateway,
  type OpsiXenditGateway,
} from "./pembayaran/xendit.js";
export {
  GatewayPalsu,
  type OperasiPalsu,
  type OpsiGatewayPalsu,
  type PerilakuPalsu,
} from "./pembayaran/palsu.js";
export { buatPaymentGateway } from "./pembayaran/pabrik.js";
