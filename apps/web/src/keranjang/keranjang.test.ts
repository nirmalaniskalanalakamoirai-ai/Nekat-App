import { describe, expect, it } from "vitest";
import {
  hapus,
  jumlahBaris,
  KERANJANG_KOSONG,
  QTY_MAKS,
  qtyDi,
  serialisasi,
  tambah,
  ubahQty,
  uraiKeranjang,
  urungkan,
  type CalonItem,
} from "./keranjang";

const minyak: CalonItem = {
  idSatuanJual: "sj-1",
  idProduk: "p-1",
  nama: "Minyak Contoh",
  kodeSatuan: "PCS_1",
  isi: 1,
  tersedia: true,
};
const dus: CalonItem = { ...minyak, idSatuanJual: "sj-2", kodeSatuan: "DUS", isi: 24 };

describe("tambah", () => {
  it("baris baru qty 1, lalu bertambah", () => {
    let k = tambah(KERANJANG_KOSONG, minyak);
    expect(qtyDi(k, "sj-1")).toBe(1);
    k = tambah(k, minyak);
    expect(qtyDi(k, "sj-1")).toBe(2);
    expect(jumlahBaris(k)).toBe(1);
  });

  it("satuan berbeda = baris terpisah", () => {
    const k = tambah(tambah(KERANJANG_KOSONG, minyak), dus);
    expect(jumlahBaris(k)).toBe(2);
  });

  it("stok habis / tidak diketahui: tidak bisa masuk keranjang (K-20, IG-02)", () => {
    const k = tambah(KERANJANG_KOSONG, { ...minyak, tersedia: false });
    expect(k).toBe(KERANJANG_KOSONG);
  });

  it(`tidak melewati ${QTY_MAKS}`, () => {
    let k = ubahQty(tambah(KERANJANG_KOSONG, minyak), "sj-1", QTY_MAKS, true);
    k = tambah(k, minyak);
    expect(qtyDi(k, "sj-1")).toBe(QTY_MAKS);
  });

  it("tidak mengubah objek lama (imutabel)", () => {
    const awal = tambah(KERANJANG_KOSONG, minyak);
    tambah(awal, minyak);
    expect(qtyDi(awal, "sj-1")).toBe(1);
  });
});

describe("ubahQty", () => {
  const isi = ubahQty(tambah(KERANJANG_KOSONG, minyak), "sj-1", 2, true);

  it("qty 0 menghapus baris", () => {
    expect(jumlahBaris(ubahQty(isi, "sj-1", 0, true))).toBe(0);
  });

  it("stok habis dengan barang di keranjang: boleh turun, tidak boleh naik (TC-UI-06b)", () => {
    expect(qtyDi(ubahQty(isi, "sj-1", 1, false), "sj-1")).toBe(1);
    expect(qtyDi(ubahQty(isi, "sj-1", 3, false), "sj-1")).toBe(2);
  });

  it("nilai aneh dibatasi / diabaikan", () => {
    expect(qtyDi(ubahQty(isi, "sj-1", 2.7, true), "sj-1")).toBe(2);
    expect(qtyDi(ubahQty(isi, "sj-1", 1e9, true), "sj-1")).toBe(QTY_MAKS);
    expect(ubahQty(isi, "sj-1", Number.NaN, true)).toBe(isi);
    expect(ubahQty(isi, "tidak-ada", 5, true)).toBe(isi);
  });
});

describe("hapus & urungkan", () => {
  it("urungkan mengembalikan baris di posisi semula", () => {
    const k = tambah(tambah(KERANJANG_KOSONG, minyak), dus);
    const h = hapus(k, "sj-1");
    expect(h.keranjang.item.map((i) => i.idSatuanJual)).toEqual(["sj-2"]);
    expect(h.terhapus).not.toBeNull();
    if (!h.terhapus) return;
    expect(urungkan(h.keranjang, h.terhapus).item.map((i) => i.idSatuanJual)).toEqual([
      "sj-1",
      "sj-2",
    ]);
  });

  it("urungkan tidak menggandakan bila baris sudah ditambahkan lagi", () => {
    const h = hapus(tambah(KERANJANG_KOSONG, minyak), "sj-1");
    if (!h.terhapus) throw new Error("harus terhapus");
    const lagi = tambah(h.keranjang, minyak);
    expect(urungkan(lagi, h.terhapus)).toBe(lagi);
  });

  it("hapus baris yang tidak ada", () => {
    expect(hapus(KERANJANG_KOSONG, "x").terhapus).toBeNull();
  });
});

describe("uraiKeranjang (data tersimpan)", () => {
  it("bolak-balik serialisasi", () => {
    const k = tambah(tambah(KERANJANG_KOSONG, minyak), dus);
    expect(uraiKeranjang(serialisasi(k))).toEqual(k);
  });

  it("tidak pernah menyimpan harga", () => {
    const k = tambah(KERANJANG_KOSONG, minyak);
    expect(serialisasi(k)).not.toMatch(/harga|Rp/i);
  });

  it("data rusak / versi lain → kosong", () => {
    for (const m of [null, "", "{", "[]", '{"versi":2,"item":[]}', '"x"', "null"]) {
      expect(uraiKeranjang(m)).toEqual(KERANJANG_KOSONG);
    }
  });

  it("baris rusak, ganda, atau kode satuan di luar P-03 dibuang; harga lama diabaikan", () => {
    const mentah = JSON.stringify({
      versi: 1,
      item: [
        { ...minyak, qty: 2, hargaSatuan: 1 },
        { ...minyak, qty: 5 },
        { ...dus, qty: 0 },
        { ...dus, kodeSatuan: "KARTON", qty: 1 },
        { ...dus, idSatuanJual: "sj-3", qty: 1.5 },
        "sampah",
      ],
    });
    const k = uraiKeranjang(mentah);
    expect(k.item).toHaveLength(1);
    expect(k.item[0]).toEqual({
      idSatuanJual: "sj-1",
      idProduk: "p-1",
      nama: "Minyak Contoh",
      kodeSatuan: "PCS_1",
      isi: 1,
      qty: 2,
    });
  });
});
