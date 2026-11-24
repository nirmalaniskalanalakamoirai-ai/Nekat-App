// Engine harga T-020: harga per satuan jual × level dari modal + margin, pagar, status tayang.
// Fungsi murni: tanpa I/O, tanpa jam sistem, deterministik (docs/spec/engine-harga.md §3–§4, §7).
//
// Aturan wajib (CLAUDE.md + keputusan.md):
// - Harga = modal + margin (persen markup atau rupiah manual, P-01). Tidak ada harga ≤ modal (P-16).
// - Tanpa pembulatan (H6): hasil yang bukan rupiah bulat tidak dibulatkan, tetapi ditolak
//   dan masuk antrean "perlu ditinjau" (K-01, K-28).
// - Cek modal memakai harga TANPA PPN (K-28): H × φ_penyebut > M × φ_pembilang.
// - Pagar level: Satuan ≥ Mitra Grosir ≥ Franchise; sama besar boleh (K-14, P-22).
// - Pagar kemasan (P-14): harga per pcs kemasan besar ≤ kemasan kecil pada level yang sama.
// - Semua perkalian memakai BigInt, sehingga tidak ada float dan tidak ada overflow diam-diam.
import { keRupiah, type Rupiah } from "@nekat/shared";
import { buatMasalah, LABEL_LEVEL, labelSatuan } from "./pesan.js";
import {
  BP_PER_SATU,
  ISI_KANONIK,
  KODE_SATUAN,
  LEVEL_HARGA,
  MODE_HARGA,
  type HasilHargaProduk,
  type InputProdukHarga,
  type InputSatuanJual,
  type IsiSel,
  type KodeSatuan,
  type KonfigurasiHarga,
  type LevelHarga,
  type Masalah,
  type Rasional,
  type SelHarga,
  type StatusTayang,
  type TabelHarga,
} from "./tipe.js";

const MAKS_AMAN = BigInt(Number.MAX_SAFE_INTEGER);
const BP = BigInt(BP_PER_SATU);
const PHI_BEBAS_PPN: Rasional = { pembilang: 1, penyebut: 1 };

/**
 * Konfigurasi bawaan. Tidak berisi angka harga/margin produk.
 * `marginMinimumBp` = null: sel cukup lolos PG-1 (harga tanpa PPN > modal). Batas 5 % K-16 hanya
 * berlaku untuk promo & gratis ongkir saja; K-41 (19 Nov): tidak berlaku untuk harga sel.
 * `ppnFaktor` sengaja kosong: produk kena PPN tidak tayang sampai Efan/konsultan pajak mengisinya.
 */
export const KONFIGURASI_HARGA_BAWAAN: KonfigurasiHarga = {
  jenisIsiSelDiizinkan: ["PERSEN", "RUPIAH"],
  levelAktif: ["SATUAN", "MITRA_GROSIR"],
  mitraWajibUntukTayang: false,
  ppnFaktor: null,
  marginMinimumBp: null, // K-41 (19 Nov): margin minimum 5 % tidak berlaku untuk harga dasar
  batasAtasMarkupBp: null,
  kategoriTerlarang: [
    "rokok",
    "tembakau",
    "nikotin",
    "vape",
    "bir",
    "alkohol",
    "minuman-beralkohol",
  ],
  batasUsiaModalMenit: null,
};

function bilanganBulatAman(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n);
}

/** Normalisasi kode kategori untuk pencocokan daftar terlarang (NFKC, trim, huruf kecil). */
export function normalisasiKodeKategori(kode: string): string {
  return kode.normalize("NFKC").trim().toLowerCase();
}

/** Memeriksa konfigurasi. Konfigurasi tidak valid → semua satuan jual tidak tayang. */
export function validasiKonfigurasi(k: KonfigurasiHarga): Masalah[] {
  const salah: string[] = [];
  if (
    k.jenisIsiSelDiizinkan.length === 0 ||
    !k.jenisIsiSelDiizinkan.every((m) => (MODE_HARGA as readonly string[]).includes(m))
  ) {
    salah.push("jenis isian sel");
  }
  if (
    !k.levelAktif.includes("SATUAN") ||
    !k.levelAktif.every((l) => (LEVEL_HARGA as readonly string[]).includes(l))
  ) {
    salah.push("level aktif (Harga Satuan wajib aktif)");
  }
  if (k.mitraWajibUntukTayang && !k.levelAktif.includes("MITRA_GROSIR")) {
    salah.push("Mitra Grosir diwajibkan untuk tayang tetapi levelnya tidak aktif");
  }
  if (k.ppnFaktor !== null) {
    const { pembilang, penyebut } = k.ppnFaktor;
    if (
      !bilanganBulatAman(pembilang) ||
      !bilanganBulatAman(penyebut) ||
      penyebut <= 0 ||
      pembilang < penyebut
    ) {
      salah.push("faktor PPN");
    }
  }
  if (
    k.marginMinimumBp !== null &&
    !(bilanganBulatAman(k.marginMinimumBp) && k.marginMinimumBp >= 0)
  ) {
    salah.push("margin minimum");
  }
  if (
    k.batasAtasMarkupBp !== null &&
    !(bilanganBulatAman(k.batasAtasMarkupBp) && k.batasAtasMarkupBp > 0)
  ) {
    salah.push("batas atas markup");
  }
  if (
    k.batasUsiaModalMenit !== null &&
    !(bilanganBulatAman(k.batasUsiaModalMenit) && k.batasUsiaModalMenit > 0)
  ) {
    salah.push("batas usia modal");
  }
  return salah.map((bagian) =>
    buatMasalah("KONFIGURASI_TIDAK_VALID", { rincian: `Periksa: ${bagian}.` }),
  );
}

// ---------------------------------------------------------------------------------------------
// Harga satu sel
// ---------------------------------------------------------------------------------------------

interface SelKerja {
  readonly level: LevelHarga;
  readonly isi: IsiSel | null;
  /** Hasil hitung (bisa melanggar pagar); dipakai pagar & tampilan admin. */
  hargaTerhitung: Rupiah | null;
  margin: Rupiah | null;
  valid: boolean;
  aktif: boolean;
  readonly masalah: Masalah[];
}

interface KonteksSel {
  readonly level: LevelHarga;
  readonly idSatuanJual?: string;
  readonly kodeSatuan?: string;
}

function keRupiahAtauNull(n: bigint): Rupiah | null {
  return n >= 0n && n <= MAKS_AMAN ? keRupiah(Number(n)) : null;
}

/**
 * Menghitung satu sel. `modal` sudah tervalidasi (bilangan bulat aman > 0).
 * `phi` = faktor PPN (1/1 untuk bebas PPN); `null` = PPN belum dikonfigurasi → sel tidak valid
 * (alasan ditulis sekali di tingkat satuan jual, bukan per sel).
 */
function hitungSelKerja(
  modal: number,
  isi: IsiSel | null,
  phi: Rasional | null,
  k: KonfigurasiHarga,
  ktx: KonteksSel,
): SelKerja {
  const sel: SelKerja = {
    level: ktx.level,
    isi,
    hargaTerhitung: null,
    margin: null,
    valid: false,
    aktif: k.levelAktif.includes(ktx.level),
    masalah: [],
  };
  const tambah = (...args: Parameters<typeof buatMasalah>) => {
    sel.masalah.push(buatMasalah(args[0], { ...ktx, ...args[1] }));
  };

  if (isi === null) {
    // Harga satuan wajib (P-21); level lain boleh kosong (P-06, K-27).
    if (ktx.level === "SATUAN") tambah("SEL_KOSONG");
    return sel;
  }
  if (!k.jenisIsiSelDiizinkan.includes(isi.mode)) {
    tambah(isi.mode === "PERSEN" ? "FORMAT_PERSEN" : "FORMAT_HARGA", {
      rincian: "Jenis isian ini tidak diizinkan konfigurasi.",
    });
    return sel;
  }

  const M = BigInt(modal);
  let H: bigint;
  if (isi.mode === "PERSEN") {
    const bp = isi.markupBp;
    if (!bilanganBulatAman(bp)) {
      tambah("FORMAT_PERSEN");
      return sel;
    }
    if (bp < 0) {
      tambah("MARGIN_NEGATIF");
      return sel;
    }
    if (bp === 0) {
      tambah("MARGIN_NOL");
      return sel;
    }
    const pembilang = M * BigInt(bp);
    if (pembilang % BP !== 0n) {
      tambah("HARGA_PECAHAN"); // K-28: tidak dibulatkan, tidak dipakai, perlu ditinjau
      return sel;
    }
    H = M + pembilang / BP;
  } else {
    const h = isi.hargaRp;
    if (!Number.isFinite(h)) {
      tambah("FORMAT_HARGA");
      return sel;
    }
    if (!Number.isInteger(h)) {
      tambah("FORMAT_HARGA", { rincian: "Harga harus rupiah bulat; tidak dibulatkan otomatis." });
      return sel;
    }
    if (!Number.isSafeInteger(h)) {
      tambah("ANGKA_OVERFLOW");
      return sel;
    }
    H = BigInt(h);
  }

  if (H > MAKS_AMAN) {
    tambah("ANGKA_OVERFLOW");
    return sel;
  }
  sel.hargaTerhitung = keRupiahAtauNull(H);

  // PG-1 dasar: harga > modal (margin 0 ditolak, P-16).
  if (H < M) {
    tambah("MARGIN_NEGATIF");
    return sel;
  }
  if (H === M) {
    tambah("MARGIN_NOL");
    return sel;
  }
  sel.margin = keRupiahAtauNull(H - M);

  if (phi === null) return sel; // PPN_BELUM_DIKONFIGURASI dicatat di tingkat satuan jual

  const num = BigInt(phi.pembilang);
  const den = BigInt(phi.penyebut);
  // PG-1 dengan dasar tanpa PPN (K-28): H / φ > M.
  if (H * den <= M * num) {
    tambah("HARGA_DI_BAWAH_MODAL");
    return sel;
  }
  // Batas bawah margin dari modal (P-07/K-16), juga tanpa PPN: H / φ ≥ M × (1 + β/10000).
  if (k.marginMinimumBp !== null && H * den * BP < M * num * (BP + BigInt(k.marginMinimumBp))) {
    tambah("MARGIN_DI_BAWAH_MINIMUM");
    return sel;
  }
  if (k.batasAtasMarkupBp !== null && (H - M) * BP > M * BigInt(k.batasAtasMarkupBp)) {
    tambah("MARKUP_DI_ATAS_BATAS");
  }
  sel.valid = true;
  return sel;
}

function bekukanSel(s: SelKerja): SelHarga {
  return {
    level: s.level,
    isi: s.isi,
    // Harga yang boleh dipakai hanya dari sel valid; nilai terhitung tetap tersedia untuk admin.
    harga: s.valid ? s.hargaTerhitung : null,
    hargaTerhitung: s.hargaTerhitung,
    margin: s.valid ? s.margin : null,
    valid: s.valid,
    aktif: s.aktif,
    masalah: [...s.masalah],
  };
}

/**
 * Pratinjau satu sel untuk panel admin (T-037), memakai aturan yang sama dengan
 * `hitungHargaProduk`, tetapi tanpa pagar lintas sel (PG-2) dan lintas kemasan (P-14).
 * `modal` mentah: bila tidak valid, hasilnya sel kosong dengan masalah modal.
 */
export function hitungHargaSel(
  modal: number | null,
  isi: IsiSel | null,
  level: LevelHarga,
  bebasPpn: boolean,
  k: KonfigurasiHarga,
): SelHarga {
  const masalahKonfigurasi = validasiKonfigurasi(k);
  const masalahModal = masalahKonfigurasi.length > 0 ? masalahKonfigurasi : periksaModal(modal, {});
  const phi = bebasPpn ? PHI_BEBAS_PPN : k.ppnFaktor;
  if (masalahModal.length > 0 || modal === null) {
    return {
      level,
      isi,
      harga: null,
      hargaTerhitung: null,
      margin: null,
      valid: false,
      aktif: k.levelAktif.includes(level),
      masalah: masalahModal,
    };
  }
  const sel = hitungSelKerja(modal, isi, phi, k, { level });
  if (phi === null && isi !== null) {
    sel.valid = false;
    sel.masalah.push(buatMasalah("PPN_BELUM_DIKONFIGURASI", { level }));
  }
  return bekukanSel(sel);
}

// ---------------------------------------------------------------------------------------------
// Validasi satuan jual & modal
// ---------------------------------------------------------------------------------------------

function periksaModal(modal: number | null, ktx: { idSatuanJual?: string }): Masalah[] {
  if (modal === null) return [buatMasalah("MODAL_KOSONG", ktx)];
  if (Number.isNaN(modal) || modal <= 0) {
    return [buatMasalah("MODAL_TIDAK_VALID", ktx)];
  }
  if (!Number.isFinite(modal)) return [buatMasalah("ANGKA_OVERFLOW", ktx)];
  if (!Number.isInteger(modal)) return [buatMasalah("MODAL_PECAHAN", ktx)]; // K-01
  if (!Number.isSafeInteger(modal)) return [buatMasalah("ANGKA_OVERFLOW", ktx)];
  return [];
}

function kodeSatuanValid(kode: string): kode is KodeSatuan {
  return (KODE_SATUAN as readonly string[]).includes(kode);
}

function periksaSatuan(s: InputSatuanJual, jumlahKode: ReadonlyMap<string, number>): Masalah[] {
  const ktx = { idSatuanJual: s.idSatuanJual, kodeSatuan: s.kode };
  const hasil: Masalah[] = [];
  if (!kodeSatuanValid(s.kode)) {
    hasil.push(
      buatMasalah("SATUAN_TIDAK_VALID", {
        ...ktx,
        rincian: "Kode harus salah satu dari 1 pcs, 3 pcs, lusin, dus, koli.",
      }),
    );
    return hasil;
  }
  if (!bilanganBulatAman(s.isi) || s.isi <= 0) {
    hasil.push(
      buatMasalah("SATUAN_TIDAK_VALID", { ...ktx, rincian: "Isi harus bilangan bulat > 0." }),
    );
  } else {
    const kanonik = ISI_KANONIK[s.kode];
    if (kanonik !== undefined && kanonik !== s.isi) {
      hasil.push(
        buatMasalah("SATUAN_TIDAK_VALID", {
          ...ktx,
          rincian: "Isi tidak sesuai jenis satuan (1 pcs = 1, 3 pcs = 3, lusin = 12).",
        }),
      );
    }
  }
  if ((jumlahKode.get(s.kode) ?? 0) > 1) {
    hasil.push(
      buatMasalah("SATUAN_TIDAK_VALID", {
        ...ktx,
        rincian: "Satuan yang sama terdaftar lebih dari sekali pada produk ini.",
      }),
    );
  }
  return hasil;
}

// ---------------------------------------------------------------------------------------------
// Pagar lintas sel
// ---------------------------------------------------------------------------------------------

type SelPerLevel = Record<LevelHarga, SelKerja>;

/** PG-2: per satuan jual, Satuan ≥ Mitra Grosir ≥ Franchise untuk sel yang punya harga. */
function terapkanPagarLevel(sel: SelPerLevel, ktx: { idSatuanJual: string; kodeSatuan: string }) {
  for (const [i, levelAtas] of LEVEL_HARGA.entries()) {
    for (const levelBawah of LEVEL_HARGA.slice(i + 1)) {
      const atas = sel[levelAtas];
      const bawah = sel[levelBawah];
      if (
        atas.hargaTerhitung === null ||
        bawah.hargaTerhitung === null ||
        atas.hargaTerhitung >= bawah.hargaTerhitung
      ) {
        continue;
      }
      const rincian = `${LABEL_LEVEL[bawah.level]} lebih tinggi dari ${LABEL_LEVEL[atas.level]}.`;
      const keduanyaAktif = atas.aktif && bawah.aktif;
      for (const s of [atas, bawah]) {
        // Pada pelanggaran yang melibatkan level nonaktif, sel level aktif tidak dikorbankan.
        if (!keduanyaAktif && s.aktif) continue;
        s.valid = false;
        s.masalah.push(
          buatMasalah(keduanyaAktif ? "PAGAR_LEVEL_DILANGGAR" : "PAGAR_LEVEL_NONAKTIF", {
            ...ktx,
            level: s.level,
            rincian,
          }),
        );
      }
    }
  }
}

interface SatuanKerja {
  readonly input: InputSatuanJual;
  readonly kode: KodeSatuan | null;
  readonly modal: Rupiah | null;
  readonly moqGrosir: number | null;
  readonly sel: SelPerLevel;
  /** Penghalang tayang di tingkat satuan jual (konfigurasi, kategori, satuan, modal, PPN). */
  readonly penghalang: Masalah[];
  readonly peringatan: Masalah[];
  /** Satuan valid untuk dibandingkan antar kemasan. */
  readonly bisaDibandingkan: boolean;
}

/**
 * P-14: pada level yang sama, harga per pcs dasar kemasan besar tidak boleh lebih mahal dari
 * kemasan kecil: `H_besar × isi_kecil ≤ H_kecil × isi_besar` (perkalian silang, tanpa pembagian).
 * Sama per pcs diizinkan. Pelanggaran membuat sel di KEDUA satuan tidak valid (engine tidak tahu
 * harga mana yang salah). Hanya sel yang sudah valid (lolos PG-1, margin minimum, PG-2) yang
 * dibandingkan, agar sel yang sudah ditolak tidak ikut menjatuhkan kemasan lain.
 * Kemasan dengan isi sama tidak dibandingkan.
 */
function terapkanPagarKemasan(daftar: readonly SatuanKerja[]) {
  for (const level of LEVEL_HARGA) {
    const kandidat = daftar.filter(
      (s) => s.bisaDibandingkan && s.sel[level].valid && s.sel[level].hargaTerhitung !== null,
    );
    for (const kecil of kandidat) {
      for (const besar of kandidat) {
        if (besar.input.isi <= kecil.input.isi) continue;
        const hKecil = BigInt(kecil.sel[level].hargaTerhitung ?? 0);
        const hBesar = BigInt(besar.sel[level].hargaTerhitung ?? 0);
        if (hBesar * BigInt(kecil.input.isi) <= hKecil * BigInt(besar.input.isi)) continue;
        for (const [ini, lawan] of [
          [kecil, besar],
          [besar, kecil],
        ] as const) {
          const s = ini.sel[level];
          s.valid = false;
          s.masalah.push(
            buatMasalah("PAGAR_KEMASAN_DILANGGAR", {
              idSatuanJual: ini.input.idSatuanJual,
              kodeSatuan: ini.input.kode,
              level,
              rincian: `Bandingkan dengan satuan ${labelSatuan(lawan.input.kode)}.`,
              ...(s.aktif ? {} : { jenis: "PERINGATAN" as const }),
            }),
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// API utama
// ---------------------------------------------------------------------------------------------

function selKosong(level: LevelHarga, isi: IsiSel | null, k: KonfigurasiHarga): SelKerja {
  return {
    level,
    isi,
    hargaTerhitung: null,
    margin: null,
    valid: false,
    aktif: k.levelAktif.includes(level),
    masalah: [],
  };
}

/**
 * Menghitung tabel harga semua satuan jual satu produk (§3.4): konfigurasi → kategori → satuan
 * → modal → harga per sel → PG-1 & margin minimum → PG-2 → pagar kemasan (P-14) → status tayang.
 * Semua pelanggaran dikumpulkan (tidak berhenti di yang pertama) agar admin bisa memperbaiki sekaligus.
 */
export function hitungHargaProduk(p: InputProdukHarga, k: KonfigurasiHarga): HasilHargaProduk {
  const masalahKonfigurasi = validasiKonfigurasi(k);
  const konfigurasiOk = masalahKonfigurasi.length === 0;
  const jumlahKode = new Map<string, number>();
  for (const s of p.satuan) jumlahKode.set(s.kode, (jumlahKode.get(s.kode) ?? 0) + 1);

  const phi = p.bebasPpn ? PHI_BEBAS_PPN : konfigurasiOk ? k.ppnFaktor : null;
  const terlarang = new Set(k.kategoriTerlarang.map(normalisasiKodeKategori));

  const kerja: SatuanKerja[] = p.satuan.map((s) => {
    const ktx = { idSatuanJual: s.idSatuanJual, kodeSatuan: s.kode };
    const penghalang: Masalah[] = masalahKonfigurasi.map((m) => ({
      ...m,
      idSatuanJual: s.idSatuanJual,
    }));
    const peringatan: Masalah[] = [];

    if (terlarang.has(normalisasiKodeKategori(p.kodeKategori))) {
      penghalang.push(buatMasalah("KATEGORI_DILARANG", ktx));
    }
    if (p.tinjauanKategori !== "TIDAK_PERLU" && p.tinjauanKategori !== "DISETUJUI") {
      penghalang.push(buatMasalah("PERLU_TINJAUAN_KATEGORI", ktx));
    }
    const masalahSatuan = periksaSatuan(s, jumlahKode);
    penghalang.push(...masalahSatuan);
    const masalahModal = periksaModal(s.modal, ktx);
    penghalang.push(...masalahModal);
    if (phi === null && konfigurasiOk) {
      penghalang.push(buatMasalah("PPN_BELUM_DIKONFIGURASI", ktx));
    }

    let moqGrosir: number | null = null;
    if (s.moqGrosir !== null) {
      if (bilanganBulatAman(s.moqGrosir) && s.moqGrosir >= 1) moqGrosir = s.moqGrosir;
      else peringatan.push(buatMasalah("MOQ_TIDAK_VALID", ktx));
    }

    const bisaHitung =
      konfigurasiOk && masalahSatuan.length === 0 && masalahModal.length === 0 && s.modal !== null;
    const isiSel = (level: LevelHarga) => s.sel[level] ?? null;
    const sel = {} as SelPerLevel;
    for (const level of LEVEL_HARGA) {
      sel[level] = bisaHitung
        ? hitungSelKerja(s.modal, isiSel(level), phi, k, { ...ktx, level })
        : selKosong(level, isiSel(level), k);
    }
    if (bisaHitung) terapkanPagarLevel(sel, ktx);

    return {
      input: s,
      kode: kodeSatuanValid(s.kode) ? s.kode : null,
      modal: bisaHitung ? keRupiah(s.modal) : null,
      moqGrosir,
      sel,
      penghalang,
      peringatan,
      bisaDibandingkan: masalahSatuan.length === 0,
    };
  });

  terapkanPagarKemasan(kerja);

  return { idProduk: p.idProduk, satuan: kerja.map((w) => selesaikan(w, k)) };
}

function selesaikan(w: SatuanKerja, k: KonfigurasiHarga): TabelHarga {
  const satuan = w.sel.SATUAN;
  const mitra = w.sel.MITRA_GROSIR;
  const ktx = { idSatuanJual: w.input.idSatuanJual, kodeSatuan: w.input.kode };

  const alasan: Masalah[] = [...w.penghalang];
  // Sel Harga Satuan wajib valid (PG-5). Hanya dicek bila tidak ada penghalang dasar.
  if (w.penghalang.length === 0) {
    alasan.push(...satuan.masalah.filter((m) => m.jenis === "ERROR"));
    if (!satuan.valid && !alasan.some((m) => m.level === "SATUAN")) {
      // Jaga-jaga: sel tidak valid tanpa error eksplisit tetap menahan tayang.
      alasan.push(buatMasalah("TIDAK_TAYANG", { ...ktx, level: "SATUAN" }));
    }
    if (k.mitraWajibUntukTayang && !(mitra.valid && mitra.aktif)) {
      alasan.push(
        buatMasalah("GROSIR_TIDAK_TERSEDIA", {
          ...ktx,
          level: "MITRA_GROSIR",
          jenis: "ERROR",
          rincian: "Konfigurasi mewajibkan Harga Mitra Grosir agar produk tayang.",
        }),
      );
    }
  }

  const peringatan: Masalah[] = [...w.peringatan];
  for (const level of LEVEL_HARGA) {
    peringatan.push(...w.sel[level].masalah.filter((m) => m.jenis !== "ERROR"));
  }
  const tayang = alasan.length === 0;
  // K-27: satuan tanpa Harga Mitra Grosir yang valid ditandai untuk admin.
  if (tayang && w.input.bolehGrup && !(mitra.valid && mitra.aktif)) {
    const rincian = mitra.masalah.map((m) => m.pesan).join(" ");
    peringatan.push(
      buatMasalah("GROSIR_TIDAK_TERSEDIA", {
        ...ktx,
        level: "MITRA_GROSIR",
        ...(rincian.length > 0 ? { rincian: `(${rincian})` } : {}),
      }),
    );
  }

  const status: StatusTayang = tayang
    ? "TAYANG"
    : alasan.some((m) => m.perluDitinjau)
      ? "PERLU_DITINJAU"
      : "TIDAK_TAYANG";

  return {
    idSatuanJual: w.input.idSatuanJual,
    kode: w.kode,
    isi: w.input.isi,
    moqGrosir: w.moqGrosir,
    bolehGrup: w.input.bolehGrup,
    modal: w.modal,
    waktuDataModal: w.input.waktuDataModal,
    sel: {
      SATUAN: bekukanSel(w.sel.SATUAN),
      MITRA_GROSIR: bekukanSel(w.sel.MITRA_GROSIR),
      FRANCHISE: bekukanSel(w.sel.FRANCHISE),
    },
    tayang,
    status,
    alasanTidakTayang: alasan,
    peringatan,
  };
}

/**
 * P-10: data modal lebih tua dari batas → `MODAL_KEDALUWARSA` (checkout ditahan, H14).
 * Dipisah dari `hitungHargaProduk` agar tabel harga tetap deterministik (waktu sebagai argumen).
 * Umur tepat sama dengan batas masih dianggap segar. Waktu data di masa depan (jam sumber salah)
 * tidak dianggap segar.
 */
export function cekKesegaranModal(t: TabelHarga, k: KonfigurasiHarga, sekarang: Date): Masalah[] {
  if (k.batasUsiaModalMenit === null) return [];
  const ktx = { idSatuanJual: t.idSatuanJual, kodeSatuan: t.kode ?? "" };
  if (t.waktuDataModal === null) {
    return [buatMasalah("MODAL_KEDALUWARSA", { ...ktx, rincian: "Waktu data modal kosong." })];
  }
  const umurMs = sekarang.getTime() - t.waktuDataModal.getTime();
  if (umurMs < 0) {
    return [
      buatMasalah("MODAL_KEDALUWARSA", { ...ktx, rincian: "Waktu data modal di masa depan." }),
    ];
  }
  if (Number.isNaN(umurMs) || umurMs > k.batasUsiaModalMenit * 60_000) {
    return [buatMasalah("MODAL_KEDALUWARSA", ktx)];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// Kunci versi harga
// ---------------------------------------------------------------------------------------------

function kanonik(nilai: unknown): string {
  if (nilai === null || nilai === undefined) return "null";
  if (typeof nilai === "number") {
    // NaN/Infinity diberi penanda tipe agar tidak bertabrakan dengan string "NaN" atau null.
    return Number.isFinite(nilai) ? JSON.stringify(nilai) : `{"$angka":"${String(nilai)}"}`;
  }
  if (typeof nilai === "string" || typeof nilai === "boolean") return JSON.stringify(nilai);
  if (Array.isArray(nilai)) return `[${nilai.map(kanonik).join(",")}]`;
  if (typeof nilai === "object") {
    const obj = nilai as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((kunci) => `${JSON.stringify(kunci)}:${kanonik(obj[kunci])}`)
      .join(",")}}`;
  }
  return "null";
}

/**
 * JSON kanonik atas semua input yang memengaruhi harga satu satuan jual (spesifikasi §7).
 * Tidak memuat `waktuDataModal` dan nama produk.
 *
 * KEAMANAN: string ini memuat modal & isian margin. Lapisan use case WAJIB membentuk
 * `id_versi_harga` dengan HMAC-SHA256 memakai kunci server dari environment variable (bukan
 * SHA-256 biasa, yang bisa ditebak ulang untuk menebak modal), lalu memotongnya. String kanonik
 * dan id versi tidak dikirim ke klien. Domain tidak boleh memakai `node:crypto`, jadi hashing
 * dilakukan di luar paket ini.
 */
export function kunciVersiHarga(
  p: InputProdukHarga,
  s: InputSatuanJual,
  k: KonfigurasiHarga,
): string {
  const sel: Record<string, unknown> = {};
  for (const level of LEVEL_HARGA) {
    const isi = s.sel[level] ?? null;
    sel[level] =
      isi === null
        ? null
        : { mode: isi.mode, nilai: isi.mode === "PERSEN" ? isi.markupBp : isi.hargaRp };
  }
  return kanonik({
    idSatuanJual: s.idSatuanJual,
    kode: s.kode,
    isi: s.isi,
    moqGrosir: s.moqGrosir,
    bolehGrup: s.bolehGrup,
    modal: s.modal,
    kodeKategori: p.kodeKategori,
    tinjauanKategori: p.tinjauanKategori,
    bebasPpn: p.bebasPpn,
    sel,
    konfigurasi: {
      jenisIsiSelDiizinkan: [...k.jenisIsiSelDiizinkan].sort(),
      levelAktif: [...k.levelAktif].sort(),
      mitraWajibUntukTayang: k.mitraWajibUntukTayang,
      ppnFaktor: k.ppnFaktor,
      marginMinimumBp: k.marginMinimumBp,
      batasAtasMarkupBp: k.batasAtasMarkupBp,
      kategoriTerlarang: [...k.kategoriTerlarang].sort(),
    },
  });
}
