import { Writable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { buatApp } from "./app.js";

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
