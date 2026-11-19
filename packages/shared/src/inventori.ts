// Tipe data & skema Zod kontrak `InventorySource` (T-009 §2, §4). Dipakai domain, adapters, db, app.
// Adapter tidak membulatkan nilai apa pun (H6). Waktu = ISO-8601 dengan offset eksplisit.
import { z } from "zod";
import { rupiahSchema } from "./rupiah.js";

/** T-009 §3: maksimal SKU per panggilan `getStok`/`getHargaModal`; pemanggil memecah batch. */
export const BATAS_SKU_PER_PANGGILAN = 200;

/** Teks label produk stok habis (K-20). Produk tetap tampil, tombol beli nonaktif. */
export const LABEL_STOK_HABIS = "Stok habis, segera distok";

export const NAMA_SUMBER_INVENTORY = ["local", "gudang"] as const;
export type NamaSumberInventory = (typeof NAMA_SUMBER_INVENTORY)[number];

/**
 * Satuan dasar mengikuti skema DB (T-004 §3.5): `pcs`, `gram`, `ml`. Sumber yang memakai kg/liter
 * dikonversi ke gram/ml saat sinkron agar stok & isi tetap integer.
 */
export const SATUAN_DASAR_INVENTORY = ["pcs", "gram", "ml"] as const;
/** Kode kanonik satuan jual P-03. `PCS_1` = satuan dasar. */
export const SATUAN_JUAL_INVENTORY = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"] as const;
export const SATUAN_KONVERSI_INVENTORY = ["PCS_3", "LUSIN", "DUS", "KOLI"] as const;

const waktu = z.iso.datetime({ offset: true });
const bulatNonNeg = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const bulatPositif = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const idTeks = z.string().min(1).max(100);

export const skuSumberSchema = z.strictObject({
  skuId: idTeks,
  skuSumberId: idTeks.nullable(),
  nama: z.string().min(1).max(200),
  kategori: z.string().min(1).max(100),
  satuanDasar: z.enum(SATUAN_DASAR_INVENTORY),
  konversiSatuan: z
    .array(
      z.strictObject({
        satuan: z.enum(SATUAN_KONVERSI_INVENTORY),
        isi: bulatPositif,
        /** Berat satu satuan ini (gram) bila sumber memberinya; null = hitung isi × beratGram. */
        beratGram: bulatNonNeg.nullable(),
      }),
    )
    .refine((d) => new Set(d.map((k) => k.satuan)).size === d.length, {
      message: "satuan konversi ganda",
    }),
  /** Berat 1 satuan dasar (gram). null = sumber tidak memberi (mis. SKU lokal tanpa satuan PCS_1). */
  beratGram: bulatNonNeg.nullable(),
  barcode: z.string().min(1).max(64).nullable(),
  aktifDiSumber: z.boolean(),
  diubahPada: waktu,
});
export type SkuSumber = z.infer<typeof skuSumberSchema>;

export const stokSumberSchema = z.strictObject({
  skuId: idTeks,
  lokasiId: idTeks,
  /** Dalam satuan dasar. */
  tersedia: bulatNonNeg,
  dataPada: waktu,
});
export type StokSumber = z.infer<typeof stokSumberSchema>;

export const modalSumberSchema = z.strictObject({
  skuId: idTeks,
  satuan: z.enum(SATUAN_JUAL_INVENTORY),
  /** K-01: modal per satuan jual. null = tidak tayang (bukan harga nol). */
  modalPerSatuan: rupiahSchema.refine((n) => n > 0, { message: "modal harus > 0" }).nullable(),
  dataPada: waktu,
});
export type ModalSumber = z.infer<typeof modalSumberSchema>;

export const konfirmasiStokSchema = z.strictObject({
  grupId: idTeks,
  skuId: idTeks,
  lokasiId: idTeks,
  qtyDibutuhkan: bulatPositif,
  kunciIdempotensi: z.string().regex(/^konfirmasi:[^:\s]{1,100}:v[1-9]\d{0,8}$/),
});
export type KonfirmasiStok = z.infer<typeof konfirmasiStokSchema>;

export const stokTerkonfirmasiSchema = z.strictObject({
  grupId: idTeks,
  skuId: idTeks,
  qtyTersedia: bulatNonNeg,
  dataPada: waktu,
});
export type StokTerkonfirmasi = z.infer<typeof stokTerkonfirmasiSchema>;

const tanggal = z.iso.date();
const jam = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Permintaan picking per grup. Objek ketat: field tambahan (nama, nomor HP, alamat, `pesananId`)
 * DITOLAK (T-009 §2, tes kontrak 8 & 13).
 */
export const permintaanPickingSchema = z.strictObject({
  grupId: idTeks,
  lokasiId: idTeks,
  kunciIdempotensi: z.string().regex(/^picking:[^:\s]{1,100}:v[1-9]\d{0,8}$/),
  slotKirim: z.strictObject({ tanggal, mulai: jam, selesai: jam }),
  baris: z
    .array(
      z.strictObject({
        anggotaId: idTeks,
        skuId: idTeks,
        qty: bulatPositif,
        caraKirim: z.enum(["ANTAR_RUMAH", "DROP_POINT"]),
        dropPointId: idTeks.nullable(),
      }),
    )
    .min(1),
});
export type PermintaanPicking = z.infer<typeof permintaanPickingSchema>;

export const hasilPickingSchema = z.strictObject({
  grupId: idTeks,
  status: z.enum(["DITERIMA", "DUPLIKAT"]),
  referensiSumber: z.string().max(100).nullable(),
});
export type HasilPicking = z.infer<typeof hasilPickingSchema>;

// ---- Error (T-009 §4) ----

export const KODE_INVENTORY_ERROR = [
  "SUMBER_TIDAK_TERJANGKAU",
  "DIBATASI",
  "DITOLAK",
  "DATA_TIDAK_VALID",
  "KONFLIK_IDEMPOTENSI",
] as const;
export type KodeInventoryError = (typeof KODE_INVENTORY_ERROR)[number];

const BOLEH_RETRY: Readonly<Record<KodeInventoryError, boolean>> = {
  SUMBER_TIDAK_TERJANGKAU: true,
  DIBATASI: true,
  DITOLAK: false,
  DATA_TIDAK_VALID: false,
  KONFLIK_IDEMPOTENSI: false,
};

export class InventoryError extends Error {
  readonly kode: KodeInventoryError;
  readonly bolehRetry: boolean;
  /** Hanya untuk `DIBATASI` (Retry-After, maks. 60 dtk). */
  readonly retrySetelahDetik: number | null;

  /** `pesan` tidak boleh memuat token, URL berkredensial, atau data pribadi. */
  constructor(
    kode: KodeInventoryError,
    pesan: string,
    opsi: { retrySetelahDetik?: number; cause?: unknown } = {},
  ) {
    super(pesan, opsi.cause === undefined ? undefined : { cause: opsi.cause });
    this.name = "InventoryError";
    this.kode = kode;
    this.bolehRetry = BOLEH_RETRY[kode];
    const r = opsi.retrySetelahDetik;
    this.retrySetelahDetik =
      kode === "DIBATASI" && r !== undefined && Number.isFinite(r)
        ? Math.min(60, Math.max(0, r))
        : null;
  }
}
