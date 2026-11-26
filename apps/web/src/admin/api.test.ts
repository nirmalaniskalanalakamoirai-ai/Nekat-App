import { describe, expect, it } from "vitest";
import { normalisasiHp } from "./api";

describe("normalisasiHp", () => {
  it.each([
    ["0812 3456 7890", "+6281234567890"],
    ["6281234567890", "+6281234567890"],
    ["+62 812-3456-7890", "+6281234567890"],
    ["81234567890", "+6281234567890"],
  ])("%s → %s", (a, b) => {
    expect(normalisasiHp(a)).toBe(b);
  });
});
