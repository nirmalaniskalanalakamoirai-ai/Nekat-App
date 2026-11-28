// Gateway WhatsApp Cloud API Meta (H2: jalur resmi) untuk mode `sandbox` dan `meta` (T-010 §3.1–§3.2).
//
// KERANGKA — BELUM DIUJI KE META NYATA. Asumsi yang wajib diverifikasi di WhatsApp Manager /
// dokumentasi Meta sebelum production (keputusan terbuka W-04):
// - Endpoint `POST {urlDasar}/{apiVersi}/{phoneNumberId}/messages`, header `Authorization: Bearer`.
// - Template authentication OTP: komponen body `{{1}}` = kode, dan tombol "Salin kode" (sub_type
//   `url`, index 0) dengan parameter = kode yang sama.
// - Respons sukses `{ messages: [{ id: "wamid…" }] }`; galat `{ error: { code, … } }`.
// - Tabel kode galat → kelas di `KELAS_GALAT_META` (T-010 §3.1).
// Meta tidak menyediakan kunci idempotensi; kunci dipakai di proses ini saja (satu kunci = satu kirim
// sukses), dan di DB oleh pemanggil (`pesan_wa.kunci`, menyusul).
//
// KEAMANAN: nomor & kode hanya di memori; galat/log tidak memuat body permintaan maupun respons.
import {
  WaGalat,
  type HasilKirimWa,
  type KelasGalatWa,
  type PesanOtp,
  type PesanTemplate,
  type WhatsAppGateway,
} from "@nekat/domain";
import { timingSafeEqual } from "node:crypto";
import type { IzinSandbox, KonfigMetaCloud } from "./konfigurasi.js";

/** Pemetaan kode galat Meta → kelas (T-010 §3.1; verifikasi ulang di dokumentasi Meta, W-04). */
export const KELAS_GALAT_META: Readonly<Record<number, KelasGalatWa>> = {
  4: "BATAS",
  80007: "BATAS",
  130429: "BATAS",
  131056: "BATAS",
  131049: "BATAS",
  131026: "PENERIMA",
  131050: "OPT_OUT_MARKETING",
  132000: "TEMPLATE",
  132001: "TEMPLATE",
  132012: "TEMPLATE",
  132015: "TEMPLATE",
  132016: "TEMPLATE",
  190: "OTENTIKASI",
  131031: "KEBIJAKAN",
  368: "KEBIJAKAN",
};

export function kelasDariKodeMeta(kode: number | undefined, status: number): KelasGalatWa {
  if (kode !== undefined) {
    const k = KELAS_GALAT_META[kode];
    if (k) return k;
  }
  if (status === 401 || status === 403) return "OTENTIKASI";
  if (status === 429) return "BATAS";
  // Kode tak dikenal / 5xx → SEMENTARA (pemanggil membatasi jumlah ulang).
  return "SEMENTARA";
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface OpsiMetaCloudGateway {
  readonly mode: "sandbox" | "meta";
  readonly konfig: KonfigMetaCloud;
  /** Wajib untuk sandbox. */
  readonly izinSandbox?: readonly IzinSandbox[];
  /** HMAC nomor HP dengan kunci versi tertentu (null = versi tidak dikenal). Wajib untuk sandbox. */
  readonly hmacHp?: (versi: number, nomorE164: string) => Buffer | null;
  readonly fetch?: FetchFn;
  /** Batas entri kunci idempotensi di memori. */
  readonly maksEntri?: number;
}

const BATAS_RESPONS_BYTE = 64 * 1024;

export class MetaCloudGateway implements WhatsAppGateway {
  readonly mode: "sandbox" | "meta";
  readonly #k: KonfigMetaCloud;
  readonly #izin: readonly IzinSandbox[];
  readonly #hmacHp: ((versi: number, nomor: string) => Buffer | null) | undefined;
  readonly #fetch: FetchFn;
  readonly #terkirim = new Map<string, string>();
  readonly #berjalan = new Map<string, Promise<HasilKirimWa>>();
  readonly #maks: number;

  constructor(o: OpsiMetaCloudGateway) {
    this.mode = o.mode;
    this.#k = o.konfig;
    this.#izin = o.izinSandbox ?? [];
    this.#hmacHp = o.hmacHp;
    this.#fetch = o.fetch ?? ((url, init) => fetch(url, init));
    this.#maks = o.maksEntri ?? 10_000;
    if (o.mode === "sandbox" && (this.#izin.length === 0 || !this.#hmacHp)) {
      throw new Error("MetaCloudGateway sandbox wajib punya daftar izin & hmacHp");
    }
  }

  /** Sandbox: hanya nomor yang HMAC-nya ada di daftar izin (dicocokkan per versi kunci entri). */
  #diizinkan(nomorE164: string): boolean {
    if (this.mode !== "sandbox") return true;
    let cocok = false;
    for (const e of this.#izin) {
      const h = this.#hmacHp?.(e.versi, nomorE164) ?? null;
      if (h?.length === e.hmac.length && timingSafeEqual(h, e.hmac)) cocok = true;
    }
    return cocok;
  }

  kirimOtp(p: PesanOtp): Promise<HasilKirimWa> {
    return this.#kirimIdempoten(p.kunciIdempotensi, p.nomorE164, () => ({
      name: this.#k.templateOtp,
      language: { code: this.#k.bahasa },
      components: [
        { type: "body", parameters: [{ type: "text", text: p.kode }] },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: p.kode }],
        },
      ],
    }));
  }

  kirimTemplate(p: PesanTemplate): Promise<HasilKirimWa> {
    return this.#kirimIdempoten(p.kunciIdempotensi, p.nomorE164, () => {
      const komponen: Record<string, unknown>[] = [];
      if (p.parameterBody.length > 0) {
        komponen.push({
          type: "body",
          parameters: p.parameterBody.map((text) => ({ type: "text", text })),
        });
      }
      if (p.parameterTombolUrl !== undefined) {
        komponen.push({
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: p.parameterTombolUrl }],
        });
      }
      return { name: p.namaTemplate, language: { code: p.bahasa }, components: komponen };
    });
  }

  #kirimIdempoten(
    kunci: string,
    nomorE164: string,
    template: () => Record<string, unknown>,
  ): Promise<HasilKirimWa> {
    const ada = this.#terkirim.get(kunci);
    if (ada) return Promise.resolve({ idPesanPenyedia: ada });
    const jalan = this.#berjalan.get(kunci);
    if (jalan) return jalan;
    const janji = (async () => {
      if (!this.#diizinkan(nomorE164)) {
        throw new WaGalat("PENERIMA", { kodePenyedia: "DIBLOKIR_SANDBOX" });
      }
      const id = await this.#panggil(nomorE164, template());
      if (this.#terkirim.size >= this.#maks) {
        const tertua = this.#terkirim.keys().next().value;
        if (tertua !== undefined) this.#terkirim.delete(tertua);
      }
      this.#terkirim.set(kunci, id);
      return { idPesanPenyedia: id };
    })().finally(() => {
      this.#berjalan.delete(kunci);
    });
    this.#berjalan.set(kunci, janji);
    return janji;
  }

  async #panggil(nomorE164: string, template: Record<string, unknown>): Promise<string> {
    const url = `${this.#k.urlDasar}/${this.#k.apiVersi}/${this.#k.phoneNumberId}/messages`;
    let r: Response;
    try {
      r = await this.#fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#k.ambilToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          // Meta menerima nomor internasional tanpa "+" (ASUMSI W-04).
          to: nomorE164.replace(/^\+/, ""),
          type: "template",
          template,
        }),
        signal: AbortSignal.timeout(this.#k.timeoutMs),
        redirect: "error",
      });
    } catch (err) {
      const nama = (err as { name?: string }).name;
      throw new WaGalat("SEMENTARA", {
        kodePenyedia: nama === "TimeoutError" || nama === "AbortError" ? "TIMEOUT" : "JARINGAN",
      });
    }
    const isi = await bacaJsonTerbatas(r);
    if (r.ok) {
      const id = (isi as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
      if (typeof id === "string" && id.length > 0 && id.length <= 256) return id;
      // 2xx tanpa wamid: anggap sementara (tidak tahu apakah terkirim). Jarang.
      throw new WaGalat("SEMENTARA", { kodePenyedia: "TANPA_WAMID" });
    }
    const galat = (isi as { error?: { code?: unknown } } | null)?.error;
    const kode = typeof galat?.code === "number" ? galat.code : undefined;
    const retryAfter = Number(r.headers.get("retry-after"));
    throw new WaGalat(kelasDariKodeMeta(kode, r.status), {
      kodePenyedia: kode !== undefined ? String(kode) : `HTTP_${String(r.status)}`,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { tundaDetik: retryAfter } : {}),
    });
  }
}

async function bacaJsonTerbatas(r: Response): Promise<unknown> {
  try {
    const buf = await r.arrayBuffer();
    if (buf.byteLength > BATAS_RESPONS_BYTE) return null;
    return JSON.parse(new TextDecoder().decode(buf)) as unknown;
  } catch {
    return null;
  }
}
