// Tes komponen KartuProduk & Harga lewat render statis (react-dom/server, lingkungan node). Kasus dari
// T-008 §1.11. Angka FIKTIF.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { KartuProdukApi, SatuanKartu } from "../../katalog/api";
import { Harga } from "../Harga/Harga";
import { KartuProduk, type KartuProdukProps } from "./KartuProduk";

const satuan: SatuanKartu = {
  id: "sj-1",
  kode: "PCS_1",
  isi: 1,
  harga: { hargaSatuan: 2222, hargaBelanjaBareng: 1111 },
  tersedia: true,
  statusStok: "TERSEDIA",
  labelStok: null,
};
const data: KartuProdukApi = {
  id: "p-1",
  nama: "Minyak Contoh 1 L",
  gambarUrl: null,
  kategori: { kode: "sembako", nama: "Sembako" },
  subkategori: null,
  satuan,
  jumlahPilihanSatuan: 1,
  tersedia: true,
  statusStok: "TERSEDIA",
  labelStok: null,
  promo: null,
};

function render(p: Partial<KartuProdukProps> = {}) {
  const props: KartuProdukProps = {
    data,
    qty: 0,
    online: true,
    alasanHalaman: null,
    onTambah: () => undefined,
    onUbahQty: () => undefined,
    ...p,
  };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KartuProduk, props)));
}

const habis = (s: "HABIS" | "TIDAK_DIKETAHUI", label: string): KartuProdukApi => ({
  ...data,
  tersedia: false,
  statusStok: s,
  labelStok: label,
  satuan: { ...satuan, tersedia: false, statusStok: s, labelStok: label },
});

describe("KartuProduk", () => {
  it("default: harga server, chip Harga Belanja Bareng, tombol + berlabel lengkap", () => {
    const html = render();
    expect(html).toContain("Rp2.222");
    expect(html).toContain("/pcs");
    expect(html).toContain("Harga Belanja Bareng Rp1.111");
    expect(html).toContain('aria-label="Tambah 1 pcs Minyak Contoh 1 L ke keranjang"');
    expect(html).toContain("per 1 pcs");
  });

  it("harga dibaca sekali: satu .sr-only kalimat, angka visual aria-hidden (TC-UI-12h)", () => {
    const html = render();
    expect(html).toContain(
      '<span class="sr-only">Rp2.222 per pcs, Harga Belanja Bareng Rp1.111.</span>',
    );
    expect(html).toMatch(/<span class="price price--card" aria-hidden="true">Rp2\.222/);
  });

  it("katalog tanpa harga coret (TC-UI-04) & tanpa promo (TC-UI-02)", () => {
    const html = render();
    expect(html).not.toMatch(/<s[\s>]/);
    expect(html).not.toContain("chip--promo");
  });

  it("tanpa harga grup → tidak ada teks Belanja Bareng (TC-UI-07)", () => {
    const html = render({
      data: {
        ...data,
        satuan: { ...satuan, harga: { hargaSatuan: 2222, hargaBelanjaBareng: null } },
      },
    });
    expect(html).not.toContain("Belanja Bareng");
  });

  it("tidak memuat kata terlarang (TC-UI-08)", () => {
    expect(render()).not.toMatch(/Mitra|drop point|modal|tier|MOQ/i);
  });

  it("stok habis, belum di keranjang: label K-20, tanpa <button> tambah (TC-UI-06)", () => {
    const html = render({ data: habis("HABIS", "Stok habis, segera distok") });
    expect(html).toContain("Stok habis, segera distok");
    expect(html).toContain('<p class="kartu__habis">Stok habis</p>');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-disabled");
    expect(html).toContain("kartu__foto--habis");
  });

  it("stok habis, sudah di keranjang: + disabled, − (hapus) aktif (TC-UI-06b)", () => {
    const html = render({ data: habis("HABIS", "Stok habis, segera distok"), qty: 2 });
    expect(html).toMatch(/aria-label="Kurangi 1 Minyak Contoh 1 L"(?![^>]*disabled)/);
    expect(html).toMatch(/aria-label="Tambah 1 Minyak Contoh 1 L" disabled=""/);
  });

  it("stok tidak diketahui (IG-02 DEFAULT): label 'Stok sedang dicek…', tombol beli disabled, foto tidak diabukan", () => {
    const html = render({
      data: habis("TIDAK_DIKETAHUI", "Stok sedang dicek, coba lagi sebentar"),
    });
    expect(html).toContain("Stok sedang dicek, coba lagi sebentar");
    expect(html).toMatch(/<button[^>]*class="kartu__tambah"[^>]*disabled=""/);
    expect(html).not.toContain("kartu__foto--habis");
    expect(html).not.toContain("Stok habis");
  });

  it("offline: harga '—', chip disembunyikan, + disabled merujuk pita offline (TC-UI-10)", () => {
    const html = render({ online: false });
    expect(html).not.toContain("Rp");
    expect(html).toContain("—");
    expect(html).toMatch(/disabled="" aria-describedby="pita-offline"/);
  });

  it("zona belum dipilih: + disabled merujuk catatan halaman", () => {
    const html = render({ alasanHalaman: "catatan-zona" });
    expect(html).toMatch(/disabled="" aria-describedby="catatan-zona"/);
  });

  it("qty > 0: stepper role=group berlabel, '−' di qty 1 = hapus", () => {
    const html = render({ qty: 1 });
    expect(html).toContain('role="group" aria-label="Jumlah Minyak Contoh 1 L"');
    expect(html).toContain('aria-label="Hapus Minyak Contoh 1 L dari keranjang"');
    expect(html).not.toContain("kartu__tambah");
  });

  it("tombol + tidak bersarang di dalam tautan", () => {
    const html = render();
    const tautan = /<a [^>]*class="kartu__tautan"[^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1] ?? "";
    expect(tautan).not.toContain("<button");
    expect(tautan).toContain("Minyak Contoh 1 L");
  });
});

describe("Harga", () => {
  it("harga kartu = harga baris untuk satuan yang sama (PG-6)", () => {
    const teks = (varian: "kartu" | "baris") =>
      renderToStaticMarkup(createElement(Harga, { harga: satuan.harga, kode: "PCS_1", varian }))
        .replace(/<[^>]+>/g, "|")
        .split("|")
        .filter(Boolean);
    expect(teks("kartu")).toEqual(teks("baris"));
  });

  it("nominal besar tidak disingkat (TC-UI-11)", () => {
    const html = renderToStaticMarkup(
      createElement(Harga, {
        harga: { hargaSatuan: 9999999, hargaBelanjaBareng: null },
        kode: "DUS",
        varian: "kartu",
      }),
    );
    expect(html).toContain("Rp9.999.999");
    expect(html).toContain("/dus");
  });
});
