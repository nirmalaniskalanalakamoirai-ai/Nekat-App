// Pesan admin (Bahasa Indonesia) untuk setiap kode masalah engine harga.
// Pesan sengaja tidak memuat nominal modal/harga: label level & satuan sudah cukup untuk
// menunjuk sel yang perlu diperbaiki, dan log/laporan tidak membocorkan angka harga.
import type { JenisMasalah, KodeMasalah, LevelHarga, Masalah } from "./tipe.js";

export const LABEL_LEVEL: Readonly<Record<LevelHarga, string>> = {
  SATUAN: "Harga Satuan",
  MITRA_GROSIR: "Harga Mitra Grosir",
  FRANCHISE: "Harga Franchise",
};

const LABEL_SATUAN: Readonly<Record<string, string>> = {
  PCS_1: "1 pcs",
  PCS_3: "3 pcs",
  LUSIN: "lusin",
  DUS: "dus",
  KOLI: "koli",
};

export function labelSatuan(kode: string): string {
  return LABEL_SATUAN[kode] ?? "satuan tidak dikenal";
}

interface DefinisiMasalah {
  readonly jenis: JenisMasalah;
  readonly perluDitinjau: boolean;
  readonly pesan: string;
}

const DEFINISI: Readonly<Record<KodeMasalah, DefinisiMasalah>> = {
  KONFIGURASI_TIDAK_VALID: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Konfigurasi harga tidak valid. Semua produk ditahan tidak tayang sampai diperbaiki.",
  },
  KATEGORI_DILARANG: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Kategori produk ini dilarang dijual di Fase 1 (rokok/bir dan sejenisnya).",
  },
  PERLU_TINJAUAN_KATEGORI: {
    jenis: "ERROR",
    perluDitinjau: true,
    pesan: "Nama produk mirip barang terlarang. Tinjau kategorinya sebelum produk bisa tayang.",
  },
  MODAL_KOSONG: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Modal belum diisi. Isi modal per satuan jual agar harga bisa dihitung.",
  },
  MODAL_TIDAK_VALID: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Modal harus lebih dari Rp0.",
  },
  MODAL_PECAHAN: {
    jenis: "ERROR",
    perluDitinjau: true,
    pesan:
      "Modal bukan rupiah bulat. Tidak dibulatkan otomatis; isi modal dalam rupiah bulat per satuan jual.",
  },
  MODAL_KEDALUWARSA: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Data modal terlalu lama. Sinkronkan ulang modal sebelum harga dipakai.",
  },
  SATUAN_TIDAK_VALID: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Satuan jual tidak valid.",
  },
  MOQ_TIDAK_VALID: {
    jenis: "PERINGATAN",
    perluDitinjau: false,
    pesan:
      "Minimal beli Mitra Grosir harus bilangan bulat ≥ 1. Untuk sementara harga grosir hanya lewat grup.",
  },
  SEL_KOSONG: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Harga belum diisi (persen atau rupiah).",
  },
  FORMAT_PERSEN: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Isian persen tidak valid (maksimal 2 desimal).",
  },
  FORMAT_HARGA: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Isian harga rupiah tidak valid.",
  },
  HARGA_PECAHAN: {
    jenis: "ERROR",
    perluDitinjau: true,
    pesan:
      "Persen margin menghasilkan harga bukan rupiah bulat. Tidak dibulatkan otomatis; isi harga rupiah atau ubah persen.",
  },
  MARGIN_NEGATIF: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Harga di bawah modal. Tidak boleh menjual di bawah modal.",
  },
  MARGIN_NOL: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Harga sama dengan modal. Margin 0 tidak diizinkan.",
  },
  HARGA_DI_BAWAH_MODAL: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Harga tanpa PPN tidak lebih dari modal. Naikkan harga.",
  },
  MARGIN_DI_BAWAH_MINIMUM: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Margin (harga tanpa PPN dibanding modal) di bawah batas minimum konfigurasi.",
  },
  MARKUP_DI_ATAS_BATAS: {
    jenis: "PERINGATAN",
    perluDitinjau: false,
    pesan: "Markup di atas batas wajar konfigurasi. Periksa kemungkinan salah ketik.",
  },
  PPN_BELUM_DIKONFIGURASI: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Tarif PPN belum dikonfigurasi, sedangkan produk ini kena PPN.",
  },
  PAGAR_LEVEL_DILANGGAR: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Urutan harga salah: wajib Harga Satuan ≥ Harga Mitra Grosir ≥ Harga Franchise.",
  },
  PAGAR_LEVEL_NONAKTIF: {
    jenis: "PERINGATAN",
    perluDitinjau: false,
    pesan:
      "Urutan harga dengan level yang belum aktif salah (wajib Harga Satuan ≥ Harga Mitra Grosir ≥ Harga Franchise).",
  },
  PAGAR_KEMASAN_DILANGGAR: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Harga per pcs kemasan besar lebih mahal dari kemasan kecil pada level yang sama.",
  },
  GROSIR_TIDAK_TERSEDIA: {
    jenis: "INFO",
    perluDitinjau: false,
    pesan:
      "Harga Mitra Grosir kosong atau tidak valid: dalam grup, satuan ini memakai Harga Satuan.",
  },
  GRUP_TIDAK_DIAKTIFKAN: {
    jenis: "INFO",
    perluDitinjau: false,
    pesan: "Harga grup dimatikan untuk satuan ini: dalam grup memakai Harga Satuan.",
  },
  ANGKA_OVERFLOW: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Angka terlalu besar untuk dihitung dengan aman.",
  },
  TIDAK_TAYANG: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Satuan jual ini tidak tayang sehingga tidak bisa dibeli.",
  },
  QTY_TIDAK_VALID: {
    jenis: "ERROR",
    perluDitinjau: false,
    pesan: "Jumlah beli harus bilangan bulat ≥ 1.",
  },
};

export interface KonteksMasalah {
  readonly level?: LevelHarga;
  readonly idSatuanJual?: string;
  readonly kodeSatuan?: string;
  /** Penjelasan tambahan (tanpa nominal), ditambahkan setelah pesan baku. */
  readonly rincian?: string;
  /** Menimpa jenis baku, mis. pagar pada level nonaktif menjadi peringatan. */
  readonly jenis?: JenisMasalah;
}

export function buatMasalah(kode: KodeMasalah, ktx: KonteksMasalah = {}): Masalah {
  const def = DEFINISI[kode];
  const awalan: string[] = [];
  if (ktx.kodeSatuan !== undefined) awalan.push(`Satuan ${labelSatuan(ktx.kodeSatuan)}`);
  if (ktx.level !== undefined) awalan.push(LABEL_LEVEL[ktx.level]);
  const kepala = awalan.length > 0 ? `${awalan.join(" · ")}: ` : "";
  const ekor = ktx.rincian !== undefined ? ` ${ktx.rincian}` : "";
  return {
    kode,
    jenis: ktx.jenis ?? def.jenis,
    perluDitinjau: def.perluDitinjau,
    level: ktx.level ?? null,
    idSatuanJual: ktx.idSatuanJual ?? null,
    pesan: `${kepala}${def.pesan}${ekor}`,
  };
}
