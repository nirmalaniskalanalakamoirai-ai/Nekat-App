import { describe, expect, it } from "vitest";
import { jarakMeter, koordinatValid, tentukanZona, type ZonaLayanan } from "./zona.js";

// Titik uji fiktif di sekitar Tangerang (bukan alamat nyata).
const DP_A = { kode: "dp-a", nama: "Drop point A", lat: -6.2, lng: 106.6, radiusMeter: 2500 };
const DP_B = { kode: "dp-b", nama: "Drop point B", lat: -6.2, lng: 106.63, radiusMeter: 2500 };
const ZONA: ZonaLayanan[] = [
  { kode: "zona-a", namaKelurahan: "Kelurahan A", dropPoint: [DP_A] },
  { kode: "zona-b", namaKelurahan: "Kelurahan B", dropPoint: [DP_B] },
];

describe("jarakMeter", () => {
  it("0 untuk titik yang sama", () => {
    expect(jarakMeter(DP_A, DP_A)).toBe(0);
  });
  it("1 derajat bujur di ekuator ≈ 111,2 km", () => {
    expect(jarakMeter({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -2);
  });
  it("simetris", () => {
    expect(jarakMeter(DP_A, DP_B)).toBeCloseTo(jarakMeter(DP_B, DP_A), 6);
  });
});

describe("tentukanZona", () => {
  it("di dalam radius → zona drop point itu", () => {
    const r = tentukanZona({ lat: -6.21, lng: 106.6 }, ZONA); // ±1,1 km dari A
    expect(r).toMatchObject({ status: "DALAM_ZONA", zonaKode: "zona-a", dropPointKode: "dp-a" });
  });
  it("tepat di batas radius masih masuk, sedikit di luar tidak", () => {
    const derajatPerMeter = 1 / 111_195;
    const pas = tentukanZona({ lat: -6.2 + 2499 * derajatPerMeter, lng: 106.6 }, ZONA.slice(0, 1));
    const lewat = tentukanZona(
      { lat: -6.2 + 2510 * derajatPerMeter, lng: 106.6 },
      ZONA.slice(0, 1),
    );
    expect(pas.status).toBe("DALAM_ZONA");
    expect(lewat.status).toBe("DI_LUAR_ZONA");
  });
  it("zona tumpang tindih → drop point terdekat menang", () => {
    const r = tentukanZona({ lat: -6.2, lng: 106.62 }, ZONA); // ±1,1 km dari B, ±2,2 km dari A
    expect(r).toMatchObject({ status: "DALAM_ZONA", zonaKode: "zona-b" });
  });
  it("jauh dari semua drop point → di luar zona", () => {
    expect(tentukanZona({ lat: -6.5, lng: 107 }, ZONA)).toEqual({ status: "DI_LUAR_ZONA" });
  });
  it("koordinat tidak valid → di luar zona", () => {
    expect(tentukanZona({ lat: Number.NaN, lng: 106.6 }, ZONA).status).toBe("DI_LUAR_ZONA");
    expect(tentukanZona({ lat: 91, lng: 106.6 }, ZONA).status).toBe("DI_LUAR_ZONA");
  });
  it("jarak dibulatkan ke 10 m", () => {
    const r = tentukanZona({ lat: -6.2037, lng: 106.6 }, ZONA);
    expect(r.status === "DALAM_ZONA" && r.jarakMeter % 10).toBe(0);
  });
  it("tanpa konfigurasi zona → di luar zona", () => {
    expect(tentukanZona({ lat: -6.2, lng: 106.6 }, []).status).toBe("DI_LUAR_ZONA");
  });
});

describe("koordinatValid", () => {
  it("menolak Infinity", () => {
    expect(koordinatValid({ lat: Number.POSITIVE_INFINITY, lng: 0 })).toBe(false);
  });
});
