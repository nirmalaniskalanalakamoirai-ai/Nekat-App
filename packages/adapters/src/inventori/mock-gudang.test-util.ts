// Mock server API Gudang-Repo — HANYA UNTUK TES (T-019). Tidak diekspor dari paket dan tidak ikut build
// (`*.test-util.ts` dikecualikan tsconfig.build). Format kawat = DEFAULT SEMENTARA (I-01, T-009 §12).
// node:http murni agar adapters tidak butuh dependensi server.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface SkuMock {
  id: string;
  nama: string;
  kategori: string;
  satuanDasar: string;
  konversi: { satuan: string; isi: number; beratGram: number | null }[];
  beratGram: number | null;
  barcode: string | null;
  aktif: boolean;
  diubahPada: string;
}

export interface StokMock {
  skuId: string;
  lokasi: string;
  tersedia: number;
  satuan: string;
  dataPada: string;
}

export interface ModalMock {
  skuId: string;
  satuan: string;
  modal: unknown;
  dataPada: string;
}

/** Gangguan yang disuntikkan per path (`/v1/sku`, `/v1/stok/cari`, …). */
export interface Gangguan {
  status?: number;
  retryAfter?: string;
  /** Tunda respons (ms) → memicu timeout klien. */
  tundaMs?: number;
  /** Balas 302 ke host lain. */
  redirect?: boolean;
  /** Balas body JSON sebesar ini (byte). */
  besarByte?: number;
  /** Tanpa content-length (chunked) untuk `besarByte`. */
  tanpaPanjang?: boolean;
  bukanJson?: boolean;
  /** Body JSON pengganti apa adanya. */
  body?: unknown;
  /** Berlaku untuk N permintaan berikutnya saja (bawaan: terus). */
  kali?: number;
}

export interface PermintaanTercatat {
  metode: string;
  path: string;
  query: Record<string, string>;
  header: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface MockGudang {
  readonly url: string;
  readonly token: string;
  sku: SkuMock[];
  stok: StokMock[];
  modal: ModalMock[];
  /** Ukuran halaman `GET /v1/sku` (kursor). */
  ukuranHalamanSku: number;
  readonly gangguan: Map<string, Gangguan>;
  readonly permintaan: PermintaanTercatat[];
  /** Picking yang diterima Gudang per Idempotency-Key. */
  readonly picking: Map<string, { hash: string; body: unknown; referensi: string }>;
  readonly konfirmasi: Map<string, { hash: string; hasil: unknown }>;
  /** qty tersedia untuk konfirmasi per `lokasi|skuId`; bawaan dari `stok`. */
  tutup(): Promise<void>;
}

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export async function mulaiMockGudang(token = "token-mock-gudang-uji"): Promise<MockGudang> {
  const keadaan = {
    sku: [] as SkuMock[],
    stok: [] as StokMock[],
    modal: [] as ModalMock[],
    ukuranHalamanSku: 1000,
    gangguan: new Map<string, Gangguan>(),
    permintaan: [] as PermintaanTercatat[],
    picking: new Map<string, { hash: string; body: unknown; referensi: string }>(),
    konfirmasi: new Map<string, { hash: string; hasil: unknown }>(),
  };
  let nomorPicking = 0;

  const kirim = (res: ServerResponse, status: number, body: unknown) => {
    const teks = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(teks),
    });
    res.end(teks);
  };

  const tangani = async (req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const potongan: Buffer[] = [];
    for await (const c of req) potongan.push(c as Buffer);
    const teks = Buffer.concat(potongan).toString("utf8");
    let body: unknown;
    try {
      body = teks === "" ? null : (JSON.parse(teks) as unknown);
    } catch {
      body = teks;
    }
    // Base URL mock memakai prefix /api (seperti contoh .env); path setelahnya = path kontrak.
    const path = u.pathname.replace(/^\/api/, "");
    keadaan.permintaan.push({
      metode: req.method ?? "",
      path,
      query: Object.fromEntries(u.searchParams),
      header: { ...req.headers },
      body,
    });

    const g = keadaan.gangguan.get(path);
    if (g) {
      if (g.kali !== undefined) {
        g.kali--;
        if (g.kali <= 0) keadaan.gangguan.delete(path);
      }
      if (g.tundaMs !== undefined) {
        await new Promise((r) => setTimeout(r, g.tundaMs));
        if (res.destroyed) return;
      }
      if (g.redirect) {
        res.writeHead(302, { location: "https://penyerang.contoh/curi" });
        res.end();
        return;
      }
      if (g.besarByte !== undefined) {
        const isi = `{"data":[],"isi":"${"x".repeat(g.besarByte)}"}`;
        res.writeHead(200, {
          "content-type": "application/json",
          ...(g.tanpaPanjang ? {} : { "content-length": Buffer.byteLength(isi) }),
        });
        res.end(isi);
        return;
      }
      if (g.bukanJson) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("<html>bukan json</html>");
        return;
      }
      if (g.status !== undefined) {
        res.writeHead(g.status, {
          "content-type": "application/json",
          ...(g.retryAfter ? { "retry-after": g.retryAfter } : {}),
        });
        res.end(JSON.stringify({ galat: "gangguan uji" }));
        return;
      }
      if (g.body !== undefined) {
        kirim(res, 200, g.body);
        return;
      }
    }

    if (req.headers.authorization !== `Bearer ${token}`) {
      kirim(res, 401, { galat: "tidak terotorisasi" });
      return;
    }

    const kunci = req.headers["idempotency-key"];
    const o = (body ?? {}) as Record<string, unknown>;
    if (req.method === "GET" && path === "/v1/sku") {
      const sejak = u.searchParams.get("sejak");
      const daftar = keadaan.sku.filter((s) => sejak === null || s.diubahPada > sejak);
      const mulai = Number(u.searchParams.get("kursor") ?? "0");
      const halaman = daftar.slice(mulai, mulai + keadaan.ukuranHalamanSku);
      const lanjut = mulai + keadaan.ukuranHalamanSku;
      kirim(res, 200, {
        data: halaman,
        berikutnya: lanjut < daftar.length ? String(lanjut) : null,
      });
      return;
    }
    if (req.method === "POST" && path === "/v1/stok/cari") {
      const ids = new Set(Array.isArray(o["skuIds"]) ? (o["skuIds"] as string[]) : []);
      kirim(res, 200, {
        data: keadaan.stok.filter((s) => ids.has(s.skuId) && s.lokasi === o["lokasi"]),
      });
      return;
    }
    if (req.method === "POST" && path === "/v1/modal/cari") {
      const ids = new Set(Array.isArray(o["skuIds"]) ? (o["skuIds"] as string[]) : []);
      kirim(res, 200, { data: keadaan.modal.filter((m) => ids.has(m.skuId)) });
      return;
    }
    if (req.method === "POST" && path === "/v1/stok/konfirmasi" && typeof kunci === "string") {
      const h = hashBody(body);
      const lama = keadaan.konfirmasi.get(kunci);
      if (lama) {
        if (lama.hash !== h) kirim(res, 409, { galat: "konflik" });
        else kirim(res, 200, lama.hasil);
        return;
      }
      const stok = keadaan.stok.find((s) => s.skuId === o["skuId"] && s.lokasi === o["lokasi"]);
      const hasil = {
        qtyTersedia: Math.min(stok?.tersedia ?? 0, Number(o["qtyDibutuhkan"])),
        dataPada: "2026-11-26T05:00:00+07:00",
      };
      keadaan.konfirmasi.set(kunci, { hash: h, hasil });
      kirim(res, 200, hasil);
      return;
    }
    if (req.method === "POST" && path === "/v1/picking" && typeof kunci === "string") {
      const h = hashBody(body);
      const lama = keadaan.picking.get(kunci);
      if (lama) {
        if (lama.hash !== h) kirim(res, 409, { galat: "konflik" });
        else kirim(res, 200, { status: "DUPLIKAT", referensi: lama.referensi });
        return;
      }
      const referensi = `PK-${String(++nomorPicking).padStart(5, "0")}`;
      keadaan.picking.set(kunci, { hash: h, body, referensi });
      kirim(res, 201, { status: "DITERIMA", referensi });
      return;
    }
    kirim(res, 404, { galat: "tidak ditemukan" });
  };

  const server: Server = createServer((req, res) => {
    tangani(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  return Object.assign(keadaan, {
    url: `http://127.0.0.1:${port}/api`,
    token,
    tutup: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => {
          r();
        });
      }),
  });
}
