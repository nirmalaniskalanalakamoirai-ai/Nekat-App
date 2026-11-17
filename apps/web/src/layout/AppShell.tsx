import { useEffect, useSyncExternalStore } from "react";
import { Link, NavLink, Outlet, useLocation, useMatches } from "react-router";
import { NAVIGASI_BAWAH, tampilkanNavigasiBawah } from "../rute";
import { Ikon } from "./Ikon";
import "./shell.css";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

interface HandleRute {
  judul?: string;
}

/** Kerangka halaman pembeli (T-007 §7): skip-link → app bar → pita → main → navigasi bawah. */
export function AppShell() {
  const { pathname } = useLocation();
  const online = useOnline();
  const denganNavigasi = tampilkanNavigasiBawah(pathname);
  const matches = useMatches();
  const judul = matches
    .map((m) => (m.handle as HandleRute | undefined)?.judul)
    .filter((j): j is string => typeof j === "string")
    .at(-1);

  useEffect(() => {
    document.title = judul ? `${judul} · NEKAT` : "NEKAT";
  }, [judul]);

  return (
    <div className={denganNavigasi ? "l-app" : "l-app l-app--cta-only"}>
      <a className="skip-link btn btn--primary" href="#isi">
        Lewati ke isi
      </a>

      <header className="l-appbar">
        <div className="l-container appbar">
          <Link
            to="/zona"
            className="tap appbar__zona"
            aria-label="Zona belum dipilih. Ketuk untuk pilih zona"
          >
            <Ikon nama="lokasi" ukuran={20} />
            <span className="appbar__zona-teks">Pilih zona</span>
          </Link>
          <div className="l-cluster appbar__aksi">
            <Link to="/cari" className="tap appbar__ikon" aria-label="Cari produk">
              <Ikon nama="cari" />
            </Link>
            <Link to="/keranjang" className="tap appbar__ikon" aria-label="Keranjang">
              <Ikon nama="keranjang" />
            </Link>
          </div>
        </div>
      </header>

      {!online && (
        <div className="pita pita--offline" role="status">
          Kamu sedang offline. Harga dan stok akan diperbarui saat tersambung lagi.
        </div>
      )}

      <main id="isi" className="l-container" tabIndex={-1}>
        <Outlet />
      </main>

      {denganNavigasi && (
        <nav className="l-bottomnav" aria-label="Navigasi utama">
          {NAVIGASI_BAWAH.map((n) => (
            <NavLink key={n.ke} to={n.ke} end={n.ke === "/"} className="tap bottomnav__item">
              <Ikon nama={n.ikon} />
              <span className="bottomnav__label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
