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
}

export interface HasilSinkron {
  readonly sku: { diubah: number; dinonaktifkan: number; satuanBeda: number } | null;
  readonly stokDisimpan: number;
  readonly modal: { disimpan: number; dikosongkan: number; turun: number };
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
      modal: { disimpan: 0, dikosongkan: 0, turun: 0 },
      gagal: [],
    };
  }
  const sekarang = o.sekarang ?? (() => new Date());
  const gagal: { bagian: string; kode: string }[] = [];

  let hasilSku: HasilSinkron["sku"] = null;
  try {
    const daftar = await o.inventory.listSku();
    // Pengaman: daftar kosong dari Gudang (mis. galat di sisi Gudang) TIDAK menonaktifkan semua SKU.
    const penuh = daftar.length > 0;
    if (!penuh) gagal.push({ bagian: "sku", kode: "DAFTAR_SKU_KOSONG" });
    hasilSku = await o.repo.terapkanSku(daftar, { penuh, waktu: sekarang() });
  } catch (e) {
    gagal.push({ bagian: "sku", kode: kodeGalat(e) });
  }

  const skuIds = await o.repo.skuTerpetakan();
  const batch = pecahBatch(skuIds);

  let stokDisimpan = 0;
  stok: for (const lokasiId of await o.repo.lokasiAktif()) {
    for (const ids of batch) {
      const sebelum = o.pengumpul.jumlahTidakValid;
      try {
        const stok = await o.inventory.getStok(ids, lokasiId);
        stokDisimpan += await o.repo.simpanStok(lokasiId, ids, stok, {
          // Ada baris cacat → jangan anggap SKU yang hilang = stok 0 (data basi ≠ stok habis).
          isiNol: o.pengumpul.jumlahTidakValid === sebelum,
          waktu: sekarang(),
        });
      } catch (e) {
        gagal.push({ bagian: "stok", kode: kodeGalat(e) });
        // Sumber tak terjangkau / ditolak: batch & cabang berikutnya kemungkinan sama → berhenti.
        if (e instanceof InventoryError && e.kode !== "DATA_TIDAK_VALID") break stok;
      }
    }
  }

  const modal = { disimpan: 0, dikosongkan: 0, turun: 0 };
  for (const ids of batch) {
    try {
      const daftar = await o.inventory.getHargaModal(ids);
      const r = await o.repo.simpanModal(ids, daftar, sekarang());
      modal.disimpan += r.disimpan;
      modal.dikosongkan += r.dikosongkan;
      modal.turun += r.turun;
    } catch (e) {
      // Snapshot modal lama menua → engine harga menahan satuan jual (P-10), tidak dijual.
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
