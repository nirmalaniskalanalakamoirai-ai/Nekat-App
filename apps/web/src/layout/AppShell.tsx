import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useMatches } from "react-router";
import { ID_PITA_OFFLINE, useOnline } from "../jaringan/online";
import { jumlahBaris } from "../keranjang/keranjang";
import { useKeranjang } from "../keranjang/simpanan";
import { NAVIGASI_BAWAH, tampilkanNavigasiBawah } from "../rute";
import { TEKS } from "../teks/id";
import { useZonaTerpilih } from "../zona/simpanan";
import { Ikon } from "./Ikon";
import "./shell.css";

interface HandleRute {
  judul?: string;
}

/** Kerangka halaman pembeli (T-007 §7): skip-link → app bar → pita → main → navigasi bawah. */
export function AppShell() {
  const { pathname } = useLocation();
  const online = useOnline();
  const zona = useZonaTerpilih();
  // Lencana keranjang (T-007 §3.3): jumlah baris keranjang sementara zona aktif.
  const [keranjang] = useKeranjang(zona?.zonaKode ?? null);
  const nBaris = jumlahBaris(keranjang);
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
            aria-label={
              zona
                ? `Zona ${zona.namaKelurahan}. Ketuk untuk ganti zona`
                : "Zona belum dipilih. Ketuk untuk pilih zona"
            }
          >
            <Ikon nama="lokasi" ukuran={20} />
            <span className="appbar__zona-teks">{zona ? zona.namaKelurahan : "Pilih zona"}</span>
          </Link>
          <div className="l-cluster appbar__aksi">
            <Link to="/cari" className="tap appbar__ikon" aria-label="Cari produk">
              <Ikon nama="cari" />
            </Link>
            <Link
              to="/keranjang"
              className="tap appbar__ikon"
              aria-label={nBaris > 0 ? `Keranjang, ${TEKS.jumlahBarangSr(nBaris)}` : "Keranjang"}
            >
              <span className="ikon-lencana">
                <Ikon nama="keranjang" />
                {nBaris > 0 && (
                  <span className="lencana num" aria-hidden="true">
                    {nBaris}
                  </span>
                )}
              </span>
            </Link>
          </div>
        </div>
      </header>

      {!online && (
        <div id={ID_PITA_OFFLINE} className="pita pita--offline" role="status">
          {TEKS.offline}
        </div>
      )}

      <main id="isi" className="l-container" tabIndex={-1}>
        <Outlet />
      </main>

      {denganNavigasi && (
        <nav className="l-bottomnav" aria-label="Navigasi utama">
          {NAVIGASI_BAWAH.map((n) => {
            const lencana = n.ikon === "keranjang" && nBaris > 0;
            return (
              <NavLink key={n.ke} to={n.ke} end={n.ke === "/"} className="tap bottomnav__item">
                <span className="ikon-lencana">
                  <Ikon nama={n.ikon} />
                  {lencana && (
                    <span className="lencana num" aria-hidden="true">
                      {nBaris}
                    </span>
                  )}
                </span>
                <span className="bottomnav__label">{n.label}</span>
                {lencana && <span className="sr-only">, {TEKS.jumlahBarangSr(nBaris)}</span>}
              </NavLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}
