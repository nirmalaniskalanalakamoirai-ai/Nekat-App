// Tes katalog (T-025). Semua angka contoh fiktif.
import { LABEL_STOK_HABIS } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { KONFIGURASI_HARGA_BAWAAN } from "../harga/hitung.js";
import { potongHalaman, saringProduk } from "./cari.js";
import {
  masukan,
  produkSederhana,
  tanpaStok,
  ubahSatuan,
  ubahSku,
  uid,
  type ProdukUji,
} from "./fixture.test-util.js";
import { persenKeBp, susunKatalog } from "./susun.js";

const satu = (p: ProdukUji, k = KONFIGURASI_HARGA_BAWAAN) => susunKatalog(masukan([p], k));
const dasar = produkSederhana(1);

describe("persenKeBp", () => {
  it("numeric(9,4) → basis poin tanpa float", () => {
    expect(persenKeBp("12.5000")).toBe(1250);
    expect(persenKeBp("20")).toBe(2000);
    expect(persenKeBp("0.0100")).toBe(1);
    expect(persenKeBp("7.25")).toBe(725);
  });
  it("lebih dari 2 desimal atau format salah → NaN (engine menolak, tidak dibulatkan)", () => {
    expect(persenKeBp("12.3450")).toBeNaN();
    expect(persenKeBp("-1")).toBeNaN();
    expect(persenKeBp("abc")).toBeNaN();
  });
});

describe("aturan tayang", () => {
  it("produk berharga & berstok tayang dengan harga dari engine", () => {
    const s = satu(dasar);
    expect(s.produk).toHaveLength(1);
    expect(s.produk[0]?.utama.harga).toEqual({ hargaSatuan: 1_200, hargaBelanjaBareng: 1_100 });
    expect(s.produk[0]?.stok).toEqual({ tersedia: true, label: null });
    expect(s.ditahan).toEqual([]);
  });

  it("produk tanpa harga tidak tayang dan dilaporkan sebagai ditahan", () => {
    const s = satu(ubahSatuan(dasar, { satuanRp: null, mitraRp: null }));
    expect(s.produk).toEqual([]);
    expect(s.kategori).toEqual([]);
    expect(s.ditahan).toEqual([
      { idSatuanJual: uid(3001), idProduk: uid(1001), kode: ["SEL_KOSONG"] },
    ]);
  });

  it("modal kosong tidak tayang", () => {
    const s = satu(ubahSatuan(dasar, { modal: null }));
    expect(s.produk).toEqual([]);
    expect(s.ditahan[0]?.kode).toEqual(["MODAL_KOSONG"]);
  });

  it("harga di bawah / sama dengan modal tidak tayang", () => {
    for (const satuanRp of [900, 1_000]) {
      expect(satu(ubahSatuan(dasar, { satuanRp, mitraRp: null })).produk).toEqual([]);
    }
  });

  it("K-42: pagar level dilanggar (Mitra Grosir > Satuan) → kedua harga ditahan, tidak tayang", () => {
    const s = satu(ubahSatuan(dasar, { satuanRp: 1_100, mitraRp: 1_200 }));
    expect(s.produk).toEqual([]);
    expect(s.ditahan[0]?.kode).toContain("PAGAR_LEVEL_DILANGGAR");
  });

  it("K-42: pagar kemasan (per pcs dus > per pcs satuan) → kedua satuan ditahan", () => {
    const s = satu(
      ubahSku(dasar, {
        stok: 100,
        satuan: [
          { id: uid(3001), jenis: "PCS_1", isi: 1, modal: 1_000, satuanRp: 1_200 },
          { id: uid(3002), jenis: "DUS", isi: 10, modal: 10_000, satuanRp: 12_500 },
        ],
      }),
    );
    expect(s.produk).toEqual([]);
    expect(s.ditahan.map((d) => d.idSatuanJual).sort()).toEqual([uid(3001), uid(3002)]);
    expect(s.ditahan.every((d) => d.kode.includes("PAGAR_KEMASAN_DILANGGAR"))).toBe(true);
  });

  it("K-41: margin minimum 5% tidak berlaku untuk harga dasar (harga > modal cukup)", () => {
    const s = satu(ubahSatuan(dasar, { satuanRp: 1_001, mitraRp: null }));
    expect(s.produk[0]?.utama.harga.hargaSatuan).toBe(1_001);
  });

  it("harga dari persen margin dihitung engine; persen pecahan rupiah → ditahan (K-28)", () => {
    const ok = satu(ubahSatuan(dasar, { satuanRp: null, mitraRp: null, satuanPersen: "20.0000" }));
    expect(ok.produk[0]?.utama.harga.hargaSatuan).toBe(1_200);
    const pecahan = satu(
      ubahSatuan(dasar, { modal: 999, satuanRp: null, mitraRp: null, satuanPersen: "12.5000" }),
    );
    expect(pecahan.produk).toEqual([]);
    expect(pecahan.ditahan[0]?.kode).toEqual(["HARGA_PECAHAN"]);
  });

  it("produk kena PPN tidak tayang selama faktor PPN belum dikonfigurasi", () => {
    const s = satu(produkSederhana(1, { bebasPpn: false }));
    expect(s.produk).toEqual([]);
    expect(s.ditahan[0]?.kode).toEqual(["PPN_BELUM_DIKONFIGURASI"]);
  });

  it("timpaan modal aktif (P-25) dipakai pagar modal", () => {
    // Harga 1.200 < timpaan modal 1.250 → tidak tayang walau modal sumber 1.000.
    expect(satu(ubahSatuan(dasar, { timpaan: 1_250 })).produk).toEqual([]);
  });

  it("produk/SKU nonaktif, kategori nonaktif/terlarang, tinjauan kategori: tidak tayang", () => {
    const s = susunKatalog(
      masukan([
        produkSederhana(1, { aktif: false }),
        produkSederhana(2, { kategoriId: uid(7) }), // minuman-bir
        produkSederhana(3, { kategoriId: uid(9) }), // induk nonaktif
        ubahSku(produkSederhana(4), { aktifDiSumber: false }),
        produkSederhana(5, { tinjauanKategori: "MENUNGGU" }),
      ]),
    );
    expect(s.produk).toEqual([]);
    expect(s.kategori).toEqual([]);
  });
});

describe("K-20 stok habis", () => {
  it("tetap tampil dengan label, tidak tersedia, dan tetap dihitung di kategori", () => {
    const s = satu(ubahSku(dasar, { stok: 0 }));
    expect(s.produk).toHaveLength(1);
    expect(s.produk[0]?.stok).toEqual({ tersedia: false, label: LABEL_STOK_HABIS });
    expect(s.produk[0]?.utama.stok).toEqual({ tersedia: false, label: LABEL_STOK_HABIS });
    expect(s.kategori[0]?.jumlahProduk).toBe(1);
  });

  it("SKU tanpa baris stok = stok 0 (habis)", () => {
    expect(satu(tanpaStok(dasar)).produk[0]?.stok.tersedia).toBe(false);
  });

  it("stok per satuan jual: dus habis bila stok < isi; kartu memilih satuan yang tersedia", () => {
    const s = satu(
      ubahSku(dasar, {
        stok: 5,
        satuan: [
          { id: uid(3002), jenis: "DUS", isi: 10, modal: 9_000, satuanRp: 11_000 },
          { id: uid(3001), jenis: "PCS_1", isi: 1, modal: 1_000, satuanRp: 1_200 },
        ],
      }),
    );
    const [pcs, dus] = s.produk[0]?.varian[0]?.satuan ?? [];
    expect(pcs?.kode).toBe("PCS_1");
    expect(pcs?.stok.tersedia).toBe(true);
    expect(dus?.stok).toEqual({ tersedia: false, label: LABEL_STOK_HABIS });
    expect(s.produk[0]?.utama).toBe(pcs);
  });

  it("kartu memilih satuan tersedia walau bukan yang terkecil", () => {
    const s = satu(
      ubahSku(dasar, {
        stok: 10,
        satuan: [
          { id: uid(3002), jenis: "DUS", isi: 10, modal: 9_000, satuanRp: 11_000 },
          // PCS_1 tanpa harga → tidak tayang; kartu memakai DUS.
          { id: uid(3001), jenis: "PCS_1", isi: 1, modal: 1_000, satuanRp: null },
        ],
      }),
    );
    expect(s.produk[0]?.utama.kode).toBe("DUS");
  });

  it("reservasi aktif mengurangi stok bebas", () => {
    const m = masukan([dasar]);
    const s = susunKatalog({ ...m, reservasi: new Map([[uid(2001), 10]]) });
    expect(s.produk[0]?.stok.tersedia).toBe(false);
  });

  it("data stok kedaluwarsa (mode gudang, P-10) → tidak bisa dibeli", () => {
    const m = masukan([dasar]);
    const s = susunKatalog({ ...m, sumber: "gudang", maksUmurDataMenit: 15 });
    expect(s.produk[0]?.stok.tersedia).toBe(false);
  });
});

describe("harga Belanja Bareng (K-38, K-27, P-21)", () => {
  it("null bila Mitra Grosir kosong atau tier grup dimatikan", () => {
    expect(
      satu(ubahSatuan(dasar, { mitraRp: null })).produk[0]?.utama.harga.hargaBelanjaBareng,
    ).toBeNull();
    expect(satu(ubahSatuan(dasar, { bolehGrup: false })).produk[0]?.utama.harga).toEqual({
      hargaSatuan: 1_200,
      hargaBelanjaBareng: null,
    });
  });

  it("hasil tidak memuat modal, margin, atau isian sel", () => {
    const teks = JSON.stringify(satu(dasar).produk);
    expect(teks).not.toMatch(/modal|margin|markup|hargaTerhitung|alasan/i);
  });
});

describe("kategori, pencarian, paginasi", () => {
  const daftar: ProdukUji[] = [
    produkSederhana(1, { nama: "Beras Pandan Wangi 5 kg" }),
    produkSederhana(2, { nama: "Beras Merah 1 kg" }),
    produkSederhana(3, { nama: "Minyak Goreng Sawit 2 L", kategoriId: uid(3) }),
    produkSederhana(4, { nama: "Kopi Bubuk", kategoriId: uid(5) }),
    produkSederhana(5, { nama: "Teh Celup Melati", kategoriId: uid(5) }),
    produkSederhana(6, { nama: "Susu UHT Cokelat", kategoriId: uid(6) }),
    // Tidak tayang (tanpa harga) → tidak dihitung.
    ubahSatuan(produkSederhana(7, { nama: "Susu Tanpa Harga", kategoriId: uid(6) }), {
      satuanRp: null,
    }),
    // Stok habis → tetap dihitung (K-20).
    ubahSku(produkSederhana(8, { nama: "Susu Kental Manis", kategoriId: uid(6) }), { stok: 0 }),
  ];
  const s = susunKatalog(masukan(daftar));

  it("jumlah per kategori & subkategori = produk tayang (termasuk stok habis)", () => {
    expect(s.kategori).toEqual([
      {
        kode: "sembako",
        nama: "Sembako",
        jumlahProduk: 3,
        subkategori: [
          { kode: "beras", nama: "Beras", jumlahProduk: 2 },
          { kode: "minyak-goreng", nama: "Minyak Goreng", jumlahProduk: 1 },
        ],
      },
      {
        kode: "minuman",
        nama: "Minuman",
        jumlahProduk: 4,
        subkategori: [
          { kode: "teh-kopi", nama: "Teh & Kopi", jumlahProduk: 2 },
          { kode: "susu", nama: "Susu", jumlahProduk: 2 },
        ],
      },
    ]);
    // Konsisten dengan daftar per kategori.
    for (const k of s.kategori) {
      expect(saringProduk(s.produk, { kategori: k.kode })).toHaveLength(k.jumlahProduk);
      for (const sub of k.subkategori) {
        expect(saringProduk(s.produk, { subkategori: sub.kode })).toHaveLength(sub.jumlahProduk);
      }
    }
  });

  it("urutan bawaan: kategori → subkategori → nama", () => {
    expect(s.produk.map((p) => p.nama)).toEqual([
      "Beras Merah 1 kg",
      "Beras Pandan Wangi 5 kg",
      "Minyak Goreng Sawit 2 L",
      "Kopi Bubuk",
      "Teh Celup Melati",
      "Susu Kental Manis",
      "Susu UHT Cokelat",
    ]);
  });

  it("pencarian: semua kata, awal kata, tanpa beda huruf besar/diakritik", () => {
    const nama = (cari: string) => saringProduk(s.produk, { cari }).map((p) => p.nama);
    expect(nama("beras")).toEqual(["Beras Merah 1 kg", "Beras Pandan Wangi 5 kg"]);
    expect(nama("BERAS wangi")).toEqual(["Beras Pandan Wangi 5 kg"]);
    expect(nama("góreng")).toEqual(["Minyak Goreng Sawit 2 L"]);
    expect(nama("oreng")).toEqual([]);
    expect(nama("susu")).toEqual(["Susu Kental Manis", "Susu UHT Cokelat"]);
    expect(nama("tanpa harga")).toEqual([]);
    expect(nama("!!!")).toEqual([]);
    expect(saringProduk(s.produk, { cari: "susu", subkategori: "beras" })).toEqual([]);
  });

  it("paginasi", () => {
    const h1 = potongHalaman(s.produk, 1, 3);
    expect(h1.isi.map((p) => p.nama)).toEqual(s.produk.slice(0, 3).map((p) => p.nama));
    expect(h1).toMatchObject({ halaman: 1, perHalaman: 3, total: 7, totalHalaman: 3 });
    expect(potongHalaman(s.produk, 3, 3).isi).toHaveLength(1);
    expect(potongHalaman(s.produk, 9, 3).isi).toEqual([]);
    expect(() => potongHalaman(s.produk, 0, 3)).toThrow(RangeError);
  });
});
