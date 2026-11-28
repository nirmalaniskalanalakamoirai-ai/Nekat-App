// Klien API login pembeli (T-016, H-07). Same-origin `/api` (dev: proxy Vite). Cookie sesi HttpOnly
// dikelola browser; token CSRF hanya di memori (bukan localStorage) dan dikirim di header untuk mutasi.

export class GalatMasuk extends Error {
  constructor(
    readonly status: number,
    readonly kode: string,
    pesan: string,
    readonly tungguDetik: number | null = null,
    readonly sisaPercobaan: number | null = null,
  ) {
    super(pesan);
    this.name = "GalatMasuk";
  }
}

export const PESAN_JARINGAN = "Gagal terhubung. Periksa sinyal lalu coba lagi.";

let csrfPembeli: string | null = null;
export function aturCsrfPembeli(token: string | null): void {
  csrfPembeli = token;
}
export function ambilCsrfPembeli(): string | null {
  return csrfPembeli;
}

async function minta<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers = new Headers({ accept: "application/json" });
  if (method !== "GET") headers.set("content-type", "application/json");
  if (method !== "GET" && csrfPembeli) headers.set("x-csrf-token", csrfPembeli);
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "same-origin",
      ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    throw new GalatMasuk(0, "JARINGAN", PESAN_JARINGAN);
  }
  if (r.status === 204) return undefined as T;
  const isi = (await r.json().catch(() => null)) as
    (T & { kode?: string; pesan?: string; tungguDetik?: number; sisaPercobaan?: number }) | null;
  if (!r.ok) {
    throw new GalatMasuk(
      r.status,
      isi?.kode ?? `HTTP_${String(r.status)}`,
      isi?.pesan ?? "Terjadi gangguan. Coba lagi.",
      typeof isi?.tungguDetik === "number" ? isi.tungguDetik : null,
      typeof isi?.sisaPercobaan === "number" ? isi.sisaPercobaan : null,
    );
  }
  return isi as T;
}

export interface SayaPembeli {
  akun: { id: string; nomorHpSamar: string; jenisPelanggan: string; status: string };
  csrfToken: string;
  sesiBerakhir: string;
}

export const apiMasuk = {
  mintaOtp: (nomorHp: string) =>
    minta<{ kedaluwarsaDetik: number; kirimUlangDetik: number }>("POST", "/masuk/otp", {
      nomorHp,
    }),
  verifikasi: async (nomorHp: string, kode: string, waOptin: boolean) => {
    const r = await minta<{ csrfToken: string; sesiBerakhir: string }>(
      "POST",
      "/masuk/verifikasi",
      { nomorHp, kode, waOptin },
    );
    aturCsrfPembeli(r.csrfToken);
    return r;
  },
  /** null = belum masuk (401). Galat lain dilempar. */
  saya: async (): Promise<SayaPembeli | null> => {
    try {
      const s = await minta<SayaPembeli>("GET", "/saya");
      aturCsrfPembeli(s.csrfToken);
      return s;
    } catch (err) {
      if (err instanceof GalatMasuk && err.status === 401) return null;
      throw err;
    }
  },
  keluar: async () => {
    await minta<undefined>("POST", "/keluar", {});
    aturCsrfPembeli(null);
  },
};
