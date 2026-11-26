// `GudangApiInventory` (T-019, T-009 §9, keputusan.md #8): sumber = API Gudang-Repo.
//
// - Anti-corruption layer: format kawat Gudang dipetakan ke tipe NEKAT (`SkuSumber`, `StokSumber`, …).
//   Format kawat = DEFAULT SEMENTARA (I-01: spesifikasi API Gudang belum ada); lihat T-009 §12.
// - Adapter TIDAK menulis snapshot/harga ke DB NEKAT (T-009 §3). Penulisan snapshot = job sinkron worker.
// - Modal dari Gudang hanya diteruskan sebagai modal per satuan jual (K-01): tidak dibulatkan (H6),
//   tidak dibagi dari karton, tidak menghitung/mengisi harga jual atau margin.
// - Idempotensi konfirmasi stok & picking: kunci NEKAT dikirim sebagai header `Idempotency-Key` DAN
//   hasil disimpan di penyimpan idempotensi NEKAT; NEKAT cek dulu sebelum mengirim ulang (I-02).
import {
  KATA_KATEGORI_TERLARANG,
  kodeKategoriTerlarang,
  type InventorySource,
  type PemetaanSumberInventori,
  type PenyimpanIdempotensi,
  type SkuId,
} from "@nekat/domain";
import {
  BATAS_SKU_PER_PANGGILAN,
  InventoryError,
  isRupiah,
  konfirmasiStokSchema,
  modalSumberSchema,
  permintaanPickingSchema,
  SATUAN_JUAL_INVENTORY,
  skuSumberSchema,
  stokSumberSchema,
  stokTerkonfirmasiSchema,
  type HasilPicking,
  type KonfirmasiStok,
  type ModalSumber,
  type PermintaanPicking,
  type SkuSumber,
  type StokSumber,
  type StokTerkonfirmasi,
} from "@nekat/shared";
import { z } from "zod";
import {
  denganRetry,
  KlienGudang,
  PROFIL_GUDANG,
  type JenisProfilBaca,
  type OpsiKlienGudang,
  type OpsiRetry,
  type PermintaanHttp,
  type ProfilPanggilan,
} from "./http-gudang.js";
import { hashKanonik } from "./kanonik.js";
import type { PeristiwaInventori } from "./local-inventory.js";

export interface OpsiGudangApiInventory {
  readonly klien: OpsiKlienGudang;
  readonly pemetaan: PemetaanSumberInventori;
  readonly idempotensi: PenyimpanIdempotensi;
  /**
   * Profil `getStok`/`getHargaModal` (T-009 §5): `sinkron` (job, bawaan) atau `checkout`
   * (2 dtk, tanpa retry → tahan checkout, H14). `listSku` selalu `sinkron`.
   */
  readonly profilBaca?: JenisProfilBaca;
  readonly catat?: (p: PeristiwaInventori) => void;
  readonly sekarang?: () => Date;
  readonly kataKategoriTerlarang?: readonly string[];
  /** Untuk tes: tidur/acak pengganti agar backoff tidak benar-benar menunggu. */
  readonly retry?: Omit<OpsiRetry, "saatUlang">;
  /** Batas halaman `listSku` (kursor). Bawaan 200. */
  readonly maksHalamanSku?: number;
  /** Batas total baris `listSku` lintas halaman (melindungi memori). Bawaan 100.000. */
  readonly maksBarisSku?: number;
}

// ---- Format kawat Gudang (DEFAULT SEMENTARA, I-01). Field tambahan dari Gudang diabaikan. ----

const waktu = z.iso.datetime({ offset: true });
const idSumber = z.string().min(1).max(100);
const SATUAN_SUMBER = ["pcs", "gram", "ml", "kg", "liter"] as const;
type SatuanSumber = (typeof SATUAN_SUMBER)[number];

const amplopSchema = z.object({
  data: z.array(z.unknown()),
  berikutnya: z.string().min(1).max(500).nullable().optional(),
});

const skuKawatSchema = z.object({
  id: idSumber,
  nama: z.string(),
  kategori: z.string(),
  satuanDasar: z.enum(SATUAN_SUMBER),
  konversi: z
    .array(z.object({ satuan: z.string(), isi: z.number(), beratGram: z.number().nullable() }))
    .default([]),
  beratGram: z.number().nullable(),
  barcode: z.string().nullable(),
  aktif: z.boolean(),
  diubahPada: waktu,
});

const stokKawatSchema = z.object({
  skuId: idSumber,
  lokasi: idSumber,
  tersedia: z.number(),
  satuan: z.enum(SATUAN_SUMBER),
  dataPada: waktu,
});

const modalKawatSchema = z.object({
  skuId: idSumber,
  satuan: z.enum(SATUAN_JUAL_INVENTORY),
  modal: z.unknown(),
  dataPada: waktu,
});

const konfirmasiKawatSchema = z.object({
  qtyTersedia: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  dataPada: waktu,
});

const pickingKawatSchema = z.object({
  status: z.enum(["DITERIMA", "DUPLIKAT"]),
  referensi: z.string().min(1).max(100).nullable(),
});

const PESAN_PEMETAAN = "Pemetaan SKU/lokasi Gudang tidak bisa dibaca";

export class GudangApiInventory implements InventorySource {
  readonly nama = "gudang" as const;
  readonly #klien: KlienGudang;
  readonly #pemetaan: PemetaanSumberInventori;
  readonly #idempotensi: PenyimpanIdempotensi;
  readonly #profilBaca: ProfilPanggilan;
  readonly #catat: (p: PeristiwaInventori) => void;
  readonly #sekarang: () => Date;
  readonly #kataTerlarang: readonly string[];
  readonly #retry: OpsiRetry;
  readonly #maksHalaman: number;
  readonly #maksBaris: number;

  constructor(opsi: OpsiGudangApiInventory) {
    this.#klien = new KlienGudang(opsi.klien);
    this.#pemetaan = opsi.pemetaan;
    this.#idempotensi = opsi.idempotensi;
    this.#profilBaca = PROFIL_GUDANG[opsi.profilBaca ?? "sinkron"];
    this.#catat = opsi.catat ?? (() => undefined);
    this.#sekarang = opsi.sekarang ?? (() => new Date());
    this.#kataTerlarang = opsi.kataKategoriTerlarang ?? KATA_KATEGORI_TERLARANG;
    this.#retry = {
      ...opsi.retry,
      saatUlang: ({ percobaan, kode, jedaMs }) => {
        this.#catat({
          kode: "PANGGILAN_DIULANG",
          skuId: "",
          keterangan: `percobaan ulang ke-${percobaan} setelah ${kode}, jeda ${jedaMs} ms`,
        });
      },
    };
    this.#maksHalaman = opsi.maksHalamanSku ?? 200;
    this.#maksBaris = opsi.maksBarisSku ?? 100_000;
  }

  async listSku(sejak?: Date): Promise<SkuSumber[]> {
    const mentah: unknown[] = [];
    let kursor: string | null = null;
    for (let halaman = 0; ; halaman++) {
      if (halaman >= this.#maksHalaman) {
        throw new InventoryError("DATA_TIDAK_VALID", "Daftar SKU Gudang melebihi batas halaman");
      }
      const query: Record<string, string> = {};
      if (sejak !== undefined) query["sejak"] = sejak.toISOString();
      if (kursor !== null) query["kursor"] = kursor;
      const amplop = await this.#ambilAmplop(
        { metode: "GET", path: "v1/sku", query, timeoutMs: PROFIL_GUDANG.sinkron.timeoutMs },
        PROFIL_GUDANG.sinkron,
      );
      if (mentah.length + amplop.data.length > this.#maksBaris) {
        throw new InventoryError("DATA_TIDAK_VALID", "Daftar SKU Gudang melebihi batas baris");
      }
      mentah.push(...amplop.data);
      kursor = amplop.berikutnya ?? null;
      if (kursor === null) break;
    }

    const baris: z.infer<typeof skuKawatSchema>[] = [];
    for (const m of mentah) {
      const cek = skuKawatSchema.safeParse(m);
      if (cek.success) baris.push(cek.data);
      else this.#catatTidakValid("", cek.error.issues, idDari(m));
    }
    const peta = await this.#petakan(() =>
      this.#pemetaan.skuDariSumber([...new Set(baris.map((b) => b.id))]),
    );

    const hasil: SkuSumber[] = [];
    const sudah = new Set<string>();
    for (const b of baris) {
      const skuId = peta.get(b.id);
      if (skuId === undefined) {
        this.#catat({
          kode: "SKU_BELUM_DIPETAKAN",
          skuId: "",
          skuSumberId: b.id,
          namaSumber: b.nama.slice(0, 200),
          keterangan: "SKU Gudang belum dipetakan ke SKU NEKAT: tidak tayang",
        });
        continue;
      }
      if (sudah.has(skuId)) {
        this.#catat({ kode: "BARIS_TIDAK_VALID", skuId, keterangan: "SKU ganda di respons" });
        continue;
      }
      sudah.add(skuId);
      const terlarang = kodeKategoriTerlarang(b.kategori, this.#kataTerlarang);
      if (terlarang) {
        this.#catat({
          kode: "KATEGORI_TERLARANG",
          skuId,
          keterangan: "kategori rokok/bir tidak diimpor di Fase 1",
        });
        // Sama dengan LocalInventory (T-009 §7): penuh → tidak muncul; inkremental → nonaktif.
        if (sejak === undefined) continue;
      }
      const sku = keSkuSumber(b, skuId);
      const cek = skuSumberSchema.safeParse(
        sku === null ? null : terlarang ? { ...sku, aktifDiSumber: false } : sku,
      );
      if (!cek.success) {
        this.#catatTidakValid(skuId, cek.error.issues);
        continue;
      }
      hasil.push(cek.data);
    }
    return hasil;
  }

  async getStok(skuIds: readonly SkuId[], lokasiId: string): Promise<StokSumber[]> {
    const ids = saringId(skuIds);
    if (ids.length === 0) return [];
    const [lokasi, peta] = await this.#petakan(() =>
      Promise.all([this.#pemetaan.lokasiKeSumber(lokasiId), this.#pemetaan.skuKeSumber(ids)]),
    );
    // Lokasi/SKU tak dikenal: tidak muncul di hasil, tanpa error (T-009 §3).
    if (lokasi === null || peta.size === 0) return [];
    const balik = balikPeta(peta);
    const amplop = await this.#ambilAmplop(
      {
        metode: "POST",
        path: "v1/stok/cari",
        body: { lokasi, skuIds: [...balik.keys()] },
        timeoutMs: this.#profilBaca.timeoutMs,
      },
      this.#profilBaca,
    );

    const hasil: StokSumber[] = [];
    const sudah = new Set<string>();
    for (const m of amplop.data) {
      const cek = stokKawatSchema.safeParse(m);
      if (!cek.success) {
        this.#catatTidakValid(balik.get(idDari(m) ?? "") ?? "", cek.error.issues);
        continue;
      }
      const b = cek.data;
      const skuId = balik.get(b.skuId);
      // Hanya stok cabang yang diminta (F-20) dan SKU yang diminta.
      if (skuId === undefined || b.lokasi !== lokasi || sudah.has(skuId)) continue;
      let tersedia: number | null = b.tersedia;
      if (tersedia < 0) {
        this.#catat({ kode: "STOK_NEGATIF", skuId, keterangan: "stok negatif dianggap 0" });
        tersedia = 0;
      }
      tersedia = keSatuanDasar(tersedia, b.satuan);
      const s = stokSumberSchema.safeParse({ skuId, lokasiId, tersedia, dataPada: b.dataPada });
      if (!s.success) {
        this.#catatTidakValid(skuId, s.error.issues);
        continue;
      }
      sudah.add(skuId);
      hasil.push(s.data);
    }
    return hasil;
  }

  async getHargaModal(skuIds: readonly SkuId[]): Promise<ModalSumber[]> {
    const ids = saringId(skuIds);
    if (ids.length === 0) return [];
    const peta = await this.#petakan(() => this.#pemetaan.skuKeSumber(ids));
    if (peta.size === 0) return [];
    const balik = balikPeta(peta);
    const amplop = await this.#ambilAmplop(
      {
        metode: "POST",
        path: "v1/modal/cari",
        body: { skuIds: [...balik.keys()] },
        timeoutMs: this.#profilBaca.timeoutMs,
      },
      this.#profilBaca,
    );

    const hasil: ModalSumber[] = [];
    const sudah = new Set<string>();
    for (const m of amplop.data) {
      const cek = modalKawatSchema.safeParse(m);
      if (!cek.success) {
        // Baris modal gagal → satuan jual tidak muncul → job sinkron mengosongkan modalnya
        // (tidak tayang; snapshot modal lama TIDAK dipakai, T-009 §4).
        this.#catatTidakValid(balik.get(idDari(m) ?? "") ?? "", cek.error.issues);
        continue;
      }
      const b = cek.data;
      const skuId = balik.get(b.skuId);
      const kunci = `${b.skuId}\u0000${b.satuan}`;
      if (skuId === undefined || sudah.has(kunci)) continue;
      sudah.add(kunci);
      const modal = this.#modalValid(b.modal, skuId, b.satuan);
      const s = modalSumberSchema.safeParse({
        skuId,
        satuan: b.satuan,
        modalPerSatuan: modal,
        dataPada: b.dataPada,
      });
      if (!s.success) {
        this.#catatTidakValid(skuId, s.error.issues);
        continue;
      }
      hasil.push(s.data);
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
    const lama = await this.#idempotensi.ambil<StokTerkonfirmasi>("konfirmasi", r.kunciIdempotensi);
    if (lama !== null) {
      if (lama.hash !== hash) throw konflik();
      return lama.hasil;
    }

    const [lokasi, peta] = await this.#petakan(() =>
      Promise.all([
        this.#pemetaan.lokasiKeSumber(r.lokasiId),
        this.#pemetaan.skuKeSumber([r.skuId]),
      ]),
    );
    const skuSumber = peta.get(r.skuId);
    let hasil: StokTerkonfirmasi;
    if (lokasi === null || skuSumber === undefined) {
      // SKU/lokasi tak dikenal sumber → stok 0 (T-009 §3), sama dengan LocalInventory.
      hasil = {
        grupId: r.grupId,
        skuId: r.skuId,
        qtyTersedia: 0,
        dataPada: this.#sekarang().toISOString(),
      };
    } else {
      const res = await denganRetry(
        () =>
          this.#klien.panggil({
            metode: "POST",
            path: "v1/stok/konfirmasi",
            kunciIdempotensi: r.kunciIdempotensi,
            // DEFAULT SEMENTARA (IG-04): qty dalam satuan dasar NEKAT (pcs/gram/ml).
            body: {
              grupId: r.grupId,
              skuId: skuSumber,
              lokasi,
              qtyDibutuhkan: r.qtyDibutuhkan,
            },
            timeoutMs: PROFIL_GUDANG.konfirmasi.timeoutMs,
          }),
        PROFIL_GUDANG.konfirmasi,
        this.#retry,
      );
      const k = konfirmasiKawatSchema.safeParse(res.json);
      if (!k.success) {
        throw new InventoryError("DATA_TIDAK_VALID", "Respons konfirmasi stok Gudang tidak valid");
      }
      hasil = {
        grupId: r.grupId,
        skuId: r.skuId,
        // Bisa < qtyDibutuhkan → alokasi parsial (flow B-09); tidak pernah melebihi kebutuhan.
        qtyTersedia: Math.min(k.data.qtyTersedia, r.qtyDibutuhkan),
        dataPada: k.data.dataPada,
      };
    }
    const sah = stokTerkonfirmasiSchema.parse(hasil);
    const { entri } = await this.#idempotensi.simpanBilaBelumAda("konfirmasi", r.kunciIdempotensi, {
      hash,
      hasil: sah,
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

    // I-02: cek dulu sebelum mengirim (ulang) ke Gudang.
    const lama = await this.#idempotensi.ambil<{ referensiSumber: string | null }>(
      "picking",
      r.kunciIdempotensi,
    );
    if (lama !== null) {
      if (lama.hash !== hash) throw konflik();
      return { grupId: r.grupId, status: "DUPLIKAT", referensiSumber: lama.hasil.referensiSumber };
    }

    const skuUnik = [...new Set(baris.map((b) => b.skuId))];
    const [lokasi, peta] = await this.#petakan(() =>
      Promise.all([this.#pemetaan.lokasiKeSumber(r.lokasiId), this.#pemetaan.skuKeSumber(skuUnik)]),
    );
    if (lokasi === null || skuUnik.some((s) => !peta.has(s))) {
      throw new InventoryError(
        "DATA_TIDAK_VALID",
        "Permintaan picking memuat SKU/lokasi yang belum dipetakan ke Gudang",
      );
    }

    // Hanya barang, qty teralokasi, slot, drop point. TANPA nama, nomor HP, alamat (T-009 §2).
    const body = {
      grupId: r.grupId,
      lokasi,
      slotKirim: r.slotKirim,
      baris: baris.map((b) => ({
        anggotaId: b.anggotaId,
        skuId: peta.get(b.skuId) ?? "",
        qty: b.qty,
        caraKirim: b.caraKirim,
        dropPointId: b.dropPointId,
      })),
    };
    const res = await denganRetry(
      () =>
        this.#klien.panggil({
          metode: "POST",
          path: "v1/picking",
          kunciIdempotensi: r.kunciIdempotensi,
          body,
          timeoutMs: PROFIL_GUDANG.picking.timeoutMs,
        }),
      PROFIL_GUDANG.picking,
      this.#retry,
    );
    const p = pickingKawatSchema.safeParse(res.json);
    if (!p.success) {
      throw new InventoryError("DATA_TIDAK_VALID", "Respons picking Gudang tidak valid");
    }
    const { baru, entri } = await this.#idempotensi.simpanBilaBelumAda(
      "picking",
      r.kunciIdempotensi,
      { hash, hasil: { referensiSumber: p.data.referensi } },
    );
    if (entri.hash !== hash) throw konflik();
    return {
      grupId: r.grupId,
      status: baru && p.data.status === "DITERIMA" ? "DITERIMA" : "DUPLIKAT",
      referensiSumber: entri.hasil.referensiSumber,
    };
  }

  // ---- bantu ----

  async #ambilAmplop(
    p: PermintaanHttp,
    profil: ProfilPanggilan,
  ): Promise<z.infer<typeof amplopSchema>> {
    const res = await denganRetry(() => this.#klien.panggil(p), profil, this.#retry);
    const amplop = amplopSchema.safeParse(res.json);
    if (!amplop.success) {
      throw new InventoryError("DATA_TIDAK_VALID", "Respons Gudang tidak sesuai skema");
    }
    return amplop.data;
  }

  async #petakan<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      throw new InventoryError("SUMBER_TIDAK_TERJANGKAU", PESAN_PEMETAAN, { cause: e });
    }
  }

  /** Modal kosong / ≤ 0 / bukan angka / pecahan → null (tidak tayang), TIDAK PERNAH 0 (H6, K-01). */
  #modalValid(nilai: unknown, skuId: string, satuan: string): number | null {
    if (nilai === null) return null;
    if (typeof nilai === "number" && isRupiah(nilai) && nilai > 0) return nilai;
    const pecahan = typeof nilai === "number" && Number.isFinite(nilai) && !Number.isInteger(nilai);
    this.#catat({
      kode: pecahan && nilai > 0 ? "MODAL_PECAHAN" : "MODAL_TIDAK_VALID",
      skuId,
      satuan,
      keterangan:
        pecahan && nilai > 0
          ? `modal pecahan satuan ${satuan}: perlu ditinjau, tidak tayang`
          : `modal tidak valid satuan ${satuan}: tidak tayang`,
      ...(pecahan && nilai > 0 ? { nilaiMentah: String(nilai) } : {}),
    });
    return null;
  }

  #catatTidakValid(
    skuId: string,
    isu: readonly { path: readonly PropertyKey[] }[],
    skuSumberId?: string | null,
  ): void {
    const field = [...new Set(isu.map((i) => i.path.map(String).join(".")))].join(", ");
    this.#catat({
      kode: "BARIS_TIDAK_VALID",
      skuId,
      keterangan: `field tidak valid: ${field || "(baris)"}`,
      ...(skuSumberId ? { skuSumberId } : {}),
    });
  }
}

/** Konversi kg/liter → gram/ml (×1000) TANPA pembulatan; hasil bukan integer → null (ditolak). */
export function keSatuanDasar(nilai: number, satuan: SatuanSumber): number | null {
  if (!Number.isFinite(nilai)) return null;
  if (satuan !== "kg" && satuan !== "liter") return Number.isInteger(nilai) ? nilai : null;
  return kaliSeribuEksak(nilai);
}

/**
 * ×1000 secara eksak lewat representasi desimal terpendek (`String(x)`), bukan aritmetika float
 * (1.005 × 1000 = 1004.999… di float, padahal 1.005 kg = 1005 g persis). Lebih dari 3 desimal → null.
 */
export function kaliSeribuEksak(x: number): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(x));
  if (!m) return null;
  const pecahan = m[3] ?? "";
  if (pecahan.length > 3) return null;
  const hasil = Number(`${m[1] ?? ""}${m[2] ?? "0"}${pecahan.padEnd(3, "0")}`);
  return Number.isSafeInteger(hasil) ? hasil : null;
}

function keSkuSumber(b: z.infer<typeof skuKawatSchema>, skuId: string): SkuSumber | null {
  const kiloan = b.satuanDasar === "kg" || b.satuanDasar === "liter";
  const satuanDasar =
    b.satuanDasar === "kg" ? "gram" : b.satuanDasar === "liter" ? "ml" : b.satuanDasar;
  const konversi: SkuSumber["konversiSatuan"] = [];
  for (const k of b.konversi) {
    const isi = kiloan ? kaliSeribuEksak(k.isi) : k.isi;
    if (isi === null) return null;
    konversi.push({
      satuan: k.satuan as SkuSumber["konversiSatuan"][number]["satuan"],
      isi,
      beratGram: k.beratGram,
    });
  }
  return {
    skuId,
    skuSumberId: b.id,
    nama: b.nama,
    kategori: b.kategori,
    satuanDasar,
    konversiSatuan: konversi,
    beratGram: b.beratGram,
    barcode: b.barcode,
    aktifDiSumber: b.aktif,
    diubahPada: b.diubahPada,
  };
}

function idDari(m: unknown): string | null {
  if (typeof m !== "object" || m === null) return null;
  const o = m as Record<string, unknown>;
  const v = o["skuId"] ?? o["id"];
  return typeof v === "string" && v.length <= 100 ? v : null;
}

function balikPeta(peta: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...peta].map(([nekat, sumber]) => [sumber, nekat]));
}

/** Batas 200 per panggilan (T-009 §3). ID dipakai persis seperti diminta, tanpa normalisasi. */
function saringId(skuIds: readonly string[]): string[] {
  if (skuIds.length > BATAS_SKU_PER_PANGGILAN) {
    throw new RangeError(
      `skuIds maksimal ${BATAS_SKU_PER_PANGGILAN} per panggilan; pecah dengan pecahBatch`,
    );
  }
  return [...new Set(skuIds)];
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
