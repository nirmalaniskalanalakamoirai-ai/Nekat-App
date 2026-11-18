// Penentuan zona layanan (keputusan #5: radius 2–3 km skala kelurahan, dari drop point).
// Fungsi murni: koordinat & radius datang dari config/lokasi.json (M7), bukan dari DB.

export interface Koordinat {
  readonly lat: number;
  readonly lng: number;
}

export interface DropPointZona extends Koordinat {
  readonly kode: string;
  readonly nama: string;
  /** 2.000–3.000 m (keputusan #5). */
  readonly radiusMeter: number;
}

export interface ZonaLayanan {
  readonly kode: string;
  readonly namaKelurahan: string;
  readonly dropPoint: readonly DropPointZona[];
}

export type HasilZona =
  | {
      readonly status: "DALAM_ZONA";
      readonly zonaKode: string;
      readonly namaKelurahan: string;
      readonly dropPointKode: string;
      readonly dropPointNama: string;
      /** Dibulatkan ke 10 m terdekat agar tidak membocorkan posisi persis. */
      readonly jarakMeter: number;
    }
  | { readonly status: "DI_LUAR_ZONA" };

export const RADIUS_MIN_METER = 2000;
export const RADIUS_MAKS_METER = 3000;
const JARI_JARI_BUMI_METER = 6_371_008.8;

export function koordinatValid(k: Koordinat): boolean {
  return (
    Number.isFinite(k.lat) &&
    Number.isFinite(k.lng) &&
    Math.abs(k.lat) <= 90 &&
    Math.abs(k.lng) <= 180
  );
}

/** Jarak lingkaran besar (haversine) dalam meter. */
export function jarakMeter(a: Koordinat, b: Koordinat): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * JARI_JARI_BUMI_METER * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Drop point TERDEKAT yang radiusnya mencakup lokasi pembeli. Bila beberapa zona tumpang tindih,
 * yang terdekat menang; jarak sama → urutan konfigurasi (deterministik).
 */
export function tentukanZona(lokasi: Koordinat, daftarZona: readonly ZonaLayanan[]): HasilZona {
  if (!koordinatValid(lokasi)) return { status: "DI_LUAR_ZONA" };
  let terbaik: { zona: ZonaLayanan; dp: DropPointZona; jarak: number } | null = null;
  for (const zona of daftarZona) {
    for (const dp of zona.dropPoint) {
      const jarak = jarakMeter(lokasi, dp);
      if (jarak <= dp.radiusMeter && (terbaik === null || jarak < terbaik.jarak)) {
        terbaik = { zona, dp, jarak };
      }
    }
  }
  if (!terbaik) return { status: "DI_LUAR_ZONA" };
  return {
    status: "DALAM_ZONA",
    zonaKode: terbaik.zona.kode,
    namaKelurahan: terbaik.zona.namaKelurahan,
    dropPointKode: terbaik.dp.kode,
    dropPointNama: terbaik.dp.nama,
    jarakMeter: Math.round(terbaik.jarak / 10) * 10,
  };
}
