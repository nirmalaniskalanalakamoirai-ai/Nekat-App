import type { RepoInventoriLokal } from "@nekat/domain";
import { describe, expect, it } from "vitest";
import { PenyimpanIdempotensiMemori } from "./idempotensi-memori.js";
import { bacaKonfigInventory, KonfigInventoryTidakValidError } from "./konfigurasi.js";
import { LocalInventory } from "./local-inventory.js";
import { buatInventorySource, SumberInventoryBelumDiimplementasiError } from "./pabrik.js";

const TOKEN = "token-uji-jangan-bocor";

function galatKonfig(env: Record<string, string>): KonfigInventoryTidakValidError {
  try {
    bacaKonfigInventory(env);
  } catch (e) {
    if (e instanceof KonfigInventoryTidakValidError) return e;
    throw e;
  }
  throw new Error("diharapkan gagal");
}

describe("bacaKonfigInventory (toggle INVENTORY_SOURCE)", () => {
  it("bawaan: local, 15 menit (P-10), tahan_checkout (H14), sinkron 5 menit", () => {
    expect(bacaKonfigInventory({})).toEqual({
      sumber: "local",
      maksUmurDataMenit: 15,
      saatGangguan: "tahan_checkout",
      intervalSinkronMenit: 5,
      gudang: null,
    });
    // String kosong = tidak diisi.
    expect(bacaKonfigInventory({ INVENTORY_SOURCE: "", GUDANG_API_URL: "" }).sumber).toBe("local");
  });

  it("menerima nilai yang diubah", () => {
    const k = bacaKonfigInventory({
      INVENTORY_SOURCE: "local",
      INVENTORY_MAKS_UMUR_DATA_MENIT: "30",
      INVENTORY_SAAT_GANGGUAN: "jual_snapshot",
      INVENTORY_INTERVAL_SINKRON_MENIT: "10",
    });
    expect(k).toMatchObject({
      maksUmurDataMenit: 30,
      saatGangguan: "jual_snapshot",
      intervalSinkronMenit: 10,
    });
  });

  it("nilai lain → gagal; pesan menyebut nama variabel saja", () => {
    const e = galatKonfig({
      INVENTORY_SOURCE: "LOCAL-rahasia",
      INVENTORY_MAKS_UMUR_DATA_MENIT: "0",
      INVENTORY_SAAT_GANGGUAN: "abaikan",
      INVENTORY_INTERVAL_SINKRON_MENIT: "5.5",
    });
    expect(e.variabel).toEqual([
      "INVENTORY_SOURCE",
      "INVENTORY_MAKS_UMUR_DATA_MENIT",
      "INVENTORY_SAAT_GANGGUAN",
      "INVENTORY_INTERVAL_SINKRON_MENIT",
    ]);
    expect(e.message).not.toContain("rahasia");
  });

  it("gudang: wajib GUDANG_API_URL https tanpa kredensial + token", () => {
    expect(galatKonfig({ INVENTORY_SOURCE: "gudang" }).variabel).toEqual([
      "GUDANG_API_URL",
      "GUDANG_API_TOKEN",
    ]);
    for (const url of [
      "http://gudang.contoh.id/api",
      "https://user:pass@gudang.contoh.id/api",
      "bukan url",
    ]) {
      const e = galatKonfig({
        INVENTORY_SOURCE: "gudang",
        GUDANG_API_URL: url,
        GUDANG_API_TOKEN: TOKEN,
      });
      expect(e.variabel).toEqual(["GUDANG_API_URL"]);
      expect(e.message).not.toContain(TOKEN);
    }
  });

  it("gudang valid: token tidak ikut ter-serialisasi", () => {
    const k = bacaKonfigInventory({
      INVENTORY_SOURCE: "gudang",
      GUDANG_API_URL: "https://gudang.contoh.id/api",
      GUDANG_API_TOKEN: TOKEN,
    });
    expect(k.gudang?.apiUrl).toBe("https://gudang.contoh.id/api");
    expect(k.gudang?.ambilToken()).toBe(TOKEN);
    expect(JSON.stringify(k)).not.toContain(TOKEN);
  });
});

describe("buatInventorySource", () => {
  const repo: RepoInventoriLokal = {
    daftarSku: () => Promise.resolve([]),
    stok: () => Promise.resolve([]),
    modal: () => Promise.resolve([]),
  };
  const dep = { repo, idempotensi: new PenyimpanIdempotensiMemori() };

  it("local → LocalInventory", () => {
    const inv = buatInventorySource(bacaKonfigInventory({}), dep);
    expect(inv).toBeInstanceOf(LocalInventory);
    expect(inv.nama).toBe("local");
  });

  it("gudang → belum diimplementasi (T-019)", () => {
    const k = bacaKonfigInventory({
      INVENTORY_SOURCE: "gudang",
      GUDANG_API_URL: "https://gudang.contoh.id/api",
      GUDANG_API_TOKEN: TOKEN,
    });
    expect(() => buatInventorySource(k, dep)).toThrow(SumberInventoryBelumDiimplementasiError);
    expect(() => buatInventorySource(k, dep)).toThrow(/belum diimplementasi/);
  });
});
