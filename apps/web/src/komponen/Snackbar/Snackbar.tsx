// Snackbar + pengumuman pembaca layar (T-007 AX6, T-008 §1.7).
// - Pengumuman: SATU region `aria-live="polite"` per halaman (sr-only), agar perubahan jumlah dibaca
//   sekali.
// - Snackbar: pesan visual singkat di atas navigasi bawah, opsional satu aksi (mis. "Urungkan").
//   Hilang setelah 5 detik; timer DIJEDA selama kursor di atasnya atau fokus ada di dalamnya
//   (WCAG 2.2.1), dan Esc menutupnya. `fokusAksi` memindah fokus ke tombol aksi (pengguna
//   keyboard bisa langsung mengurungkan); setelah ditutup fokus dikembalikan lewat `kembalikanFokus`.
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
  /** Pindahkan fokus ke tombol aksi saat snackbar muncul. */
  readonly fokusAksi?: boolean;
}

export function useSnackbar() {
  const [isi, setIsi] = useState<(IsiSnackbar & { id: number }) | null>(null);
  const [jeda, setJeda] = useState(false);
  const [umum, setUmum] = useState("");
  const urutan = useRef(0);

  useEffect(() => {
    if (!isi || jeda) return;
    const t = window.setTimeout(() => {
      setIsi(null);
    }, DURASI_SNACKBAR_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [isi, jeda]);

  const tampilkan = useCallback((x: IsiSnackbar) => {
    urutan.current += 1;
    setJeda(false);
    setIsi({ ...x, id: urutan.current });
  }, []);
  const tutup = useCallback(() => {
    setIsi(null);
    setJeda(false);
  }, []);
  /** Umumkan ke pembaca layar (teks sama berturut-turut tetap dibaca: diberi spasi tak terlihat). */
  const umumkan = useCallback((teks: string) => {
    setUmum((lama) => (lama === teks ? `${teks}${NBSP}` : teks));
  }, []);

  return { isi, tampilkan, tutup, umum, umumkan, setJeda };
}

export function Snackbar({
  isi,
  umum,
  tutup,
  setJeda,
  kembalikanFokus,
}: {
  isi: (IsiSnackbar & { id: number }) | null;
  umum: string;
  tutup: () => void;
  setJeda: (jeda: boolean) => void;
  /** Dipanggil saat snackbar ditutup lewat aksi/Esc ketika fokus ada di dalamnya. */
  kembalikanFokus?: () => void;
}) {
  const refAksi = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const idIsi = isi?.id;
  const fokusAksi = isi?.fokusAksi === true;
  useEffect(() => {
    if (idIsi !== undefined && fokusAksi) refAksi.current?.focus();
  }, [idIsi, fokusAksi]);

  const selesai = () => {
    tutup();
    kembalikanFokus?.();
  };

  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {umum}
      </p>
      {isi && (
        <div
          className="snackbar"
          aria-live="off"
          onMouseEnter={() => {
            setJeda(true);
          }}
          onMouseLeave={() => {
            setJeda(false);
          }}
          onFocus={() => {
            setJeda(true);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setJeda(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              selesai();
            }
          }}
        >
          <span className="snackbar__pesan">{isi.pesan}</span>
          {isi.aksi &&
            ("ke" in isi.aksi ? (
              <Link ref={refAksi} to={isi.aksi.ke} className="snackbar__aksi" onClick={tutup}>
                {isi.aksi.label}
              </Link>
            ) : (
              <button
                ref={refAksi}
                type="button"
                className="snackbar__aksi"
                onClick={() => {
                  if (isi.aksi && "onKlik" in isi.aksi) isi.aksi.onKlik();
                  selesai();
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
