// Tes kontrak T-009 §10 untuk GudangApiInventory terhadap mock server Gudang (T-019).
// Angka contoh fiktif. Mock memakai http://127.0.0.1 (izinkanHttpLokalUntukTes); produksi wajib https.
import type { PemetaanSumberInventori } from "@nekat/domain";
import { InventoryError, permintaanPickingSchema, type PermintaanPicking } from "@nekat/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GudangApiInventory, kaliSeribuEksak } from "./gudang-api-inventory.js";
import {
  bacaRetryAfter,
  jedaBackoff,
  KlienGudang,
  PROFIL_GUDANG,
  urlDasarGudang,
} from "./http-gudang.js";
import { PenyimpanIdempotensiMemori } from "./idempotensi-memori.js";
import type { PeristiwaInventori } from "./local-inventory.js";
import { mulaiMockGudang, type MockGudang } from "./mock-gudang.test-util.js";

const SKU_A = "0190a000-0000-7000-8000-00000000000a";
const SKU_B = "0190a000-0000-7000-8000-00000000000b";
const SKU_KG = "0190a000-0000-7000-8000-00000000000c";
const SKU_ROKOK = "0190a000-0000-7000-8000-0000000000cc";
const SKU_TAK_DIKENAL = "0190a000-0000-7000-8000-0000000000ff";
const LOKASI_1 = "0190b000-0000-7000-8000-000000000001";
const LOKASI_2 = "0190b000-0000-7000-8000-000000000002";
const GRUP = "0190c000-0000-7000-8000-000000000001";
const ANGGOTA = "0190d000-0000-7000-8000-000000000001";
const T = "2026-11-26T04:55:00+07:00";

const PETA_SKU: Record<string, string> = {
  [SKU_A]: "G-MINYAK-1L",
  [SKU_B]: "G-GULA-1KG",
  [SKU_KG]: "G-BERAS-CURAH",
  [SKU_ROKOK]: "G-ROKOK-12",
};
const PETA_LOKASI: Record<string, string> = { [LOKASI_1]: "PUSAT", [LOKASI_2]: "CABANG-2" };

function pemetaanMemori(gagal = false): PemetaanSumberInventori & { panggilan: number } {
  const o = {
    panggilan: 0,
    skuKeSumber(ids: readonly string[]) {
      o.panggilan++;
      if (gagal) return Promise.reject(new Error("postgres://rahasia@db mati"));
      return Promise.resolve(
        new Map(ids.flatMap((id) => (PETA_SKU[id] ? [[id, PETA_SKU[id]] as const] : []))),
      );
    },
    skuDariSumber(ids: readonly string[]) {
      o.panggilan++;
      const balik = new Map(Object.entries(PETA_SKU).map(([a, b]) => [b, a]));
      return Promise.resolve(
        new Map(ids.flatMap((id) => (balik.has(id) ? [[id, balik.get(id) ?? ""] as const] : []))),
      );
    },
    lokasiKeSumber(id: string) {
      o.panggilan++;
      return Promise.resolve(PETA_LOKASI[id] ?? null);
    },
  };
  return o;
}

function skuMock(id: string, ubah: Record<string, unknown> = {}) {
  return {
    id,
    nama: `Produk ${id}`,
    kategori: "sembako",
    satuanDasar: "pcs",
    konversi: [{ satuan: "DUS", isi: 12, beratGram: 11_800 }],
    beratGram: 950,
    barcode: null,
    aktif: true,
    diubahPada: T,
    ...ubah,
  };
}

let mock: MockGudang;
let peristiwa: PeristiwaInventori[];
let jeda: number[];
let idem: PenyimpanIdempotensiMemori;

function buat(
  opsi: {
    profilBaca?: "sinkron" | "checkout";
    pemetaan?: PemetaanSumberInventori;
    token?: string;
  } = {},
) {
  return new GudangApiInventory({
    klien: {
      baseUrl: mock.url,
      ambilToken: () => opsi.token ?? mock.token,
      izinkanHttpLokalUntukTes: true,
    },
    pemetaan: opsi.pemetaan ?? pemetaanMemori(),
    idempotensi: idem,
    catat: (p) => peristiwa.push(p),
    sekarang: () => new Date("2026-11-26T05:00:00+07:00"),
    ...(opsi.profilBaca ? { profilBaca: opsi.profilBaca } : {}),
    // Backoff tanpa benar-benar menunggu; jeda dicatat untuk diperiksa.
    retry: { tidur: (ms) => (jeda.push(ms), Promise.resolve()), acak: () => 0 },
  });
}

async function galat(p: Promise<unknown>): Promise<InventoryError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof InventoryError) return e;
    throw e;
  }
  throw new Error("diharapkan gagal");
}

beforeAll(async () => {
  mock = await mulaiMockGudang();
});
afterAll(async () => {
  await mock.tutup();
});
beforeEach(() => {
  peristiwa = [];
  jeda = [];
  idem = new PenyimpanIdempotensiMemori();
  mock.gangguan.clear();
  mock.permintaan.length = 0;
  mock.picking.clear();
  mock.konfirmasi.clear();
  mock.ukuranHalamanSku = 1000;
  mock.sku = [
    skuMock("G-MINYAK-1L", { barcode: "8990000000001" }),
    skuMock("G-GULA-1KG", { aktif: false, konversi: [] }),
    skuMock("G-BERAS-CURAH", {
      satuanDasar: "kg",
      konversi: [{ satuan: "KOLI", isi: 1.005, beratGram: null }],
      beratGram: null,
    }),
    skuMock("G-ROKOK-12", { kategori: "rokok-kretek" }),
    skuMock("G-BARU-TANPA-PETA"),
  ];
  mock.stok = [
    { skuId: "G-MINYAK-1L", lokasi: "PUSAT", tersedia: 30, satuan: "pcs", dataPada: T },
    { skuId: "G-MINYAK-1L", lokasi: "CABANG-2", tersedia: 999, satuan: "pcs", dataPada: T },
    { skuId: "G-GULA-1KG", lokasi: "PUSAT", tersedia: -4, satuan: "pcs", dataPada: T },
    { skuId: "G-BERAS-CURAH", lokasi: "PUSAT", tersedia: 12.5, satuan: "kg", dataPada: T },
  ];
  mock.modal = [
    { skuId: "G-MINYAK-1L", satuan: "PCS_1", modal: 15_000, dataPada: T },
    { skuId: "G-MINYAK-1L", satuan: "DUS", modal: 170_000, dataPada: T },
    { skuId: "G-GULA-1KG", satuan: "PCS_1", modal: 0, dataPada: T },
    { skuId: "G-BERAS-CURAH", satuan: "PCS_1", modal: 12_500.5, dataPada: T },
    { skuId: "G-ROKOK-12", satuan: "PCS_1", modal: "15000", dataPada: T },
  ];
});
afterEach(() => {
  // (9) Token tidak pernah muncul di peristiwa log.
  expect(JSON.stringify(peristiwa)).not.toContain(mock.token);
});

describe("GudangApiInventory — kontrak T-009 §10", () => {
  it("nama = gudang; token dikirim lewat header Bearer saja, tidak di URL/query", async () => {
    const inv = buat();
    expect(inv.nama).toBe("gudang");
    await inv.listSku();
    const r = mock.permintaan[0];
    expect(r?.header["authorization"]).toBe(`Bearer ${mock.token}`);
    expect(JSON.stringify(r?.query)).not.toContain(mock.token);
    expect(r?.path).toBe("/v1/sku");
  });

  describe("listSku", () => {
    it("(1) lolos skema; rokok tidak muncul; SKU tanpa pemetaan dicatat dan tidak muncul", async () => {
      const hasil = await buat().listSku();
      expect(hasil.map((s) => s.skuId).sort()).toEqual([SKU_A, SKU_B, SKU_KG].sort());
      expect(peristiwa.map((p) => p.kode)).toContain("KATEGORI_TERLARANG");
      const belum = peristiwa.find((p) => p.kode === "SKU_BELUM_DIPETAKAN");
      expect(belum).toMatchObject({ skuSumberId: "G-BARU-TANPA-PETA" });
      const a = hasil.find((s) => s.skuId === SKU_A);
      expect(a).toMatchObject({
        skuSumberId: "G-MINYAK-1L",
        satuanDasar: "pcs",
        konversiSatuan: [{ satuan: "DUS", isi: 12, beratGram: 11_800 }],
        barcode: "8990000000001",
        aktifDiSumber: true,
      });
    });

    it("kg → gram ×1000 tanpa pembulatan (1,005 kg = 1005 g); pecahan gram ditolak", async () => {
      let hasil = await buat().listSku();
      expect(hasil.find((s) => s.skuId === SKU_KG)).toMatchObject({
        satuanDasar: "gram",
        konversiSatuan: [{ satuan: "KOLI", isi: 1005 }],
      });
      mock.sku = [
        skuMock("G-BERAS-CURAH", {
          satuanDasar: "kg",
          konversi: [{ satuan: "KOLI", isi: 0.0005, beratGram: null }],
        }),
      ];
      hasil = await buat().listSku();
      expect(hasil).toEqual([]);
      expect(peristiwa.some((p) => p.kode === "BARIS_TIDAK_VALID" && p.skuId === SKU_KG)).toBe(
        true,
      );
    });

    it("inkremental: `sejak` diteruskan; SKU pindah ke kategori terlarang dikirim aktifDiSumber=false", async () => {
      const hasil = await buat().listSku(new Date("2026-11-25T00:00:00Z"));
      expect(mock.permintaan[0]?.query["sejak"]).toBe("2026-11-25T00:00:00.000Z");
      expect(hasil.find((s) => s.skuId === SKU_ROKOK)?.aktifDiSumber).toBe(false);
    });

    it("mengikuti kursor halaman", async () => {
      mock.ukuranHalamanSku = 2;
      const hasil = await buat().listSku();
      expect(mock.permintaan.length).toBe(3);
      expect(hasil).toHaveLength(3);
    });

    it("batas total baris lintas halaman → DATA_TIDAK_VALID", async () => {
      mock.ukuranHalamanSku = 2;
      const terbatas = new GudangApiInventory({
        klien: { baseUrl: mock.url, ambilToken: () => mock.token, izinkanHttpLokalUntukTes: true },
        pemetaan: pemetaanMemori(),
        idempotensi: idem,
        maksBarisSku: 3,
      });
      expect((await galat(terbatas.listSku())).kode).toBe("DATA_TIDAK_VALID");
    });

    it("baris kawat tidak valid diabaikan & dicatat tanpa nilai mentah", async () => {
      mock.sku = [
        skuMock("G-MINYAK-1L", { nama: 123, rahasia: "isi-mentah-xyz" }),
        skuMock("G-GULA-1KG"),
      ];
      const hasil = await buat().listSku();
      expect(hasil.map((s) => s.skuId)).toEqual([SKU_B]);
      expect(peristiwa.find((p) => p.kode === "BARIS_TIDAK_VALID")?.keterangan).toContain("nama");
      expect(JSON.stringify(peristiwa)).not.toContain("isi-mentah-xyz");
    });
  });

  describe("getStok", () => {
    it("(11) memakai lokasiId; stok cabang lain tidak dipakai; ID sumber dipetakan balik", async () => {
      const hasil = await buat().getStok([SKU_A], LOKASI_1);
      expect(hasil).toEqual([{ skuId: SKU_A, lokasiId: LOKASI_1, tersedia: 30, dataPada: T }]);
      expect(mock.permintaan[0]?.body).toEqual({ lokasi: "PUSAT", skuIds: ["G-MINYAK-1L"] });
      expect((await buat().getStok([SKU_A], LOKASI_2))[0]?.tersedia).toBe(999);
    });

    it("(3) SKU / lokasi tak dikenal tidak muncul dan tidak melempar", async () => {
      expect(await buat().getStok([SKU_TAK_DIKENAL], LOKASI_1)).toEqual([]);
      expect(await buat().getStok([SKU_A], "lokasi-lain")).toEqual([]);
      // Tanpa SKU terpetakan: tidak memanggil Gudang sama sekali.
      expect(mock.permintaan).toHaveLength(0);
    });

    it("stok negatif → 0 dan dicatat; kg → gram tanpa pembulatan", async () => {
      const hasil = await buat().getStok([SKU_B, SKU_KG], LOKASI_1);
      expect(hasil.find((s) => s.skuId === SKU_B)?.tersedia).toBe(0);
      expect(hasil.find((s) => s.skuId === SKU_KG)?.tersedia).toBe(12_500);
      expect(peristiwa.some((p) => p.kode === "STOK_NEGATIF")).toBe(true);
    });

    it("lebih dari 200 SKU per panggilan ditolak (pemanggil memecah batch)", async () => {
      const ids = Array.from({ length: 201 }, (_, i) => `sku-${i}`);
      await expect(buat().getStok(ids, LOKASI_1)).rejects.toThrow(RangeError);
    });

    it("pemetaan DB gagal → SUMBER_TIDAK_TERJANGKAU tanpa bocor detail", async () => {
      const e = await galat(buat({ pemetaan: pemetaanMemori(true) }).getStok([SKU_A], LOKASI_1));
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(e.message).not.toContain("rahasia");
    });
  });

  describe("getHargaModal", () => {
    it("(2, 12) modal per satuan jual apa adanya (bukan karton dibagi); ≤ 0 → null, bukan 0", async () => {
      const hasil = await buat().getHargaModal([SKU_A, SKU_B]);
      expect(hasil).toEqual(
        expect.arrayContaining([
          { skuId: SKU_A, satuan: "PCS_1", modalPerSatuan: 15_000, dataPada: T },
          { skuId: SKU_A, satuan: "DUS", modalPerSatuan: 170_000, dataPada: T },
          { skuId: SKU_B, satuan: "PCS_1", modalPerSatuan: null, dataPada: T },
        ]),
      );
      expect(hasil).toHaveLength(3);
    });

    it("(10) modal pecahan tidak dibulatkan: null + MODAL_PECAHAN dengan nilai mentah (antrean tinjau)", async () => {
      const hasil = await buat().getHargaModal([SKU_KG]);
      expect(hasil).toEqual([
        { skuId: SKU_KG, satuan: "PCS_1", modalPerSatuan: null, dataPada: T },
      ]);
      expect(peristiwa).toContainEqual(
        expect.objectContaining({
          kode: "MODAL_PECAHAN",
          skuId: SKU_KG,
          satuan: "PCS_1",
          nilaiMentah: "12500.5",
        }),
      );
    });

    it("(10) modal bukan angka → null (tidak tayang), tidak dikonversi dari teks", async () => {
      const hasil = await buat().getHargaModal([SKU_ROKOK]);
      expect(hasil[0]?.modalPerSatuan).toBeNull();
      expect(peristiwa.some((p) => p.kode === "MODAL_TIDAK_VALID")).toBe(true);
    });
  });

  describe("konfirmasiStok", () => {
    const req = {
      grupId: GRUP,
      skuId: SKU_A,
      lokasiId: LOKASI_1,
      qtyDibutuhkan: 50,
      kunciIdempotensi: `konfirmasi:${GRUP}:v1`,
    };

    it("stok Gudang dibatasi qty dibutuhkan; Idempotency-Key dikirim", async () => {
      const hasil = await buat().konfirmasiStok(req);
      expect(hasil).toEqual({
        grupId: GRUP,
        skuId: SKU_A,
        qtyTersedia: 30,
        dataPada: expect.any(String) as string,
      });
      expect(mock.permintaan[0]?.header["idempotency-key"]).toBe(req.kunciIdempotensi);
    });

    it("(4) dua kali kunci sama → hasil sama, Gudang hanya dipanggil sekali", async () => {
      const inv = buat();
      const a = await inv.konfirmasiStok(req);
      mock.stok = [];
      const b = await inv.konfirmasiStok(req);
      expect(b).toEqual(a);
      expect(mock.permintaan.filter((p) => p.path === "/v1/stok/konfirmasi")).toHaveLength(1);
    });

    it("(6) kunci sama, isi beda → KONFLIK_IDEMPOTENSI", async () => {
      const inv = buat();
      await inv.konfirmasiStok(req);
      expect((await galat(inv.konfirmasiStok({ ...req, qtyDibutuhkan: 7 }))).kode).toBe(
        "KONFLIK_IDEMPOTENSI",
      );
    });

    it("Gudang 409 (kunci dipakai isi lain di sisi Gudang) → KONFLIK_IDEMPOTENSI", async () => {
      mock.gangguan.set("/v1/stok/konfirmasi", { status: 409 });
      expect((await galat(buat().konfirmasiStok(req))).kode).toBe("KONFLIK_IDEMPOTENSI");
    });

    it("SKU tak dikenal → qtyTersedia 0 tanpa memanggil Gudang", async () => {
      const hasil = await buat().konfirmasiStok({ ...req, skuId: SKU_TAK_DIKENAL });
      expect(hasil.qtyTersedia).toBe(0);
      expect(mock.permintaan).toHaveLength(0);
    });

    it("5× retry dengan backoff hingga 60 dtk, lalu menyerah (grup DITAHAN oleh pemanggil)", async () => {
      mock.gangguan.set("/v1/stok/konfirmasi", { status: 503 });
      const e = await galat(buat().konfirmasiStok(req));
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(mock.permintaan).toHaveLength(6);
      expect(jeda).toEqual([2_000, 4_000, 8_000, 16_000, 32_000]);
      // Gagal → tidak ada hasil tersimpan di kunci idempotensi (boleh dicoba lagi nanti).
      expect(idem.jumlah("konfirmasi")).toBe(0);
    });

    it("pulih setelah gangguan sementara", async () => {
      mock.gangguan.set("/v1/stok/konfirmasi", { status: 502, kali: 2 });
      expect((await buat().konfirmasiStok(req)).qtyTersedia).toBe(30);
      expect(jeda).toHaveLength(2);
    });

    it("permintaan tidak valid → DATA_TIDAK_VALID", async () => {
      expect(
        (await galat(buat().konfirmasiStok({ ...req, kunciIdempotensi: "konfirmasi:lain:v1" })))
          .kode,
      ).toBe("DATA_TIDAK_VALID");
    });
  });

  describe("kirimPermintaanPicking", () => {
    const req: PermintaanPicking = {
      grupId: GRUP,
      lokasiId: LOKASI_1,
      kunciIdempotensi: `picking:${GRUP}:v1`,
      slotKirim: { tanggal: "2026-11-27", mulai: "09:00", selesai: "12:00" },
      baris: [
        { anggotaId: ANGGOTA, skuId: SKU_B, qty: 2, caraKirim: "DROP_POINT", dropPointId: "dp-1" },
        { anggotaId: ANGGOTA, skuId: SKU_A, qty: 3, caraKirim: "DROP_POINT", dropPointId: "dp-1" },
      ],
    };

    const BARIS_1 =
      req.baris[0] ??
      (() => {
        throw new Error("fixture");
      })();

    it("(5) dua kali kunci sama → DITERIMA lalu DUPLIKAT, picking di Gudang hanya satu", async () => {
      const inv = buat();
      const a = await inv.kirimPermintaanPicking(req);
      const b = await inv.kirimPermintaanPicking({ ...req, baris: [...req.baris].reverse() });
      expect(a).toEqual({
        grupId: GRUP,
        status: "DITERIMA",
        referensiSumber: expect.stringMatching(/^PK-\d{5}$/) as string,
      });
      expect(b).toEqual({ grupId: GRUP, status: "DUPLIKAT", referensiSumber: a.referensiSumber });
      expect(mock.picking.size).toBe(1);
      // I-02: kiriman kedua dicek di NEKAT dulu, tidak dikirim ulang.
      expect(mock.permintaan.filter((p) => p.path === "/v1/picking")).toHaveLength(1);
      expect(mock.permintaan[0]?.header["idempotency-key"]).toBe(req.kunciIdempotensi);
    });

    it("hasil lokal hilang (crash setelah kirim) → Gudang DUPLIKAT, referensi sama, picking tetap satu", async () => {
      const a = await buat().kirimPermintaanPicking(req);
      idem = new PenyimpanIdempotensiMemori();
      const b = await buat().kirimPermintaanPicking(req);
      expect(b).toEqual({ grupId: GRUP, status: "DUPLIKAT", referensiSumber: a.referensiSumber });
      expect(mock.picking.size).toBe(1);
    });

    it("(6) kunci sama, isi beda → KONFLIK_IDEMPOTENSI", async () => {
      const inv = buat();
      await inv.kirimPermintaanPicking(req);
      const e = await galat(
        inv.kirimPermintaanPicking({ ...req, baris: [{ ...BARIS_1, qty: 9 }] }),
      );
      expect(e.kode).toBe("KONFLIK_IDEMPOTENSI");
    });

    it("(8, 13) body ke Gudang hanya barang/qty/slot/drop point: tanpa data pribadi & pesananId", async () => {
      await buat().kirimPermintaanPicking(req);
      const body = mock.permintaan[0]?.body as { baris: Record<string, unknown>[] };
      expect(Object.keys(body).sort()).toEqual(["baris", "grupId", "lokasi", "slotKirim"]);
      for (const b of body.baris) {
        expect(Object.keys(b).sort()).toEqual([
          "anggotaId",
          "caraKirim",
          "dropPointId",
          "qty",
          "skuId",
        ]);
      }
      expect(body.baris.map((b) => b["skuId"])).toEqual(["G-MINYAK-1L", "G-GULA-1KG"]);
      for (const ekstra of [
        { nama: "Bu Sari" },
        { nomorHp: "+6281200000000" },
        { alamat: "Jl. X" },
        { pesananId: "p" },
      ]) {
        const kotor = { ...req, baris: [{ ...BARIS_1, ...ekstra }] };
        expect(permintaanPickingSchema.safeParse(kotor).success).toBe(false);
        expect((await galat(buat().kirimPermintaanPicking(kotor as PermintaanPicking))).kode).toBe(
          "DATA_TIDAK_VALID",
        );
      }
    });

    it("SKU belum dipetakan → DATA_TIDAK_VALID sebelum mengirim", async () => {
      const e = await galat(
        buat().kirimPermintaanPicking({
          ...req,
          baris: [{ ...BARIS_1, skuId: SKU_TAK_DIKENAL }],
        }),
      );
      expect(e.kode).toBe("DATA_TIDAK_VALID");
      expect(mock.permintaan).toHaveLength(0);
    });

    it("adapter tidak retry picking (retry berjenjang milik worker outbox)", async () => {
      mock.gangguan.set("/v1/picking", { status: 503 });
      const e = await galat(buat().kirimPermintaanPicking(req));
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(e.bolehRetry).toBe(true);
      expect(mock.permintaan).toHaveLength(1);
      expect(idem.jumlah("picking")).toBe(0);
    });
  });

  describe("(7, 9) galat transport", () => {
    it("timeout → SUMBER_TIDAK_TERJANGKAU (profil checkout 2 dtk, tanpa retry)", async () => {
      mock.gangguan.set("/v1/stok/cari", { tundaMs: 2_500 });
      const mulai = Date.now();
      const e = await galat(buat({ profilBaca: "checkout" }).getStok([SKU_A], LOKASI_1));
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(Date.now() - mulai).toBeLessThan(2_400);
      expect(mock.permintaan).toHaveLength(1);
    });

    it("429 → DIBATASI mengikuti Retry-After (maks. 60 dtk)", async () => {
      mock.gangguan.set("/v1/modal/cari", { status: 429, retryAfter: "120" });
      const e = await galat(buat().getHargaModal([SKU_A]));
      expect(e.kode).toBe("DIBATASI");
      expect(e.retrySetelahDetik).toBe(60);
      // Profil sinkron: 3× ulang, tiap jeda = Retry-After (dibatasi 60 dtk).
      expect(jeda).toEqual([60_000, 60_000, 60_000]);
    });

    it("401/403 → DITOLAK tanpa retry", async () => {
      const e = await galat(buat({ token: "token-salah" }).listSku());
      expect(e.kode).toBe("DITOLAK");
      expect(e.bolehRetry).toBe(false);
      expect(mock.permintaan).toHaveLength(1);
      mock.gangguan.set("/v1/sku", { status: 403 });
      expect((await galat(buat().listSku())).kode).toBe("DITOLAK");
    });

    it("5xx diulang 3× dengan backoff 2–8 dtk + jitter (profil sinkron)", async () => {
      mock.gangguan.set("/v1/sku", { status: 500 });
      const e = await galat(buat().listSku());
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(jeda).toEqual([2_000, 4_000, 8_000]);
      expect(peristiwa.filter((p) => p.kode === "PANGGILAN_DIULANG")).toHaveLength(3);
    });

    it("redirect 3xx tidak diikuti → SUMBER_TIDAK_TERJANGKAU; token tidak terkirim ke host lain", async () => {
      mock.gangguan.set("/v1/sku", { redirect: true });
      const e = await galat(buat().listSku());
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(e.message).toContain("redirect");
      expect(mock.permintaan.every((p) => p.path === "/v1/sku")).toBe(true);
    });

    it("respons > batas ukuran → DATA_TIDAK_VALID (dengan & tanpa content-length)", async () => {
      const kecil = new GudangApiInventory({
        klien: {
          baseUrl: mock.url,
          ambilToken: () => mock.token,
          izinkanHttpLokalUntukTes: true,
          batasResponsByte: 1_000,
        },
        pemetaan: pemetaanMemori(),
        idempotensi: idem,
      });
      mock.gangguan.set("/v1/sku", { besarByte: 5_000 });
      expect((await galat(kecil.listSku())).kode).toBe("DATA_TIDAK_VALID");
      mock.gangguan.set("/v1/sku", { besarByte: 5_000, tanpaPanjang: true });
      expect((await galat(kecil.listSku())).kode).toBe("DATA_TIDAK_VALID");
    });

    it("bukan JSON / amplop salah → DATA_TIDAK_VALID tanpa retry", async () => {
      mock.gangguan.set("/v1/sku", { bukanJson: true });
      expect((await galat(buat().listSku())).kode).toBe("DATA_TIDAK_VALID");
      mock.gangguan.set("/v1/sku", { body: { daftar: [] } });
      expect((await galat(buat().listSku())).kode).toBe("DATA_TIDAK_VALID");
      expect(jeda).toEqual([]);
    });

    it("koneksi ditolak → SUMBER_TIDAK_TERJANGKAU; pesan tanpa URL & token", async () => {
      const mati = new GudangApiInventory({
        klien: {
          baseUrl: "http://127.0.0.1:1/api",
          ambilToken: () => mock.token,
          izinkanHttpLokalUntukTes: true,
        },
        pemetaan: pemetaanMemori(),
        idempotensi: idem,
        retry: { tidur: () => Promise.resolve() },
      });
      const e = await galat(mati.listSku());
      expect(e.kode).toBe("SUMBER_TIDAK_TERJANGKAU");
      expect(`${e.message} ${String(e.cause)}`).not.toContain("127.0.0.1");
      expect(e.message).not.toContain(mock.token);
    });
  });
});

describe("klien & aturan bantu", () => {
  it("base URL wajib https tanpa kredensial; http hanya untuk mock lokal di tes", () => {
    expect(() => urlDasarGudang("http://gudang.contoh.id/api")).toThrow(/https/);
    expect(() => urlDasarGudang("https://u:p@gudang.contoh.id/api")).toThrow(/kredensial/);
    expect(() => urlDasarGudang("http://gudang.contoh.id/api", true)).toThrow(/https/);
    expect(urlDasarGudang("http://127.0.0.1:9/api", true).href).toBe("http://127.0.0.1:9/api/");
    expect(urlDasarGudang("https://gudang.contoh.id/api").href).toBe(
      "https://gudang.contoh.id/api/",
    );
    expect(() => new KlienGudang({ baseUrl: "bukan url", ambilToken: () => "x" })).toThrow(
      "GUDANG_API_URL tidak valid",
    );
  });

  it("Retry-After: detik / HTTP-date, dibatasi 0–60", () => {
    expect(bacaRetryAfter("5")).toBe(5);
    expect(bacaRetryAfter("600")).toBe(60);
    expect(bacaRetryAfter(new Date(10_000 + 30_000).toUTCString(), 10_000)).toBe(30);
    expect(bacaRetryAfter("besok")).toBeNull();
    expect(bacaRetryAfter(null)).toBeNull();
  });

  it("backoff eksponensial dibatasi maks + jitter", () => {
    const e = new InventoryError("SUMBER_TIDAK_TERJANGKAU", "x");
    expect([1, 2, 3, 4].map((n) => jedaBackoff(n, PROFIL_GUDANG.sinkron, e, () => 0))).toEqual([
      2_000, 4_000, 8_000, 8_000,
    ]);
    expect(jedaBackoff(1, PROFIL_GUDANG.sinkron, e, () => 0.999)).toBe(2_999);
    expect(jedaBackoff(7, PROFIL_GUDANG.konfirmasi, e, () => 0)).toBe(60_000);
  });

  it("kaliSeribuEksak tanpa pembulatan", () => {
    expect(kaliSeribuEksak(1.005)).toBe(1005);
    expect(kaliSeribuEksak(12.5)).toBe(12_500);
    expect(kaliSeribuEksak(3)).toBe(3_000);
    expect(kaliSeribuEksak(0.0005)).toBeNull();
    expect(kaliSeribuEksak(1e-7)).toBeNull();
  });
});
