// Klien API panel admin (T-036). Same-origin `/api/admin` (dev: proxy Vite). Cookie sesi HttpOnly
// dikelola browser; token CSRF hanya di memori (tidak di localStorage) dan dikirim di header.

export class GalatAdmin extends Error {
  constructor(
    readonly status: number,
    readonly kode: string,
    pesan: string,
    readonly isian: readonly string[] = [],
  ) {
    super(pesan);
  }
}

/** Nilai teks isian form (FormDataEntryValue File → ""), sudah di-trim. */
export function nilaiForm(f: FormData, nama: string): string {
  const v = f.get(nama);
  return typeof v === "string" ? v.trim() : "";
}

let csrfToken: string | null = null;
export function aturCsrf(token: string | null): void {
  csrfToken = token;
}

/** Dipanggil saat sesi habis (401) agar UI kembali ke halaman masuk. */
let saatSesiHabis: (() => void) | null = null;
export function aturSaatSesiHabis(fn: (() => void) | null): void {
  saatSesiHabis = fn;
}

async function minta<T>(
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  const headers = new Headers({ accept: "application/json" });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET" && csrfToken) headers.set("x-csrf-token", csrfToken);
  const r = await fetch(`/api/admin${path}`, {
    method,
    headers,
    credentials: "same-origin",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 204) return undefined as T;
  const isi = (await r.json().catch(() => null)) as
    (T & { kode?: string; pesan?: string; isian?: string[] }) | null;
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith("/masuk")) saatSesiHabis?.();
    throw new GalatAdmin(
      r.status,
      isi?.kode ?? `HTTP_${String(r.status)}`,
      isi?.pesan ?? "Terjadi gangguan. Coba lagi.",
      isi?.isian ?? [],
    );
  }
  return isi as T;
}

// ---------- Tipe respons (selaras apps/api/src/admin/rute.ts) ----------

export interface Saya {
  admin: { id: string; nama: string; peran: string[]; izin: string[] };
  csrfToken: string;
  sesiBerakhir: string;
  sumberInventori: "local" | "gudang";
}

export interface Kategori {
  id: string;
  kode: string;
  nama: string;
  aktif: boolean;
  indukId: string | null;
  indukNama: string | null;
  terlarang: boolean;
}

export interface ProdukRingkas {
  id: string;
  kategoriId: string;
  kategoriNama: string;
  indukKategoriNama: string | null;
  nama: string;
  deskripsi: string | null;
  gambarUrl: string | null;
  aktif: boolean;
  bebasPpn: boolean;
  tinjauanKategori: "TIDAK_PERLU" | "MENUNGGU" | "DISETUJUI";
  jumlahSku: number;
  diubahPada: string;
}

export type JenisSatuan = "PCS_1" | "PCS_3" | "LUSIN" | "DUS" | "KOLI";

export interface Satuan {
  id: string;
  skuId: string;
  jenis: JenisSatuan;
  isiSatuanDasar: number;
  beratGram: number;
  tayang: boolean;
  alasanTidakTayang: string[];
}

export interface Sku {
  id: string;
  produkId: string;
  kodeSku: string;
  barcode: string | null;
  namaVarian: string | null;
  satuanDasar: "pcs" | "gram" | "ml";
  aktifDiSumber: boolean;
  satuan: Satuan[];
}

export interface BarisStok {
  skuId: string;
  kodeSku: string;
  namaProduk: string;
  namaVarian: string | null;
  satuanDasar: string;
  gudangId: string;
  tersedia: number | null;
  dataPada: string | null;
}

export interface BarisLog {
  id: number;
  waktu: string;
  adminNama: string;
  izinKode: string;
  entitasJenis: string;
  entitasId: string | null;
  sebelum: Record<string, unknown> | null;
  sesudah: Record<string, unknown> | null;
  alasan: string | null;
}

// ---------- Panggilan ----------

export const apiAdmin = {
  masuk: (nomorHp: string, kataSandi: string) =>
    minta<{ langkah: "TOTP"; csrfToken: string }>("POST", "/masuk", { nomorHp, kataSandi }),
  masukTotp: (faktor: { kode: string } | { kodePemulihan: string }) =>
    minta<{ csrfToken: string; sesiBerakhir: string }>("POST", "/masuk/totp", faktor),
  keluar: () => minta<undefined>("POST", "/keluar", {}),
  saya: () => minta<Saya>("GET", "/saya"),

  kategori: () => minta<{ kategori: Kategori[] }>("GET", "/kategori"),
  daftarProduk: (cari: string, halaman: number) =>
    minta<{ produk: ProdukRingkas[]; total: number; halaman: number }>(
      "GET",
      `/produk?${new URLSearchParams({ ...(cari ? { cari } : {}), halaman: String(halaman) }).toString()}`,
    ),
  produk: (id: string) => minta<{ produk: ProdukRingkas; sku: Sku[] }>("GET", `/produk/${id}`),
  buatProduk: (data: Record<string, unknown>) => minta<{ id: string }>("POST", "/produk", data),
  ubahProduk: (id: string, data: Record<string, unknown>) =>
    minta<undefined>("PATCH", `/produk/${id}`, data),
  buatSku: (produkId: string, data: Record<string, unknown>) =>
    minta<{ id: string }>("POST", `/produk/${produkId}/sku`, data),
  ubahSku: (id: string, data: Record<string, unknown>) =>
    minta<undefined>("PATCH", `/sku/${id}`, data),
  buatSatuan: (skuId: string, data: Record<string, unknown>) =>
    minta<{ id: string }>("POST", `/sku/${skuId}/satuan`, data),
  ubahSatuan: (id: string, data: Record<string, unknown>) =>
    minta<undefined>("PATCH", `/satuan/${id}`, data),

  gudang: () =>
    minta<{ gudang: { id: string; kode: string; nama: string; aktif: boolean }[] }>(
      "GET",
      "/gudang",
    ),
  stok: (gudangId: string, cari: string, halaman: number) =>
    minta<{
      sumber: "local" | "gudang";
      dapatDiubah: boolean;
      stok: BarisStok[];
      total: number;
    }>(
      "GET",
      `/stok?${new URLSearchParams({ gudangId, ...(cari ? { cari } : {}), halaman: String(halaman) }).toString()}`,
    ),
  aturStok: (data: { skuId: string; gudangId: string; tersedia: number; alasan: string }) =>
    minta<undefined>("PUT", "/stok", data),

  log: (sebelumId?: number) =>
    minta<{ log: BarisLog[]; berikutnya: number | null }>(
      "GET",
      `/log${sebelumId ? `?sebelumId=${String(sebelumId)}` : ""}`,
    ),
};

export const LABEL_SATUAN: Record<JenisSatuan, string> = {
  PCS_1: "1 pcs",
  PCS_3: "3 pcs",
  LUSIN: "Lusin (12)",
  DUS: "Dus",
  KOLI: "Koli",
};

export const LABEL_ENTITAS: Record<string, string> = {
  produk: "Produk",
  sku: "SKU",
  satuan_jual: "Satuan jual",
  stok_lokasi: "Stok",
};
