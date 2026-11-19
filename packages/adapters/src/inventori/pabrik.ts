import type { InventorySource } from "@nekat/domain";
import type { KonfigInventory } from "./konfigurasi.js";
import { LocalInventory, type OpsiLocalInventory } from "./local-inventory.js";

export class SumberInventoryBelumDiimplementasiError extends Error {
  constructor(sumber: string) {
    super(`InventorySource "${sumber}" belum diimplementasi (GudangApiInventory dibuat di T-019)`);
    this.name = "SumberInventoryBelumDiimplementasiError";
  }
}

export type DependensiInventory = OpsiLocalInventory;

/**
 * Memilih implementasi `InventorySource` dari konfigurasi (toggle `INVENTORY_SOURCE`, dibaca saat
 * start, tidak per request). Titik sambung T-019: cabang `gudang` diganti `new GudangApiInventory(...)`.
 */
export function buatInventorySource(
  konfig: KonfigInventory,
  dep: DependensiInventory,
): InventorySource {
  switch (konfig.sumber) {
    case "local":
      return new LocalInventory(dep);
    case "gudang":
      throw new SumberInventoryBelumDiimplementasiError(konfig.sumber);
  }
}

/**
 * Penjaga start API/worker: `INVENTORY_SOURCE=gudang` ditolak sampai GudangApiInventory ada (T-019).
 * T-019 menghapus cabang `gudang` di sini bersamaan dengan pabrik di atas.
 */
export function pastikanSumberInventoryTersedia(konfig: KonfigInventory): void {
  if (konfig.sumber === "gudang") throw new SumberInventoryBelumDiimplementasiError(konfig.sumber);
}
