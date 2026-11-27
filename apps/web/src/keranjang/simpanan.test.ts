// Keranjang sementara: localStorage bisa melempar (mode privat/diblokir) → tetap jalan di memori.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qtyDi, tambah, type CalonItem } from "./keranjang";

const calon: CalonItem = {
  idSatuanJual: "sj-1",
  idProduk: "p-1",
  nama: "Contoh",
  kodeSatuan: "PCS_1",
  isi: 1,
  tersedia: true,
};

function pasangWindow(storage: Storage) {
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

function storageMemori(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => {
      m.clear();
    },
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("simpanan keranjang", () => {
  it("per zona: zona lain tidak ikut berubah, tersimpan di localStorage", async () => {
    const st = storageMemori();
    pasangWindow(st);
    const { perbaruiKeranjang, bacaKeranjang } = await import("./simpanan");
    perbaruiKeranjang("zona-a", (k) => tambah(k, calon));
    expect(qtyDi(bacaKeranjang("zona-a"), "sj-1")).toBe(1);
    expect(qtyDi(bacaKeranjang("zona-b"), "sj-1")).toBe(0);
    expect(st.getItem("nekat:keranjang-sementara:zona-a")).toContain("sj-1");
  });

  it("ganti zona bolak-balik: tiap zona membaca keranjangnya sendiri (snapshot stabil)", async () => {
    pasangWindow(storageMemori());
    const { perbaruiKeranjang, bacaKeranjang } = await import("./simpanan");
    perbaruiKeranjang("zona-a", (k) => tambah(k, calon));
    perbaruiKeranjang("zona-b", (k) => tambah(tambah(k, calon), calon));
    const a1 = bacaKeranjang("zona-a");
    expect(qtyDi(a1, "sj-1")).toBe(1);
    expect(qtyDi(bacaKeranjang("zona-b"), "sj-1")).toBe(2);
    // useSyncExternalStore butuh referensi sama bila tidak berubah.
    expect(bacaKeranjang("zona-a")).toBe(a1);
  });

  it("tanpa zona → selalu kosong", async () => {
    pasangWindow(storageMemori());
    const { bacaKeranjang } = await import("./simpanan");
    expect(bacaKeranjang(null).item).toHaveLength(0);
  });

  it("localStorage melempar → tidak crash, tetap di memori", async () => {
    const lempar = () => {
      throw new Error("SecurityError");
    };
    pasangWindow({
      length: 0,
      clear: lempar,
      getItem: lempar,
      key: lempar,
      removeItem: lempar,
      setItem: lempar,
    });
    const { perbaruiKeranjang, bacaKeranjang } = await import("./simpanan");
    expect(() => perbaruiKeranjang("zona-a", (k) => tambah(k, calon))).not.toThrow();
    expect(qtyDi(bacaKeranjang("zona-a"), "sj-1")).toBe(1);
  });

  it("dibaca ulang dari localStorage saat modul baru dimuat (setelah halaman dibuka lagi)", async () => {
    const st = storageMemori();
    pasangWindow(st);
    const m1 = await import("./simpanan");
    m1.perbaruiKeranjang("zona-a", (k) => tambah(tambah(k, calon), calon));
    vi.resetModules();
    const m2 = await import("./simpanan");
    expect(qtyDi(m2.bacaKeranjang("zona-a"), "sj-1")).toBe(2);
  });
});
