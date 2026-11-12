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
