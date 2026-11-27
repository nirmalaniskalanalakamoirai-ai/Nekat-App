// XenditGateway (T-029): QRIS & Virtual Account lewat Xendit Payments API v3 "payment requests".
//
// ASUMSI API (belum diuji ke Xendit nyata; hanya ke mock lokal yang meniru dokumentasi publik):
//   X-01  Endpoint & versi: `POST /v3/payment_requests`, `GET /v3/payment_requests/{id}`,
//         `POST /v3/payment_requests/{id}/cancel`, header `api-version: 2024-11-11`, Basic auth (kunci = user,
//         sandi kosong). Status: ACCEPTING_PAYMENTS | REQUIRES_ACTION | AUTHORIZED | CANCELED | EXPIRED |
//         SUCCEEDED | FAILED. Instruksi di `actions[]` dengan `descriptor` QR_STRING / VIRTUAL_ACCOUNT_NUMBER.
//   X-02  Body PAY: `reference_id` (= pembayaran.id = external_id), `type: "PAY"`, `country: "ID"`,
//         `currency: "IDR"`, `request_amount` (integer rupiah), `capture_method: "AUTOMATIC"`,
//         `channel_code` QRIS | {BANK}_VIRTUAL_ACCOUNT, `channel_properties.expires_at` (waktu absolut ISO),
//         `channel_properties.display_name` = nama merchant (VA). Nominal PAY dianggap closed amount &
//         sekali pakai (§5.3) — WAJIB diverifikasi di sandbox per bank.
//   X-03  Idempotensi: header `idempotency-key` = external_id; permintaan ulang dengan kunci sama tidak
//         membuat tagihan baru (mengembalikan yang lama atau 409 DUPLICATE_ERROR).
//   X-05  Cari tanpa ID Xendit (xendit_ref NULL, FP-01): `GET /v3/payment_requests?reference_id=…` → `data[]`.
//         TIDAK terdokumentasi di halaman yang dibaca; bila endpoint tidak ada (404/405), hasil = tidak
//         ditemukan, dan pengaman X-03 mencegah tagihan ganda saat dibuat ulang dengan external_id sama.
//   X-06  `paid_at` = `updated` payment request berstatus SUCCEEDED (perkiraan; T-030 sebaiknya memakai
//         waktu dari objek payment `latest_payment_id` setelah diverifikasi).
//
// Keamanan (pola http-gudang.ts): https wajib, redirect tidak diikuti, batas ukuran respons, timeout per
// panggilan, kunci hanya di header Authorization (tidak di URL/log/pesan galat), pesan galat tanpa isi
// respons (bisa memuat nomor VA/QR string), path dari kode (id dari respons divalidasi pola sebelum dipakai).
import type {
  HasilBuatPembayaran,
  HasilCekStatus,
  InstruksiGateway,
  ModeGateway,
  PaymentGateway,
  PermintaanBuatPembayaran,
  RujukanPembayaran,
  StatusNormal,
} from "@nekat/domain";
import { GalatGateway } from "@nekat/domain";
import { z } from "zod";

export const XENDIT_API_URL = "https://api.xendit.co/";
export const XENDIT_API_VERSION = "2024-11-11";
/** Respons payment request kecil; 64 KB jauh di atas ukuran wajar. */
export const BATAS_RESPONS_XENDIT_BYTE = 64 * 1024;

/** Nilai teknis T-029 (§12.2 "TIMEOUT: nilai teknis"). */
export const TIMEOUT_XENDIT_MS = { buat: 10_000, cek: 5_000, batal: 8_000 } as const;

export interface OpsiXenditGateway {
  readonly mode: ModeGateway;
  readonly ambilKunci: () => string;
  readonly kanalVa: readonly string[];
  readonly fetch?: typeof fetch;
  /** HANYA tes: base URL mock lokal (http://127.0.0.1). Tidak bisa diatur lewat env. */
  readonly baseUrlUntukTes?: string;
  readonly timeoutMs?: Partial<Record<keyof typeof TIMEOUT_XENDIT_MS, number>>;
}

const POLA_ID_PR = /^pr-[0-9a-f-]{36}$/;
const POLA_HOST_LOKAL = /^(127\.0\.0\.1|localhost|\[::1\])$/;

const skemaAksi = z.object({
  type: z.string().optional(),
  descriptor: z.string(),
  value: z.string().max(2048),
});
const skemaPr = z.object({
  payment_request_id: z.string().regex(POLA_ID_PR),
  reference_id: z.string(),
  status: z.string(),
  request_amount: z.number(),
  currency: z.string(),
  channel_code: z.string().optional(),
  actions: z.array(skemaAksi).optional().default([]),
  updated: z.string().optional(),
  channel_properties: z.record(z.string(), z.unknown()).optional(),
});
type PaymentRequestXendit = z.infer<typeof skemaPr>;
const skemaDaftar = z.object({ data: z.array(skemaPr) });
const skemaGalat = z.object({ error_code: z.string().optional(), message: z.string().optional() });

export function channelCode(metode: string, kanal: string | null): string {
  if (metode === "QRIS") return "QRIS";
  if (metode === "VA" && kanal !== null) return `${kanal}_VIRTUAL_ACCOUNT`;
  throw new GalatGateway("METODE_TIDAK_DIDUKUNG", "metode belum didukung adapter Xendit");
}

export function normalkanStatus(s: string): StatusNormal {
  switch (s) {
    case "ACCEPTING_PAYMENTS":
    case "REQUIRES_ACTION":
      return "MENUNGGU";
    case "SUCCEEDED":
      return "PAID";
    case "EXPIRED":
    case "CANCELED":
      return "EXPIRED";
    case "FAILED":
      return "FAILED";
    default:
      return "LAINNYA";
  }
}

export class XenditGateway implements PaymentGateway {
  readonly nama = "xendit" as const;
  readonly mode: ModeGateway;
  readonly kanalVa: readonly string[];
  readonly #dasar: URL;
  readonly #ambilKunci: () => string;
  readonly #fetch: typeof fetch;
  readonly #timeout: Record<keyof typeof TIMEOUT_XENDIT_MS, number>;

  constructor(o: OpsiXenditGateway) {
    this.mode = o.mode;
    this.kanalVa = [...o.kanalVa];
    this.#ambilKunci = o.ambilKunci;
    this.#fetch = o.fetch ?? globalThis.fetch;
    this.#timeout = { ...TIMEOUT_XENDIT_MS, ...o.timeoutMs };
    const u = new URL(o.baseUrlUntukTes ?? XENDIT_API_URL);
    const lokal =
      o.baseUrlUntukTes !== undefined && u.protocol === "http:" && POLA_HOST_LOKAL.test(u.hostname);
    if ((u.protocol !== "https:" && !lokal) || u.username !== "" || u.password !== "") {
      throw new TypeError("URL Xendit harus https:// tanpa kredensial");
    }
    this.#dasar = u;
  }

  async buatPembayaran(p: PermintaanBuatPembayaran): Promise<HasilBuatPembayaran> {
    if (p.metode === "EWALLET") {
      // Port siap; e-wallet menunggu skema pesanan individu (K-36/K-57).
      throw new GalatGateway("METODE_TIDAK_DIDUKUNG", "e-wallet belum didukung");
    }
    if (p.metode === "VA" && (p.kanal === null || !this.kanalVa.includes(p.kanal))) {
      throw new GalatGateway("METODE_TIDAK_DIDUKUNG", "bank VA tidak didukung");
    }
    if (!Number.isSafeInteger(p.jumlahRp) || p.jumlahRp <= 0) {
      throw new GalatGateway("DITOLAK", "nominal tidak valid");
    }
    const properti: Record<string, string> = { expires_at: p.kedaluwarsaPada.toISOString() };
    if (p.metode === "VA") properti["display_name"] = p.namaVa;
    const body = {
      reference_id: p.pembayaranId,
      type: "PAY",
      country: "ID",
      currency: "IDR",
      request_amount: p.jumlahRp,
      capture_method: "AUTOMATIC",
      channel_code: channelCode(p.metode, p.kanal),
      channel_properties: properti,
      description: p.keterangan,
      metadata: { invoice_id: p.invoiceId },
    };
    const r = await this.#panggil("POST", "v3/payment_requests", this.#timeout.buat, {
      body,
      kunciIdempotensi: p.pembayaranId,
      konteks: "buat",
    });
    const pr = this.#bacaPr(r);
    if (
      pr.reference_id !== p.pembayaranId ||
      pr.request_amount !== p.jumlahRp ||
      pr.currency !== "IDR"
    ) {
      // Jawaban tidak cocok dengan permintaan: jangan tampilkan instruksinya (W5 berlaku juga di sini).
      throw new GalatGateway("RESPONS_TIDAK_VALID", "respons Xendit tidak cocok dengan permintaan");
    }
    const instruksi = instruksiDari(pr, p.metode, p.kanal, p.namaVa);
    if (!instruksi)
      throw new GalatGateway("RESPONS_TIDAK_VALID", "instruksi bayar tidak ada di respons");
    return { xenditRef: pr.payment_request_id, instruksi, kedaluwarsaPada: p.kedaluwarsaPada };
  }

  async cekStatus(r: RujukanPembayaran): Promise<HasilCekStatus> {
    let pr: PaymentRequestXendit | null;
    if (r.xenditRef !== null) {
      if (!POLA_ID_PR.test(r.xenditRef))
        throw new GalatGateway("DITOLAK", "xendit_ref tidak valid");
      const h = await this.#panggil(
        "GET",
        `v3/payment_requests/${r.xenditRef}`,
        this.#timeout.cek,
        {
          konteks: "cek",
        },
      );
      pr = h === null ? null : this.#bacaPr(h);
    } else {
      // X-05: cari dengan external_id DARI DB (bukan dari payload webhook).
      const h = await this.#panggil("GET", "v3/payment_requests", this.#timeout.cek, {
        query: { reference_id: r.pembayaranId },
        konteks: "cari",
      });
      if (h === null) {
        pr = null;
      } else {
        const d = skemaDaftar.safeParse(h);
        if (!d.success)
          throw new GalatGateway("RESPONS_TIDAK_VALID", "respons daftar Xendit tidak valid");
        pr = d.data.data.find((x) => x.reference_id === r.pembayaranId) ?? null;
      }
    }
    if (pr === null) return { ditemukan: false };
    if (pr.reference_id !== r.pembayaranId) {
      throw new GalatGateway("RESPONS_TIDAK_VALID", "reference_id Xendit tidak cocok");
    }
    const statusNormal = normalkanStatus(pr.status);
    const metode = pr.channel_code === "QRIS" ? "QRIS" : "VA";
    const kanal =
      metode === "VA" ? (pr.channel_code?.replace(/_VIRTUAL_ACCOUNT$/, "") ?? null) : null;
    const nama =
      typeof pr.channel_properties?.["display_name"] === "string"
        ? pr.channel_properties["display_name"]
        : "";
    return {
      ditemukan: true,
      statusNormal,
      jumlahRp: pr.request_amount,
      mataUang: pr.currency,
      externalId: pr.reference_id,
      paidAt: statusNormal === "PAID" && pr.updated ? waktuAtauNull(pr.updated) : null,
      xenditRef: pr.payment_request_id,
      instruksi: statusNormal === "MENUNGGU" ? instruksiDari(pr, metode, kanal, nama) : null,
    };
  }

  async batalkan(r: { pembayaranId: string; xenditRef: string }): Promise<void> {
    if (!POLA_ID_PR.test(r.xenditRef)) throw new GalatGateway("DITOLAK", "xendit_ref tidak valid");
    const h = await this.#panggil(
      "POST",
      `v3/payment_requests/${r.xenditRef}/cancel`,
      this.#timeout.batal,
      {
        konteks: "batal",
      },
    );
    if (h === null) throw new GalatGateway("TIDAK_AKTIF", "tagihan Xendit tidak ditemukan");
    const pr = this.#bacaPr(h);
    if (pr.reference_id !== r.pembayaranId) {
      throw new GalatGateway("RESPONS_TIDAK_VALID", "reference_id Xendit tidak cocok");
    }
    if (pr.status !== "CANCELED" && pr.status !== "EXPIRED") {
      throw new GalatGateway("TIDAK_AKTIF", "Xendit tidak mengonfirmasi pembatalan");
    }
  }

  kedaluwarsakan(r: { pembayaranId: string; xenditRef: string }): Promise<void> {
    return this.batalkan(r);
  }

  #bacaPr(json: unknown): PaymentRequestXendit {
    const h = skemaPr.safeParse(json);
    if (!h.success) throw new GalatGateway("RESPONS_TIDAK_VALID", "respons Xendit tidak valid");
    return h.data;
  }

  /** null = 404 (tidak ditemukan / endpoint tidak ada) pada GET/cancel. */
  async #panggil(
    metode: "GET" | "POST",
    path: string,
    timeoutMs: number,
    o: {
      body?: unknown;
      query?: Record<string, string>;
      kunciIdempotensi?: string;
      konteks: "buat" | "cek" | "cari" | "batal";
    },
  ): Promise<unknown> {
    const url = new URL(path, this.#dasar);
    if (url.origin !== this.#dasar.origin) throw new TypeError("path Xendit tidak valid");
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    const header: Record<string, string> = {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${this.#ambilKunci()}:`).toString("base64")}`,
      "api-version": XENDIT_API_VERSION,
      "user-agent": "nekat-pembayaran",
    };
    if (o.body !== undefined) header["content-type"] = "application/json";
    if (o.kunciIdempotensi !== undefined) header["idempotency-key"] = o.kunciIdempotensi;

    const sinyal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: metode,
        headers: header,
        redirect: "manual",
        signal: sinyal,
        ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      });
    } catch (e) {
      // Tanpa `cause` (bisa memuat alamat/header).
      throw new GalatGateway(
        "TIMEOUT",
        e instanceof Error && (e.name === "TimeoutError" || sinyal.aborted)
          ? "Xendit tidak menjawab dalam batas waktu"
          : "Xendit tidak bisa dihubungi",
      );
    }

    let teks: string;
    try {
      teks = await bacaTerbatas(res, BATAS_RESPONS_XENDIT_BYTE);
    } catch (e) {
      if (e instanceof GalatGateway) throw e;
      throw new GalatGateway("TIMEOUT", "respons Xendit terputus");
    }
    if (res.status >= 300 && res.status < 400) {
      throw new GalatGateway(
        "GATEWAY_5XX",
        `Xendit membalas redirect HTTP ${String(res.status)} (tidak diikuti)`,
      );
    }
    if (res.status >= 200 && res.status < 300) {
      try {
        return JSON.parse(teks) as unknown;
      } catch {
        throw new GalatGateway("RESPONS_TIDAK_VALID", "respons Xendit bukan JSON");
      }
    }
    const galat = bacaGalat(teks);
    const kode = galat?.error_code ?? "";
    const pesan = (galat?.message ?? "").toLowerCase();
    if (res.status === 404 && o.konteks !== "buat") return null;
    if (res.status === 405 && o.konteks === "cari") return null;
    if (res.status === 401)
      throw new GalatGateway("KONFIGURASI", "Xendit menolak kunci (HTTP 401)");
    if (res.status === 429 || kode === "PAYMENT_REQUEST_RATE_LIMITED") {
      throw new GalatGateway("DIBATASI", "Xendit membatasi permintaan");
    }
    if (res.status >= 500)
      throw new GalatGateway("GATEWAY_5XX", `Xendit galat HTTP ${String(res.status)}`);
    if (res.status === 409 && kode === "DUPLICATE_ERROR") {
      throw new GalatGateway("DUPLIKAT", "external_id sudah dipakai di Xendit");
    }
    if (
      o.konteks === "batal" &&
      (kode === "INACTIVE_PAYMENT_REQUEST" || kode === "INELIGIBLE_TRANSACTION_STATUS")
    ) {
      throw new GalatGateway("TIDAK_AKTIF", "tagihan Xendit sudah tidak aktif");
    }
    if (res.status === 403) {
      if (kode === "INVALID_MERCHANT_SETTINGS" || kode === "CHANNEL_NOT_ACTIVATED") {
        throw new GalatGateway("METODE_TIDAK_DIDUKUNG", "kanal belum aktif di akun Xendit");
      }
      throw new GalatGateway("KONFIGURASI", "Xendit menolak akses (HTTP 403)");
    }
    if (o.konteks === "buat" && res.status === 400) {
      if (kode === "CHANNEL_NOT_SUPPORTED" || kode === "UNSUPPORTED_CHANNEL") {
        throw new GalatGateway("METODE_TIDAK_DIDUKUNG", "kanal tidak didukung Xendit");
      }
      // Pesan hanya dibaca untuk klasifikasi, tidak pernah diteruskan/dicatat.
      if (pesan.includes("amount")) {
        throw new GalatGateway("NOMINAL_DI_BAWAH_MINIMUM", "nominal ditolak Xendit");
      }
      throw new GalatGateway("DITOLAK", `Xendit menolak permintaan (${kodeAman(kode)})`);
    }
    throw new GalatGateway(
      o.konteks === "buat" ? "DITOLAK" : "RESPONS_TIDAK_VALID",
      `Xendit HTTP ${String(res.status)} (${kodeAman(kode)})`,
    );
  }
}

function kodeAman(k: string): string {
  return /^[A-Z_]{1,40}$/.test(k) ? k : "TANPA_KODE";
}

function bacaGalat(teks: string): z.infer<typeof skemaGalat> | null {
  try {
    const h = skemaGalat.safeParse(JSON.parse(teks) as unknown);
    return h.success ? h.data : null;
  } catch {
    return null;
  }
}

function waktuAtauNull(s: string): Date | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function instruksiDari(
  pr: PaymentRequestXendit,
  metode: string,
  kanal: string | null,
  namaVa: string,
): InstruksiGateway | null {
  if (metode === "QRIS") {
    const a = pr.actions.find((x) => x.descriptor === "QR_STRING");
    return a && a.value.length > 0 ? { jenis: "QRIS", qrString: a.value } : null;
  }
  const a = pr.actions.find((x) => x.descriptor === "VIRTUAL_ACCOUNT_NUMBER");
  if (!a || kanal === null || !/^[0-9]{6,32}$/.test(a.value)) return null;
  return { jenis: "VA", bank: kanal, nomorVa: a.value, namaPenerima: namaVa };
}

interface PembacaByte {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

async function bacaTerbatas(res: Response, batas: number): Promise<string> {
  const panjang = Number(res.headers.get("content-length") ?? Number.NaN);
  const besar = () =>
    new GalatGateway("RESPONS_TIDAK_VALID", "respons Xendit melebihi batas ukuran");
  if (Number.isFinite(panjang) && panjang > batas) {
    await res.body?.cancel().catch(() => undefined);
    throw besar();
  }
  if (res.body === null) return "";
  const pembaca = (res.body as unknown as { getReader(): PembacaByte }).getReader();
  const potongan: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const b = await pembaca.read();
    if (b.done || b.value === undefined) break;
    total += b.value.byteLength;
    if (total > batas) {
      await pembaca.cancel().catch(() => undefined);
      throw besar();
    }
    potongan.push(b.value);
  }
  return Buffer.concat(potongan).toString("utf8");
}
