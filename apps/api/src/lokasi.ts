import { readFile } from "node:fs/promises";
import { RADIUS_MAKS_METER, RADIUS_MIN_METER, type ZonaLayanan } from "@nekat/domain";
import { z } from "zod";

// config/lokasi.json (M7): satu-satunya sumber koordinat & radius. Format: config/lokasi.example.json.

const kode = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kode: huruf kecil, angka, tanda minus");
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

const skemaKonfigLokasi = z
  .object({
    versi: z.literal(1),
    gudang: z
      .array(
        z.object({ kode, nama: z.string().min(1), jenis: z.enum(["PUSAT", "CABANG"]), lat, lng }),
      )
      .min(1),
    zona: z
      .array(
        z.object({
          kode,
          namaKelurahan: z.string().min(1),
          gudang: kode,
          dropPoint: z
            .array(
              z.object({
                kode,
                nama: z.string().min(1),
                alamatPublik: z.string().optional(),
                jamAmbil: z.string().optional(),
                lat,
                lng,
                radiusMeter: z.number().int().min(RADIUS_MIN_METER).max(RADIUS_MAKS_METER),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .superRefine((k, ctx) => {
    const gudang = new Set(k.gudang.map((g) => g.kode));
    const semuaKode = [
      ...k.gudang.map((g) => g.kode),
      ...k.zona.map((z) => z.kode),
      ...k.zona.flatMap((z) => z.dropPoint.map((d) => d.kode)),
    ];
    const ganda = semuaKode.filter((x, i) => semuaKode.indexOf(x) !== i);
    if (ganda.length > 0)
      ctx.addIssue({ code: "custom", message: `kode ganda: ${[...new Set(ganda)].join(", ")}` });
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
