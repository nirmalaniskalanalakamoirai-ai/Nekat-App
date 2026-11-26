// Job sinkron inventori Gudang → snapshot lokal (T-019, T-009 §6; modul `inventori`, bukan adapter).
//
// Alur satu putaran:
// 1. `listSku()` penuh → status aktif SKU terpetakan (`sku.aktif_di_sumber`).
// 2. Per cabang aktif, per batch 200 SKU: `getStok` → `stok_lokasi` (+ `disinkron_pada`).
// 3. Per batch 200 SKU: `getHargaModal` → `modal_satuan_jual` (sumber GUDANG). Modal HANYA modal:
//    harga jual & margin tidak dihitung/diisi (CLAUDE.md, keputusan #6).
// Bagian yang gagal (setelah retry adapter) dicatat dan dilewati; snapshot lamanya dibiarkan menua
// sehingga katalog menampilkan "Stok sedang dicek" (tidak diketahui), BUKAN "Stok habis".
import type { PeristiwaInventori } from "@nekat/adapters";
import { pecahBatch, type InventorySource, type RepoSinkronInventori } from "@nekat/domain";
import { InventoryError } from "@nekat/shared";

/**
 * Pengumpul peristiwa adapter per putaran: menghitung baris tidak valid (agar SKU yang hilang dari
 * respons cacat tidak dianggap stok 0) dan meneruskan tinjauan (modal pecahan, SKU belum dipetakan).
 */
export class PengumpulPeristiwaSinkron {
  #tidakValid = 0;
  readonly tinjauan: PeristiwaInventori[] = [];
  readonly #teruskan: (p: PeristiwaInventori) => void;

  constructor(teruskan: (p: PeristiwaInventori) => void = () => undefined) {
    this.#teruskan = teruskan;
  }

  /** Dipasang sebagai `catat` adapter. */
  readonly catat = (p: PeristiwaInventori): void => {
    if (p.kode === "BARIS_TIDAK_VALID") this.#tidakValid++;
    if (p.kode === "MODAL_PECAHAN" || p.kode === "SKU_BELUM_DIPETAKAN") this.tinjauan.push(p);
    this.#teruskan(p);
  };

  get jumlahTidakValid(): number {
    return this.#tidakValid;
  }

  ambilTinjauan(): PeristiwaInventori[] {
    return this.tinjauan.splice(0);
  }
}

export interface OpsiSinkron {
  readonly inventory: InventorySource;
  readonly repo: RepoSinkronInventori;
  readonly pengumpul: PengumpulPeristiwaSinkron;
  readonly sekarang?: () => Date;
  /**
   * Ambang anomali penonaktifan SKU pada sinkron penuh (DEFAULT SEMENTARA IG-08): bila calon SKU
   * yang dinonaktifkan karena hilang dari daftar Gudang > `jumlah` ATAU > `persen` % SKU terpetakan,
   * penonaktifan DITAHAN (dicatat log audit, admin meninjau). Bawaan 50 SKU / 20 %.
   */
  readonly batasNonaktif?: { readonly jumlah: number; readonly persen: number };
  /**
   * Opsional: bila SKU yang hilang dari respons stok satu batch > persen ini, jangan isi stok 0
   * (anomali). null = nonaktif (bawaan). Respons kosong untuk permintaan tak kosong SELALU anomali.
   */
  readonly batasHilangStokPersen?: number | null;
}

export const BATAS_NONAKTIF_BAWAAN = { jumlah: 50, persen: 20 } as const;

export interface HasilSinkron {
  readonly sku: {
    diubah: number;
    dinonaktifkan: number;
    satuanBeda: number;
    ditahan: boolean;
  } | null;
  readonly stokDisimpan: number;
  readonly modal: {
    disimpan: number;
    dikosongkan: number;
    turun: number;
    naik: number;
    peringatanRupiah: number;
  };
  /** Kode galat per bagian yang gagal (tanpa pesan bebas). */
  readonly gagal: readonly { bagian: string; kode: string }[];
}

function kodeGalat(e: unknown): string {
  return e instanceof InventoryError ? e.kode : "GALAT_LAIN";
}

export async function sinkronInventori(o: OpsiSinkron): Promise<HasilSinkron> {
  if (o.inventory.nama !== "gudang") {
    // LocalInventory: tabel NEKAT = sumber; tidak ada yang disinkron.
    return {
      sku: null,
      stokDisimpan: 0,
      modal: { disimpan: 0, dikosongkan: 0, turun: 0, naik: 0, peringatanRupiah: 0 },
      gagal: [],
    };
  }
  const sekarang = o.sekarang ?? (() => new Date());
  const gagal: { bagian: string; kode: string }[] = [];

  const skuIds = await o.repo.skuTerpetakan();
  const batch = pecahBatch(skuIds);

  let hasilSku: HasilSinkron["sku"] = null;
  try {
    const sebelum = o.pengumpul.jumlahTidakValid;
    const daftar = await o.inventory.listSku();
    // Pengaman penonaktifan (sinkron penuh hanya bila respons bersih):
    // - daftar kosong (mis. galat di sisi Gudang) → jangan nonaktifkan semua SKU;
    // - ada baris SKU cacat → SKU itu tidak muncul di hasil walau masih ada di Gudang → jangan
    //   anggap "hilang" (ID sumber baris cacat bisa tidak terbaca, jadi sinkron penuh dilewati).
    let penuh = true;
    if (daftar.length === 0) {
      penuh = false;
      gagal.push({ bagian: "sku", kode: "DAFTAR_SKU_KOSONG" });
    } else if (o.pengumpul.jumlahTidakValid > sebelum) {
      penuh = false;
      gagal.push({ bagian: "sku", kode: "BARIS_SKU_TIDAK_VALID" });
    }
    const batas = o.batasNonaktif ?? BATAS_NONAKTIF_BAWAAN;
    const maksNonaktif = Math.min(batas.jumlah, Math.floor((skuIds.length * batas.persen) / 100));
    hasilSku = await o.repo.terapkanSku(daftar, { penuh, maksNonaktif, waktu: sekarang() });
    if (hasilSku.ditahan) gagal.push({ bagian: "sku", kode: "ANOMALI_PENONAKTIFAN" });
  } catch (e) {
    gagal.push({ bagian: "sku", kode: kodeGalat(e) });
  }

  let stokDisimpan = 0;
  stok: for (const lokasiId of await o.repo.lokasiAktif()) {
    for (const ids of batch) {
      const sebelum = o.pengumpul.jumlahTidakValid;
      try {
        const stok = await o.inventory.getStok(ids, lokasiId);
        // Isi stok 0 untuk SKU yang hilang HANYA bila respons tampak utuh (data basi ≠ stok habis):
        // tanpa baris cacat, tidak kosong total, dan (opsional) jumlah hilang di bawah ambang.
        let isiNol = o.pengumpul.jumlahTidakValid === sebelum;
        if (stok.length === 0 && ids.length > 0) {
          isiNol = false;
          gagal.push({ bagian: "stok", kode: "STOK_KOSONG" });
        } else if (
          o.batasHilangStokPersen != null &&
          ((ids.length - stok.length) * 100) / ids.length > o.batasHilangStokPersen
        ) {
          isiNol = false;
          gagal.push({ bagian: "stok", kode: "STOK_BANYAK_HILANG" });
        }
        stokDisimpan += await o.repo.simpanStok(lokasiId, ids, stok, {
          isiNol,
          waktu: sekarang(),
        });
      } catch (e) {
        gagal.push({ bagian: "stok", kode: kodeGalat(e) });
        // Sumber tak terjangkau / ditolak: batch & cabang berikutnya kemungkinan sama → berhenti.
        if (e instanceof InventoryError && e.kode !== "DATA_TIDAK_VALID") break stok;
      }
    }
  }

  const modal = { disimpan: 0, dikosongkan: 0, turun: 0, naik: 0, peringatanRupiah: 0 };
  for (const ids of batch) {
    try {
      const daftar = await o.inventory.getHargaModal(ids);
      if (daftar.length === 0 && ids.length > 0) {
        // Respons kosong total = anomali: JANGAN kosongkan modal semua satuan jual. Snapshot lama
        // dibiarkan menua; TODO(invoice/checkout): wajib menolak modal lewat batas usia P-10.
        gagal.push({ bagian: "modal", kode: "MODAL_KOSONG" });
        continue;
      }
      const r = await o.repo.simpanModal(ids, daftar, sekarang());
      modal.disimpan += r.disimpan;
      modal.dikosongkan += r.dikosongkan;
      modal.turun += r.turun;
      modal.naik += r.naik;
      modal.peringatanRupiah += r.peringatanRupiah;
    } catch (e) {
      // Snapshot modal lama dibiarkan menua. Katalog TIDAK menegakkan usia modal (agar tetap tampil
      // saat gangguan, T-009 §6); TODO(invoice/checkout): penerbitan tagihan WAJIB menolak modal
      // yang lebih tua dari INVENTORY_MAKS_UMUR_DATA_MENIT (P-10, K-15).
      gagal.push({ bagian: "modal", kode: kodeGalat(e) });
      if (e instanceof InventoryError && e.kode !== "DATA_TIDAK_VALID") break;
    }
  }

  for (const p of o.pengumpul.ambilTinjauan()) {
    if (p.kode === "MODAL_PECAHAN" && p.satuan !== undefined && p.nilaiMentah !== undefined) {
      await o.repo.catatTinjauan({
        jenis: "MODAL_PECAHAN",
        skuId: p.skuId,
        satuan: p.satuan,
        nilaiMentah: p.nilaiMentah,
      });
    } else if (p.kode === "SKU_BELUM_DIPETAKAN" && p.skuSumberId !== undefined) {
      await o.repo.catatTinjauan({
        jenis: "SKU_BELUM_DIPETAKAN",
        skuSumberId: p.skuSumberId,
        nama: p.namaSumber ?? "",
      });
    }
  }

  const hasil: HasilSinkron = { sku: hasilSku, stokDisimpan, modal, gagal };
  await o.repo.catatAudit(gagal.length > 0 ? "SINKRON_GUDANG_SEBAGIAN" : "SINKRON_GUDANG", {
    sku: hasilSku,
    stokDisimpan,
    modal,
    gagal,
  });
  return hasil;
}
