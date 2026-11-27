import type { ItemNavigasi } from "../rute";

export type NamaIkon =
  ItemNavigasi["ikon"] | "cari" | "lokasi" | "tambah" | "kurang" | "hapus" | "gambar";

const PATH: Record<NamaIkon, string> = {
  belanja: "M4 7h16l-1.5 11.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5L4 7Zm4 0V6a4 4 0 0 1 8 0v1",
  keranjang: "M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 8H6.2M10 20h.01M17 20h.01",
  pesanan: "M7 3h10a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Zm2 5h6m-6 4h6",
  saldo: "M3 7a2 2 0 0 1 2-2h14v4M3 7v10a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2Zm14 7h.01",
  akun: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0",
  cari: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5",
  lokasi: "M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  tambah: "M12 5v14M5 12h14",
  kurang: "M5 12h14",
  hapus: "M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  gambar: "M4 5h16v14H4V5Zm0 11 4.5-4.5 3.5 3.5 2.5-2.5L20 17M15 9h.01",
};

/** Ikon garis sederhana orisinal NEKAT; selalu dekoratif (label teks ada di sampingnya). */
export function Ikon({ nama, ukuran = 24 }: { nama: NamaIkon; ukuran?: number }) {
  return (
    <svg
      width={ukuran}
      height={ukuran}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATH[nama]} />
    </svg>
  );
}
