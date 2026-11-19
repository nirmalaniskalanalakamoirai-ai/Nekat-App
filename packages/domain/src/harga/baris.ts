// Penentuan jenis harga satu baris keranjang/grup (spesifikasi §5.2) — K-09, K-14, K-27, P-05, P-21.
// Syarat grup (≥ 3 akun berbarang & total grup ≥ Rp100.000) dihitung engine grup (T-022);
// fungsi ini hanya menerima hasilnya.
import type { Rupiah } from "@nekat/shared";
import { buatMasalah } from "./pesan.js";
import type { Hasil, JenisHargaBaris, Masalah, TabelHarga } from "./tipe.js";

export interface HargaBaris {
  readonly jenis: JenisHargaBaris;
  /** Harga per satuan jual (termasuk PPN). */
  readonly harga: Rupiah;
  /** Info untuk pengguna/admin, mis. `GROSIR_TIDAK_TERSEDIA` (K-27). */
  readonly info: readonly Masalah[];
}

/**
 * - `GRUP`: syarat grup terpenuhi, tier grup aktif untuk satuan ini (P-21), Harga Mitra Grosir valid
 *   → Harga Mitra Grosir walau 1 pcs (K-09, K-14).
 * - `GROSIR_MOQ`: qty ≥ MOQ Mitra Grosir dan Harga Mitra Grosir valid (P-05).
 * - `SATUAN`: selain itu. Bila syarat grup terpenuhi tetapi harga grup tidak bisa dipakai,
 *   info `GROSIR_TIDAK_TERSEDIA` (K-27) atau `GRUP_TIDAK_DIAKTIFKAN` (P-21) ikut dikembalikan.
 * Satuan jual yang tidak tayang tidak punya harga untuk dibeli → `ok: false`.
 */
export function jenisHargaBaris(
  t: TabelHarga,
  qty: number,
  syaratGrupTerpenuhi: boolean,
): Hasil<HargaBaris> {
  const ktx = { idSatuanJual: t.idSatuanJual, kodeSatuan: t.kode ?? "" };
  if (!t.tayang || !t.sel.SATUAN.valid || t.sel.SATUAN.harga === null) {
    return { ok: false, masalah: [buatMasalah("TIDAK_TAYANG", ktx), ...t.alasanTidakTayang] };
  }
  if (!Number.isSafeInteger(qty) || qty < 1) {
    return { ok: false, masalah: [buatMasalah("QTY_TIDAK_VALID", ktx)] };
  }

  const mitra = t.sel.MITRA_GROSIR;
  const hargaMitra = mitra.valid && mitra.aktif ? mitra.harga : null;
  const hargaSatuan = t.sel.SATUAN.harga;

  if (syaratGrupTerpenuhi && t.bolehGrup && hargaMitra !== null) {
    return { ok: true, nilai: { jenis: "GRUP", harga: hargaMitra, info: [] } };
  }
  if (t.moqGrosir !== null && qty >= t.moqGrosir && hargaMitra !== null) {
    return { ok: true, nilai: { jenis: "GROSIR_MOQ", harga: hargaMitra, info: [] } };
  }
  const info: Masalah[] = [];
  if (syaratGrupTerpenuhi) {
    info.push(
      buatMasalah(t.bolehGrup ? "GROSIR_TIDAK_TERSEDIA" : "GRUP_TIDAK_DIAKTIFKAN", {
        ...ktx,
        level: "MITRA_GROSIR",
      }),
    );
  }
  return { ok: true, nilai: { jenis: "SATUAN", harga: hargaSatuan, info } };
}
