import type { EntriIdempotensi, PenyimpanIdempotensi } from "@nekat/domain";

/**
 * Penyimpan idempotensi di memori proses. Untuk tes dan dev satu proses SAJA: isinya hilang saat
 * restart dan tidak dibagi antar-proses API/worker. Production memakai penyimpan tahan lama
 * `buatPenyimpanIdempotensiPg` dari `@nekat/db` (tabel `idempotensi_inventori`, T-013b).
 */
export class PenyimpanIdempotensiMemori implements PenyimpanIdempotensi {
  readonly #data = new Map<string, EntriIdempotensi<unknown>>();

  simpanBilaBelumAda<T>(
    ruang: "konfirmasi" | "picking",
    kunci: string,
    entri: EntriIdempotensi<T>,
  ): Promise<{ baru: boolean; entri: EntriIdempotensi<T> }> {
    const k = `${ruang}\u0000${kunci}`;
    const lama = this.#data.get(k) as EntriIdempotensi<T> | undefined;
    if (lama) return Promise.resolve({ baru: false, entri: lama });
    this.#data.set(k, entri);
    return Promise.resolve({ baru: true, entri });
  }

  /** Jumlah entri per ruang (untuk tes: "picking hanya satu"). */
  jumlah(ruang: "konfirmasi" | "picking"): number {
    let n = 0;
    for (const k of this.#data.keys()) if (k.startsWith(`${ruang}\u0000`)) n++;
    return n;
  }
}
