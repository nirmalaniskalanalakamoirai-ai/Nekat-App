import { PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";
import { bacaKonfigurasi } from "./config.js";
import { buatWorker } from "./worker.js";

// Nilai uji non-rahasia; tidak ada koneksi DB yang dibuka di tes ini.
const URL_UJI = "postgres://pengguna_uji@localhost:5432/nekat_uji";

describe("konfigurasi worker", () => {
  it("menolak DATABASE_URL kosong tanpa membocorkan nilai", () => {
    expect(() => bacaKonfigurasi({})).toThrow("Konfigurasi worker tidak valid: DATABASE_URL");
    expect(() => bacaKonfigurasi({ DATABASE_URL: "mysql://rahasia@x/y" })).toThrow(
      /^Konfigurasi worker tidak valid: DATABASE_URL$/,
    );
  });

  it("menerima URL postgres", () => {
    expect(bacaKonfigurasi({ DATABASE_URL: URL_UJI }).databaseUrl).toBe(URL_UJI);
  });
});

describe("buatWorker", () => {
  it("membuat instans pg-boss tanpa menyambung ke database", () => {
    const boss = buatWorker({ databaseUrl: URL_UJI });
    expect(boss).toBeInstanceOf(PgBoss);
  });
});
