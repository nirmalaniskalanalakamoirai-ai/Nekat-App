// Penyusun katalog pembeli (T-025). Fungsi murni: data katalog + stok + modal → snapshot tayang.
//
// Aturan (CLAUDE.md, keputusan.md):
// - Harga HANYA dari engine harga (`hitungHargaProduk`); satuan jual yang tidak tayang menurut
//   engine (tanpa harga, di bawah modal, pagar dilanggar — K-42 menahan kedua harga) TIDAK tayang.
// - K-20: satuan jual berharga tetapi stok habis TETAP tampil, `tersedia: false` + label.
// - PG-6: harga kartu & detail dari satu fungsi (`tampilanHargaKatalog`) dan objek yang sama.
// - Modal, margin, isian sel, dan alasan admin tidak pernah masuk hasil (hanya kode di `ditahan`).
// - Rokok/bir (keputusan #7): kategori terlarang (kode kategori ATAU induknya) disaring.
import {
  LABEL_STOK_HABIS,
  LABEL_STOK_TIDAK_DIKETAHUI,
  type Rupiah,
  type StatusStok,
} from "@nekat/shared";
import { cekKesegaranModal, hitungHargaProduk, normalisasiKodeKategori } from "../harga/hitung.js";
import { labelSatuan } from "../harga/pesan.js";
import {
  BP_PER_SATU,
  LEVEL_HARGA,
  type InputSatuanJual,
  type IsiSel,
  type LevelHarga,
  type TabelHarga,
  type TinjauanKategori,
} from "../harga/tipe.js";
import { kodeKategoriTerlarang, statusStokSnapshot } from "../inventori.js";
import { kunciCari } from "./cari.js";
import type {
  BarisKategoriKatalog,
  BarisSatuanJualKatalog,
  KategoriTampil,
  MasukanKatalog,
  ProdukTampil,
  RingkasKategori,
  SatuanDitahan,
  SatuanTampil,
  SnapshotKatalog,
  StatusStokTampil,
  TampilanHargaKatalog,
  VarianTampil,
} from "./tipe.js";

/** Kunci peta modal: satu modal per (SKU, jenis satuan jual), sama dengan `ModalSumber` (K-01). */
export function kunciModal(skuId: string, jenis: string): string {
  return `${skuId}\u0000${jenis}`;
}

const POLA_PERSEN = /^(\d{1,9})(?:\.(\d+))?$/;

/**
 * `numeric(9,4)` (teks) → basis poin. Tanpa float: "12.5" → 1250. Lebih dari 2 desimal yang tidak
 * nol (mis. "12.345") → NaN agar engine menolak dengan `FORMAT_PERSEN` (bukan dibulatkan, H6).
 */
export function persenKeBp(teks: string): number {
  const m = POLA_PERSEN.exec(teks.trim());
  if (!m) return Number.NaN;
  const bulat = m[1] ?? "0";
  const pecahan = m[2] ?? "";
  if (/[1-9]/.test(pecahan.slice(2))) return Number.NaN;
  const duaDigit = pecahan.slice(0, 2).padEnd(2, "0");
  return Number(bulat) * (BP_PER_SATU / 100) + Number(duaDigit);
}

function keTinjauan(nilai: string): TinjauanKategori {
  return nilai === "TIDAK_PERLU" || nilai === "DISETUJUI" ? nilai : "MENUNGGU";
}

/**
 * Harga tampil katalog untuk SATU satuan jual (engine-harga §5.1, konteks KATALOG).
 * Satu-satunya penghasil harga kartu & detail (PG-6). `null` = tidak boleh tayang.
 * Verifikasi ulang (pertahanan berlapis): harga > modal dan Belanja Bareng ≤ Harga Satuan.
 */
export function tampilanHargaKatalog(t: TabelHarga): TampilanHargaKatalog | null {
  const satuan = t.sel.SATUAN;
  if (!t.tayang || t.kode === null || !satuan.valid || satuan.harga === null || t.modal === null) {
    return null;
  }
  if (satuan.harga <= t.modal) return null;
  const mitra = t.sel.MITRA_GROSIR;
  let belanjaBareng: Rupiah | null = null;
  // K-38 + K-14: Harga Belanja Bareng = Harga Mitra Grosir; hanya bila tier grup aktif (P-21)
  // dan selnya valid (K-27: kosong/tidak valid → grup memakai Harga Satuan, jadi tidak ditampilkan).
  if (t.bolehGrup && mitra.valid && mitra.aktif && mitra.harga !== null) {
    if (mitra.harga > t.modal && mitra.harga <= satuan.harga) belanjaBareng = mitra.harga;
  }
  return { hargaSatuan: satuan.harga, hargaBelanjaBareng: belanjaBareng };
}

function statusStok(status: StatusStok): StatusStokTampil {
  switch (status) {
    case "TERSEDIA":
      return { status, tersedia: true, label: null };
    case "HABIS":
      return { status, tersedia: false, label: LABEL_STOK_HABIS };
    case "TIDAK_DIKETAHUI":
      return { status, tersedia: false, label: LABEL_STOK_TIDAK_DIKETAHUI };
  }
}

/** Status produk: ada satuan tersedia → TERSEDIA; ada yang tidak diketahui → TIDAK_DIKETAHUI; selain itu HABIS. */
function statusProduk(semua: readonly SatuanTampil[]): StatusStok {
  if (semua.some((x) => x.stok.status === "TERSEDIA")) return "TERSEDIA";
  if (semua.some((x) => x.stok.status === "TIDAK_DIKETAHUI")) return "TIDAK_DIKETAHUI";
  return "HABIS";
}

interface PosisiKategori {
  readonly akar: BarisKategoriKatalog;
  readonly sub: BarisKategoriKatalog | null;
}

function bandingKategori(a: BarisKategoriKatalog, b: BarisKategoriKatalog): number {
  return a.urutan - b.urutan || a.nama.localeCompare(b.nama, "id") || banding(a.kode, b.kode);
}

function banding(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function susunKatalog(m: MasukanKatalog): SnapshotKatalog {
  const k = m.konfigurasiHarga;
  const terlarangEngine = new Set(k.kategoriTerlarang.map(normalisasiKodeKategori));
  const kategoriTerlarang = (kode: string) =>
    terlarangEngine.has(normalisasiKodeKategori(kode)) || kodeKategoriTerlarang(kode);

  const kategoriPerId = new Map(m.data.kategori.map((x) => [x.id, x]));
  /** Posisi valid (aktif, maks. 2 tingkat, tidak terlarang) per id kategori. */
  const posisi = new Map<string, PosisiKategori>();
  for (const x of m.data.kategori) {
    if (!x.aktif || kategoriTerlarang(x.kode)) continue;
    if (x.indukId === null) {
      posisi.set(x.id, { akar: x, sub: null });
      continue;
    }
    const induk = kategoriPerId.get(x.indukId);
    if (!induk?.aktif || induk.indukId !== null || kategoriTerlarang(induk.kode)) continue;
    posisi.set(x.id, { akar: induk, sub: x });
  }

  const skuPerProduk = kelompokkan(
    m.data.sku.filter((s) => s.aktifDiSumber),
    (s) => s.produkId,
  );
  const sjPerSku = kelompokkan(m.data.satuanJual, (s) => s.skuId);
  const hargaPerSj = kelompokkan(m.data.hargaLevel, (h) => h.satuanJualId);
  const timpaan = new Map(m.data.timpaanModal.map((t) => [t.satuanJualId, t.modalRp]));

  const ditahan: SatuanDitahan[] = [];
  const produk: ProdukTampil[] = [];
  const posisiProduk = new Map<string, PosisiKategori>();

  for (const p of m.data.produk) {
    if (!p.aktif) continue;
    const pos = posisi.get(p.kategoriId);
    if (!pos) continue;
    const kodeKategori = (pos.sub ?? pos.akar).kode;

    const skuUrut = [...(skuPerProduk.get(p.id) ?? [])].sort(
      (a, b) => banding(a.kodeSku, b.kodeSku) || banding(a.id, b.id),
    );
    const varian: VarianTampil[] = [];
    for (const s of skuUrut) {
      const sjUrut = [...(sjPerSku.get(s.id) ?? [])].sort(
        (a, b) => a.isiSatuanDasar - b.isiSatuanDasar || banding(a.jenis, b.jenis),
      );
      if (sjUrut.length === 0) continue;
      const sjPerId = new Map(sjUrut.map((x) => [x.id, x]));
      const hasil = hitungHargaProduk(
        {
          idProduk: s.id,
          kodeKategori,
          tinjauanKategori: keTinjauan(p.tinjauanKategori),
          bebasPpn: p.bebasPpn,
          satuan: sjUrut.map((sj) => inputSatuan(sj, m, hargaPerSj, timpaan)),
        },
        k,
      );

      const stok = m.stok.get(s.id);
      const reservasi = m.reservasi.get(s.id) ?? 0;

      const satuan: SatuanTampil[] = [];
      for (const t of hasil.satuan) {
        const sj = sjPerId.get(t.idSatuanJual);
        const basi = cekKesegaranModal(t, k, m.sekarang);
        const harga = basi.length === 0 ? tampilanHargaKatalog(t) : null;
        if (!sj || harga === null || t.kode === null) {
          const kode = [...t.alasanTidakTayang, ...basi].map((x) => x.kode);
          ditahan.push({
            idSatuanJual: t.idSatuanJual,
            idProduk: p.id,
            kode: kode.length > 0 ? [...new Set(kode)] : ["TIDAK_TAYANG"],
          });
          continue;
        }
        satuan.push({
          id: t.idSatuanJual,
          skuId: s.id,
          kode: t.kode,
          label: labelSatuan(t.kode),
          isi: t.isi,
          harga,
          stok: statusStok(
            statusStokSnapshot({
              sumber: m.sumber,
              stok,
              reservasi,
              isiSatuanDasar: sj.isiSatuanDasar,
              sekarang: m.sekarang,
              maksUmurDataMenit: m.maksUmurDataMenit,
            }),
          ),
        });
      }
      if (satuan.length > 0) {
        varian.push({ skuId: s.id, nama: s.namaVarian, satuanDasar: s.satuanDasar, satuan });
      }
    }

    const semua = varian.flatMap((v) => v.satuan);
    const utama = semua.find((x) => x.stok.tersedia) ?? semua[0];
    if (!utama) continue;

    posisiProduk.set(p.id, pos);
    produk.push({
      id: p.id,
      nama: p.nama,
      deskripsi: p.deskripsi,
      gambarUrl: p.gambarUrl,
      kategori: ringkas(pos.akar),
      subkategori: pos.sub ? ringkas(pos.sub) : null,
      varian,
      utama,
      stok: statusStok(statusProduk(semua)),
      kunciCari: kunciCari([p.nama, ...varian.map((v) => v.nama ?? "")]),
      urutan: 0,
    });
  }

  produk.sort((a, b) => {
    const pa = posisiProduk.get(a.id);
    const pb = posisiProduk.get(b.id);
    if (pa && pb) {
      const ka = bandingKategori(pa.akar, pb.akar);
      if (ka !== 0) return ka;
      if (pa.sub === null || pb.sub === null) {
        if (pa.sub !== pb.sub) return pa.sub === null ? -1 : 1;
      } else {
        const ks = bandingKategori(pa.sub, pb.sub);
        if (ks !== 0) return ks;
      }
    }
    return a.nama.localeCompare(b.nama, "id") || banding(a.id, b.id);
  });
  const produkUrut = produk.map((x, i) => ({ ...x, urutan: i }));

  return {
    kategori: susunKategori(m.data.kategori, posisi, produkUrut, posisiProduk),
    produk: produkUrut,
    produkPerId: new Map(produkUrut.map((x) => [x.id, x])),
    ditahan,
  };
}

function kelompokkan<T>(daftar: readonly T[], kunci: (x: T) => string): Map<string, T[]> {
  const hasil = new Map<string, T[]>();
  for (const x of daftar) {
    const k = kunci(x);
    const isi = hasil.get(k);
    if (isi) isi.push(x);
    else hasil.set(k, [x]);
  }
  return hasil;
}

function ringkas(x: BarisKategoriKatalog): RingkasKategori {
  return { kode: x.kode, nama: x.nama };
}

function inputSatuan(
  sj: BarisSatuanJualKatalog,
  m: MasukanKatalog,
  hargaPerSj: ReadonlyMap<string, readonly MasukanKatalog["data"]["hargaLevel"][number][]>,
  timpaan: ReadonlyMap<string, number>,
): InputSatuanJual {
  const sumber = m.modal.get(kunciModal(sj.skuId, sj.jenis));
  // P-25/K-03: timpaan aktif menggantikan modal sumber sampai dicabut admin.
  const modalTimpaan = timpaan.get(sj.id);
  const sel: Partial<Record<LevelHarga, IsiSel | null>> = {};
  for (const h of hargaPerSj.get(sj.id) ?? []) {
    if (!(LEVEL_HARGA as readonly string[]).includes(h.level)) continue;
    const level = h.level as LevelHarga;
    if (h.mode === "PERSEN" && h.marginPersen !== null) {
      sel[level] = { mode: "PERSEN", markupBp: persenKeBp(h.marginPersen) };
    } else if (h.mode === "RUPIAH" && h.hargaJualRp !== null) {
      sel[level] = { mode: "RUPIAH", hargaRp: h.hargaJualRp };
    }
  }
  return {
    idSatuanJual: sj.id,
    kode: sj.jenis,
    isi: sj.isiSatuanDasar,
    moqGrosir: sj.moqMitraGrosir,
    bolehGrup: sj.bolehGrup,
    modal: modalTimpaan ?? sumber?.modal ?? null,
    waktuDataModal: modalTimpaan !== undefined ? m.sekarang : (sumber?.dataPada ?? null),
    sel,
  };
}

function susunKategori(
  semua: readonly BarisKategoriKatalog[],
  posisi: ReadonlyMap<string, PosisiKategori>,
  produk: readonly ProdukTampil[],
  posisiProduk: ReadonlyMap<string, PosisiKategori>,
): KategoriTampil[] {
  const jumlahPerKategori = new Map<string, number>();
  for (const x of produk) {
    const pos = posisiProduk.get(x.id);
    if (!pos) continue;
    jumlahPerKategori.set(pos.akar.id, (jumlahPerKategori.get(pos.akar.id) ?? 0) + 1);
    if (pos.sub) jumlahPerKategori.set(pos.sub.id, (jumlahPerKategori.get(pos.sub.id) ?? 0) + 1);
  }
  const akar = semua.filter((x) => x.indukId === null && posisi.has(x.id)).sort(bandingKategori);
  const hasil: KategoriTampil[] = [];
  for (const a of akar) {
    const jumlah = jumlahPerKategori.get(a.id) ?? 0;
    // Kategori/subkategori tanpa produk tayang tidak ditampilkan (tidak ada tab kosong).
    if (jumlah === 0) continue;
    const sub = semua
      .filter((x) => x.indukId === a.id && posisi.has(x.id))
      .sort(bandingKategori)
      .map((x) => ({ kode: x.kode, nama: x.nama, jumlahProduk: jumlahPerKategori.get(x.id) ?? 0 }))
      .filter((x) => x.jumlahProduk > 0);
    hasil.push({ kode: a.kode, nama: a.nama, jumlahProduk: jumlah, subkategori: sub });
  }
  return hasil;
}
