// Komponen `Harga` (T-008 §1.4) untuk konteks KATALOG. Satu-satunya tempat angka harga dirender, agar
// harga kartu = harga detail = baris keranjang (PG-6, CLAUDE.md). Input hanya angka dari server.
//
// Belum ada di API (T-025): `hargaCoret`, `teksStatus`, `keteranganHarga`, `idVersiHarga`. Di konteks
// katalog tanpa grup ketiganya memang kosong/null (T-008 R3, §1.3), jadi tidak ada `<s>` dan tidak
// ada teks status. Promo TIDAK PERNAH dirender di sini (aturan §1.4 no. 7).
import { teksHargaKatalog, type HargaKatalog, type KodeSatuan } from "../../harga/format";
import { TEKS } from "../../teks/id";
import "./harga.css";

export interface HargaProps {
  /** null = harga tidak boleh tampil (offline): diganti "—". */
  readonly harga: HargaKatalog | null;
  readonly kode: KodeSatuan;
  readonly varian: "kartu" | "baris";
}

export function Harga({ harga, kode, varian }: HargaProps) {
  const teks = harga === null ? null : teksHargaKatalog(harga, kode);
  const kelasAngka = varian === "kartu" ? "price price--card" : "price harga__baris";
  if (teks === null) {
    return (
      <div className={`harga harga--${varian}`}>
        <span className="sr-only">{TEKS.hargaOfflineSr}</span>
        <span className={kelasAngka} aria-hidden="true">
          —
        </span>
      </div>
    );
  }
  return (
    <div className={`harga harga--${varian}`}>
      {/* T-008 §1.9: kalimat utuh dibaca SEKALI; angka visual aria-hidden. */}
      <span className="sr-only">{teks.kalimat}</span>
      <span className={kelasAngka} aria-hidden="true">
        {teks.aktif}
        <span className="harga__per">{teks.perSatuan}</span>
      </span>
      {teks.chipGrup !== null && (
        <span className="chip chip--group harga__grup" aria-hidden="true">
          {teks.chipGrup}
        </span>
      )}
    </div>
  );
}
