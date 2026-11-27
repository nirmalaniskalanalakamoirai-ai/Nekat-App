// Navigasi halaman bersama (daftar produk & stok). 25 baris per halaman (bawaan API).
export const PER_HALAMAN = 25;

export function Paginasi({
  halaman,
  total,
  onGanti,
}: {
  halaman: number;
  total: number;
  onGanti: (h: number) => void;
}) {
  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  if (totalHalaman <= 1) return null;
  return (
    <nav className="l-cluster" aria-label="Halaman">
      <button
        type="button"
        className="btn btn--secondary"
        disabled={halaman <= 1}
        onClick={() => {
          onGanti(halaman - 1);
        }}
      >
        Sebelumnya
      </button>
      <span>
        {halaman} / {totalHalaman}
      </span>
      <button
        type="button"
        className="btn btn--secondary"
        disabled={halaman >= totalHalaman}
        onClick={() => {
          onGanti(halaman + 1);
        }}
      >
        Berikutnya
      </button>
    </nav>
  );
}
