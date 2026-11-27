import { readFile } from "node:fs/promises";
import type { ZonaLayanan } from "@nekat/domain";
import { bacaKonfigLokasi, type KonfigLokasi } from "@nekat/shared";

// config/lokasi.json (M7): satu-satunya sumber koordinat & radius. Format: config/lokasi.example.json.
// Skema & validasi di @nekat/shared (dipakai juga oleh sinkron config → DB, T-015b).

export { bacaKonfigLokasi, type KonfigLokasi };

/** null bila file tidak ada (zona belum diatur). Error bila ada tapi tidak valid. */
export async function muatKonfigLokasi(path: string): Promise<KonfigLokasi | null> {
  let isi: string;
  try {
    isi = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return bacaKonfigLokasi(JSON.parse(isi) as unknown);
}

export function keZonaLayanan(k: KonfigLokasi): ZonaLayanan[] {
  return k.zona.map((z) => ({
    kode: z.kode,
    namaKelurahan: z.namaKelurahan,
    dropPoint: z.dropPoint.map((d) => ({
      kode: d.kode,
      nama: d.nama,
      lat: d.lat,
      lng: d.lng,
      radiusMeter: d.radiusMeter,
    })),
  }));
}
