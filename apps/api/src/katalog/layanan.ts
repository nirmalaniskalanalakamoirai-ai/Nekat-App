// Use case katalog pembeli (T-025): rangkai RepoKatalog (tabel T-013a) + InventorySource (stok &
// modal, T-018) + engine harga (T-020) → snapshot tayang per gudang. Hanya baca.
//
// Snapshot dipakai bersama oleh daftar, pencarian, jumlah per kategori, dan detail, sehingga harga
// kartu = harga detail (PG-6) dan jumlah per kategori = isi daftar. Cache singkat per gudang
// (bawaan 10 dtk) membatasi beban DB; harga & stok tetap dicek ulang saat keranjang/invoice.
import {
  kunciModal,
  pecahBatch,
  susunKatalog,
  type InventorySource,
  type KonfigurasiHarga,
  type ModalKatalog,
  type RepoKatalog,
  type SatuanDitahan,
  type SnapshotKatalog,
  type StokKatalog,
} from "@nekat/domain";

export interface OpsiLayananKatalog {
  readonly repo: RepoKatalog;
  readonly inventory: InventorySource;
  readonly konfigurasiHarga: KonfigurasiHarga;
  /** P-10 (INVENTORY_MAKS_UMUR_DATA_MENIT). */
  readonly maksUmurDataMenit: number;
  /** Umur cache snapshot (ms). 0 = tanpa cache. */
  readonly cacheMs?: number;
  readonly sekarang?: () => Date;
  /**
   * K-42: laporan satuan jual yang ditahan (tidak tayang). Dipanggil hanya bila daftarnya berubah
   * sejak laporan terakhir (tidak membanjiri log tiap cache habis). Hanya ID & kode, tanpa nominal.
   */
  readonly laporDitahan?: (ditahan: readonly SatuanDitahan[]) => void;
}

interface EntriCache<T> {
  readonly kedaluwarsa: number;
  readonly janji: Promise<T>;
}

export class LayananKatalog {
  readonly #o: OpsiLayananKatalog;
  readonly #cacheMs: number;
  readonly #sekarang: () => Date;
  readonly #cache = new Map<string, EntriCache<SnapshotKatalog>>();
  readonly #cacheGudang = new Map<string, EntriCache<string | null>>();
  #tandaDitahanTerakhir = "";

  constructor(opsi: OpsiLayananKatalog) {
    this.#o = opsi;
    this.#cacheMs = opsi.cacheMs ?? 10_000;
    this.#sekarang = opsi.sekarang ?? (() => new Date());
  }

  /** `gudang.id` dari `kode_konfig` zona (config/lokasi.json). Di-cache seumur cache snapshot. */
  idGudang(kodeKonfig: string): Promise<string | null> {
    const kini = this.#sekarang().getTime();
    const ada = this.#cacheGudang.get(kodeKonfig);
    if (ada && ada.kedaluwarsa > kini) return ada.janji;
    const janji = this.#o.repo.idGudang(kodeKonfig);
    if (this.#cacheMs > 0) {
      this.#cacheGudang.set(kodeKonfig, { kedaluwarsa: kini + this.#cacheMs, janji });
      janji.catch(() => {
        if (this.#cacheGudang.get(kodeKonfig)?.janji === janji)
          this.#cacheGudang.delete(kodeKonfig);
      });
    }
    return janji;
  }

  /** Snapshot untuk gudang/cabang penerima pesanan (F-20: stok dicek di cabang itu). */
  snapshot(gudangId: string): Promise<SnapshotKatalog> {
    const kini = this.#sekarang().getTime();
    const ada = this.#cache.get(gudangId);
    if (ada && ada.kedaluwarsa > kini) return ada.janji;
    const janji = this.#susun(gudangId);
    if (this.#cacheMs > 0) {
      // Satu penyusunan untuk permintaan serentak; gagal → tidak disimpan.
      this.#cache.set(gudangId, { kedaluwarsa: kini + this.#cacheMs, janji });
      janji.catch(() => {
        if (this.#cache.get(gudangId)?.janji === janji) this.#cache.delete(gudangId);
      });
    }
    return janji;
  }

  async #susun(gudangId: string): Promise<SnapshotKatalog> {
    const data = await this.#o.repo.muatData();
    const skuIds = data.sku.map((s) => s.id);

    const stok = new Map<string, StokKatalog>();
    const modal = new Map<string, ModalKatalog>();
    for (const batch of pecahBatch(skuIds)) {
      for (const s of await this.#o.inventory.getStok(batch, gudangId)) {
        stok.set(s.skuId, { tersedia: s.tersedia, dataPada: new Date(s.dataPada) });
      }
      for (const x of await this.#o.inventory.getHargaModal(batch)) {
        modal.set(kunciModal(x.skuId, x.satuan), {
          modal: x.modalPerSatuan,
          dataPada: new Date(x.dataPada),
        });
      }
    }

    const snapshot = susunKatalog({
      data,
      stok,
      modal,
      // Tabel reservasi_stok menyusul di T-013b; sampai itu stok bebas = stok snapshot.
      reservasi: new Map(),
      sumber: this.#o.inventory.nama,
      maksUmurDataMenit: this.#o.maksUmurDataMenit,
      konfigurasiHarga: this.#o.konfigurasiHarga,
      sekarang: this.#sekarang(),
    });
    const tanda = snapshot.ditahan
      .map((d) => `${d.idSatuanJual}:${d.kode.join(",")}`)
      .sort()
      .join(";");
    if (tanda !== this.#tandaDitahanTerakhir) {
      this.#tandaDitahanTerakhir = tanda;
      this.#o.laporDitahan?.(snapshot.ditahan);
    }
    return snapshot;
  }
}
