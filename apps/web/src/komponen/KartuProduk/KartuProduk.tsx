// `KartuProduk` (T-008 §1) untuk katalog (T-026), konteks KATALOG tanpa grup.
// Data = respons nyata GET /api/katalog/produk (T-025). Tidak ada harga dihitung di klien.
//
// Penyesuaian karena field T-008 belum ada di API (dicatat di laporan T-026):
// - `slug` → tautan memakai `id` produk (/p/{id}); `foto.alt` → foto dekoratif (alt kosong), nama
//   produk sudah ada di tautan yang sama.
// - Stok `TERBATAS`/`sisa` belum ada → baris "Sisa {n}" tidak dirender.
// - `TIDAK_DIKETAHUI` (T-019, IG-02 DEFAULT): chip "Stok sedang dicek, coba lagi sebentar", tombol "+"
//   disabled; foto tidak diabukan (bukan stok habis).
// - Konteks grup (ProgresGrupRingkas, keteranganHarga) belum ada (T-022) → tidak dirender.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { labelSatuan, satuanPendek } from "../../harga/format";
import type { KartuProdukApi } from "../../katalog/api";
import { ID_PITA_OFFLINE } from "../../jaringan/online";
import { Ikon } from "../../layout/Ikon";
import { QTY_MAKS } from "../../keranjang/keranjang";
import { TEKS } from "../../teks/id";
import { Harga } from "../Harga/Harga";
import { Stepper } from "../Stepper/Stepper";
import "./kartu-produk.css";

export interface KartuProdukProps {
  readonly data: KartuProdukApi;
  /** Jumlah satuan ini di keranjang (sementara) zona aktif. */
  readonly qty: number;
  readonly online: boolean;
  /**
   * id elemen yang menjelaskan alasan tingkat halaman tombol beli nonaktif (mis. zona belum
   * dipilih); null = tidak ada alasan halaman.
   */
  readonly alasanHalaman: string | null;
  readonly onTambah: (data: KartuProdukApi) => void;
  readonly onUbahQty: (data: KartuProdukApi, qty: number) => void;
}

export function KartuProduk({
  data,
  qty,
  online,
  alasanHalaman,
  onTambah,
  onUbahQty,
}: KartuProdukProps) {
  const idNama = useId();
  const idStatus = useId();
  const s = data.satuan;
  const pendek = satuanPendek(s.kode);
  const habisProduk = data.statusStok === "HABIS";
  const labelProduk =
    data.statusStok === "TERSEDIA"
      ? null
      : (data.labelStok ?? (habisProduk ? TEKS.stokHabis : TEKS.stokDicek));

  // Alasan "+" nonaktif, urut prioritas: offline → halaman (zona) → stok.
  const alasan = !online ? ID_PITA_OFFLINE : alasanHalaman;
  const bolehBeli = alasan === null && s.tersedia;

  // Fokus tidak hilang saat "+" berganti stepper dan sebaliknya (T-007 AX5).
  const refCepat = useRef<HTMLButtonElement>(null);
  const refStepper = useRef<HTMLButtonElement>(null);
  const pindahFokus = useRef<"stepper" | "cepat" | null>(null);
  useEffect(() => {
    if (pindahFokus.current === "stepper" && qty > 0) refStepper.current?.focus();
    if (pindahFokus.current === "cepat" && qty === 0) refCepat.current?.focus();
    pindahFokus.current = null;
  }, [qty]);

  let aksiCepat: ReactNode = null;
  if (qty === 0) {
    if (s.statusStok === "HABIS" && alasan === null) {
      // K-20 / TC-UI-06: bukan tombol, tidak fokusable.
      aksiCepat = <p className="kartu__habis">{TEKS.stokHabisPendek}</p>;
    } else {
      aksiCepat = (
        <button
          ref={refCepat}
          type="button"
          className="kartu__tambah"
          aria-label={TEKS.tambahAria(pendek, data.nama)}
          disabled={!bolehBeli}
          aria-describedby={
            bolehBeli ? undefined : (alasan ?? (labelProduk !== null ? idStatus : undefined))
          }
          onClick={() => {
            pindahFokus.current = "stepper";
            onTambah(data);
          }}
        >
          <Ikon nama="tambah" />
        </button>
      );
    }
  }

  return (
    <article className="kartu" aria-labelledby={idNama}>
      <Link to={`/p/${encodeURIComponent(data.id)}`} className="kartu__tautan">
        <figure className={habisProduk ? "kartu__foto kartu__foto--habis" : "kartu__foto"}>
          {data.gambarUrl ? (
            <img
              src={data.gambarUrl}
              alt=""
              width={320}
              height={320}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="kartu__foto-kosong">
              <Ikon nama="gambar" ukuran={32} />
            </span>
          )}
          {labelProduk !== null && online && (
            <span id={idStatus} className="chip kartu__status">
              {labelProduk}
            </span>
          )}
        </figure>
        <h3 id={idNama} className="kartu__nama">
          {data.nama}
        </h3>
      </Link>
      {aksiCepat !== null && <div className="kartu__aksi">{aksiCepat}</div>}

      <div className="kartu__bawah">
        <p className="kartu__satuan">{TEKS.kartuPer(labelSatuan(s))}</p>
        <Harga harga={online ? s.harga : null} kode={s.kode} varian="kartu" />
        {qty > 0 && (
          <Stepper
            nama={data.nama}
            qty={qty}
            bolehTambah={bolehBeli && qty < QTY_MAKS}
            alasanTambahNonaktif={alasan ?? (labelProduk !== null ? idStatus : undefined)}
            refTambah={refStepper}
            onTambah={() => {
              onUbahQty(data, qty + 1);
            }}
            onKurangi={() => {
              if (qty <= 1) pindahFokus.current = "cepat";
              onUbahQty(data, qty - 1);
            }}
          />
        )}
      </div>
    </article>
  );
}
