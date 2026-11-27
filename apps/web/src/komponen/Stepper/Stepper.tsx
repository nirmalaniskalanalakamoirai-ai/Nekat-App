// Stepper jumlah `− n +` (T-008 §1.7, §1.9). "−" di qty 1 menjadi tombol hapus (ikon tempat sampah).
// Tombol 44 px (--tap-min), jarak 8 px. Angka TIDAK aria-live di sini: pengumuman perubahan dilakukan
// induk lewat satu region live per halaman agar tidak dibaca dua kali.
import type { Ref } from "react";
import { Ikon } from "../../layout/Ikon";
import { TEKS } from "../../teks/id";
import "./stepper.css";

export interface StepperProps {
  readonly nama: string;
  readonly qty: number;
  /** false = "+" disabled (stok habis/dicek, offline, batas jumlah). "−"/hapus tetap aktif. */
  readonly bolehTambah: boolean;
  /** id elemen yang menjelaskan kenapa "+" nonaktif. */
  readonly alasanTambahNonaktif?: string | undefined;
  readonly onTambah: () => void;
  readonly onKurangi: () => void;
  /** Ref ke tombol "+" (fokus dipindah ke sini setelah "+" cepat ditekan). */
  readonly refTambah?: Ref<HTMLButtonElement> | undefined;
}

export function Stepper({
  nama,
  qty,
  bolehTambah,
  alasanTambahNonaktif,
  onTambah,
  onKurangi,
  refTambah,
}: StepperProps) {
  const hapus = qty <= 1;
  return (
    <div className="stepper" role="group" aria-label={TEKS.jumlahAria(nama)}>
      <button
        type="button"
        className="stepper__tombol"
        aria-label={hapus ? TEKS.hapusAria(nama) : TEKS.kurangiAria(nama)}
        onClick={onKurangi}
      >
        <Ikon nama={hapus ? "hapus" : "kurang"} ukuran={20} />
      </button>
      <span className="stepper__qty num">{qty}</span>
      <button
        ref={refTambah}
        type="button"
        className="stepper__tombol"
        aria-label={`Tambah 1 ${nama}`}
        disabled={!bolehTambah}
        aria-describedby={!bolehTambah ? alasanTambahNonaktif : undefined}
        onClick={onTambah}
      >
        <Ikon nama="tambah" ukuran={20} />
      </button>
    </div>
  );
}
