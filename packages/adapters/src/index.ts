// @nekat/adapters — InventorySource, PaymentGateway (Xendit), WhatsAppGateway, Clock (ADR-0001 §3.1, §4).
// T-018: InventorySource (LocalInventory + toggle). Menyusul: T-016 (WhatsApp), T-019 (Gudang), T-029 (Xendit).

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
export { PenyimpanIdempotensiMemori } from "./inventori/idempotensi-memori.js";
export {
  buatInventorySource,
  SumberInventoryBelumDiimplementasiError,
  type DependensiInventory,
} from "./inventori/pabrik.js";
export { hashKanonik, jsonKanonik } from "./inventori/kanonik.js";
