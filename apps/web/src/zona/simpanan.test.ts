import { describe, expect, it } from "vitest";
import { tujuanSetelahZona } from "./simpanan";

describe("tujuanSetelahZona", () => {
  it("kembali ke link grup yang valid", () => {
    expect(tujuanSetelahZona("/g/AB12CD")).toBe("/g/AB12CD");
  });
  it("menolak tujuan lain (cegah open redirect)", () => {
    for (const t of ["https://jahat.example", "//jahat.example", "/akun", "/g/../akun", null]) {
      expect(tujuanSetelahZona(t)).toBe("/");
    }
  });
});
