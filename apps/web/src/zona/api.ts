// Klien API zona (apps/api T-015). Same-origin `/api` (dev: proxy Vite).
import { minta } from "../api/klien";

export interface DropPointPublik {
  kode: string;
  nama: string;
  alamatPublik: string | null;
  jamAmbil: string | null;
}
export interface ZonaPublik {
  kode: string;
  namaKelurahan: string;
  dropPoint: DropPointPublik[];
}
export type HasilCekZona =
  | {
      status: "DALAM_ZONA";
      zonaKode: string;
      namaKelurahan: string;
      dropPointKode: string;
      dropPointNama: string;
      jarakMeter: number;
    }
  | { status: "DI_LUAR_ZONA" };

export function ambilDaftarZona(): Promise<{ zona: ZonaPublik[] }> {
  return minta("/api/zona");
}

export function cekZona(lat: number, lng: number): Promise<HasilCekZona> {
  return minta("/api/zona/cek", { method: "POST", body: JSON.stringify({ lat, lng }) });
}
