// Tes adapter WhatsApp (T-016): penjaga start, mode log, sandbox (daftar izin), kerangka Meta (fetch palsu,
// TIDAK menghubungi Meta). SEMUA NOMOR & TOKEN FIKTIF.
import { WaGalat } from "@nekat/domain";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bacaKonfigWhatsApp, KonfigWhatsAppTidakValidError } from "./konfigurasi.js";
import { LogGateway } from "./log-gateway.js";
import { kelasDariKodeMeta, MetaCloudGateway } from "./meta-gateway.js";
import { buatWhatsAppGateway } from "./pabrik.js";

const NOMOR = "+6281200001111";
const NOMOR_LAIN = "+6281200002222";
const KUNCI_HP: Record<number, Buffer> = { 1: Buffer.alloc(32, 1), 2: Buffer.alloc(32, 2) };
const hmacHp = (versi: number, nomor: string) => {
  const k = KUNCI_HP[versi];
  return k ? createHmac("sha256", k).update(nomor, "utf8").digest() : null;
};
const entriIzin = (versi: number, nomor: string) =>
  `v${String(versi)}:${hmacHp(versi, nomor)?.toString("hex") ?? ""}`;

const META = {
  WA_API_VERSI: "v21.0",
  WA_PHONE_NUMBER_ID: "1234567890",
  WA_ACCESS_TOKEN: "TOKEN_UJI_FIKTIF_0123456789",
};

function salahDari(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof KonfigWhatsAppTidakValidError) return e.variabel;
    throw e;
  }
  return [];
}

describe("penjaga start WhatsApp", () => {
  const baca = (env: Record<string, string>) => bacaKonfigWhatsApp(env, { versiKunciHp: [1, 2] });

  it("dev/test tanpa WA_MODE → log", () => {
    expect(baca({ NODE_ENV: "development" }).mode).toBe("log");
    expect(baca({ NODE_ENV: "test" }).mode).toBe("log");
  });

  it("NODE_ENV kosong / tidak dikenal → gagal start", () => {
    expect(salahDari(() => baca({ WA_MODE: "log" }))).toContain("NODE_ENV");
    expect(salahDari(() => baca({ NODE_ENV: "prod", WA_MODE: "log" }))).toContain("NODE_ENV");
  });

  it("production: log & sandbox ditolak, meta wajib (TC-NJ-02)", () => {
    expect(salahDari(() => baca({ NODE_ENV: "production", WA_MODE: "log" }))).toEqual(["WA_MODE"]);
    expect(salahDari(() => baca({ NODE_ENV: "production" }))).toEqual(["WA_MODE"]);
    expect(
      salahDari(() =>
        baca({
          NODE_ENV: "production",
          WA_MODE: "sandbox",
          ...META,
          WA_SANDBOX_NOMOR_IZIN: entriIzin(1, NOMOR),
        }),
      ),
    ).toContain("WA_MODE");
    const k = baca({ NODE_ENV: "production", WA_MODE: "meta", ...META });
    expect(k.mode).toBe("meta");
    expect(k.meta?.ambilToken()).toBe(META.WA_ACCESS_TOKEN);
    // Token tidak ikut ter-serialisasi.
    expect(JSON.stringify(k)).not.toContain(META.WA_ACCESS_TOKEN);
  });

  it("meta di luar production ditolak (TC-NJ-03)", () => {
    expect(salahDari(() => baca({ NODE_ENV: "staging", WA_MODE: "meta", ...META }))).toEqual([
      "WA_MODE",
    ]);
  });

  it("staging wajib WA_MODE eksplisit", () => {
    expect(salahDari(() => baca({ NODE_ENV: "staging" }))).toEqual(["WA_MODE"]);
  });

  it("production: hanya Graph API resmi, daftar izin sandbox tertinggal ditolak", () => {
    expect(
      salahDari(() =>
        baca({
          NODE_ENV: "production",
          WA_MODE: "meta",
          ...META,
          WA_API_URL: "https://bsp.contoh",
        }),
      ),
    ).toEqual(["WA_API_URL"]);
    expect(
      salahDari(() =>
        baca({
          NODE_ENV: "production",
          WA_MODE: "meta",
          ...META,
          WA_SANDBOX_NOMOR_IZIN: entriIzin(1, NOMOR),
        }),
      ),
    ).toEqual(["WA_SANDBOX_NOMOR_IZIN"]);
  });

  it("sandbox: daftar izin wajib, format v{versi}:{hex}, versi harus dikenal (TC-NJ-49)", () => {
    const dasar = { NODE_ENV: "staging", WA_MODE: "sandbox", ...META };
    expect(salahDari(() => baca(dasar))).toEqual(["WA_SANDBOX_NOMOR_IZIN"]);
    expect(salahDari(() => baca({ ...dasar, WA_SANDBOX_NOMOR_IZIN: "+6281200001111" }))).toEqual([
      "WA_SANDBOX_NOMOR_IZIN",
    ]);
    expect(
      salahDari(() => baca({ ...dasar, WA_SANDBOX_NOMOR_IZIN: `v9:${"ab".repeat(32)}` })),
    ).toEqual(["WA_SANDBOX_NOMOR_IZIN"]);
    const k = baca({
      ...dasar,
      WA_SANDBOX_NOMOR_IZIN: `${entriIzin(1, NOMOR)}, ${entriIzin(2, NOMOR_LAIN)}`,
    });
    expect(k.izinSandbox.map((e) => e.versi)).toEqual([1, 2]);
  });

  it("kredensial Meta salah → hanya NAMA variabel di pesan, tanpa nilai", () => {
    try {
      baca({ NODE_ENV: "production", WA_MODE: "meta", ...META, WA_ACCESS_TOKEN: "pendek rahasia" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("WA_ACCESS_TOKEN");
      expect((e as Error).message).not.toContain("rahasia");
    }
  });

  it("pabrik menolak LogGateway di production (pertahanan berlapis)", () => {
    expect(() =>
      buatWhatsAppGateway(
        { nodeEnv: "production", mode: "log", meta: null, izinSandbox: [] },
        { hmacHp, ttlKodeMs: 1000 },
      ),
    ).toThrow();
  });
});

describe("LogGateway", () => {
  it("kode hanya di memori, kedaluwarsa sesuai TTL, catatan log tanpa nomor/kode", async () => {
    let kini = 1_000;
    const catatan: unknown[] = [];
    const g = new LogGateway({
      ttlKodeMs: 5_000,
      sekarang: () => kini,
      catat: (c) => catatan.push(c),
    });
    await g.kirimOtp({ nomorE164: NOMOR, kode: "123456", kunciIdempotensi: "otp:a" });
    expect(g.ambilKodeTerakhir(NOMOR)).toBe("123456");
    expect(g.ambilKodeTerakhir(NOMOR_LAIN)).toBeNull();
    const teks = JSON.stringify(catatan);
    expect(teks).not.toContain("123456");
    expect(teks).not.toContain("81200001111");
    kini += 5_001;
    expect(g.ambilKodeTerakhir(NOMOR)).toBeNull();
  });

  it("kunci idempotensi sama → satu kiriman, kode tidak tertimpa", async () => {
    const g = new LogGateway({ ttlKodeMs: 60_000 });
    const a = await g.kirimOtp({ nomorE164: NOMOR, kode: "111111", kunciIdempotensi: "otp:x" });
    const b = await g.kirimOtp({ nomorE164: NOMOR, kode: "222222", kunciIdempotensi: "otp:x" });
    expect(b.idPesanPenyedia).toBe(a.idPesanPenyedia);
    expect(g.jumlahTerkirim).toBe(1);
    expect(g.ambilKodeTerakhir(NOMOR)).toBe("111111");
  });
});

function fetchPalsu(jawab: (n: number, body: Record<string, unknown>) => Response) {
  const panggilan: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fn = (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const h = new Headers(init.headers);
    panggilan.push({ url, body, auth: h.get("authorization") ?? "" });
    return Promise.resolve(jawab(panggilan.length, body));
  };
  return { fn, panggilan };
}

const KONFIG_META = {
  apiVersi: "v21.0",
  phoneNumberId: "1234567890",
  ambilToken: () => META.WA_ACCESS_TOKEN,
  templateOtp: "auth_otp_v1",
  bahasa: "id" as const,
  timeoutMs: 1000,
  urlDasar: "https://graph.contoh",
};

const sukses = (id = "wamid.UJI1") =>
  new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });
const galatMeta = (code: number, status = 400) =>
  new Response(JSON.stringify({ error: { code, message: "rahasia isi" } }), { status });

describe("MetaCloudGateway (kerangka, fetch palsu)", () => {
  it("bentuk permintaan template OTP: body + tombol salin kode, nomor tanpa '+'", async () => {
    const f = fetchPalsu(() => sukses());
    const g = new MetaCloudGateway({ mode: "meta", konfig: KONFIG_META, fetch: f.fn });
    const h = await g.kirimOtp({ nomorE164: NOMOR, kode: "654321", kunciIdempotensi: "otp:1" });
    expect(h.idPesanPenyedia).toBe("wamid.UJI1");
    const p = f.panggilan[0];
    expect(p?.url).toBe("https://graph.contoh/v21.0/1234567890/messages");
    expect(p?.auth).toBe(`Bearer ${META.WA_ACCESS_TOKEN}`);
    expect(p?.body).toMatchObject({
      messaging_product: "whatsapp",
      to: "6281200001111",
      type: "template",
      template: {
        name: "auth_otp_v1",
        language: { code: "id" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "654321" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ text: "654321" }] },
        ],
      },
    });
  });

  it("kunci idempotensi sama (berurutan & paralel) → satu panggilan ke Meta", async () => {
    const f = fetchPalsu(() => sukses());
    const g = new MetaCloudGateway({ mode: "meta", konfig: KONFIG_META, fetch: f.fn });
    const p = { nomorE164: NOMOR, kode: "000001", kunciIdempotensi: "otp:2" };
    await Promise.all([g.kirimOtp(p), g.kirimOtp(p)]);
    await g.kirimOtp(p);
    expect(f.panggilan).toHaveLength(1);
  });

  it("pemetaan kode galat Meta → kelas; pesan galat tanpa isi respons", async () => {
    const kasus: [number, number, string][] = [
      [131026, 400, "PENERIMA"],
      [130429, 429, "BATAS"],
      [132015, 400, "TEMPLATE"],
      [190, 401, "OTENTIKASI"],
      [368, 400, "KEBIJAKAN"],
      [999999, 500, "SEMENTARA"],
    ];
    for (const [code, status, kelas] of kasus) {
      const f = fetchPalsu(() => galatMeta(code, status));
      const g = new MetaCloudGateway({ mode: "meta", konfig: KONFIG_META, fetch: f.fn });
      const e = await g
        .kirimOtp({ nomorE164: NOMOR, kode: "1", kunciIdempotensi: `k${String(code)}` })
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(WaGalat);
      expect((e as WaGalat).kelas).toBe(kelas);
      expect((e as WaGalat).message).not.toContain("rahasia");
    }
    expect(kelasDariKodeMeta(undefined, 503)).toBe("SEMENTARA");
  });

  it("jaringan/timeout → SEMENTARA; gagal tidak dicatat sebagai terkirim (boleh dicoba lagi)", async () => {
    let n = 0;
    const g = new MetaCloudGateway({
      mode: "meta",
      konfig: KONFIG_META,
      fetch: () => {
        n++;
        return n === 1
          ? Promise.reject(Object.assign(new Error("x"), { name: "TimeoutError" }))
          : Promise.resolve(sukses("wamid.ULANG"));
      },
    });
    const p = { nomorE164: NOMOR, kode: "1", kunciIdempotensi: "otp:t" };
    const e = await g.kirimOtp(p).catch((x: unknown) => x);
    expect((e as WaGalat).kelas).toBe("SEMENTARA");
    expect((e as WaGalat).kodePenyedia).toBe("TIMEOUT");
    expect((await g.kirimOtp(p)).idPesanPenyedia).toBe("wamid.ULANG");
  });

  it("sandbox: nomor di luar daftar izin tidak dikirim (TC-NJ-04); cocok per versi kunci", async () => {
    const f = fetchPalsu(() => sukses());
    const g = new MetaCloudGateway({
      mode: "sandbox",
      konfig: KONFIG_META,
      fetch: f.fn,
      hmacHp,
      izinSandbox: [{ versi: 2, hmac: hmacHp(2, NOMOR) ?? Buffer.alloc(0) }],
    });
    const e = await g
      .kirimOtp({ nomorE164: NOMOR_LAIN, kode: "1", kunciIdempotensi: "s1" })
      .catch((x: unknown) => x);
    expect((e as WaGalat).kelas).toBe("PENERIMA");
    expect((e as WaGalat).kodePenyedia).toBe("DIBLOKIR_SANDBOX");
    expect(f.panggilan).toHaveLength(0);
    await g.kirimOtp({ nomorE164: NOMOR, kode: "1", kunciIdempotensi: "s2" });
    expect(f.panggilan).toHaveLength(1);
  });
});
