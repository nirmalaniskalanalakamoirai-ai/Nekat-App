import { NAMA_APLIKASI } from "@nekat/shared";
import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import { bacaZona, langgananZona } from "../zona/simpanan";

// H-02 Katalog: isi produk dibuat di T-025/T-026. Sampai itu, beranda menampilkan status zona.
export function Beranda() {
  const namaZona = useSyncExternalStore(
    langgananZona,
    () => bacaZona()?.namaKelurahan ?? null,
    () => null,
  );

  return (
    <section className="l-stack segera" aria-labelledby="judul-halaman">
      <h1 id="judul-halaman">{NAMA_APLIKASI}</h1>
      <p>Belanja bareng tetangga, makin banyak yang ikut makin murah.</p>
      {namaZona ? (
        <>
          <p>
            Kamu di zona <strong>{namaZona}</strong>. Katalog produk sedang disiapkan.
          </p>
          <p>
            <Link to="/zona" className="btn btn--ghost">
              Ganti zona
            </Link>
          </p>
        </>
      ) : (
        <>
          <p>Katalog produk sedang disiapkan.</p>
          <p>
            <Link to="/zona" className="btn btn--primary">
              Pilih zona pengiriman
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
