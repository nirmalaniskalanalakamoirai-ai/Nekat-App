import { describe, expect, it } from "vitest";
import { bacaKonfigLokasi, type KonfigLokasi } from "./konfig-lokasi.js";

// Bentuk sama dengan config/lokasi.example.json (dicek juga di tes API). Koordinat UJI fiktif.
const contoh: unknown = {
  $komentar: "uji",
  versi: 1,
  uji: true,
  gudang: [{ kode: "gudang-pusat", nama: "Gudang Uji", jenis: "PUSAT", lat: -6.2, lng: 106.6 }],
  zona: [
    {
      kode: "zona-pilot",
      namaKelurahan: "Kelurahan Uji",
      gudang: "gudang-pusat",
      dropPoint: [{ kode: "dp-pusat", nama: "DP Uji", lat: -6.2, lng: 106.6, radiusMeter: 2500 }],
    },
  ],
};

// Zod membuat objek baru tiap parse → salinan yang bebas diubah.
const salin = (): KonfigLokasi => bacaKonfigLokasi(contoh);

describe("bacaKonfigLokasi (T-015/T-015b)", () => {
  it("config contoh valid, bertanda uji, kunci tak dikenal dibuang", () => {
    const k = bacaKonfigLokasi(contoh);
    expect(k.uji).toBe(true);
    expect(k).not.toHaveProperty("$komentar");
    expect(k.zona[0]?.dropPoint[0]?.radiusMeter).toBe(2500);
  });

  it("radius di luar 2.000–3.000 m ditolak", () => {
    for (const r of [1999, 3001, 2500.5]) {
      const k = salin();
      const dp = k.zona[0]?.dropPoint[0];
      if (dp) dp.radiusMeter = r;
      expect(() => bacaKonfigLokasi(k)).toThrow(/radiusMeter/);
    }
    const k = salin();
    const dp = k.zona[0]?.dropPoint[0];
    if (dp) dp.radiusMeter = 2000;
    expect(() => bacaKonfigLokasi(k)).not.toThrow();
  });

  it("koordinat tertukar / di luar Indonesia / tak hingga ditolak", () => {
    const tertukar = salin();
    const dp = tertukar.zona[0]?.dropPoint[0];
    if (dp) [dp.lat, dp.lng] = [dp.lng, dp.lat];
    expect(() => bacaKonfigLokasi(tertukar)).toThrow(/wilayah Indonesia|lat/);

    const tanpaMinus = salin();
    const g = tanpaMinus.gudang[0];
    if (g) g.lat = 26.2;
    expect(() => bacaKonfigLokasi(tanpaMinus)).toThrow(/gudang\.0.*wilayah Indonesia/);

    const takHingga = salin();
    const g2 = takHingga.gudang[0];
    if (g2) g2.lng = Number.POSITIVE_INFINITY;
    expect(() => bacaKonfigLokasi(takHingga)).toThrow(/gudang\.0\.lng/);
  });

  it("kode ganda lintas jenis ditolak", () => {
    const k = salin();
    const z = k.zona[0];
    if (z) z.kode = "gudang-pusat";
    expect(() => bacaKonfigLokasi(k)).toThrow(/kode ganda: gudang-pusat/);
  });

  it("kode tidak sesuai format ditolak", () => {
    const k = salin();
    const dp = k.zona[0]?.dropPoint[0];
    if (dp) dp.kode = "DP Pusat";
    expect(() => bacaKonfigLokasi(k)).toThrow(/kode: huruf kecil/);
  });

  it("harus tepat satu gudang PUSAT", () => {
    const dua = salin();
    dua.gudang = [
      ...dua.gudang,
      { kode: "gudang-2", nama: "Gudang 2", jenis: "PUSAT", lat: -6.3, lng: 106.7 },
    ];
    expect(() => bacaKonfigLokasi(dua)).toThrow(/tepat satu gudang PUSAT \(ada 2\)/);
    const nol = salin();
    nol.gudang = nol.gudang.map((g) => ({ ...g, jenis: "CABANG" as const }));
    expect(() => bacaKonfigLokasi(nol)).toThrow(/tepat satu gudang PUSAT \(ada 0\)/);
  });

  it("zona merujuk gudang yang tidak ada, nama kosong, tanpa drop point → ditolak", () => {
    const k = salin();
    const z = k.zona[0];
    if (z) z.gudang = "gudang-hilang";
    expect(() => bacaKonfigLokasi(k)).toThrow(/gudang gudang-hilang tidak ada/);
    const kosong = salin();
    const z2 = kosong.zona[0];
    if (z2) z2.namaKelurahan = "  ";
    expect(() => bacaKonfigLokasi(kosong)).toThrow(/namaKelurahan/);
    const tanpaDp = salin();
    const z3 = tanpaDp.zona[0];
    if (z3) z3.dropPoint = [];
    expect(() => bacaKonfigLokasi(tanpaDp)).toThrow(/dropPoint/);
  });

  it("panjang teks dibatasi (kode 64, nama 120, alamatPublik 200, jamAmbil 60)", () => {
    const panjang = (n: number) => "a".repeat(n);
    const cek = (
      ubah: (dp: {
        kode: string;
        nama: string;
        alamatPublik?: string | undefined;
        jamAmbil?: string | undefined;
      }) => void,
    ) => {
      const k = salin();
      const dp = k.zona[0]?.dropPoint[0];
      if (dp) ubah(dp);
      return () => bacaKonfigLokasi(k);
    };
    expect(cek((dp) => (dp.kode = panjang(65)))).toThrow(/kode maks\. 64/);
    expect(cek((dp) => (dp.kode = panjang(64)))).not.toThrow();
    expect(cek((dp) => (dp.nama = panjang(121)))).toThrow(/nama/);
    expect(cek((dp) => (dp.alamatPublik = panjang(201)))).toThrow(/alamatPublik/);
    expect(cek((dp) => (dp.jamAmbil = panjang(61)))).toThrow(/jamAmbil/);
    expect(cek((dp) => (dp.jamAmbil = "Senin–Sabtu 08.00–17.00"))).not.toThrow();
    expect(cek((dp) => (dp.jamAmbil = "   "))).toThrow(/jamAmbil/);
  });

  it("versi lain ditolak", () => {
    expect(() => bacaKonfigLokasi({ ...salin(), versi: 2 })).toThrow(/versi/);
  });
});
