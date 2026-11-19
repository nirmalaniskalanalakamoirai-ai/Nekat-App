// Tipe katalog pembeli (T-025). Port `RepoKatalog` diimplementasi @nekat/db; domain hanya bentuknya.
import type { NamaSumberInventory, Rupiah } from "@nekat/shared";
import type { KodeSatuan, KonfigurasiHarga } from "../harga/tipe.js";

// ---- Baris mentah dari tabel katalog T-013a (hanya baca) ----

export interface BarisKategoriKatalog {
  readonly id: string;
  /** null = kategori akar; terisi = subkategori. */
  readonly indukId: string | null;
  readonly kode: string;
  readonly nama: string;
  readonly urutan: number;
  readonly aktif: boolean;
}

export interface BarisProdukKatalog {
  readonly id: string;
  readonly kategoriId: string;
  readonly nama: string;
  readonly deskripsi: string | null;
  readonly gambarUrl: string | null;
  readonly bebasPpn: boolean;
  /** Mentah dari DB; nilai di luar `TinjauanKategori` diperlakukan sebagai belum ditinjau. */
  readonly tinjauanKategori: string;
  readonly aktif: boolean;
}

export interface BarisSkuKatalog {
  readonly id: string;
  readonly produkId: string;
  readonly kodeSku: string;
  readonly namaVarian: string | null;
  readonly satuanDasar: string;
  readonly aktifDiSumber: boolean;
}

export interface BarisSatuanJualKatalog {
  readonly id: string;
  readonly skuId: string;
  readonly jenis: string;
  readonly isiSatuanDasar: number;
  readonly moqMitraGrosir: number | null;
  readonly bolehGrup: boolean;
}

export interface BarisHargaLevelKatalog {
  readonly satuanJualId: string;
  readonly level: string;
  readonly mode: string;
  /** `numeric(9,4)` sebagai teks desimal, mis. "12.5000" (M2). */
  readonly marginPersen: string | null;
  readonly hargaJualRp: number | null;
}

/** Timpaan modal aktif (P-25, K-03: berlaku sampai dicabut). */
export interface BarisTimpaanModalKatalog {
  readonly satuanJualId: string;
  readonly modalRp: number;
}

export interface DataKatalog {
  readonly kategori: readonly BarisKategoriKatalog[];
  readonly produk: readonly BarisProdukKatalog[];
  readonly sku: readonly BarisSkuKatalog[];
  readonly satuanJual: readonly BarisSatuanJualKatalog[];
  readonly hargaLevel: readonly BarisHargaLevelKatalog[];
  readonly timpaanModal: readonly BarisTimpaanModalKatalog[];
}

/** Bacaan tabel katalog NEKAT. Hanya SELECT. */
export interface RepoKatalog {
  muatData(): Promise<DataKatalog>;
  /** `gudang.id` untuk `kode_konfig` (config/lokasi.json); null bila tidak ada / nonaktif. */
  idGudang(kodeKonfig: string): Promise<string | null>;
}

// ---- Masukan stok & modal (dari InventorySource) ----

export interface StokKatalog {
  /** Satuan dasar, sebelum dikurangi reservasi. */
  readonly tersedia: number;
  readonly dataPada: Date;
}

export interface ModalKatalog {
  readonly modal: number | null;
  readonly dataPada: Date;
}

export interface MasukanKatalog {
  readonly data: DataKatalog;
  /** Per `skuId`. SKU tanpa baris = stok 0 (T-009 §3). */
  readonly stok: ReadonlyMap<string, StokKatalog>;
  /** Per `kunciModal(skuId, jenis)`. Tidak ada = modal kosong → tidak tayang. */
  readonly modal: ReadonlyMap<string, ModalKatalog>;
  /**
   * Σ reservasi AKTIF per `skuId` (satuan dasar). Tabel reservasi dibuat di T-013b; sampai itu
   * pemanggil memberi peta kosong (stok bebas = stok snapshot).
   */
  readonly reservasi: ReadonlyMap<string, number>;
  readonly sumber: NamaSumberInventory;
  /** P-10. */
  readonly maksUmurDataMenit: number;
  readonly konfigurasiHarga: KonfigurasiHarga;
  readonly sekarang: Date;
}

// ---- Hasil katalog untuk pembeli. TIDAK memuat modal, margin, isian sel, alasan admin. ----

/**
 * Harga tampil satu satuan jual (PG-6): SATU-SATUNYA bentuk harga yang dikirim ke kartu & detail.
 * Promo tidak pernah digabung di sini (field `promo` terpisah, T-032).
 */
export interface TampilanHargaKatalog {
  /** Harga Satuan (termasuk PPN), tanpa grup. */
  readonly hargaSatuan: Rupiah;
  /** K-38: "Harga Belanja Bareng" (= Harga Mitra Grosir, K-14). null bila tidak berlaku (K-27, P-21). */
  readonly hargaBelanjaBareng: Rupiah | null;
}

export interface StatusStokTampil {
  /** false = tombol beli nonaktif, tidak bisa masuk keranjang/grup (K-20). */
  readonly tersedia: boolean;
  /** `LABEL_STOK_HABIS` bila tidak tersedia; null bila tersedia. */
  readonly label: string | null;
}

export interface SatuanTampil {
  readonly id: string;
  readonly skuId: string;
  readonly kode: KodeSatuan;
  readonly label: string;
  readonly isi: number;
  readonly harga: TampilanHargaKatalog;
  readonly stok: StatusStokTampil;
}

export interface VarianTampil {
  readonly skuId: string;
  readonly nama: string | null;
  readonly satuanDasar: string;
  readonly satuan: readonly SatuanTampil[];
}

export interface RingkasKategori {
  readonly kode: string;
  readonly nama: string;
}

export interface ProdukTampil {
  readonly id: string;
  readonly nama: string;
  readonly deskripsi: string | null;
  readonly gambarUrl: string | null;
  readonly kategori: RingkasKategori;
  /** null bila produk menempel langsung di kategori akar. */
  readonly subkategori: RingkasKategori | null;
  readonly varian: readonly VarianTampil[];
  /** Satuan yang tampil di kartu; objek yang SAMA dengan entri di `varian` (PG-6). */
  readonly utama: SatuanTampil;
  readonly stok: StatusStokTampil;
  /** Teks ternormalisasi untuk pencarian (internal, tidak dikirim). */
  readonly kunciCari: string;
  /** Urutan tampil bawaan (internal). */
  readonly urutan: number;
}

export interface KategoriTampil {
  readonly kode: string;
  readonly nama: string;
  /** Produk tayang (termasuk yang stok habis, K-20) di kategori ini + semua subkategorinya. */
  readonly jumlahProduk: number;
  readonly subkategori: readonly { kode: string; nama: string; jumlahProduk: number }[];
}

/** Satuan jual yang ditahan (tidak tayang): untuk log admin (K-42: laporkan). Tanpa nominal. */
export interface SatuanDitahan {
  readonly idSatuanJual: string;
  readonly idProduk: string;
  readonly kode: readonly string[];
}

export interface SnapshotKatalog {
  readonly kategori: readonly KategoriTampil[];
  /** Urut tampil bawaan. */
  readonly produk: readonly ProdukTampil[];
  readonly produkPerId: ReadonlyMap<string, ProdukTampil>;
  readonly ditahan: readonly SatuanDitahan[];
}
