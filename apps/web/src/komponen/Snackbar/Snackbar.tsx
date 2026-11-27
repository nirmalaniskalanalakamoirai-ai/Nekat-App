// Snackbar + pengumuman pembaca layar (T-007 AX6, T-008 §1.7).
// - Pengumuman: SATU region `aria-live="polite"` per halaman (sr-only), agar perubahan jumlah dibaca
//   sekali.
// - Snackbar: pesan visual singkat di atas navigasi bawah, opsional satu aksi (tautan "Ganti satuan"
//   atau tombol "Urungkan"). Hilang setelah 5 detik; posisi tetap di atas navigasi bawah.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import "./snackbar.css";

export const DURASI_SNACKBAR_MS = 5_000;
const NBSP = String.fromCharCode(0xa0);

export type AksiSnackbar =
  | { readonly label: string; readonly ke: string }
  | { readonly label: string; readonly onKlik: () => void };

export interface IsiSnackbar {
  readonly pesan: string;
  readonly aksi?: AksiSnackbar;
}

export function useSnackbar() {
  const [isi, setIsi] = useState<(IsiSnackbar & { id: number }) | null>(null);
  const [umum, setUmum] = useState("");
  const urutan = useRef(0);

  useEffect(() => {
    if (!isi) return;
    const t = window.setTimeout(() => {
      setIsi(null);
    }, DURASI_SNACKBAR_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [isi]);

  const tampilkan = useCallback((x: IsiSnackbar) => {
    urutan.current += 1;
    setIsi({ ...x, id: urutan.current });
  }, []);
  const tutup = useCallback(() => {
    setIsi(null);
  }, []);
  /** Umumkan ke pembaca layar (teks sama berturut-turut tetap dibaca: diberi spasi tak terlihat). */
  const umumkan = useCallback((teks: string) => {
    setUmum((lama) => (lama === teks ? `${teks}${NBSP}` : teks));
  }, []);

  return { isi, tampilkan, tutup, umum, umumkan };
}

export function Snackbar({
  isi,
  umum,
  tutup,
}: {
  isi: IsiSnackbar | null;
  umum: string;
  tutup: () => void;
}) {
  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {umum}
      </p>
      {isi && (
        <div className="snackbar" aria-live="off">
          <span className="snackbar__pesan">{isi.pesan}</span>
          {isi.aksi &&
            ("ke" in isi.aksi ? (
              <Link to={isi.aksi.ke} className="snackbar__aksi" onClick={tutup}>
                {isi.aksi.label}
              </Link>
            ) : (
              <button
                type="button"
                className="snackbar__aksi"
                onClick={() => {
                  if (isi.aksi && "onKlik" in isi.aksi) isi.aksi.onKlik();
                  tutup();
                }}
              >
                {isi.aksi.label}
              </button>
            ))}
        </div>
      )}
    </>
  );
}
