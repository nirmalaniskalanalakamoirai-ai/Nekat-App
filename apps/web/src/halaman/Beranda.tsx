import { NAMA_APLIKASI } from "@nekat/shared";
import { Link } from "react-router";

// H-02 Katalog: isi produk dibuat di T-025/T-026. T-014 hanya menyiapkan kerangka.
export function Beranda() {
  return (
    <section className="l-stack segera" aria-labelledby="judul-halaman">
      <h1 id="judul-halaman">{NAMA_APLIKASI}</h1>
      <p>Belanja bareng tetangga, makin banyak yang ikut makin murah.</p>
      <p>Katalog produk sedang disiapkan.</p>
      <p>
        <Link to="/zona" className="btn btn--primary">
          Pilih zona pengiriman
        </Link>
      </p>
    </section>
  );
}
