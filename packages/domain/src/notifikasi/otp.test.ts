import { describe, expect, it } from "vitest";
import { awalHariWib, tanggalWib } from "./otp.js";
import { WaGalat } from "./whatsapp.js";

describe("tanggal WIB untuk penghitung harian OTP", () => {
  it("pergantian hari mengikuti WIB (UTC+7), bukan UTC", () => {
    expect(tanggalWib(new Date("2026-11-28T16:59:59Z"))).toBe("2026-11-28");
    expect(tanggalWib(new Date("2026-11-28T17:00:00Z"))).toBe("2026-11-29");
    expect(awalHariWib(new Date("2026-11-28T20:00:00Z")).toISOString()).toBe(
      "2026-11-28T17:00:00.000Z",
    );
  });
});

describe("WaGalat", () => {
  it("pesan hanya memuat kelas & kode penyedia", () => {
    const g = new WaGalat("PENERIMA", { kodePenyedia: "131026" });
    expect(g.message).toBe("WhatsApp gagal: PENERIMA (131026)");
    expect(g.kelas).toBe("PENERIMA");
  });
});
