// SEMUA NOMOR FIKTIF.
import { describe, expect, it } from "vitest";
import { nodeEnvSah } from "./lingkungan.js";
import { normalisasiNomorHp, samarkanNomorHp } from "./nomor-hp.js";

describe("normalisasiNomorHp", () => {
  it.each([
    ["081234567890", "+6281234567890"],
    ["6281234567890", "+6281234567890"],
    ["+62 812-3456-7890", "+6281234567890"],
    ["(0812) 3456.7890", "+6281234567890"],
    ["81234567890", "+6281234567890"],
    ["+62081234567890", "+6281234567890"],
    ["0812345678", "+62812345678"],
  ])("%s → %s", (masuk, hasil) => {
    expect(normalisasiNomorHp(masuk)).toBe(hasil);
  });

  it.each([
    "",
    "+6521234567",
    "02112345678", // telepon rumah, bukan seluler
    "0812345", // terlalu pendek
    "08123456789012345", // terlalu panjang
    "0812abc4567",
    "+1 812 345 6789",
    "8".repeat(40),
  ])("menolak %j", (masuk) => {
    expect(normalisasiNomorHp(masuk)).toBeNull();
  });

  it("semua bentuk tulisan nomor yang sama menghasilkan satu E.164 (1 akun per nomor)", () => {
    const bentuk = ["0812 1111 2222", "62812-1111-2222", "+6281211112222", "81211112222"];
    expect(new Set(bentuk.map(normalisasiNomorHp)).size).toBe(1);
  });
});

describe("samarkanNomorHp", () => {
  it("hanya 3 digit awal & 2 digit akhir yang terlihat", () => {
    expect(samarkanNomorHp("+6281234567890")).toBe("+62 812•••• 90");
    expect(samarkanNomorHp("bukan-nomor")).toBe("+62 ••••");
  });
});

describe("nodeEnvSah", () => {
  it("hanya 4 nilai yang dikenal", () => {
    expect(["development", "test", "staging", "production"].every(nodeEnvSah)).toBe(true);
    expect([undefined, "", "prod", "Production"].some(nodeEnvSah)).toBe(false);
  });
});
