// Format tampilan harga & satuan (T-008 §0 R9, §1.3). TIDAK menghitung harga: hanya mengubah angka
// integer dari server menjadi teks. Tanpa pembulatan, tanpa singkatan ("rb", "jt"), tanpa spasi.
import { isRupiah } from "@nekat/shared";

const FORMAT_ID = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/**
 * "Rp12.345". `null` bila nilai bukan rupiah valid (bukan integer aman ≥ 0): pemanggil tidak boleh
 * menampilkan harga sama sekali (lebih baik kosong daripada angka keliru).
 */
export function formatRupiah(nilai: unknown): string | null {
  if (!isRupiah(nilai)) return null;
  return `Rp${FORMAT_ID.format(nilai)}`;
}

/** Kode satuan jual P-03, urutan tetap kecil → besar (T-008 R7). */
export const KODE_SATUAN = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"] as const;
export type KodeSatuan = (typeof KODE_SATUAN)[number];

export function isKodeSatuan(x: unknown): x is KodeSatuan {
  return typeof x === "string" && (KODE_SATUAN as readonly string[]).includes(x);
}

export interface Satuan {
  readonly kode: KodeSatuan;
  readonly isi: number;
}

/** Label satuan (T-008 §1.3): "1 pcs", "3 pcs", "lusin (isi 12)", "dus (isi 24)", "koli (isi 6)". */
export function labelSatuan(s: Satuan): string {
  switch (s.kode) {
    case "PCS_1":
      return "1 pcs";
    case "PCS_3":
      return "3 pcs";
    case "LUSIN":
      return `lusin (isi ${s.isi})`;
    case "DUS":
      return `dus (isi ${s.isi})`;
    case "KOLI":
      return `koli (isi ${s.isi})`;
  }
}

/** Satuan pendek untuk "/pcs", "Tambah 1 pcs …" (T-008 §1.3). */
export function satuanPendek(kode: KodeSatuan): string {
  switch (kode) {
    case "PCS_1":
      return "pcs";
    case "PCS_3":
      return "3 pcs";
    case "LUSIN":
      return "lusin";
    case "DUS":
      return "dus";
    case "KOLI":
      return "koli";
  }
}

export interface HargaKatalog {
  /** Harga Satuan (termasuk PPN) dari server. */
  readonly hargaSatuan: number;
  /** K-38 "Harga Belanja Bareng"; null = tidak berlaku untuk satuan ini (K-27). */
  readonly hargaBelanjaBareng: number | null;
}

export interface TeksHarga {
  /** "Rp12.345" */
  readonly aktif: string;
  /** "/pcs" */
  readonly perSatuan: string;
  /** "Harga Belanja Bareng Rp11.111" atau null bila tidak berlaku / tidak valid. */
  readonly chipGrup: string | null;
  /** Satu kalimat utuh untuk pembaca layar (T-008 §1.9): dibaca tepat sekali. */
  readonly kalimat: string;
}

/**
 * Teks blok `Harga` untuk konteks KATALOG (tanpa grup): harga aktif = Harga Satuan, tanpa harga coret
 * (P-17/R3: coret hanya bila server memberi harga lebih murah yang berlaku; katalog tanpa grup → tidak
 * ada). `null` bila harga satuan tidak valid → kartu tidak dirender (R5).
 */
export function teksHargaKatalog(harga: HargaKatalog, kode: KodeSatuan): TeksHarga | null {
  const aktif = formatRupiah(harga.hargaSatuan);
  if (aktif === null) return null;
  const pendek = satuanPendek(kode);
  const nominalGrup =
    harga.hargaBelanjaBareng === null ? null : formatRupiah(harga.hargaBelanjaBareng);
  const chipGrup = nominalGrup === null ? null : `Harga Belanja Bareng ${nominalGrup}`;
  const kalimat = `${aktif} per ${pendek}${chipGrup === null ? "" : `, ${chipGrup}`}.`;
  return { aktif, perSatuan: `/${pendek}`, chipGrup, kalimat };
}
