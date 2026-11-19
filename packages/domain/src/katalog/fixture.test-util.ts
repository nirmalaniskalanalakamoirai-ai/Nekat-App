// Data uji katalog. SEMUA ANGKA DI SINI CONTOH FIKTIF — bukan modal, margin, atau harga NEKAT
// (keputusan #6: agen tidak mengisi angka harga). Tidak ada produk rokok/bir nyata.
import { KONFIGURASI_HARGA_BAWAAN } from "../harga/hitung.js";
import type { KonfigurasiHarga } from "../harga/tipe.js";
import { kunciModal } from "./susun.js";
import type {
  BarisHargaLevelKatalog,
  BarisKategoriKatalog,
  BarisProdukKatalog,
  BarisSatuanJualKatalog,
  BarisSkuKatalog,
  DataKatalog,
  MasukanKatalog,
  ModalKatalog,
  StokKatalog,
} from "./tipe.js";

export const SEKARANG = new Date("2026-11-19T05:00:00Z");
const WAKTU = new Date("2026-11-19T04:00:00Z");

/** UUID uji deterministik dari angka. */
export const uid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

export interface ProdukUji {
  readonly id: string;
  readonly nama: string;
  readonly kategoriId: string;
  readonly bebasPpn?: boolean;
  readonly aktif?: boolean;
  readonly tinjauanKategori?: string;
  readonly sku: readonly SkuUji[];
}

export interface SkuUji {
  readonly id: string;
  readonly kodeSku: string;
  readonly namaVarian?: string | null;
  readonly aktifDiSumber?: boolean;
  /** Stok satuan dasar; undefined = tidak ada baris stok. */
  readonly stok?: number;
  readonly satuan: readonly SatuanUji[];
}

export interface SatuanUji {
  readonly id: string;
  readonly jenis: string;
  readonly isi: number;
  readonly modal: number | null;
  readonly satuanRp?: number | null;
  readonly mitraRp?: number | null;
  readonly satuanPersen?: string;
  readonly bolehGrup?: boolean;
  readonly moq?: number | null;
  readonly timpaan?: number;
}

export const KATEGORI_UJI: readonly BarisKategoriKatalog[] = [
  { id: uid(1), indukId: null, kode: "sembako", nama: "Sembako", urutan: 1, aktif: true },
  { id: uid(2), indukId: uid(1), kode: "beras", nama: "Beras", urutan: 1, aktif: true },
  {
    id: uid(3),
    indukId: uid(1),
    kode: "minyak-goreng",
    nama: "Minyak Goreng",
    urutan: 2,
    aktif: true,
  },
  { id: uid(4), indukId: null, kode: "minuman", nama: "Minuman", urutan: 2, aktif: true },
  { id: uid(5), indukId: uid(4), kode: "teh-kopi", nama: "Teh & Kopi", urutan: 1, aktif: true },
  { id: uid(6), indukId: uid(4), kode: "susu", nama: "Susu", urutan: 2, aktif: true },
  // Kategori uji terlarang (keputusan #7): harus tersaring walau ada produk.
  {
    id: uid(7),
    indukId: uid(4),
    kode: "minuman-bir",
    nama: "Uji terlarang",
    urutan: 3,
    aktif: true,
  },
  { id: uid(8), indukId: null, kode: "nonaktif", nama: "Nonaktif", urutan: 3, aktif: false },
  { id: uid(9), indukId: uid(8), kode: "sub-nonaktif", nama: "Sub", urutan: 1, aktif: true },
];

export function dataDari(produk: readonly ProdukUji[]): {
  data: DataKatalog;
  stok: Map<string, StokKatalog>;
  modal: Map<string, ModalKatalog>;
} {
  const p: BarisProdukKatalog[] = [];
  const s: BarisSkuKatalog[] = [];
  const sj: BarisSatuanJualKatalog[] = [];
  const h: BarisHargaLevelKatalog[] = [];
  const t: { satuanJualId: string; modalRp: number }[] = [];
  const stok = new Map<string, StokKatalog>();
  const modal = new Map<string, ModalKatalog>();
  for (const x of produk) {
    p.push({
      id: x.id,
      kategoriId: x.kategoriId,
      nama: x.nama,
      deskripsi: null,
      gambarUrl: null,
      bebasPpn: x.bebasPpn ?? true,
      tinjauanKategori: x.tinjauanKategori ?? "TIDAK_PERLU",
      aktif: x.aktif ?? true,
    });
    for (const k of x.sku) {
      s.push({
        id: k.id,
        produkId: x.id,
        kodeSku: k.kodeSku,
        namaVarian: k.namaVarian ?? null,
        satuanDasar: "pcs",
        aktifDiSumber: k.aktifDiSumber ?? true,
      });
      if (k.stok !== undefined) stok.set(k.id, { tersedia: k.stok, dataPada: WAKTU });
      for (const u of k.satuan) {
        sj.push({
          id: u.id,
          skuId: k.id,
          jenis: u.jenis,
          isiSatuanDasar: u.isi,
          moqMitraGrosir: u.moq ?? null,
          bolehGrup: u.bolehGrup ?? true,
        });
        modal.set(kunciModal(k.id, u.jenis), { modal: u.modal, dataPada: WAKTU });
        if (u.satuanPersen !== undefined) {
          h.push({
            satuanJualId: u.id,
            level: "SATUAN",
            mode: "PERSEN",
            marginPersen: u.satuanPersen,
            hargaJualRp: null,
          });
        } else if (u.satuanRp != null) {
          h.push({
            satuanJualId: u.id,
            level: "SATUAN",
            mode: "RUPIAH",
            marginPersen: null,
            hargaJualRp: u.satuanRp,
          });
        }
        if (u.mitraRp != null) {
          h.push({
            satuanJualId: u.id,
            level: "MITRA_GROSIR",
            mode: "RUPIAH",
            marginPersen: null,
            hargaJualRp: u.mitraRp,
          });
        }
        if (u.timpaan !== undefined) t.push({ satuanJualId: u.id, modalRp: u.timpaan });
      }
    }
  }
  return {
    data: {
      kategori: KATEGORI_UJI,
      produk: p,
      sku: s,
      satuanJual: sj,
      hargaLevel: h,
      timpaanModal: t,
    },
    stok,
    modal,
  };
}

export function masukan(
  produk: readonly ProdukUji[],
  konfigurasiHarga: KonfigurasiHarga = KONFIGURASI_HARGA_BAWAAN,
): MasukanKatalog {
  const { data, stok, modal } = dataDari(produk);
  return {
    data,
    stok,
    modal,
    reservasi: new Map(),
    sumber: "local",
    maksUmurDataMenit: 15,
    konfigurasiHarga,
    sekarang: SEKARANG,
  };
}

/** Satu produk sederhana tayang & berstok (angka fiktif). */
export function produkSederhana(n: number, ubah: Partial<ProdukUji> = {}): ProdukUji {
  return {
    id: uid(1000 + n),
    nama: `Produk Uji ${n}`,
    kategoriId: uid(2),
    sku: [
      {
        id: uid(2000 + n),
        kodeSku: `UJI-${n}`,
        stok: 10,
        satuan: [
          {
            id: uid(3000 + n),
            jenis: "PCS_1",
            isi: 1,
            modal: 1_000,
            satuanRp: 1_200,
            mitraRp: 1_100,
          },
        ],
      },
    ],
    ...ubah,
  };
}

function skuPertama(p: ProdukUji): SkuUji {
  const s = p.sku[0];
  if (!s) throw new Error("produk uji tanpa SKU");
  return s;
}

/** Salinan produk dengan SKU pertama diubah. */
export function ubahSku(p: ProdukUji, ubah: Partial<SkuUji>): ProdukUji {
  return { ...p, sku: [{ ...skuPertama(p), ...ubah }, ...p.sku.slice(1)] };
}

/** Salinan produk dengan satuan jual pertama SKU pertama diubah. */
export function ubahSatuan(p: ProdukUji, ubah: Partial<SatuanUji>): ProdukUji {
  const s = skuPertama(p);
  const sj = s.satuan[0];
  if (!sj) throw new Error("SKU uji tanpa satuan jual");
  return ubahSku(p, { satuan: [{ ...sj, ...ubah }, ...s.satuan.slice(1)] });
}

/** Salinan produk tanpa baris stok untuk SKU pertama. */
export function tanpaStok(p: ProdukUji): ProdukUji {
  const s = skuPertama(p);
  const sisa: SkuUji = { id: s.id, kodeSku: s.kodeSku, satuan: s.satuan };
  return { ...p, sku: [sisa, ...p.sku.slice(1)] };
}
