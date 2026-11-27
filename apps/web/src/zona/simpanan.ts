// Zona terpilih disimpan di HP (sesi lokal, T-007 H-01). Bukan data rahasia: hanya kode & nama zona,
// TIDAK menyimpan koordinat pembeli.
import { useSyncExternalStore } from "react";

export interface ZonaTerpilih {
  zonaKode: string;
  namaKelurahan: string;
  dropPointKode: string;
  dropPointNama: string;
}

const KUNCI = "nekat:zona";
const PERISTIWA = "nekat:zona-berubah";

function valid(x: unknown): x is ZonaTerpilih {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return ["zonaKode", "namaKelurahan", "dropPointKode", "dropPointNama"].every(
    (k) => typeof o[k] === "string",
  );
}

export function bacaZona(): ZonaTerpilih | null {
  try {
    const mentah = localStorage.getItem(KUNCI);
    if (!mentah) return null;
    const data: unknown = JSON.parse(mentah);
    return valid(data) ? data : null;
  } catch {
    return null;
  }
}

export function simpanZona(z: ZonaTerpilih): void {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(z));
  } catch {
    // Penyimpanan tidak tersedia: zona berlaku sampai halaman ditutup.
  }
  window.dispatchEvent(new CustomEvent(PERISTIWA));
}

export function langgananZona(cb: () => void): () => void {
  window.addEventListener(PERISTIWA, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PERISTIWA, cb);
    window.removeEventListener("storage", cb);
  };
}

// useSyncExternalStore butuh nilai stabil antar render: cache per isi JSON.
let cacheZona: { kunci: string; nilai: ZonaTerpilih | null } = { kunci: "null", nilai: null };
function bacaZonaStabil(): ZonaTerpilih | null {
  const nilai = bacaZona();
  const kunci = JSON.stringify(nilai);
  if (kunci !== cacheZona.kunci) cacheZona = { kunci, nilai };
  return cacheZona.nilai;
}

/** Zona terpilih (null = belum dipilih), ikut berubah saat zona diganti di tab mana pun. */
export function useZonaTerpilih(): ZonaTerpilih | null {
  return useSyncExternalStore(langgananZona, bacaZonaStabil, () => null);
}

/** Tujuan setelah memilih zona: kembali ke link grup bila datang dari sana, selain itu ke Belanja. */
export function tujuanSetelahZona(kembali: string | null): string {
  return kembali && /^\/g\/[A-Za-z0-9]{4,12}$/.test(kembali) ? kembali : "/";
}
