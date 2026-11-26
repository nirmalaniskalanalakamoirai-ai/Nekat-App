import type {
  InventorySource,
  PemetaanSumberInventori,
  PenyimpanIdempotensi,
  RepoInventoriLokal,
} from "@nekat/domain";
import { GudangApiInventory } from "./gudang-api-inventory.js";
import type { JenisProfilBaca } from "./http-gudang.js";
import type { KonfigInventory } from "./konfigurasi.js";
import { LocalInventory, type PeristiwaInventori } from "./local-inventory.js";

export interface DependensiInventory {
  readonly idempotensi: PenyimpanIdempotensi;
  /** Wajib untuk `local`. */
  readonly repo?: RepoInventoriLokal;
  /** Wajib untuk `gudang`. */
  readonly pemetaan?: PemetaanSumberInventori;
  /** `gudang`: profil getStok/getHargaModal (T-009 §5). Bawaan `sinkron`. */
  readonly profilBaca?: JenisProfilBaca;
  readonly catat?: (p: PeristiwaInventori) => void;
  readonly sekarang?: () => Date;
}

export class DependensiInventoryKurangError extends Error {
  constructor(sumber: string, nama: string) {
    super(`InventorySource "${sumber}" butuh dependensi "${nama}"`);
    this.name = "DependensiInventoryKurangError";
  }
}

/**
 * Memilih implementasi `InventorySource` dari konfigurasi (toggle `INVENTORY_SOURCE`, dibaca saat
 * start, tidak per request; keputusan.md #8: integrasi bisa dinyalakan/dimatikan lewat konfigurasi).
 */
export function buatInventorySource(
  konfig: KonfigInventory,
  dep: DependensiInventory,
): InventorySource {
  const umum = {
    idempotensi: dep.idempotensi,
    ...(dep.catat ? { catat: dep.catat } : {}),
    ...(dep.sekarang ? { sekarang: dep.sekarang } : {}),
  };
  switch (konfig.sumber) {
    case "local":
      if (!dep.repo) throw new DependensiInventoryKurangError("local", "repo");
      return new LocalInventory({ ...umum, repo: dep.repo });
    case "gudang":
      if (!dep.pemetaan) throw new DependensiInventoryKurangError("gudang", "pemetaan");
      if (!konfig.gudang) throw new DependensiInventoryKurangError("gudang", "GUDANG_API_URL");
      return new GudangApiInventory({
        ...umum,
        pemetaan: dep.pemetaan,
        klien: { baseUrl: konfig.gudang.apiUrl, ambilToken: konfig.gudang.ambilToken },
        ...(dep.profilBaca ? { profilBaca: dep.profilBaca } : {}),
      });
  }
}
