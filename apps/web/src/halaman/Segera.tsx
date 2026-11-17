import { Link } from "react-router";

/** Halaman sementara: rute sudah ada, isi dibuat di task berikutnya. */
export function Segera({ judul, kodeHalaman }: { judul: string; kodeHalaman: string }) {
  return (
    <section className="segera l-stack" aria-labelledby="judul-halaman">
      <h1 id="judul-halaman">{judul}</h1>
      <p>Halaman ini sedang disiapkan.</p>
      <p className="segera__kode">{kodeHalaman}</p>
      <p>
        <Link to="/" className="btn btn--secondary">
          Kembali belanja
        </Link>
      </p>
    </section>
  );
}

export function TidakDitemukan() {
  return (
    <section className="segera l-stack" aria-labelledby="judul-halaman">
      <h1 id="judul-halaman">Halaman tidak ditemukan</h1>
      <p>Alamat yang kamu buka tidak ada atau sudah tidak berlaku.</p>
      <p>
        <Link to="/" className="btn btn--primary">
          Ke halaman Belanja
        </Link>
      </p>
    </section>
  );
}
