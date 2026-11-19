// Toggle & konfigurasi InventorySource dari environment (T-009 §8, ADR-0001 §4.1).
// Dibaca SEKALI saat start; nilai tidak valid → aplikasi gagal start. Pesan error hanya menyebut
// NAMA variabel, tidak pernah nilainya (ADR-0001 §6).
import { NAMA_SUMBER_INVENTORY, type NamaSumberInventory } from "@nekat/shared";

export const MODE_SAAT_GANGGUAN = ["tahan_checkout", "jual_snapshot"] as const;
export type ModeSaatGangguan = (typeof MODE_SAAT_GANGGUAN)[number];

export interface KonfigInventory {
  readonly sumber: NamaSumberInventory;
  /** P-10: batas usia data snapshot (menit). Bawaan 15. */
  readonly maksUmurDataMenit: number;
  /** H14: perilaku saat sumber tak terjangkau. Bawaan `tahan_checkout`. */
  readonly saatGangguan: ModeSaatGangguan;
  readonly intervalSinkronMenit: number;
  /** Hanya bila `sumber = gudang` (dipakai T-019). */
  readonly gudang: {
    readonly apiUrl: string;
    /** Fungsi (bukan properti) agar token tidak ikut ter-serialisasi bila objek konfigurasi dicatat. */
    readonly ambilToken: () => string;
  } | null;
}

export class KonfigInventoryTidakValidError extends Error {
  readonly variabel: readonly string[];
  constructor(variabel: readonly string[]) {
    super(`Konfigurasi inventory tidak valid: ${variabel.join(", ")}`);
    this.name = "KonfigInventoryTidakValidError";
    this.variabel = variabel;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** String kosong = tidak diisi (sama dengan pola PORT di apps/api). */
function ambil(env: Env, nama: string): string | undefined {
  const v = env[nama]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

function bilanganBulat(
  env: Env,
  nama: string,
  bawaan: number,
  min: number,
  maks: number,
  salah: string[],
): number {
  const v = ambil(env, nama);
  if (v === undefined) return bawaan;
  const n = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < min || n > maks) {
    salah.push(nama);
    return bawaan;
  }
  return n;
}

function pilihan<T extends string>(
  env: Env,
  nama: string,
  daftar: readonly T[],
  bawaan: T,
  salah: string[],
): T {
  const v = ambil(env, nama);
  if (v === undefined) return bawaan;
  if ((daftar as readonly string[]).includes(v)) return v as T;
  salah.push(nama);
  return bawaan;
}

/** `https://` tanpa kredensial di URL (token hanya lewat header, T-009 §5.1). */
function urlGudangValid(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.username === "" && u.password === "" && u.hostname !== "";
  } catch {
    return false;
  }
}

export function bacaKonfigInventory(env: Env): KonfigInventory {
  const salah: string[] = [];
  const sumber = pilihan(env, "INVENTORY_SOURCE", NAMA_SUMBER_INVENTORY, "local", salah);
  const maksUmurDataMenit = bilanganBulat(
    env,
    "INVENTORY_MAKS_UMUR_DATA_MENIT",
    15,
    1,
    1440,
    salah,
  );
  const saatGangguan = pilihan(
    env,
    "INVENTORY_SAAT_GANGGUAN",
    MODE_SAAT_GANGGUAN,
    "tahan_checkout",
    salah,
  );
  const intervalSinkronMenit = bilanganBulat(
    env,
    "INVENTORY_INTERVAL_SINKRON_MENIT",
    5,
    1,
    1440,
    salah,
  );

  let gudang: KonfigInventory["gudang"] = null;
  if (sumber === "gudang") {
    const apiUrl = ambil(env, "GUDANG_API_URL");
    const token = ambil(env, "GUDANG_API_TOKEN");
    if (apiUrl === undefined || !urlGudangValid(apiUrl)) salah.push("GUDANG_API_URL");
    if (token === undefined) salah.push("GUDANG_API_TOKEN");
    if (apiUrl !== undefined && token !== undefined) {
      gudang = { apiUrl, ambilToken: () => token };
    }
  }

  if (salah.length > 0) throw new KonfigInventoryTidakValidError(salah);
  return { sumber, maksUmurDataMenit, saatGangguan, intervalSinkronMenit, gudang };
}
