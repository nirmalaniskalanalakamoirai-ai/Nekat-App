// Mock server Xendit Payments API v3 — HANYA UNTUK TES (T-029). Tidak ikut build (`*.test-util.ts`).
// Meniru bentuk respons di dokumentasi publik (asumsi X-01–X-05 di xendit.ts), BUKAN Xendit nyata.
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface PrMock {
  payment_request_id: string;
  reference_id: string;
  type: string;
  country: string;
  currency: string;
  request_amount: number;
  capture_method: string;
  channel_code: string;
  channel_properties: Record<string, unknown>;
  actions: { type: string; descriptor: string; value: string }[];
  status: string;
  description?: string | undefined;
  metadata?: unknown;
  created: string;
  updated: string;
}

/** Gangguan per kunci rute: `buat`, `ambil`, `cari`, `batal`. */
export interface GangguanXendit {
  status?: number;
  body?: unknown;
  tundaMs?: number;
  redirect?: boolean;
  besarByte?: number;
  /** `buat`: tagihan tetap tercatat lalu respons ditunda (meniru timeout setelah diproses Xendit). */
  setelahTercatat?: boolean;
  kali?: number;
}

export type RuteXendit = "buat" | "ambil" | "cari" | "batal";

export interface PermintaanXendit {
  rute: RuteXendit;
  metode: string;
  url: string;
  header: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface MockXendit {
  readonly url: string;
  readonly kunci: string;
  readonly permintaan: PermintaanXendit[];
  readonly tagihan: Map<string, PrMock>;
  ganggu(rute: RuteXendit, g: GangguanXendit): void;
  bersihkanGangguan(): void;
  /** Endpoint pencarian reference_id tidak tersedia (404) — menguji jalur X-05 cadangan. */
  tanpaPencarian(aktif: boolean): void;
  bayar(referenceId: string, o?: { jumlah?: number }): void;
  kedaluwarsakan(referenceId: string): void;
  cariRef(referenceId: string): PrMock | undefined;
  tutup(): Promise<void>;
}

function bacaBody(req: IncomingMessage): Promise<string> {
  return new Promise((selesai, gagal) => {
    const bagian: Buffer[] = [];
    req.on("data", (c: Buffer) => bagian.push(c));
    req.on("end", () => {
      selesai(Buffer.concat(bagian).toString("utf8"));
    });
    req.on("error", gagal);
  });
}

const tunda = (ms: number) =>
  new Promise<void>((s) => {
    setTimeout(s, ms);
  });

function kirim(res: ServerResponse, status: number, body: unknown): void {
  const teks = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(teks),
  });
  res.end(teks);
}

export async function mulaiMockXendit(
  kunci = "xnd_development_ujiMockKunciRahasia0001",
): Promise<MockXendit> {
  const tagihan = new Map<string, PrMock>();
  const perIdem = new Map<string, string>();
  const permintaan: PermintaanXendit[] = [];
  const gangguan = new Map<RuteXendit, GangguanXendit>();
  let tanpaCari = false;
  const authBenar = `Basic ${Buffer.from(`${kunci}:`).toString("base64")}`;

  const ambilGangguan = (r: RuteXendit): GangguanXendit | undefined => {
    const g = gangguan.get(r);
    if (!g) return undefined;
    if (g.kali !== undefined) {
      g.kali--;
      if (g.kali <= 0) gangguan.delete(r);
    }
    return g;
  };

  const tanggapiGangguan = async (res: ServerResponse, g: GangguanXendit): Promise<boolean> => {
    if (g.tundaMs) await tunda(g.tundaMs);
    if (g.redirect) {
      res.writeHead(302, { location: "https://contoh.invalid/" });
      res.end();
      return true;
    }
    if (g.besarByte) {
      kirim(res, 200, { isi: "x".repeat(g.besarByte) });
      return true;
    }
    if (g.status) {
      kirim(res, g.status, g.body ?? { error_code: "SERVER_ERROR", message: "mock" });
      return true;
    }
    return false;
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const teks = await bacaBody(req);
      let body: unknown;
      try {
        body = teks === "" ? null : (JSON.parse(teks) as unknown);
      } catch {
        body = null;
      }
      const m = /^\/v3\/payment_requests(?:\/(pr-[0-9a-f-]{36}))?(\/cancel)?$/.exec(u.pathname);
      if (!m) {
        kirim(res, 404, { error_code: "NOT_FOUND" });
        return;
      }
      const id = m[1];
      const rute: RuteXendit =
        req.method === "POST" && !id ? "buat" : m[2] ? "batal" : id ? "ambil" : "cari";
      permintaan.push({
        rute,
        metode: req.method ?? "",
        url: req.url ?? "",
        header: req.headers,
        body,
      });

      if (req.headers.authorization !== authBenar) {
        kirim(res, 401, { error_code: "INVALID_API_KEY", message: "API key is invalid" });
        return;
      }
      if (req.headers["api-version"] !== "2024-11-11") {
        kirim(res, 400, { error_code: "API_VALIDATION_ERROR", message: "api-version" });
        return;
      }
      const g = ambilGangguan(rute);
      if (g && !g.setelahTercatat && (await tanggapiGangguan(res, g))) return;

      if (rute === "buat") {
        const b = body as Partial<PrMock> & { request_amount?: unknown };
        const idem = req.headers["idempotency-key"];
        const kunciIdem = typeof idem === "string" ? idem : null;
        if (kunciIdem !== null) {
          const lama = perIdem.get(kunciIdem);
          if (lama) {
            const pr = tagihan.get(lama);
            if (g?.setelahTercatat) await tanggapiGangguan(res, g);
            if (pr && !res.headersSent) {
              kirim(res, 200, pr);
              return;
            }
            return;
          }
        }
        if (typeof b.request_amount !== "number" || b.request_amount < 1) {
          kirim(res, 400, {
            error_code: "API_VALIDATION_ERROR",
            message: "request_amount must be >= 1",
          });
          return;
        }
        if (b.channel_code === "OVO_TIDAK_ADA_VIRTUAL_ACCOUNT") {
          kirim(res, 400, { error_code: "CHANNEL_NOT_SUPPORTED", message: "channel" });
          return;
        }
        const prId = `pr-${randomUUID()}`;
        const h = createHash("sha256").update(prId).digest("hex");
        const sekarang = new Date().toISOString();
        const qr = b.channel_code === "QRIS";
        const pr: PrMock = {
          payment_request_id: prId,
          reference_id: String(b.reference_id),
          type: String(b.type),
          country: String(b.country),
          currency: String(b.currency),
          request_amount: b.request_amount,
          capture_method: String(b.capture_method),
          channel_code: String(b.channel_code),
          channel_properties: b.channel_properties ?? {},
          actions: [
            qr
              ? {
                  type: "PRESENT_TO_CUSTOMER",
                  descriptor: "QR_STRING",
                  value: `00020101021226MOCK${h.slice(0, 32)}6304ABCD`,
                }
              : {
                  type: "PRESENT_TO_CUSTOMER",
                  descriptor: "VIRTUAL_ACCOUNT_NUMBER",
                  value: `9888${BigInt(`0x${h.slice(0, 12)}`)
                    .toString()
                    .slice(0, 12)}`,
                },
          ],
          status: "ACCEPTING_PAYMENTS",
          description: b.description,
          metadata: b.metadata,
          created: sekarang,
          updated: sekarang,
        };
        tagihan.set(prId, pr);
        if (kunciIdem !== null) perIdem.set(kunciIdem, prId);
        if (g?.setelahTercatat) {
          await tanggapiGangguan(res, g);
          if (res.headersSent) return;
        }
        kirim(res, 201, pr);
        return;
      }
      if (rute === "cari") {
        if (tanpaCari) {
          kirim(res, 404, { error_code: "NOT_FOUND" });
          return;
        }
        const ref = u.searchParams.get("reference_id");
        kirim(res, 200, {
          data: [...tagihan.values()].filter((p) => p.reference_id === ref),
          has_more: false,
        });
        return;
      }
      const pr = id ? tagihan.get(id) : undefined;
      if (!pr) {
        kirim(res, 404, { error_code: "DATA_NOT_FOUND", message: "not found" });
        return;
      }
      if (rute === "ambil") {
        kirim(res, 200, pr);
        return;
      }
      if (pr.status !== "ACCEPTING_PAYMENTS") {
        kirim(res, 400, { error_code: "INACTIVE_PAYMENT_REQUEST", message: "inactive" });
        return;
      }
      pr.status = "CANCELED";
      pr.updated = new Date().toISOString();
      kirim(res, 200, pr);
    })().catch(() => {
      if (!res.headersSent) kirim(res, 500, { error_code: "SERVER_ERROR" });
    });
  });

  await new Promise<void>((s) => server.listen(0, "127.0.0.1", s));
  const port = (server.address() as AddressInfo).port;
  const cariRef = (ref: string) => [...tagihan.values()].find((p) => p.reference_id === ref);
  return {
    url: `http://127.0.0.1:${String(port)}/`,
    kunci,
    permintaan,
    tagihan,
    ganggu: (r, g) => gangguan.set(r, { ...g }),
    bersihkanGangguan: () => {
      gangguan.clear();
    },
    tanpaPencarian: (a) => {
      tanpaCari = a;
    },
    bayar: (ref, o = {}) => {
      const pr = cariRef(ref);
      if (!pr) throw new Error("ref tidak ada");
      pr.status = "SUCCEEDED";
      if (o.jumlah !== undefined) pr.request_amount = o.jumlah;
      pr.updated = new Date().toISOString();
    },
    kedaluwarsakan: (ref) => {
      const pr = cariRef(ref);
      if (pr) pr.status = "EXPIRED";
    },
    cariRef,
    tutup: () =>
      new Promise<void>((s) => {
        server.closeAllConnections();
        server.close(() => {
          s();
        });
      }),
  };
}
