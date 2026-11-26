// Tes unit job sinkron (T-019) dengan InventorySource & repo palsu. Angka fiktif.
import type { InventorySource, RepoSinkronInventori, TinjauanSinkron } from "@nekat/domain";
import { InventoryError, type ModalSumber, type StokSumber } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { cronSinkron, daftarkanJobInventori } from "../worker.js";
import { PengumpulPeristiwaSinkron, sinkronInventori } from "./sinkron.js";

const SKU = Array.from(
  { length: 201 },
  (_, i) => `0190a000-0000-7000-8000-${String(i).padStart(12, "0")}`,
);
const LOKASI = "0190b000-0000-7000-8000-000000000001";
const W = new Date("2026-11-26T05:00:00Z");

function repoPalsu() {
  const catatan = {
    stok: [] as { ids: number; stok: number; isiNol: boolean }[],
    modal: [] as number[],
    tinjauan: [] as TinjauanSinkron[],
    audit: [] as { jenis: string; data: unknown }[],
    sku: 0,
    penuh: [] as boolean[],
    maksNonaktif: [] as number[],
    tahan: false,
  };
  const repo: RepoSinkronInventori = {
    skuTerpetakan: () => Promise.resolve(SKU),
    lokasiAktif: () => Promise.resolve([LOKASI]),
    terapkanSku: (h, o) => {
      catatan.sku = h.length;
      catatan.penuh.push(o.penuh);
      catatan.maksNonaktif.push(o.maksNonaktif);
      return Promise.resolve({
        diubah: h.length,
        dinonaktifkan: 0,
        satuanBeda: 0,
        ditahan: catatan.tahan,
      });
    },
    simpanStok: (_l, ids, stok, o) => {
      catatan.stok.push({ ids: ids.length, stok: stok.length, isiNol: o.isiNol });
      return Promise.resolve(stok.length);
    },
    simpanModal: (ids, modal) => {
      catatan.modal.push(ids.length);
      return Promise.resolve({
        disimpan: modal.length,
        dikosongkan: 0,
        turun: 0,
        naik: 0,
        peringatanRupiah: 0,
      });
    },
    catatTinjauan: (t) => {
      catatan.tinjauan.push(t);
      return Promise.resolve();
    },
    catatAudit: (jenis, data) => {
      catatan.audit.push({ jenis, data });
      return Promise.resolve();
    },
  };
  return { repo, catatan };
}

function inventoryPalsu(
  pengumpul: PengumpulPeristiwaSinkron,
  ubah: Partial<InventorySource> = {},
): InventorySource {
  return {
    nama: "gudang",
    listSku: () =>
      Promise.resolve([
        {
          skuId: SKU[0] ?? "",
          skuSumberId: "G-0",
          nama: "Produk",
          kategori: "sembako",
          satuanDasar: "pcs",
          konversiSatuan: [],
          beratGram: null,
          barcode: null,
          aktifDiSumber: true,
          diubahPada: W.toISOString(),
        },
      ]),
    getStok: (ids, lokasiId) =>
      Promise.resolve(
        ids.slice(0, 2).map((skuId): StokSumber => ({
          skuId,
          lokasiId,
          tersedia: 5,
          dataPada: W.toISOString(),
        })),
      ),
    getHargaModal: (ids) => {
      pengumpul.catat({
        kode: "MODAL_PECAHAN",
        skuId: ids[0] ?? "",
        satuan: "PCS_1",
        nilaiMentah: "100.5",
        keterangan: "x",
      });
      return Promise.resolve(
        ids.slice(0, 1).map((skuId): ModalSumber => ({
          skuId,
          satuan: "PCS_1",
          modalPerSatuan: null,
          dataPada: W.toISOString(),
        })),
      );
    },
    konfirmasiStok: () => Promise.reject(new Error("tidak dipakai")),
    kirimPermintaanPicking: () => Promise.reject(new Error("tidak dipakai")),
    ...ubah,
  };
}

describe("sinkronInventori", () => {
  it("LocalInventory: tidak ada yang disinkron", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const h = await sinkronInventori({
      inventory: { ...inventoryPalsu(pengumpul), nama: "local" },
      repo,
      pengumpul,
    });
    expect(h.sku).toBeNull();
    expect(catatan.audit).toEqual([]);
  });

  it("memecah batch 200 per panggilan, menyimpan stok & modal, meneruskan tinjauan", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul),
      repo,
      pengumpul,
      sekarang: () => W,
    });
    expect(catatan.stok).toEqual([
      { ids: 200, stok: 2, isiNol: true },
      { ids: 1, stok: 1, isiNol: true },
    ]);
    expect(catatan.modal).toEqual([200, 1]);
    expect(catatan.tinjauan).toHaveLength(2);
    expect(catatan.tinjauan[0]).toMatchObject({ jenis: "MODAL_PECAHAN", nilaiMentah: "100.5" });
    expect(h.gagal).toEqual([]);
    expect(catatan.audit[0]?.jenis).toBe("SINKRON_GUDANG");
  });

  it("daftar SKU kosong dari Gudang tidak menonaktifkan semua SKU (pengaman)", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul, { listSku: () => Promise.resolve([]) }),
      repo,
      pengumpul,
    });
    expect(catatan.penuh).toEqual([false]);
    expect(h.gagal).toContainEqual({ bagian: "sku", kode: "DAFTAR_SKU_KOSONG" });
  });

  it("baris SKU cacat di daftar Gudang → sinkron TIDAK penuh (SKU cacat tidak dinonaktifkan)", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const dasar = inventoryPalsu(pengumpul);
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul, {
        listSku: () => {
          pengumpul.catat({ kode: "BARIS_TIDAK_VALID", skuId: "", keterangan: "field nama" });
          return dasar.listSku();
        },
      }),
      repo,
      pengumpul,
    });
    expect(catatan.penuh).toEqual([false]);
    expect(h.gagal).toContainEqual({ bagian: "sku", kode: "BARIS_SKU_TIDAK_VALID" });
  });

  it("ambang anomali penonaktifan: min(jumlah, persen × terpetakan); ditahan → dicatat gagal", async () => {
    const { repo, catatan } = repoPalsu();
    catatan.tahan = true;
    const pengumpul = new PengumpulPeristiwaSinkron();
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul),
      repo,
      pengumpul,
      batasNonaktif: { jumlah: 50, persen: 10 },
    });
    // 201 SKU terpetakan × 10 % = 20 (lebih kecil dari 50).
    expect(catatan.maksNonaktif).toEqual([20]);
    expect(catatan.penuh).toEqual([true]);
    expect(h.gagal).toContainEqual({ bagian: "sku", kode: "ANOMALI_PENONAKTIFAN" });
    expect(catatan.audit[0]?.jenis).toBe("SINKRON_GUDANG_SEBAGIAN");
  });

  it("respons stok `data: []` untuk permintaan tak kosong → anomali, BUKAN stok 0", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul, { getStok: () => Promise.resolve([]) }),
      repo,
      pengumpul,
    });
    expect(catatan.stok.map((x) => x.isiNol)).toEqual([false, false]);
    expect(h.gagal.filter((g) => g.kode === "STOK_KOSONG")).toHaveLength(2);
  });

  it("ambang opsional SKU hilang dari respons stok", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    // Batch 200 → 2 dikembalikan (99 % hilang); batch 1 → 1 dikembalikan (0 % hilang).
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul),
      repo,
      pengumpul,
      batasHilangStokPersen: 50,
    });
    expect(catatan.stok.map((x) => x.isiNol)).toEqual([false, true]);
    expect(h.gagal).toContainEqual({ bagian: "stok", kode: "STOK_BANYAK_HILANG" });
  });

  it("respons modal `data: []` → anomali, modal TIDAK dikosongkan", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul, { getHargaModal: () => Promise.resolve([]) }),
      repo,
      pengumpul,
    });
    expect(catatan.modal).toEqual([]);
    expect(h.gagal.filter((g) => g.kode === "MODAL_KOSONG")).toHaveLength(2);
  });

  it("baris stok tidak valid di respons → SKU yang hilang TIDAK dianggap stok 0", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const dasar = inventoryPalsu(pengumpul);
    const inventory = inventoryPalsu(pengumpul, {
      getStok: (ids, l) => {
        pengumpul.catat({ kode: "BARIS_TIDAK_VALID", skuId: "", keterangan: "x" });
        return dasar.getStok(ids, l);
      },
    });
    await sinkronInventori({ inventory, repo, pengumpul });
    expect(catatan.stok.map((s) => s.isiNol)).toEqual([false, false]);
  });

  it("Gudang tak terjangkau: bagian dicatat gagal (kode saja), snapshot lama dibiarkan menua", async () => {
    const { repo, catatan } = repoPalsu();
    const pengumpul = new PengumpulPeristiwaSinkron();
    const mati = () =>
      Promise.reject(new InventoryError("SUMBER_TIDAK_TERJANGKAU", "Gudang tidak bisa dihubungi"));
    const h = await sinkronInventori({
      inventory: inventoryPalsu(pengumpul, { listSku: mati, getStok: mati, getHargaModal: mati }),
      repo,
      pengumpul,
    });
    expect(h.gagal).toEqual([
      { bagian: "sku", kode: "SUMBER_TIDAK_TERJANGKAU" },
      { bagian: "stok", kode: "SUMBER_TIDAK_TERJANGKAU" },
      { bagian: "modal", kode: "SUMBER_TIDAK_TERJANGKAU" },
    ]);
    // Berhenti setelah batch pertama gagal (tidak menghajar Gudang yang sedang mati).
    expect(catatan.stok).toEqual([]);
    expect(catatan.modal).toEqual([]);
    expect(catatan.audit[0]?.jenis).toBe("SINKRON_GUDANG_SEBAGIAN");
  });
});

describe("jadwal job inventori", () => {
  it("cron dari interval menit", () => {
    expect(cronSinkron(1)).toBe("* * * * *");
    expect(cronSinkron(5)).toBe("*/5 * * * *");
    expect(cronSinkron(90)).toBe("0 */1 * * *");
    expect(cronSinkron(1440)).toBe("0 0 * * *");
    expect(() => cronSinkron(0)).toThrow(RangeError);
  });

  it("mendaftarkan antrean singleton + jadwal; sinkron hanya bila mode gudang", async () => {
    const dibuat: string[] = [];
    const jadwal: string[] = [];
    const boss = {
      getQueue: () => Promise.resolve(null),
      createQueue: (n: string, o?: { policy?: string }) => {
        dibuat.push(`${n}:${o?.policy ?? ""}`);
        return Promise.resolve();
      },
      schedule: (n: string, c: string) => {
        jadwal.push(`${n}@${c}`);
        return Promise.resolve();
      },
      work: () => Promise.resolve("id"),
    };
    await daftarkanJobInventori(boss, {
      sinkron: () => Promise.resolve(),
      kirimPicking: () => Promise.resolve(),
      intervalSinkronMenit: 5,
    });
    expect(dibuat).toEqual(["inventori-sinkron:singleton", "inventori-kirim-picking:singleton"]);
    expect(jadwal).toEqual(["inventori-sinkron@*/5 * * * *", "inventori-kirim-picking@* * * * *"]);

    jadwal.length = 0;
    await daftarkanJobInventori(boss, {
      sinkron: null,
      kirimPicking: () => Promise.resolve(),
      intervalSinkronMenit: 5,
    });
    expect(jadwal).toEqual(["inventori-kirim-picking@* * * * *"]);
  });
});
