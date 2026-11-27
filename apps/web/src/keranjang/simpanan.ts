// Penyimpanan keranjang sementara: memori + localStorage (dibungkus try/catch), PER ZONA.
// localStorage bisa melempar (mode privat, penyimpanan penuh/diblokir): keranjang tetap jalan di
// memori sampai halaman ditutup. Keranjang zona lain tidak ikut pindah (F-25 belum diputuskan).
import { useCallback, useSyncExternalStore } from "react";
import { KERANJANG_KOSONG, serialisasi, uraiKeranjang, type Keranjang } from "./keranjang";

const AWALAN = "nekat:keranjang-sementara:";
const PERISTIWA = "nekat:keranjang-berubah";

const memori = new Map<string, Keranjang>();

function kunci(zona: string) {
  return `${AWALAN}${zona}`;
}

export function bacaKeranjang(zona: string | null): Keranjang {
  if (zona === null) return KERANJANG_KOSONG;
  const ada = memori.get(zona);
  if (ada) return ada;
  let k = KERANJANG_KOSONG;
  try {
    k = uraiKeranjang(localStorage.getItem(kunci(zona)));
  } catch {
    // Penyimpanan tidak tersedia: mulai kosong.
  }
  memori.set(zona, k);
  return k;
}

export function tulisKeranjang(zona: string, k: Keranjang): void {
  memori.set(zona, k);
  try {
    if (k.item.length === 0) localStorage.removeItem(kunci(zona));
    else localStorage.setItem(kunci(zona), serialisasi(k));
  } catch {
    // Penyimpanan tidak tersedia/penuh: tetap berlaku di memori.
  }
  window.dispatchEvent(new CustomEvent(PERISTIWA));
}

/** Ubah keranjang zona secara atomik terhadap nilai terbaru. */
export function perbaruiKeranjang(zona: string, f: (k: Keranjang) => Keranjang): Keranjang {
  const lama = bacaKeranjang(zona);
  const baru = f(lama);
  if (baru !== lama) tulisKeranjang(zona, baru);
  return baru;
}

function langganan(cb: () => void) {
  const dariTabLain = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(AWALAN)) {
      // Tab lain mengubah keranjang: buang cache memori agar dibaca ulang.
      memori.clear();
      cb();
    }
  };
  window.addEventListener(PERISTIWA, cb);
  window.addEventListener("storage", dariTabLain);
  return () => {
    window.removeEventListener(PERISTIWA, cb);
    window.removeEventListener("storage", dariTabLain);
  };
}

/** Keranjang zona aktif (null = zona belum dipilih → selalu kosong) + fungsi pengubah. */
export function useKeranjang(zona: string | null) {
  const keranjang = useSyncExternalStore(
    langganan,
    () => bacaKeranjang(zona),
    () => KERANJANG_KOSONG,
  );
  const ubah = useCallback(
    (f: (k: Keranjang) => Keranjang) =>
      zona === null ? KERANJANG_KOSONG : perbaruiKeranjang(zona, f),
    [zona],
  );
  return [keranjang, ubah] as const;
}
