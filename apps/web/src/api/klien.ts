// Klien HTTP bersama untuk API NEKAT. Same-origin `/api` (dev: proxy Vite; produksi: reverse proxy).
// Pesan galat dari server (bentuk `{ kode, pesan }`) diteruskan apa adanya karena sudah aman untuk
// pembeli; galat jaringan diberi kode `JARINGAN`.

export class GalatApi extends Error {
  constructor(
    readonly kode: string,
    pesan: string,
    /** Status HTTP; 0 = permintaan tidak sampai ke server (jaringan putus). */
    readonly status = 0,
  ) {
    super(pesan);
    this.name = "GalatApi";
  }
}

export const PESAN_GAGAL_MUAT = "Gagal memuat. Periksa sinyal lalu coba lagi.";

export async function minta<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers });
  } catch (err) {
    // AbortError diteruskan apa adanya agar react-query mengenalinya sebagai pembatalan.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new GalatApi("JARINGAN", PESAN_GAGAL_MUAT);
  }
  if (!r.ok) {
    const isi = (await r.json().catch(() => null)) as { kode?: unknown; pesan?: unknown } | null;
    throw new GalatApi(
      typeof isi?.kode === "string" ? isi.kode : `HTTP_${String(r.status)}`,
      typeof isi?.pesan === "string" ? isi.pesan : "Terjadi gangguan. Coba lagi.",
      r.status,
    );
  }
  return (await r.json()) as T;
}
