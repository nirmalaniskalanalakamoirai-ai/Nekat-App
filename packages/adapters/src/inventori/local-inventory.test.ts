// Tes kontrak T-009 §10 untuk LocalInventory (repo palsu di memori). Tes 7 & 9 khusus Gudang (T-019).
import type {
  BarisModalLokal,
  BarisSkuLokal,
  BarisStokLokal,
  RepoInventoriLokal,
} from "@nekat/domain";
import {
  InventoryError,
  permintaanPickingSchema,
  skuSumberSchema,
  type PermintaanPicking,
} from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { PenyimpanIdempotensiMemori } from "./idempotensi-memori.js";
import { LocalInventory, type PeristiwaInventori } from "./local-inventory.js";

const SKU_A = "0190a000-0000-7000-8000-00000000000a";
const SKU_B = "0190a000-0000-7000-8000-00000000000b";
const SKU_ROKOK = "0190a000-0000-7000-8000-0000000000cc";
const SKU_TAK_DIKENAL = "0190a000-0000-7000-8000-0000000000ff";
const GUDANG_1 = "0190b000-0000-7000-8000-000000000001";
const GUDANG_2 = "0190b000-0000-7000-8000-000000000002";
const T = new Date("2026-11-19T03:00:00Z");

const skuA: BarisSkuLokal = {
  skuId: SKU_A,
  namaProduk: "Minyak Goreng",
  namaVarian: "1 L",
  kategoriKode: "minyak-goreng",
  indukKategoriKode: "sembako",
  satuanDasar: "pcs",
  barcode: "8990000000001",
  aktif: true,
  diubahPada: T,
  satuanJual: [
    { jenis: "PCS_1", isi: 1, beratGram: 950 },
    { jenis: "DUS", isi: 12, beratGram: 11_800 },
  ],
};
const skuB: BarisSkuLokal = {
  ...skuA,
  skuId: SKU_B,
  namaProduk: "Gula Pasir",
  namaVarian: null,
  barcode: null,
  aktif: false,
  satuanJual: [{ jenis: "KOLI", isi: 48, beratGram: 48_500 }],
};
const skuRokok: BarisSkuLokal = {
  ...skuA,
  skuId: SKU_ROKOK,
  kategoriKode: "kretek",
  indukKategoriKode: "rokok",
};

function buatRepo(
  ubah: Partial<{
    sku: BarisSkuLokal[];
    stok: BarisStokLokal[];
    modal: BarisModalLokal[];
    gagal: boolean;
  }> = {},
): RepoInventoriLokal & { panggilan: string[][] } {
  const panggilan: string[][] = [];
  const cek = () => {
    if (ubah.gagal) return Promise.reject(new Error("ECONNREFUSED postgres://rahasia@db"));
    return null;
  };
  return {
    panggilan,
    daftarSku: (sejak) =>
      cek() ??
      Promise.resolve(
        (ubah.sku ?? [skuA, skuB, skuRokok]).filter((s) => !sejak || s.diubahPada > sejak),
      ),
    stok: (ids, gudangId) => {
      panggilan.push([...ids]);
      return (
        cek() ??
        Promise.resolve(
          (
            ubah.stok ?? [
              { skuId: SKU_A, gudangId: GUDANG_1, tersedia: 30, dataPada: T },
              { skuId: SKU_A, gudangId: GUDANG_2, tersedia: 999, dataPada: T },
            ]
          ).filter((s) => ids.includes(s.skuId) && s.gudangId === gudangId),
        )
      );
    },
    modal: (ids) =>
      cek() ??
      Promise.resolve(
        (
          ubah.modal ?? [
            { skuId: SKU_A, jenis: "PCS_1", modalRp: 15_000, dataPada: T },
            { skuId: SKU_A, jenis: "DUS", modalRp: null, dataPada: T },
          ]
        ).filter((m) => ids.includes(m.skuId)),
      ),
  };
}

function buat(repo = buatRepo()) {
  const log: PeristiwaInventori[] = [];
  const idempotensi = new PenyimpanIdempotensiMemori();
  const inv = new LocalInventory({
    repo,
    idempotensi,
    catat: (p) => log.push(p),
    sekarang: () => new Date("2026-11-19T04:00:00Z"),
  });
  return { inv, log, idempotensi };
}

const picking = (ubah: Partial<PermintaanPicking> = {}): PermintaanPicking => ({
  grupId: "grup-1",
  lokasiId: GUDANG_1,
  kunciIdempotensi: "picking:grup-1:v1",
  slotKirim: { tanggal: "2026-11-20", mulai: "08:00", selesai: "10:00" },
  baris: [
    { anggotaId: "ang-2", skuId: SKU_A, qty: 2, caraKirim: "DROP_POINT", dropPointId: "dp-1" },
    { anggotaId: "ang-1", skuId: SKU_A, qty: 1, caraKirim: "ANTAR_RUMAH", dropPointId: null },
  ],
  ...ubah,
});

async function galat(p: Promise<unknown>): Promise<InventoryError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof InventoryError) return e;
    throw e;
  }
  throw new Error("diharapkan InventoryError");
}

describe("LocalInventory", () => {
  it("nama = local", () => {
    expect(buat().inv.nama).toBe("local");
  });

  describe("listSku", () => {
    it("(1) lolos skema; kategori rokok/bir tidak muncul dan dicatat", async () => {
      const { inv, log } = buat();
      const hasil = await inv.listSku();
      expect(hasil.map((s) => s.skuId)).toEqual([SKU_A, SKU_B]);
      for (const s of hasil) expect(skuSumberSchema.safeParse(s).success).toBe(true);
      expect(log).toContainEqual(
        expect.objectContaining({ kode: "KATEGORI_TERLARANG", skuId: SKU_ROKOK }),
      );
    });

    it("memetakan tabel NEKAT ke SkuSumber (PCS_1 = satuan dasar, bukan konversi)", async () => {
      const [a, b] = await buat().inv.listSku();
      expect(a).toEqual({
        skuId: SKU_A,
        skuSumberId: null,
        nama: "Minyak Goreng 1 L",
        kategori: "minyak-goreng",
        satuanDasar: "pcs",
        konversiSatuan: [{ satuan: "DUS", isi: 12, beratGram: 11_800 }],
        beratGram: 950,
        barcode: "8990000000001",
        aktifDiSumber: true,
        diubahPada: "2026-11-19T03:00:00.000Z",
      });
      // Tanpa PCS_1 → berat satuan dasar tidak diketahui (null), bukan ditebak.
      expect(b).toMatchObject({ nama: "Gula Pasir", beratGram: null, aktifDiSumber: false });
    });

    it("baris tidak valid diabaikan & dicatat tanpa nilai mentah", async () => {
      const rusak = { ...skuA, skuId: SKU_B, namaProduk: "x".repeat(201), satuanDasar: "kg" };
      const { inv, log } = buat(buatRepo({ sku: [skuA, rusak] }));
      expect((await inv.listSku()).map((s) => s.skuId)).toEqual([SKU_A]);
      const p = log.find((l) => l.kode === "BARIS_TIDAK_VALID");
      expect(p?.keterangan).toContain("nama");
      expect(p?.keterangan).toContain("satuanDasar");
      expect(p?.keterangan).not.toContain("xxxx");
    });

    it("meneruskan `sejak`", async () => {
      const { inv } = buat();
      expect(await inv.listSku(new Date("2026-11-19T05:00:00Z"))).toEqual([]);
    });
  });

  describe("getStok", () => {
    it("(11) memakai lokasiId; stok cabang lain tidak dipakai", async () => {
      const { inv } = buat();
      expect(await inv.getStok([SKU_A], GUDANG_1)).toEqual([
        { skuId: SKU_A, lokasiId: GUDANG_1, tersedia: 30, dataPada: "2026-11-19T03:00:00.000Z" },
      ]);
    });

    it("(3) SKU tak dikenal / ID bukan UUID tidak muncul dan tidak melempar", async () => {
      const repo = buatRepo();
      const { inv } = buat(repo);
      expect(
        await inv.getStok([SKU_TAK_DIKENAL, "bukan-uuid'; DROP TABLE x;--"], GUDANG_1),
      ).toEqual([]);
      expect(repo.panggilan).toEqual([[SKU_TAK_DIKENAL]]);
      expect(await inv.getStok([SKU_A], "bukan-uuid")).toEqual([]);
    });

    it("stok negatif → 0 dan dicatat", async () => {
      const { inv, log } = buat(
        buatRepo({ stok: [{ skuId: SKU_A, gudangId: GUDANG_1, tersedia: -3, dataPada: T }] }),
      );
      expect((await inv.getStok([SKU_A], GUDANG_1))[0]?.tersedia).toBe(0);
      expect(log.map((l) => l.kode)).toContain("STOK_NEGATIF");
    });

    it("lebih dari 200 SKU per panggilan ditolak (pemanggil memecah batch)", async () => {
      const ids = Array.from({ length: 201 }, () => SKU_A);
      await expect(buat().inv.getStok(ids, GUDANG_1)).rejects.toThrow(RangeError);
    });

    it("DB tidak bisa dibaca → SUMBER_TIDAK_TERJANGKAU (H14: tahan checkout), tanpa bocor detail", async () => {
      const e = await galat(buat(buatRepo({ gagal: true })).inv.getStok([SKU_A], GUDANG_1));
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(e.bolehRetry).toBe(true);
      expect(e.message).not.toContain("postgres://");
    });
  });

  describe("getHargaModal", () => {
    it("(2, 12) modal per satuan jual; kosong → null, bukan 0", async () => {
      expect(await buat().inv.getHargaModal([SKU_A, SKU_TAK_DIKENAL])).toEqual([
        {
          skuId: SKU_A,
          satuan: "PCS_1",
          modalPerSatuan: 15_000,
          dataPada: "2026-11-19T03:00:00.000Z",
        },
        { skuId: SKU_A, satuan: "DUS", modalPerSatuan: null, dataPada: "2026-11-19T03:00:00.000Z" },
      ]);
    });

    it("(2, 10) modal ≤ 0 → null; pecahan tidak dibulatkan, null + antrean tinjau", async () => {
      const { inv, log } = buat(
        buatRepo({
          modal: [
            { skuId: SKU_A, jenis: "PCS_1", modalRp: 0, dataPada: T },
            { skuId: SKU_A, jenis: "PCS_3", modalRp: -10, dataPada: T },
            { skuId: SKU_A, jenis: "DUS", modalRp: 12_500.5, dataPada: T },
          ],
        }),
      );
      const hasil = await inv.getHargaModal([SKU_A]);
      expect(hasil.map((m) => m.modalPerSatuan)).toEqual([null, null, null]);
      expect(log.map((l) => l.kode)).toEqual([
        "MODAL_TIDAK_VALID",
        "MODAL_TIDAK_VALID",
        "MODAL_PECAHAN",
      ]);
    });
  });

  describe("konfirmasiStok", () => {
    const req = {
      grupId: "grup-1",
      skuId: SKU_A,
      lokasiId: GUDANG_1,
      qtyDibutuhkan: 50,
      kunciIdempotensi: "konfirmasi:grup-1:v1",
    };

    it("stok tabel NEKAT saat itu, dibatasi qty dibutuhkan (alokasi parsial)", async () => {
      expect(await buat().inv.konfirmasiStok(req)).toEqual({
        grupId: "grup-1",
        skuId: SKU_A,
        qtyTersedia: 30,
        dataPada: "2026-11-19T03:00:00.000Z",
      });
    });

    it("(4) dua kali kunci sama → hasil sama walau stok berubah", async () => {
      const stok: BarisStokLokal[] = [
        { skuId: SKU_A, gudangId: GUDANG_1, tersedia: 30, dataPada: T },
      ];
      const { inv } = buat(buatRepo({ stok }));
      const pertama = await inv.konfirmasiStok(req);
      stok[0] = { skuId: SKU_A, gudangId: GUDANG_1, tersedia: 1, dataPada: T };
      expect(await inv.konfirmasiStok(req)).toEqual(pertama);
    });

    it("(6) kunci sama, isi beda → KONFLIK_IDEMPOTENSI", async () => {
      const { inv } = buat();
      await inv.konfirmasiStok(req);
      const e = await galat(inv.konfirmasiStok({ ...req, qtyDibutuhkan: 51 }));
      expect(e.kode).toBe("KONFLIK_IDEMPOTENSI");
      expect(e.bolehRetry).toBe(false);
    });

    it("SKU tak dikenal → qtyTersedia 0, tanpa error", async () => {
      const hasil = await buat().inv.konfirmasiStok({ ...req, skuId: SKU_TAK_DIKENAL });
      expect(hasil).toMatchObject({ qtyTersedia: 0, dataPada: "2026-11-19T04:00:00.000Z" });
    });

    it("permintaan tidak valid → DATA_TIDAK_VALID", async () => {
      const e = await galat(buat().inv.konfirmasiStok({ ...req, kunciIdempotensi: "bebas" }));
      expect(e.kode).toBe("DATA_TIDAK_VALID");
    });
  });

  describe("kirimPermintaanPicking", () => {
    it("(5) dua kali kunci sama → DITERIMA lalu DUPLIKAT, picking hanya satu", async () => {
      const { inv, idempotensi } = buat();
      expect(await inv.kirimPermintaanPicking(picking())).toEqual({
        grupId: "grup-1",
        status: "DITERIMA",
        referensiSumber: null,
      });
      // Urutan baris berbeda = isi sama (payload kanonik diurutkan anggotaId, skuId).
      const dibalik = picking();
      dibalik.baris.reverse();
      expect((await inv.kirimPermintaanPicking(dibalik)).status).toBe("DUPLIKAT");
      expect(idempotensi.jumlah("picking")).toBe(1);
    });

    it("(6) kunci sama, isi beda → KONFLIK_IDEMPOTENSI", async () => {
      const { inv } = buat();
      await inv.kirimPermintaanPicking(picking());
      const ubah = picking({
        baris: [
          {
            anggotaId: "ang-1",
            skuId: SKU_A,
            qty: 9,
            caraKirim: "DROP_POINT",
            dropPointId: "dp-1",
          },
        ],
      });
      expect((await galat(inv.kirimPermintaanPicking(ubah))).kode).toBe("KONFLIK_IDEMPOTENSI");
    });

    it("(8, 13) data pribadi / pesananId ditolak skema", async () => {
      const { inv } = buat();
      const tambahan = [
        { nama: "Bu Sari" },
        { nomorHp: "+6281200000000" },
        { alamat: "Jl. Mawar 1" },
        { pesananId: "p-1" },
      ];
      for (const t of tambahan) {
        const p = picking();
        const barisPii = { ...p, baris: p.baris.map((b) => ({ ...b, ...t })) };
        expect(permintaanPickingSchema.safeParse(barisPii).success).toBe(false);
        expect(permintaanPickingSchema.safeParse({ ...p, ...t }).success).toBe(false);
        const e = await galat(inv.kirimPermintaanPicking(barisPii));
        expect(e.kode).toBe("DATA_TIDAK_VALID");
      }
    });
  });
});
