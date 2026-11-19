// `LocalInventory` (default, T-009 §9, ADR-0001 §4.1): sumber = tabel NEKAT sendiri (panel admin / CSV).
// Membaca lewat port `RepoInventoriLokal` (implementasi di @nekat/db). Tidak menulis ke DB NEKAT.
// Tidak pernah kedaluwarsa (T-009 §6). Tidak mengisi atau menghitung harga; modal hanya diteruskan.
import {
  KATA_KATEGORI_TERLARANG,
  kodeKategoriTerlarang,
  type BarisSkuLokal,
  type InventorySource,
  type PenyimpanIdempotensi,
  type RepoInventoriLokal,
  type SkuId,
} from "@nekat/domain";
import {
  BATAS_SKU_PER_PANGGILAN,
  InventoryError,
  isRupiah,
  konfirmasiStokSchema,
  modalSumberSchema,
  permintaanPickingSchema,
  skuSumberSchema,
  stokSumberSchema,
  type HasilPicking,
  type KonfirmasiStok,
  type ModalSumber,
  type PermintaanPicking,
  type SkuSumber,
  type StokSumber,
  type StokTerkonfirmasi,
} from "@nekat/shared";
import { hashKanonik } from "./kanonik.js";

/** Peristiwa untuk log admin. Tidak memuat nilai mentah dari sumber selain ID SKU. */
export interface PeristiwaInventori {
  readonly kode:
    | "BARIS_TIDAK_VALID"
    | "KATEGORI_TERLARANG"
    | "STOK_NEGATIF"
    | "MODAL_TIDAK_VALID"
    | "MODAL_PECAHAN";
  readonly skuId: string;
  readonly keterangan: string;
}

export interface OpsiLocalInventory {
  readonly repo: RepoInventoriLokal;
  readonly idempotensi: PenyimpanIdempotensi;
  /** Pencatat log admin; bawaan: diabaikan. */
  readonly catat?: (p: PeristiwaInventori) => void;
  /** Jam (Clock). Bawaan `new Date()`. */
  readonly sekarang?: () => Date;
  readonly kataKategoriTerlarang?: readonly string[];
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PESAN_DB = "Database inventori lokal tidak bisa dibaca";

export class LocalInventory implements InventorySource {
  readonly nama = "local" as const;
  readonly #repo: RepoInventoriLokal;
  readonly #idempotensi: PenyimpanIdempotensi;
  readonly #catat: (p: PeristiwaInventori) => void;
  readonly #sekarang: () => Date;
  readonly #kataTerlarang: readonly string[];

  constructor(opsi: OpsiLocalInventory) {
    this.#repo = opsi.repo;
    this.#idempotensi = opsi.idempotensi;
    this.#catat = opsi.catat ?? (() => undefined);
    this.#sekarang = opsi.sekarang ?? (() => new Date());
    this.#kataTerlarang = opsi.kataKategoriTerlarang ?? KATA_KATEGORI_TERLARANG;
  }

  async listSku(sejak?: Date): Promise<SkuSumber[]> {
    const baris = await this.#baca(() => this.#repo.daftarSku(sejak));
    const hasil: SkuSumber[] = [];
    for (const b of baris) {
      if (
        kodeKategoriTerlarang(b.kategoriKode, this.#kataTerlarang) ||
        (b.indukKategoriKode !== null &&
          kodeKategoriTerlarang(b.indukKategoriKode, this.#kataTerlarang))
      ) {
        this.#catat({
          kode: "KATEGORI_TERLARANG",
          skuId: b.skuId,
          keterangan: "kategori rokok/bir tidak diimpor di Fase 1",
        });
        continue;
      }
      const cek = skuSumberSchema.safeParse(keSkuSumber(b));
      if (!cek.success) {
        this.#catatTidakValid(b.skuId, cek.error.issues);
        continue;
      }
      hasil.push(cek.data);
    }
    return hasil;
  }

  async getStok(skuIds: readonly SkuId[], lokasiId: string): Promise<StokSumber[]> {
    const ids = saringId(skuIds);
    if (ids.length === 0 || !POLA_UUID.test(lokasiId)) return [];
    const baris = await this.#baca(() => this.#repo.stok(ids, lokasiId));
    const hasil: StokSumber[] = [];
    for (const b of baris) {
      // Hanya stok cabang yang diminta (F-20); stok cabang lain tidak dipakai.
      if (b.gudangId !== lokasiId || !ids.includes(b.skuId)) continue;
      let tersedia = b.tersedia;
      if (Number.isInteger(tersedia) && tersedia < 0) {
        this.#catat({
          kode: "STOK_NEGATIF",
          skuId: b.skuId,
          keterangan: "stok negatif dianggap 0",
        });
        tersedia = 0;
      }
      const cek = stokSumberSchema.safeParse({
        skuId: b.skuId,
        lokasiId: b.gudangId,
        tersedia,
        dataPada: b.dataPada.toISOString(),
      });
      if (!cek.success) {
        this.#catatTidakValid(b.skuId, cek.error.issues);
        continue;
      }
      hasil.push(cek.data);
    }
    return hasil;
  }

  async getHargaModal(skuIds: readonly SkuId[]): Promise<ModalSumber[]> {
    const ids = saringId(skuIds);
    if (ids.length === 0) return [];
    const baris = await this.#baca(() => this.#repo.modal(ids));
    const hasil: ModalSumber[] = [];
    for (const b of baris) {
      if (!ids.includes(b.skuId)) continue;
      // Modal kosong / ≤ 0 / pecahan → null (tidak tayang), TIDAK PERNAH 0 dan tidak dibulatkan (H6, K-01).
      let modal = b.modalRp;
      if (modal !== null && !(isRupiah(modal) && modal > 0)) {
        const pecahan = Number.isFinite(modal) && !Number.isInteger(modal);
        this.#catat({
          kode: pecahan ? "MODAL_PECAHAN" : "MODAL_TIDAK_VALID",
          skuId: b.skuId,
          keterangan: pecahan
            ? `modal pecahan satuan ${b.jenis}: perlu ditinjau, tidak tayang`
            : `modal tidak valid satuan ${b.jenis}: tidak tayang`,
        });
        modal = null;
      }
      const cek = modalSumberSchema.safeParse({
        skuId: b.skuId,
        satuan: b.jenis,
        modalPerSatuan: modal,
        dataPada: b.dataPada.toISOString(),
      });
      if (!cek.success) {
        this.#catatTidakValid(b.skuId, cek.error.issues);
        continue;
      }
      hasil.push(cek.data);
    }
    return hasil;
  }

  async konfirmasiStok(req: KonfirmasiStok): Promise<StokTerkonfirmasi> {
    const cek = konfirmasiStokSchema.safeParse(req);
    if (!cek.success) {
      throw new InventoryError("DATA_TIDAK_VALID", "Permintaan konfirmasi stok tidak valid");
    }
    const r = cek.data;
    const hash = hashKanonik(r);
    // Stok tabel NEKAT saat ini di cabang penerima (T-009 §9), dibatasi qty yang dibutuhkan.
    const [stok] = await this.getStok([r.skuId], r.lokasiId);
    const hasil: StokTerkonfirmasi = {
      grupId: r.grupId,
      skuId: r.skuId,
      qtyTersedia: Math.min(stok?.tersedia ?? 0, r.qtyDibutuhkan),
      dataPada: stok?.dataPada ?? this.#sekarang().toISOString(),
    };
    const { entri } = await this.#idempotensi.simpanBilaBelumAda("konfirmasi", r.kunciIdempotensi, {
      hash,
      hasil,
    });
    if (entri.hash !== hash) throw konflik();
    return entri.hasil;
  }

  async kirimPermintaanPicking(req: PermintaanPicking): Promise<HasilPicking> {
    const cek = permintaanPickingSchema.safeParse(req);
    if (!cek.success) {
      // Termasuk field tambahan (nama, nomor HP, alamat, pesananId): skema ketat menolaknya.
      throw new InventoryError("DATA_TIDAK_VALID", "Permintaan picking tidak valid");
    }
    const r = cek.data;
    const baris = [...r.baris].sort(
      (a, b) => banding(a.anggotaId, b.anggotaId) || banding(a.skuId, b.skuId),
    );
    const hash = hashKanonik({ ...r, baris });
    // LocalInventory: permintaan dicatat sebagai daftar picking internal (tampilan admin/PDF di T-040).
    const { baru, entri } = await this.#idempotensi.simpanBilaBelumAda(
      "picking",
      r.kunciIdempotensi,
      {
        hash,
        hasil: { permintaan: { ...r, baris }, referensiSumber: null as string | null },
      },
    );
    if (entri.hash !== hash) throw konflik();
    return {
      grupId: r.grupId,
      status: baru ? "DITERIMA" : "DUPLIKAT",
      referensiSumber: entri.hasil.referensiSumber,
    };
  }

  async #baca<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      // H14: sumber tak terjangkau → pemanggil menahan checkout. Pesan tanpa detail koneksi.
      throw new InventoryError("SUMBER_TIDAK_TERJANGKAU", PESAN_DB, { cause: e });
    }
  }

  #catatTidakValid(skuId: string, isu: readonly { path: readonly PropertyKey[] }[]): void {
    const field = [...new Set(isu.map((i) => i.path.map(String).join(".")))].join(", ");
    this.#catat({ kode: "BARIS_TIDAK_VALID", skuId, keterangan: `field tidak valid: ${field}` });
  }
}

function keSkuSumber(b: BarisSkuLokal): unknown {
  const pcs1 = b.satuanJual.find((s) => s.jenis === "PCS_1");
  return {
    skuId: b.skuId,
    skuSumberId: null,
    nama: b.namaVarian ? `${b.namaProduk} ${b.namaVarian}` : b.namaProduk,
    kategori: b.kategoriKode,
    satuanDasar: b.satuanDasar,
    konversiSatuan: b.satuanJual
      .filter((s) => s.jenis !== "PCS_1")
      .map((s) => ({ satuan: s.jenis, isi: s.isi, beratGram: s.beratGram })),
    beratGram: pcs1?.beratGram ?? null,
    barcode: b.barcode,
    aktifDiSumber: b.aktif,
    diubahPada: b.diubahPada.toISOString(),
  };
}

/** Batas 200 per panggilan (T-009 §3); ID non-UUID = SKU tak dikenal → dibuang tanpa error. */
function saringId(skuIds: readonly string[]): string[] {
  if (skuIds.length > BATAS_SKU_PER_PANGGILAN) {
    throw new RangeError(
      `skuIds maksimal ${BATAS_SKU_PER_PANGGILAN} per panggilan; pecah dengan pecahBatch`,
    );
  }
  return [...new Set(skuIds)].filter((id) => POLA_UUID.test(id)).map((id) => id.toLowerCase());
}

function banding(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function konflik(): InventoryError {
  return new InventoryError(
    "KONFLIK_IDEMPOTENSI",
    "Kunci idempotensi sudah dipakai untuk permintaan dengan isi berbeda",
  );
}
