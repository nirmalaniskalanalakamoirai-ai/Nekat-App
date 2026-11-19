// Data uji engine harga. SEMUA ANGKA DI SINI CONTOH FIKTIF — bukan modal, margin, harga,
// atau tarif PPN NEKAT yang nyata (keputusan #6: agen tidak mengisi angka harga).
import { KONFIGURASI_HARGA_BAWAAN } from "./hitung.js";
import type {
  InputProdukHarga,
  InputSatuanJual,
  IsiSel,
  KonfigurasiHarga,
  LevelHarga,
} from "./tipe.js";

/** Modal fiktif (contoh fiktif). */
export const MODAL_FIKTIF = 10_000;

/** Faktor PPN fiktif 111/100 (contoh fiktif, bukan tarif yang dikonfigurasi). */
export const PHI_FIKTIF = { pembilang: 111, penyebut: 100 } as const;

export const persen = (markupBp: number): IsiSel => ({ mode: "PERSEN", markupBp });
export const rupiah = (hargaRp: number): IsiSel => ({ mode: "RUPIAH", hargaRp });

export function satuanUji(
  ubah: Partial<Omit<InputSatuanJual, "sel">> & {
    sel?: Partial<Record<LevelHarga, IsiSel | null>>;
  } = {},
): InputSatuanJual {
  return {
    idSatuanJual: "sj-fiktif-1",
    kode: "PCS_1",
    isi: 1,
    moqGrosir: null,
    bolehGrup: true,
    modal: MODAL_FIKTIF,
    waktuDataModal: new Date("2026-11-19T00:00:00Z"),
    sel: { SATUAN: rupiah(12_000), MITRA_GROSIR: rupiah(11_000) },
    ...ubah,
  };
}

export function produkUji(
  satuan: readonly InputSatuanJual[] = [satuanUji()],
  ubah: Partial<Omit<InputProdukHarga, "satuan">> = {},
): InputProdukHarga {
  return {
    idProduk: "produk-fiktif-1",
    kodeKategori: "sembako",
    tinjauanKategori: "TIDAK_PERLU",
    bebasPpn: true,
    satuan,
    ...ubah,
  };
}

export const K: KonfigurasiHarga = KONFIGURASI_HARGA_BAWAAN;
export const kDengan = (ubah: Partial<KonfigurasiHarga>): KonfigurasiHarga => ({ ...K, ...ubah });
