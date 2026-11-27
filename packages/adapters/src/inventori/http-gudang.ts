// Klien HTTP ke API Gudang-Repo (T-019, T-009 §4, §5, §5.1). Hanya dipakai GudangApiInventory.
//
// Keamanan (T-009 §5.1):
// - Base URL hanya dari konfigurasi (env), wajib https://; path selalu dari kode, tidak dari data respons.
// - Token hanya di header `Authorization: Bearer …`, tidak pernah di URL/query, tidak pernah di pesan error.
// - Redirect TIDAK diikuti (`redirect: "manual"`) → `SUMBER_TIDAK_TERJANGKAU` (CWE-918).
// - Batas ukuran respons (bawaan 5 MB) → lebih besar = `DATA_TIDAK_VALID`.
// - Pesan error tidak memuat URL, header, atau isi respons (bisa memuat data sumber).
import { InventoryError } from "@nekat/shared";

/** Batas ukuran respons bawaan (T-009 §5.1: default teknis 5 MB). */
export const BATAS_RESPONS_BAWAAN_BYTE = 5 * 1024 * 1024;

/** Profil timeout & retry per jenis panggilan (T-009 §5). */
export interface ProfilPanggilan {
  readonly timeoutMs: number;
  /** Jumlah percobaan ULANG setelah percobaan pertama (0 = tanpa retry). */
  readonly percobaanUlang: number;
  readonly jedaAwalMs: number;
  readonly jedaMaksMs: number;
}

/**
 * T-009 §5:
 * - `sinkron`: job sinkron listSku/getStok/getHargaModal: 10 dtk, 3× backoff 2–8 dtk + jitter.
 * - `checkout`: getStok on-demand saat checkout: 2 dtk, tanpa retry (gagal → tahan checkout, H14).
 * - `konfirmasi`: cut-off: 10 dtk, 5× backoff hingga 60 dtk.
 * - `picking`: 10 dtk, tanpa retry di adapter; retry berjenjang oleh worker outbox (sampai 6 jam).
 */
export const PROFIL_GUDANG = {
  sinkron: { timeoutMs: 10_000, percobaanUlang: 3, jedaAwalMs: 2_000, jedaMaksMs: 8_000 },
  checkout: { timeoutMs: 2_000, percobaanUlang: 0, jedaAwalMs: 0, jedaMaksMs: 0 },
  konfirmasi: { timeoutMs: 10_000, percobaanUlang: 5, jedaAwalMs: 2_000, jedaMaksMs: 60_000 },
  picking: { timeoutMs: 10_000, percobaanUlang: 0, jedaAwalMs: 0, jedaMaksMs: 0 },
} as const satisfies Record<string, ProfilPanggilan>;

export type JenisProfilBaca = "sinkron" | "checkout";

export interface OpsiKlienGudang {
  /** `GUDANG_API_URL` (https://, tanpa kredensial). */
  readonly baseUrl: string;
  /** Fungsi agar token tidak tersimpan sebagai properti yang bisa ter-serialisasi. */
  readonly ambilToken: () => string;
  /** Untuk tes: fetch pengganti. Bawaan `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  readonly batasResponsByte?: number;
  /**
   * HANYA untuk tes dengan mock server lokal (http://127.0.0.1). Tidak bisa diaktifkan lewat env;
   * konfigurasi produksi (`bacaKonfigInventory`) selalu mewajibkan https://.
   */
  readonly izinkanHttpLokalUntukTes?: boolean;
}

export interface PermintaanHttp {
  readonly metode: "GET" | "POST";
  /** Path relatif dari base URL, mis. `v1/sku`. Selalu konstanta kode. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** Dikirim sebagai header `Idempotency-Key` (konfirmasi stok & picking). */
  readonly kunciIdempotensi?: string;
  readonly timeoutMs: number;
}

export interface ResponsHttp {
  readonly status: number;
  readonly json: unknown;
}

const POLA_HOST_LOKAL = /^(127\.0\.0\.1|localhost|\[::1\])$/;

/** Validasi base URL (pertahanan berlapis selain `bacaKonfigInventory`). Error tanpa nilai URL. */
export function urlDasarGudang(baseUrl: string, izinkanHttpLokal = false): URL {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new TypeError("GUDANG_API_URL tidak valid");
  }
  const httpLokal = izinkanHttpLokal && u.protocol === "http:" && POLA_HOST_LOKAL.test(u.hostname);
  if ((u.protocol !== "https:" && !httpLokal) || u.username !== "" || u.password !== "") {
    throw new TypeError("GUDANG_API_URL harus https:// tanpa kredensial");
  }
  if (u.search !== "" || u.hash !== "") throw new TypeError("GUDANG_API_URL tanpa query/fragmen");
  if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
  return u;
}

export class KlienGudang {
  readonly #dasar: URL;
  readonly #ambilToken: () => string;
  readonly #fetch: typeof fetch;
  readonly #batas: number;

  constructor(opsi: OpsiKlienGudang) {
    this.#dasar = urlDasarGudang(opsi.baseUrl, opsi.izinkanHttpLokalUntukTes === true);
    this.#ambilToken = opsi.ambilToken;
    this.#fetch = opsi.fetch ?? globalThis.fetch;
    this.#batas = opsi.batasResponsByte ?? BATAS_RESPONS_BAWAAN_BYTE;
  }

  /** Satu panggilan tanpa retry. Status 2xx → JSON; selain itu `InventoryError` (T-009 §4). */
  async panggil(p: PermintaanHttp): Promise<ResponsHttp> {
    // Path relatif terhadap base (tanpa "/" awal) agar prefix `/api` pada base tetap dipakai.
    const url = new URL(p.path.replace(/^\/+/, ""), this.#dasar);
    if (url.origin !== this.#dasar.origin) throw new TypeError("path Gudang tidak valid");
    for (const [k, v] of Object.entries(p.query ?? {})) url.searchParams.set(k, v);

    const header: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.#ambilToken()}`,
      "user-agent": "nekat-inventori",
    };
    if (p.body !== undefined) header["content-type"] = "application/json";
    if (p.kunciIdempotensi !== undefined) header["idempotency-key"] = p.kunciIdempotensi;

    const sinyal = AbortSignal.timeout(p.timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: p.metode,
        headers: header,
        redirect: "manual",
        signal: sinyal,
        ...(p.body === undefined ? {} : { body: JSON.stringify(p.body) }),
      });
    } catch (e) {
      // Tanpa `cause`: galat jaringan bisa memuat alamat; token memang tidak pernah di URL.
      throw new InventoryError(
        "SUMBER_TIDAK_TERJANGKAU",
        namaGalat(e) === "TimeoutError" || sinyal.aborted
          ? "Gudang tidak menjawab dalam batas waktu"
          : "Gudang tidak bisa dihubungi",
      );
    }

    if (res.status >= 300 && res.status < 400) {
      await batalkanBody(res);
      throw new InventoryError(
        "SUMBER_TIDAK_TERJANGKAU",
        `Gudang membalas redirect HTTP ${res.status} (tidak diikuti)`,
      );
    }
    if (res.status === 429) {
      await batalkanBody(res);
      const r = bacaRetryAfter(res.headers.get("retry-after"));
      throw new InventoryError(
        "DIBATASI",
        "Gudang membatasi permintaan (HTTP 429)",
        r === null ? {} : { retrySetelahDetik: r },
      );
    }
    if (res.status === 401 || res.status === 403) {
      await batalkanBody(res);
      throw new InventoryError("DITOLAK", `Gudang menolak kredensial (HTTP ${res.status})`);
    }
    if (res.status === 409 && p.kunciIdempotensi !== undefined) {
      await batalkanBody(res);
      throw new InventoryError(
        "KONFLIK_IDEMPOTENSI",
        "Gudang: kunci idempotensi sudah dipakai untuk permintaan dengan isi berbeda",
      );
    }
    if (res.status >= 500) {
      await batalkanBody(res);
      throw new InventoryError("SUMBER_TIDAK_TERJANGKAU", `Gudang galat HTTP ${res.status}`);
    }
    if (res.status < 200 || res.status >= 300) {
      await batalkanBody(res);
      throw new InventoryError(
        "DATA_TIDAK_VALID",
        `Gudang menolak permintaan (HTTP ${res.status})`,
      );
    }

    let teks: string;
    try {
      teks = await bacaTerbatas(res, this.#batas);
    } catch (e) {
      if (e instanceof InventoryError) throw e;
      throw new InventoryError(
        "SUMBER_TIDAK_TERJANGKAU",
        sinyal.aborted ? "Gudang tidak menjawab dalam batas waktu" : "Respons Gudang terputus",
      );
    }
    try {
      return { status: res.status, json: JSON.parse(teks) as unknown };
    } catch {
      throw new InventoryError("DATA_TIDAK_VALID", "Respons Gudang bukan JSON yang valid");
    }
  }
}

function namaGalat(e: unknown): string {
  return e instanceof Error ? e.name : "";
}

async function batalkanBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // diabaikan
  }
}

interface PembacaByte {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

async function bacaTerbatas(res: Response, batas: number): Promise<string> {
  const panjang = Number(res.headers.get("content-length") ?? Number.NaN);
  const terlaluBesar = () =>
    new InventoryError("DATA_TIDAK_VALID", "Respons Gudang melebihi batas ukuran");
  if (Number.isFinite(panjang) && panjang > batas) {
    await batalkanBody(res);
    throw terlaluBesar();
  }
  if (res.body === null) return "";
  // Tipe pembaca dinyatakan eksplisit (lib DOM tidak dipakai; tipe stream web Node tidak selalu
  // ter-resolve oleh linter).
  const pembaca = (res.body as unknown as { getReader(): PembacaByte }).getReader();
  const potongan: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const bagian = await pembaca.read();
    if (bagian.done || bagian.value === undefined) break;
    const value = bagian.value;
    total += value.byteLength;
    if (total > batas) {
      await pembaca.cancel().catch(() => undefined);
      throw terlaluBesar();
    }
    potongan.push(value);
  }
  return Buffer.concat(potongan).toString("utf8");
}

/** `Retry-After` (detik atau HTTP-date) → detik, dibatasi 0–60 (T-009 §4). Tidak valid → null. */
export function bacaRetryAfter(nilai: string | null, sekarang = Date.now()): number | null {
  if (nilai === null) return null;
  const t = nilai.trim();
  if (/^\d+$/.test(t)) return Math.min(60, Number(t));
  const waktu = Date.parse(t);
  if (Number.isNaN(waktu)) return null;
  return Math.min(60, Math.max(0, Math.ceil((waktu - sekarang) / 1000)));
}

export interface OpsiRetry {
  /** Untuk tes: tidur pengganti. */
  readonly tidur?: (ms: number) => Promise<void>;
  /** Untuk tes: sumber acak [0, 1). */
  readonly acak?: () => number;
  /** Dipanggil sebelum tiap percobaan ulang (log tanpa rahasia). */
  readonly saatUlang?: (info: { percobaan: number; kode: string; jedaMs: number }) => void;
}

const tidurBawaan = (ms: number) =>
  new Promise<void>((selesai) => {
    setTimeout(selesai, ms);
  });

/**
 * Jeda backoff eksponensial: min(maks, awal × 2^(n-1)) + jitter [0, awal/2).
 * `DIBATASI` dengan Retry-After → nilai itu (maks. 60 dtk, T-009 §4).
 */
export function jedaBackoff(
  percobaanUlangKe: number,
  profil: ProfilPanggilan,
  galat: InventoryError,
  acak: () => number,
): number {
  if (galat.kode === "DIBATASI" && galat.retrySetelahDetik !== null) {
    return Math.min(60_000, galat.retrySetelahDetik * 1000);
  }
  const dasar = Math.min(profil.jedaMaksMs, profil.jedaAwalMs * 2 ** (percobaanUlangKe - 1));
  return dasar + Math.floor(acak() * (profil.jedaAwalMs / 2));
}

/** Menjalankan `f` dengan retry hanya untuk galat yang `bolehRetry` (T-009 §4). */
export async function denganRetry<T>(
  f: () => Promise<T>,
  profil: ProfilPanggilan,
  opsi: OpsiRetry = {},
): Promise<T> {
  const tidur = opsi.tidur ?? tidurBawaan;
  const acak = opsi.acak ?? Math.random;
  for (let ke = 0; ; ke++) {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof InventoryError) || !e.bolehRetry || ke >= profil.percobaanUlang) throw e;
      const jedaMs = jedaBackoff(ke + 1, profil, e, acak);
      opsi.saatUlang?.({ percobaan: ke + 1, kode: e.kode, jedaMs });
      await tidur(jedaMs);
    }
  }
}
