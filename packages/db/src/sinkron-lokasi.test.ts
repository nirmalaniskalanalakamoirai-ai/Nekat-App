// Unit: rencana sinkron config → DB (fungsi murni, tanpa database).
import { bacaKonfigLokasi, type KonfigLokasi } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import {
  rencanakanSinkronLokasi,
  teksPerubahanLokasi,
  type PemakaianAktifLokasi,
  type StatusLokasiDb,
} from "./sinkron-lokasi.js";

// Koordinat UJI fiktif (bukan lokasi asli, keputusan #3 belum diisi).
const konfig = (ubah: (k: KonfigLokasi) => void = () => undefined): KonfigLokasi => {
  const k: KonfigLokasi = bacaKonfigLokasi({
    versi: 1,
    uji: true,
    gudang: [{ kode: "g-uji", nama: "Gudang Uji", jenis: "PUSAT", lat: -6.2, lng: 106.6 }],
    zona: [
      {
        kode: "z-uji",
        namaKelurahan: "Kelurahan Uji",
        gudang: "g-uji",
        dropPoint: [
          { kode: "dp-a", nama: "DP A", lat: -6.2, lng: 106.6, radiusMeter: 2500 },
          {
            kode: "dp-b",
            nama: "DP B",
            alamatPublik: "Warung B",
            jamAmbil: "08.00–17.00",
            lat: -6.21,
            lng: 106.61,
            radiusMeter: 2000,
          },
        ],
      },
    ],
  });
  ubah(k);
  return k;
};

const KOSONG: StatusLokasiDb = { gudang: [], zona: [], dropPoint: [] };

/** Status DB yang persis sesuai `konfig()`. */
const sesuai = (): StatusLokasiDb => ({
  gudang: [{ id: "1", kode: "g-uji", nama: "Gudang Uji", jenis: "PUSAT", aktif: true }],
  zona: [
    {
      id: "2",
      kode: "z-uji",
      namaKelurahan: "Kelurahan Uji",
      gudang: "g-uji",
      dropPointPusat: "dp-a",
      aktif: true,
    },
  ],
  dropPoint: [
    {
      id: "3",
      kode: "dp-a",
      zona: "z-uji",
      gudang: "g-uji",
      nama: "DP A",
      alamatPublik: null,
      jamAmbil: null,
      aktif: true,
    },
    {
      id: "4",
      kode: "dp-b",
      zona: "z-uji",
      gudang: "g-uji",
      nama: "DP B",
      alamatPublik: "Warung B",
      jamAmbil: "08.00–17.00",
      aktif: true,
    },
  ],
});

describe("rencanakanSinkronLokasi", () => {
  it("DB kosong → TAMBAH semua, urut gudang → zona → drop point", () => {
    const r = rencanakanSinkronLokasi(konfig(), KOSONG);
    expect(r.konflik).toEqual([]);
    expect(r.langkah.map((l) => `${l.aksi} ${l.jenis} ${l.kode}`)).toEqual([
      "TAMBAH gudang g-uji",
      "TAMBAH zona z-uji",
      "TAMBAH drop_point dp-a",
      "TAMBAH drop_point dp-b",
    ]);
    expect(r.langkah[1]).toMatchObject({
      sesudah: { dropPointPusat: "dp-a", gudang: "g-uji", aktif: true },
    });
    // Koordinat & radius tidak pernah masuk ke DB (M7).
    expect(JSON.stringify(r.langkah)).not.toMatch(/lat|lng|radius/);
  });

  it("DB sudah sesuai → 0 langkah (idempoten)", () => {
    expect(rencanakanSinkronLokasi(konfig(), sesuai())).toEqual({
      langkah: [],
      konflik: [],
      konflikPemakaian: [],
    });
  });

  it("UBAH hanya memuat kolom yang berubah", () => {
    const k = konfig((x) => {
      const dp = x.zona[0]?.dropPoint[1];
      if (dp) (dp as { nama: string }).nama = "DP B Baru";
    });
    const r = rencanakanSinkronLokasi(k, sesuai());
    expect(r.langkah).toEqual([
      {
        aksi: "UBAH",
        jenis: "drop_point",
        kode: "dp-b",
        sebelum: { nama: "DP B" },
        sesudah: { nama: "DP B Baru" },
      },
    ]);
  });

  it("drop point pusat = drop point pertama; urutan berubah → UBAH zona", () => {
    const k = konfig((x) => {
      x.zona[0]?.dropPoint.reverse();
    });
    const r = rencanakanSinkronLokasi(k, sesuai());
    expect(r.langkah).toEqual([
      {
        aksi: "UBAH",
        jenis: "zona",
        kode: "z-uji",
        sebelum: { dropPointPusat: "dp-a" },
        sesudah: { dropPointPusat: "dp-b" },
      },
    ]);
  });

  it("hilang dari config & masih aktif → LEPAS (drop point → zona → gudang); sudah nonaktif → dibiarkan", () => {
    const s = sesuai();
    const status: StatusLokasiDb = {
      gudang: [
        ...s.gudang,
        { id: "9", kode: "g-lama", nama: "Lama", jenis: "CABANG", aktif: true },
      ],
      zona: [
        ...s.zona,
        {
          id: "8",
          kode: "z-lama",
          namaKelurahan: "Lama",
          gudang: "g-lama",
          dropPointPusat: "dp-lama",
          aktif: true,
        },
        {
          id: "7",
          kode: "z-arsip",
          namaKelurahan: "Arsip",
          gudang: "g-uji",
          dropPointPusat: null,
          aktif: false,
        },
      ],
      dropPoint: [
        ...s.dropPoint,
        {
          id: "6",
          kode: "dp-lama",
          zona: "z-lama",
          gudang: "g-lama",
          nama: "Lama",
          alamatPublik: null,
          jamAmbil: null,
          aktif: true,
        },
      ],
    };
    const r = rencanakanSinkronLokasi(konfig(), status);
    expect(r.langkah.map((l) => `${l.aksi} ${l.jenis} ${l.kode}`)).toEqual([
      "LEPAS drop_point dp-lama",
      "LEPAS zona z-lama",
      "LEPAS gudang g-lama",
    ]);
  });

  it("entri nonaktif yang kembali ke config → diaktifkan lagi", () => {
    const s = sesuai();
    const status: StatusLokasiDb = {
      ...s,
      dropPoint: s.dropPoint.map((d) => (d.kode === "dp-b" ? { ...d, aktif: false } : d)),
    };
    const r = rencanakanSinkronLokasi(konfig(), status);
    expect(r.langkah).toEqual([
      {
        aksi: "UBAH",
        jenis: "drop_point",
        kode: "dp-b",
        sebelum: { aktif: false },
        sesudah: { aktif: true },
      },
    ]);
  });

  it("drop point pindah zona → konflik", () => {
    const k = konfig((x) => {
      const z = x.zona[0];
      if (!z) return;
      const [dpA, dpB] = z.dropPoint;
      if (!dpA || !dpB) return;
      x.zona = [
        { ...z, dropPoint: [dpA] },
        { kode: "z-dua", namaKelurahan: "Kelurahan Dua", gudang: "g-uji", dropPoint: [dpB] },
      ];
    });
    const r = rencanakanSinkronLokasi(k, sesuai());
    expect(r.konflik).toHaveLength(1);
    expect(r.konflik[0]).toMatch(/dp-b terdaftar di zona z-uji.*z-dua.*kode drop point baru/);
  });

  describe("pagar pemakaian aktif (Z-03, default sementara)", () => {
    const tanpaPemakaian = {
      zonaSlotDibuka: [],
      zonaGrupBelumFinal: [],
      dropPointPesertaHidup: [],
      gudangGrupBelumFinal: [],
    };
    // DB punya z-lama (+dp-lama, g-lama) yang sudah tidak ada di config.
    const denganLama = (pemakaian: PemakaianAktifLokasi): StatusLokasiDb => {
      const s = sesuai();
      return {
        pemakaian,
        gudang: [
          ...s.gudang,
          { id: "9", kode: "g-lama", nama: "Lama", jenis: "CABANG", aktif: true },
        ],
        zona: [
          ...s.zona,
          {
            id: "8",
            kode: "z-lama",
            namaKelurahan: "Lama",
            gudang: "g-lama",
            dropPointPusat: "dp-lama",
            aktif: true,
          },
        ],
        dropPoint: [
          ...s.dropPoint,
          {
            id: "6",
            kode: "dp-lama",
            zona: "z-lama",
            gudang: "g-lama",
            nama: "Lama",
            alamatPublik: null,
            jamAmbil: null,
            aktif: true,
          },
        ],
      };
    };

    it("tanpa pemakaian aktif → tidak ada konflik pemakaian", () => {
      expect(
        rencanakanSinkronLokasi(konfig(), denganLama(tanpaPemakaian)).konflikPemakaian,
      ).toEqual([]);
    });

    it("lepas zona/drop point/gudang yang masih dipakai → konflik pemakaian per entri", () => {
      const r = rencanakanSinkronLokasi(
        konfig(),
        denganLama({
          zonaSlotDibuka: ["z-lama"],
          zonaGrupBelumFinal: ["z-lama"],
          dropPointPesertaHidup: ["dp-lama"],
          gudangGrupBelumFinal: ["g-lama"],
        }),
      );
      expect(r.konflik).toEqual([]);
      expect(r.konflikPemakaian).toEqual([
        "drop point dp-lama dilepas saat masih dipilih peserta grup belum final",
        "zona z-lama dilepas saat masih ada slot kirim DIBUKA & grup belum final",
        "gudang g-lama dilepas saat masih menerima grup belum final",
      ]);
      // Langkah tetap dihitung (untuk pratinjau --kering).
      expect(r.langkah.filter((l) => l.aksi === "LEPAS")).toHaveLength(3);
    });

    it("pemakaian pada entri yang TIDAK dilepas tidak menimbulkan konflik", () => {
      const r = rencanakanSinkronLokasi(konfig(), {
        ...sesuai(),
        pemakaian: {
          zonaSlotDibuka: ["z-uji"],
          zonaGrupBelumFinal: ["z-uji"],
          dropPointPesertaHidup: ["dp-a"],
          gudangGrupBelumFinal: ["g-uji"],
        },
      });
      expect(r).toEqual({ langkah: [], konflik: [], konflikPemakaian: [] });
    });

    it("zona pindah gudang saat slot DIBUKA → konflik; tanpa pemakaian → boleh", () => {
      const k = konfig((x) => {
        x.gudang.push({ kode: "g-dua", nama: "Cabang", jenis: "CABANG", lat: -6.3, lng: 106.7 });
        const z = x.zona[0];
        if (z) z.gudang = "g-dua";
      });
      const dipakai = rencanakanSinkronLokasi(k, {
        ...sesuai(),
        pemakaian: { ...tanpaPemakaian, zonaSlotDibuka: ["z-uji"] },
      });
      expect(dipakai.konflikPemakaian).toEqual([
        "zona z-uji pindah gudang g-uji → g-dua saat masih ada slot kirim DIBUKA",
      ]);
      expect(rencanakanSinkronLokasi(k, sesuai()).konflikPemakaian).toEqual([]);
    });
  });

  it("teksPerubahanLokasi: satu baris yang bisa dibaca manusia", () => {
    const [tambah] = rencanakanSinkronLokasi(konfig(), KOSONG).langkah;
    if (!tambah) throw new Error("tidak ada langkah");
    expect(teksPerubahanLokasi(tambah)).toBe(
      '+ gudang g-uji (nama="Gudang Uji", jenis="PUSAT", aktif=true)',
    );
    expect(
      teksPerubahanLokasi({
        aksi: "UBAH",
        jenis: "zona",
        kode: "z",
        sebelum: { aktif: false },
        sesudah: { aktif: true },
      }),
    ).toBe("~ zona z: aktif false → true");
    expect(
      teksPerubahanLokasi({ aksi: "LEPAS", jenis: "zona", kode: "z", hasil: "DINONAKTIFKAN" }),
    ).toBe("- zona z → DINONAKTIFKAN");
  });
});
