// Keranjang SEMENTARA di HP (T-026). Keranjang server & grup belum ada (T-022): sampai itu, isi
// keranjang hanya disimpan lokal, per zona. Fungsi murni (tanpa React / localStorage) agar mudah diuji.
//
// Sengaja TIDAK menyimpan harga: harga selalu diambil ulang dari server saat ditampilkan (ADR-0001,
// T-008 R13), sehingga harga lama di HP tidak pernah tampil sebagai harga aktif.
import { isKodeSatuan, type KodeSatuan } from "../harga/format";

/** Batas jumlah per baris di keranjang sementara (sanity klien; stok final dicek server). */
export const QTY_MAKS = 99;
/**
 * Batas baris keranjang sementara. Halaman keranjang memuat harga terbaru dengan 1 GET per produk
 * (belum ada endpoint batch / keranjang server, T-022), jadi jumlah baris dibatasi.
 */
export const BARIS_MAKS = 50;
export const NAMA_MAKS = 200;
export const VERSI_KERANJANG = 1;

export interface ItemKeranjang {
  readonly idSatuanJual: string;
  readonly idProduk: string;
  /** Nama saat ditambahkan, hanya untuk tampilan cadangan bila server tidak terjangkau. */
  readonly nama: string;
  readonly kodeSatuan: KodeSatuan;
  readonly isi: number;
  readonly qty: number;
}

export interface Keranjang {
  readonly versi: typeof VERSI_KERANJANG;
  readonly item: readonly ItemKeranjang[];
}

export const KERANJANG_KOSONG: Keranjang = { versi: VERSI_KERANJANG, item: [] };

export interface CalonItem {
  readonly idSatuanJual: string;
  readonly idProduk: string;
  readonly nama: string;
  readonly kodeSatuan: KodeSatuan;
  readonly isi: number;
  /** Dari server (K-20, IG-02). false → tidak bisa masuk keranjang. */
  readonly tersedia: boolean;
}

const batasi = (n: number) => Math.min(QTY_MAKS, Math.max(0, Math.trunc(n)));

export function qtyDi(k: Keranjang, idSatuanJual: string): number {
  return k.item.find((i) => i.idSatuanJual === idSatuanJual)?.qty ?? 0;
}

/** Jumlah baris (satuan jual berbeda) untuk lencana keranjang. */
export function jumlahBaris(k: Keranjang): number {
  return k.item.length;
}

/** Baris baru tidak bisa ditambahkan lagi (baris yang sudah ada tetap bisa ditambah jumlahnya). */
export function keranjangPenuh(k: Keranjang): boolean {
  return k.item.length >= BARIS_MAKS;
}

/**
 * Tambah 1 satuan. Stok habis / tidak diketahui → keranjang TIDAK berubah (K-20, IG-02 DEFAULT).
 * Baris baru ditaruh di akhir; satuan berbeda = baris terpisah (T-007 H-03). Keranjang penuh
 * (BARIS_MAKS) → baris baru ditolak (keranjang tidak berubah).
 */
export function tambah(k: Keranjang, c: CalonItem): Keranjang {
  if (!c.tersedia) return k;
  const ada = k.item.find((i) => i.idSatuanJual === c.idSatuanJual);
  if (ada) return ubahQty(k, c.idSatuanJual, ada.qty + 1, true);
  if (keranjangPenuh(k)) return k;
  const baru: ItemKeranjang = {
    idSatuanJual: c.idSatuanJual,
    idProduk: c.idProduk,
    nama: c.nama.slice(0, NAMA_MAKS),
    kodeSatuan: c.kodeSatuan,
    isi: c.isi,
    qty: 1,
  };
  return { ...k, item: [...k.item, baru] };
}

/**
 * Ubah jumlah. qty ≤ 0 → baris dihapus. `bolehNaik = false` (stok habis/tidak diketahui): jumlah
 * hanya boleh turun, agar pembeli tetap bisa mengurangi/menghapus (T-008 §1.5, TC-UI-06b).
 */
export function ubahQty(k: Keranjang, id: string, qty: number, bolehNaik: boolean): Keranjang {
  const lama = k.item.find((i) => i.idSatuanJual === id);
  if (!lama || !Number.isFinite(qty)) return k;
  let baru = batasi(qty);
  if (!bolehNaik && baru > lama.qty) baru = lama.qty;
  if (baru === lama.qty) return k;
  if (baru === 0) return hapus(k, id).keranjang;
  return { ...k, item: k.item.map((i) => (i.idSatuanJual === id ? { ...i, qty: baru } : i)) };
}

export interface HasilHapus {
  readonly keranjang: Keranjang;
  /** Untuk "Urungkan" (T-007 H-04). null bila baris tidak ada. */
  readonly terhapus: { readonly item: ItemKeranjang; readonly posisi: number } | null;
}

export function hapus(k: Keranjang, id: string): HasilHapus {
  const posisi = k.item.findIndex((i) => i.idSatuanJual === id);
  const item = k.item[posisi];
  if (!item) return { keranjang: k, terhapus: null };
  return {
    keranjang: { ...k, item: k.item.filter((_, i) => i !== posisi) },
    terhapus: { item, posisi },
  };
}

/** Urungkan hapus: kembalikan baris ke posisi semula (bila belum ditambahkan lagi). */
export function urungkan(k: Keranjang, t: NonNullable<HasilHapus["terhapus"]>): Keranjang {
  if (k.item.some((i) => i.idSatuanJual === t.item.idSatuanJual)) return k;
  const item = [...k.item];
  item.splice(Math.min(t.posisi, item.length), 0, t.item);
  return { ...k, item };
}

/** Baca isi tersimpan secara defensif: data rusak/versi lain → keranjang kosong; baris rusak dibuang. */
export function uraiKeranjang(mentah: string | null): Keranjang {
  if (!mentah) return KERANJANG_KOSONG;
  let data: unknown;
  try {
    data = JSON.parse(mentah);
  } catch {
    return KERANJANG_KOSONG;
  }
  if (typeof data !== "object" || data === null) return KERANJANG_KOSONG;
  const o = data as Record<string, unknown>;
  if (o["versi"] !== VERSI_KERANJANG || !Array.isArray(o["item"])) return KERANJANG_KOSONG;
  const terlihat = new Set<string>();
  const item: ItemKeranjang[] = [];
  for (const x of o["item"] as unknown[]) {
    if (item.length >= BARIS_MAKS) break;
    if (typeof x !== "object" || x === null) continue;
    const i = x as Record<string, unknown>;
    const { idSatuanJual, idProduk, nama, kodeSatuan, isi, qty } = i;
    if (
      typeof idSatuanJual !== "string" ||
      typeof idProduk !== "string" ||
      typeof nama !== "string" ||
      !isKodeSatuan(kodeSatuan) ||
      !Number.isSafeInteger(isi) ||
      (isi as number) < 1 ||
      !Number.isSafeInteger(qty) ||
      (qty as number) < 1 ||
      terlihat.has(idSatuanJual)
    )
      continue;
    terlihat.add(idSatuanJual);
    item.push({
      idSatuanJual,
      idProduk,
      nama: nama.slice(0, NAMA_MAKS),
      kodeSatuan,
      isi: isi as number,
      qty: batasi(qty as number),
    });
  }
  return { versi: VERSI_KERANJANG, item };
}

export function serialisasi(k: Keranjang): string {
  return JSON.stringify(k);
}
