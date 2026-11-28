import { describe, expect, it } from "vitest";
import { formatMenitDetik, linkMasuk, tujuanSetelahMasuk } from "./tujuan";

describe("tujuan setelah masuk (anti open redirect)", () => {
  it.each([
    ["/g/AB12CD", "/g/AB12CD"],
    ["/checkout?slot=3", "/checkout?slot=3"],
    [
      "/tagihan/0193b9a0-0000-7000-8000-000000000001",
      "/tagihan/0193b9a0-0000-7000-8000-000000000001",
    ],
  ])("%s diterima", (masuk, hasil) => {
    expect(tujuanSetelahMasuk(masuk)).toBe(hasil);
  });

  it.each([
    null,
    "",
    "//jahat.contoh",
    "/\\jahat.contoh",
    "https://jahat.contoh",
    "javascript:alert(1)",
    "/masuk",
    "/masuk?kembali=/g/X",
    "/ada spasi",
    `/${"a".repeat(600)}`,
  ])("%j → beranda", (masuk) => {
    expect(tujuanSetelahMasuk(masuk)).toBe("/");
  });

  it("linkMasuk membawa asal yang aman", () => {
    expect(linkMasuk("/g/AB12CD")).toBe("/masuk?kembali=%2Fg%2FAB12CD");
    expect(linkMasuk("//x")).toBe("/masuk");
  });

  it("hitung mundur m:ss", () => {
    expect(formatMenitDetik(60)).toBe("1:00");
    expect(formatMenitDetik(9)).toBe("0:09");
    expect(formatMenitDetik(-3)).toBe("0:00");
  });
});
