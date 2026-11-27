// Klien API katalog pembeli (apps/api/src/katalog/rute.ts, T-025). Tipe di sini mengikuti skema
// respons NYATA API; tidak ada field karangan. Field yang diusulkan T-008 tetapi belum ada di API
// (slug, foto.alt, keteranganHarga, hargaCoret, teksStatus, promoPerProduk, stok TERBATAS/sisa,
// KonteksBelanja) sengaja TIDAK dipakai; tampilan aman tanpa field itu.
//
// Respons divalidasi ringan di klien: kartu yang tidak lolos (mis. harga bukan integer, kode satuan
// di luar P-03) DIBUANG dan dicatat tanpa data pribadi (T-008 R5, TC-UI-09, TC-UI-28).
import { isRupiah, STATUS_STOK_TAMPIL, type StatusStok } from "@nekat/shared";
import { minta } from "../api/klien";
import { isKodeSatuan, type HargaKatalog, type KodeSatuan } from "../harga/format";

/** Batas API (rute.ts): q 2–100 karakter, perHalaman ≤ 50. */
export const PANJANG_CARI_MIN = 2;
export const PANJANG_CARI_MAKS = 100;
export const PER_HALAMAN = 20;

export interface RingkasKategori {
  readonly kode: string;
  readonly nama: string;
}

export interface SatuanKartu {
  readonly id: string;
  readonly kode: KodeSatuan;
  readonly isi: number;
  readonly harga: HargaKatalog;
  /** K-20 / IG-02: false = tombol beli nonaktif. */
  readonly tersedia: boolean;
  readonly statusStok: StatusStok;
  readonly labelStok: string | null;
}

export interface KartuProdukApi {
  readonly id: string;
  readonly nama: string;
  readonly gambarUrl: string | null;
  readonly kategori: RingkasKategori;
  readonly subkategori: RingkasKategori | null;
  readonly satuan: SatuanKartu;
  readonly jumlahPilihanSatuan: number;
  readonly tersedia: boolean;
  readonly statusStok: StatusStok;
  readonly labelStok: string | null;
  /** Selalu null sampai T-032 (promo terpisah dari harga). */
  readonly promo: null;
}

export interface HalamanProduk {
  readonly produk: readonly KartuProdukApi[];
  readonly halaman: number;
  readonly perHalaman: number;
  readonly total: number;
  readonly totalHalaman: number;
}

export interface KategoriApi {
  readonly kode: string;
  readonly nama: string;
  readonly jumlahProduk: number;
  readonly subkategori: readonly { kode: string; nama: string; jumlahProduk: number }[];
}

export interface DetailProdukApi {
  readonly id: string;
  readonly nama: string;
  readonly gambarUrl: string | null;
  readonly tersedia: boolean;
  readonly statusStok: StatusStok;
  readonly labelStok: string | null;
  readonly satuan: readonly SatuanKartu[];
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isStrAtauNull = (x: unknown): x is string | null => x === null || typeof x === "string";
const isBulatPositif = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) > 0;
const isStatus = (x: unknown): x is StatusStok =>
  isStr(x) && (STATUS_STOK_TAMPIL as readonly string[]).includes(x);

function laporBuang(alasan: string, id: unknown) {
  // Tanpa PII: hanya ID produk/satuan & alasan.
  console.error(`katalog: data dibuang (${alasan})`, { id: isStr(id) ? id : null });
}

function keRingkas(x: unknown): RingkasKategori | null {
  return isObj(x) && isStr(x["kode"]) && isStr(x["nama"])
    ? { kode: x["kode"], nama: x["nama"] }
    : null;
}

/** Satuan jual dari respons; null bila tidak valid (harga tidak valid = tidak tayang). */
export function keSatuan(x: unknown): SatuanKartu | null {
  if (!isObj(x) || !isStr(x["id"])) return null;
  const harga = x["harga"];
  if (!isKodeSatuan(x["kode"])) {
    laporBuang("kode satuan di luar P-03", x["id"]);
    return null;
  }
  if (
    !isObj(harga) ||
    !isRupiah(harga["hargaSatuan"]) ||
    !(harga["hargaBelanjaBareng"] === null || isRupiah(harga["hargaBelanjaBareng"]))
  ) {
    laporBuang("harga tidak valid", x["id"]);
    return null;
  }
  if (
    !isBulatPositif(x["isi"]) ||
    typeof x["tersedia"] !== "boolean" ||
    !isStatus(x["statusStok"]) ||
    !isStrAtauNull(x["labelStok"])
  ) {
    laporBuang("satuan tidak valid", x["id"]);
    return null;
  }
  // Pertahanan: hanya TERSEDIA yang boleh dibeli, apa pun nilai `tersedia` (K-20, IG-02).
  const tersedia = x["tersedia"] && x["statusStok"] === "TERSEDIA";
  return {
    id: x["id"],
    kode: x["kode"],
    isi: x["isi"],
    harga: {
      hargaSatuan: harga["hargaSatuan"],
      hargaBelanjaBareng: harga["hargaBelanjaBareng"],
    },
    tersedia,
    statusStok: x["statusStok"],
    labelStok: x["labelStok"],
  };
}

export function keKartu(x: unknown): KartuProdukApi | null {
  if (!isObj(x)) return null;
  const kategori = keRingkas(x["kategori"]);
  const sub = x["subkategori"] === null ? null : keRingkas(x["subkategori"]);
  const satuan = keSatuan(x["satuan"]);
  if (
    !isStr(x["id"]) ||
    !isStr(x["nama"]) ||
    !isStrAtauNull(x["gambarUrl"]) ||
    kategori === null ||
    (x["subkategori"] !== null && sub === null) ||
    satuan === null ||
    !isBulatPositif(x["jumlahPilihanSatuan"]) ||
    typeof x["tersedia"] !== "boolean" ||
    !isStatus(x["statusStok"]) ||
    !isStrAtauNull(x["labelStok"])
  ) {
    if (satuan !== null) laporBuang("kartu tidak valid", x["id"]);
    return null;
  }
  return {
    id: x["id"],
    nama: x["nama"],
    gambarUrl: x["gambarUrl"],
    kategori,
    subkategori: sub,
    satuan,
    jumlahPilihanSatuan: x["jumlahPilihanSatuan"],
    tersedia: x["tersedia"] && x["statusStok"] === "TERSEDIA",
    statusStok: x["statusStok"],
    labelStok: x["labelStok"],
    promo: null,
  };
}

function keHalaman(x: unknown): HalamanProduk {
  if (!isObj(x) || !Array.isArray(x["produk"])) throw new Error("respons katalog tidak valid");
  const angka = (k: string) => (Number.isSafeInteger(x[k]) ? (x[k] as number) : 0);
  return {
    produk: x["produk"].map(keKartu).filter((k): k is KartuProdukApi => k !== null),
    halaman: angka("halaman"),
    perHalaman: angka("perHalaman"),
    total: angka("total"),
    totalHalaman: angka("totalHalaman"),
  };
}

function keKategori(x: unknown): KategoriApi[] {
  if (!isObj(x) || !Array.isArray(x["kategori"])) throw new Error("respons kategori tidak valid");
  const hasil: KategoriApi[] = [];
  for (const k of x["kategori"] as unknown[]) {
    if (
      !isObj(k) ||
      !isStr(k["kode"]) ||
      !isStr(k["nama"]) ||
      !Number.isSafeInteger(k["jumlahProduk"])
    )
      continue;
    const sub = Array.isArray(k["subkategori"]) ? (k["subkategori"] as unknown[]) : [];
    hasil.push({
      kode: k["kode"],
      nama: k["nama"],
      jumlahProduk: k["jumlahProduk"] as number,
      subkategori: sub.flatMap((s) =>
        isObj(s) && isStr(s["kode"]) && isStr(s["nama"]) && Number.isSafeInteger(s["jumlahProduk"])
          ? [{ kode: s["kode"], nama: s["nama"], jumlahProduk: s["jumlahProduk"] as number }]
          : [],
      ),
    });
  }
  return hasil;
}

function keDetail(x: unknown): DetailProdukApi {
  if (
    !isObj(x) ||
    !isStr(x["id"]) ||
    !isStr(x["nama"]) ||
    !Array.isArray(x["varian"]) ||
    !isStatus(x["statusStok"])
  )
    throw new Error("respons detail tidak valid");
  const satuan: SatuanKartu[] = [];
  for (const v of x["varian"] as unknown[]) {
    if (!isObj(v) || !Array.isArray(v["satuan"])) continue;
    for (const s of v["satuan"] as unknown[]) {
      const hasil = keSatuan(s);
      if (hasil) satuan.push(hasil);
    }
  }
  return {
    id: x["id"],
    nama: x["nama"],
    gambarUrl: isStr(x["gambarUrl"]) ? x["gambarUrl"] : null,
    tersedia: x["tersedia"] === true && x["statusStok"] === "TERSEDIA",
    statusStok: x["statusStok"],
    labelStok: isStr(x["labelStok"]) ? x["labelStok"] : null,
    satuan,
  };
}

function qs(param: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(param)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export async function ambilKategori(zona: string | undefined, signal?: AbortSignal) {
  return keKategori(
    await minta<unknown>(`/api/katalog/kategori${qs({ zona })}`, signal ? { signal } : undefined),
  );
}

export interface SaringanProduk {
  readonly zona: string | undefined;
  readonly kategori: string | undefined;
  readonly subkategori: string | undefined;
  readonly q: string | undefined;
}

export async function ambilProduk(s: SaringanProduk, halaman: number, signal?: AbortSignal) {
  const url = `/api/katalog/produk${qs({
    zona: s.zona,
    kategori: s.kategori,
    subkategori: s.subkategori,
    q: s.q,
    halaman,
    perHalaman: PER_HALAMAN,
  })}`;
  return keHalaman(await minta<unknown>(url, signal ? { signal } : undefined));
}

export async function ambilDetail(id: string, zona: string | undefined, signal?: AbortSignal) {
  const url = `/api/katalog/produk/${encodeURIComponent(id)}${qs({ zona })}`;
  return keDetail(await minta<unknown>(url, signal ? { signal } : undefined));
}

/** Kata kunci yang dikirim ke API: dipangkas, ≤ 100 karakter; < 2 karakter = tidak mencari. */
export function normalisasiCari(q: string): string | undefined {
  const t = q.trim().replace(/\s+/g, " ").slice(0, PANJANG_CARI_MAKS).trim();
  return t.length >= PANJANG_CARI_MIN ? t : undefined;
}
