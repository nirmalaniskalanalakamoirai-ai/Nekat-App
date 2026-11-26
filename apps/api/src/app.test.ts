import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { buatApp } from "./app.js";
import { bacaKonfigLokasi } from "./lokasi.js";

describe("GET /health", () => {
  const app = buatApp({ logger: false });
  afterAll(() => app.close());

  it("mengembalikan 200 {status: ok}", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rute tidak dikenal mengembalikan 404", async () => {
    const res = await app.inject({ method: "GET", url: "/tidak-ada" });
    expect(res.statusCode).toBe(404);
  });
});

describe("redaksi log", () => {
  it("menyensor authorization/cookie/x-callback-token walau header dicatat langsung", async () => {
    const baris: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        baris.push(chunk.toString());
        cb();
      },
    });
    const app = buatApp({ logStream: stream });
    app.get("/uji-log", (request) => {
      request.log.info({ headers: request.headers }, "uji");
      return { ok: true };
    });
    await app.inject({
      method: "GET",
      url: "/uji-log",
      headers: {
        authorization: "Bearer PENANDA_RAHASIA_1",
        cookie: "sesi=PENANDA_RAHASIA_2",
        "x-callback-token": "PENANDA_RAHASIA_3",
      },
    });
    await app.close();
    const log = baris.join("");
    expect(log).not.toContain("PENANDA_RAHASIA");
    expect(log).toContain("[disensor]");
  });

  it("respons /health tidak membocorkan x-powered-by", async () => {
    const app = buatApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/health" });
    await app.close();
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["content-type"]).toContain("application/json");
  });
});

describe("zona (T-015)", () => {
  const lokasi = bacaKonfigLokasi(
    JSON.parse(
      readFileSync(new URL("../../../config/lokasi.example.json", import.meta.url), "utf8"),
    ) as unknown,
  );

  it("config contoh bertanda uji (koordinat fiktif, keputusan #3 belum diisi)", () => {
    expect(lokasi.uji).toBe(true);
  });

  it("tanpa config: 503 ZONA_BELUM_DIATUR", async () => {
    const app = buatApp({ logger: false });
    const r = await app.inject({
      method: "POST",
      url: "/api/zona/cek",
      payload: { lat: -6.2, lng: 106.6 },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ kode: "ZONA_BELUM_DIATUR" });
  });

  it("daftar zona tanpa koordinat", async () => {
    const app = buatApp({ logger: false, lokasi });
    const r = await app.inject({ method: "GET", url: "/api/zona" });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("lat");
    expect(r.json()).toMatchObject({
      zona: [{ kode: "zona-pilot", dropPoint: [{ kode: "dp-pusat" }] }],
    });
  });

  it("cek: dalam zona dan di luar zona", async () => {
    const app = buatApp({ logger: false, lokasi });
    const dalam = await app.inject({
      method: "POST",
      url: "/api/zona/cek",
      payload: { lat: -6.205, lng: 106.6 },
    });
    expect(dalam.json()).toMatchObject({ status: "DALAM_ZONA", zonaKode: "zona-pilot" });
    const luar = await app.inject({
      method: "POST",
      url: "/api/zona/cek",
      payload: { lat: -6.5, lng: 107 },
    });
    expect(luar.json()).toEqual({ status: "DI_LUAR_ZONA" });
  });

  it("cek: koordinat tidak valid ditolak 400", async () => {
    const app = buatApp({ logger: false, lokasi });
    const r = await app.inject({
      method: "POST",
      url: "/api/zona/cek",
      payload: { lat: 95, lng: 106.6 },
    });
    expect(r.statusCode).toBe(400);
  });

  it("config: radius di luar 2–3 km dan kode ganda ditolak", () => {
    const salah = structuredClone(lokasi) as {
      zona: { kode: string; dropPoint: { radiusMeter: number }[] }[];
    };
    const z0 = salah.zona[0];
    if (z0?.dropPoint[0]) z0.dropPoint[0].radiusMeter = 5000;
    expect(() => bacaKonfigLokasi(salah)).toThrow(/radiusMeter/);
    const ganda = structuredClone(lokasi) as { zona: { kode: string }[] };
    if (ganda.zona[0]) ganda.zona[0].kode = "gudang-pusat";
    expect(() => bacaKonfigLokasi(ganda)).toThrow(/kode ganda/);
  });
});
