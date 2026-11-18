// Klien API zona (apps/api T-015). Same-origin `/api` (dev: proxy Vite).

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

export class GalatApi extends Error {
  constructor(
    readonly kode: string,
    pesan: string,
  ) {
    super(pesan);
  }
}

async function minta<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  const r = await fetch(url, { ...init, headers });
  if (!r.ok) {
    const isi = (await r.json().catch(() => null)) as { kode?: string; pesan?: string } | null;
    throw new GalatApi(
      isi?.kode ?? `HTTP_${String(r.status)}`,
      isi?.pesan ?? "Terjadi gangguan. Coba lagi.",
    );
  }
  return (await r.json()) as T;
}

export function ambilDaftarZona(): Promise<{ zona: ZonaPublik[] }> {
  return minta("/api/zona");
}

export function cekZona(lat: number, lng: number): Promise<HasilCekZona> {
  return minta("/api/zona/cek", { method: "POST", body: JSON.stringify({ lat, lng }) });
}
