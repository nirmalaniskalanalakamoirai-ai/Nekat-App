// Klien API tagihan (apps/api T-029). Same-origin `/api`. Respons divalidasi skema bersama sebelum dipakai.
import {
  tagihanBayarSchema,
  type MetodeBayarApi,
  type PermintaanBayar,
  type TagihanBayar,
} from "@nekat/shared";

export class GalatTagihan extends Error {
  constructor(
    readonly status: number,
    readonly kode: string,
    pesan: string,
  ) {
    super(pesan);
  }
}

export interface DataTagihan {
  readonly data: TagihanBayar;
  /** Jam HP saat respons diterima (untuk selisih jam server). */
  readonly diterimaMs: number;
}

async function minta(url: string, init?: RequestInit): Promise<DataTagihan> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const r = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const isi = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) {
    const g = isi as { kode?: unknown; pesan?: unknown } | null;
    throw new GalatTagihan(
      r.status,
      typeof g?.kode === "string" ? g.kode : `HTTP_${String(r.status)}`,
      typeof g?.pesan === "string" ? g.pesan : "Terjadi gangguan. Coba lagi.",
    );
  }
  const h = tagihanBayarSchema.safeParse(isi);
  if (!h.success)
    throw new GalatTagihan(502, "RESPONS_TIDAK_VALID", "Terjadi gangguan. Coba lagi.");
  return { data: h.data, diterimaMs: Date.now() };
}

export function ambilStatus(id: string): Promise<DataTagihan> {
  return minta(`/api/tagihan/${encodeURIComponent(id)}/pembayaran`);
}

export function mulaiBayar(
  id: string,
  metode: MetodeBayarApi,
  kanal?: string,
): Promise<DataTagihan> {
  const body: PermintaanBayar = kanal === undefined ? { metode } : { metode, kanal };
  return minta(`/api/tagihan/${encodeURIComponent(id)}/bayar`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
