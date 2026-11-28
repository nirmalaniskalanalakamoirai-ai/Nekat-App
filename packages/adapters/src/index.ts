// @nekat/adapters — InventorySource, PaymentGateway (Xendit), WhatsAppGateway, Clock (ADR-0001 §3.1, §4).
// T-018: InventorySource (LocalInventory + toggle). T-019: GudangApiInventory.
// T-016: WhatsAppGateway (mode log / sandbox / meta) + penjaga start. Menyusul: T-029 (Xendit).

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
  bacaKonfigWhatsApp,
  KonfigWhatsAppTidakValidError,
  MODE_WHATSAPP,
  type IzinSandbox,
  type KonfigMetaCloud,
  type KonfigWhatsApp,
  type OpsiBacaKonfigWhatsApp,
} from "./whatsapp/konfigurasi.js";
export { LogGateway, type CatatanLogWa, type OpsiLogGateway } from "./whatsapp/log-gateway.js";
export {
  KELAS_GALAT_META,
  kelasDariKodeMeta,
  MetaCloudGateway,
  type OpsiMetaCloudGateway,
} from "./whatsapp/meta-gateway.js";
export { buatWhatsAppGateway, type DependensiWhatsApp } from "./whatsapp/pabrik.js";
