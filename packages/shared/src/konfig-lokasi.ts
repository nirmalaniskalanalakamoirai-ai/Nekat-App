// Skema config/lokasi.json (T-015, T-015b). Satu-satunya sumber koordinat & radius (M7, keputusan §5).
// Dipakai API (cek zona) dan @nekat/db (sinkron config → tabel gudang/zona/drop_point).
// Format: config/lokasi.example.json. Hanya validasi bentuk & kewajaran; tanpa I/O.
import { z } from "zod";

/** Keputusan §5: radius 2–3 km dari drop point. */
export const RADIUS_MIN_METER = 2000;
export const RADIUS_MAKS_METER = 3000;

/**
 * Kotak batas kasar wilayah Indonesia (pagar salah ketik, mis. lat/lng tertukar atau tanda minus
 * hilang). Bukan batas layanan; batas layanan = radius drop point.
 */
export const BATAS_KOORDINAT_INDONESIA = {
  latMin: -11.5,
  latMaks: 6.5,
  lngMin: 94.5,
  lngMaks: 141.5,
} as const;

const B = BATAS_KOORDINAT_INDONESIA;
const kode = z
  .string()
  .max(64, "kode maks. 64 karakter")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kode: huruf kecil, angka, tanda minus");
// z.number() menolak NaN & Infinity.
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const teks = z.string().trim().min(1).max(120);
// Teks bebas untuk pembeli. Format jam ambil belum baku (contoh hanya "08.00–20.00"; bisa juga
// "Senin–Sabtu 08.00–17.00"), jadi hanya dibatasi panjang, tanpa regex.
const teksOpsional = (maks: number) => z.string().trim().min(1).max(maks).optional();

function diIndonesia(k: { lat: number; lng: number }): boolean {
  return k.lat >= B.latMin && k.lat <= B.latMaks && k.lng >= B.lngMin && k.lng <= B.lngMaks;
}

const pesanLuarIndonesia = `koordinat di luar wilayah Indonesia (lat ${B.latMin}..${B.latMaks}, lng ${B.lngMin}..${B.lngMaks}); lat/lng tertukar?`;

export const skemaKonfigLokasi = z
  .object({
    versi: z.literal(1),
    /** true = koordinat fiktif/uji (contoh, staging). Sinkron ke DB menolaknya kecuali diizinkan. */
    uji: z.boolean().optional(),
    gudang: z
      .array(
        z
          .object({ kode, nama: teks, jenis: z.enum(["PUSAT", "CABANG"]), lat, lng })
          .refine(diIndonesia, { message: pesanLuarIndonesia }),
      )
      .min(1),
    zona: z
      .array(
        z.object({
          kode,
          namaKelurahan: teks,
          gudang: kode,
          dropPoint: z
            .array(
              z
                .object({
                  kode,
                  nama: teks,
                  alamatPublik: teksOpsional(200),
                  jamAmbil: teksOpsional(60),
                  lat,
                  lng,
                  radiusMeter: z.number().int().min(RADIUS_MIN_METER).max(RADIUS_MAKS_METER),
                })
                .refine(diIndonesia, { message: pesanLuarIndonesia }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .superRefine((k, ctx) => {
    const gudang = new Set(k.gudang.map((g) => g.kode));
    // Kode unik lintas gudang/zona/drop point: satu kode = satu entri, log & pesan tidak ambigu.
    const semuaKode = [
      ...k.gudang.map((g) => g.kode),
      ...k.zona.map((z) => z.kode),
      ...k.zona.flatMap((z) => z.dropPoint.map((d) => d.kode)),
    ];
    const ganda = semuaKode.filter((x, i) => semuaKode.indexOf(x) !== i);
    if (ganda.length > 0)
      ctx.addIssue({ code: "custom", message: `kode ganda: ${[...new Set(ganda)].join(", ")}` });
    // Katalog tanpa zona memakai gudang PUSAT (T-025): harus tepat satu.
    const jumlahPusat = k.gudang.filter((g) => g.jenis === "PUSAT").length;
    if (jumlahPusat !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["gudang"],
        message: `harus tepat satu gudang PUSAT (ada ${jumlahPusat})`,
      });
    for (const zona of k.zona) {
      if (!gudang.has(zona.gudang)) {
        ctx.addIssue({
          code: "custom",
          message: `zona ${zona.kode}: gudang ${zona.gudang} tidak ada`,
        });
      }
    }
  });

export type KonfigLokasi = z.infer<typeof skemaKonfigLokasi>;

/** Validasi isi config (sudah di-parse dari JSON). Error berisi semua masalah sekaligus. */
export function bacaKonfigLokasi(data: unknown): KonfigLokasi {
  const hasil = skemaKonfigLokasi.safeParse(data);
  if (!hasil.success) {
    const pesan = hasil.error.issues
      .map((i) => `${i.path.join(".") || "(akar)"}: ${i.message}`)
      .join("; ");
    throw new Error(`config/lokasi.json tidak valid — ${pesan}`);
  }
  return hasil.data;
}
