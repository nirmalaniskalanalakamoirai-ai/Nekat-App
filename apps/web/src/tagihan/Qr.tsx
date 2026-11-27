// Gambar QRIS dari `qr_string` server (render lokal dengan `uqr`, tanpa layanan pihak ketiga, tanpa
// innerHTML). Latar SELALU putih & modul hitam, juga di tema gelap (T-007 H-10), agar terbaca pemindai.
import { useMemo } from "react";
import { encode } from "uqr";

export function jalurQr(qrString: string): { path: string; ukuran: number } {
  const hasil = encode(qrString, { ecc: "M", border: 4 });
  let path = "";
  hasil.data.forEach((baris, y) => {
    baris.forEach((hitam, x) => {
      if (hitam) path += `M${String(x)} ${String(y)}h1v1h-1z`;
    });
  });
  return { path, ukuran: hasil.size };
}

export function GambarQr({ qrString, label }: { qrString: string; label: string }) {
  const { path, ukuran } = useMemo(() => jalurQr(qrString), [qrString]);
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(ukuran)} ${String(ukuran)}`}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={ukuran} height={ukuran} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/** Unduh QR sebagai PNG (untuk "Simpan QR"); dibuat di HP, tidak dikirim ke server mana pun. */
export async function simpanQrPng(qrString: string, namaFile: string): Promise<void> {
  const { path, ukuran } = jalurQr(qrString);
  const skala = 12;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(ukuran)} ${String(ukuran)}" width="${String(ukuran * skala)}" height="${String(ukuran * skala)}" shape-rendering="crispEdges"><rect width="${String(ukuran)}" height="${String(ukuran)}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((selesai, gagal) => {
      img.onload = () => {
        selesai();
      };
      img.onerror = () => {
        gagal(new Error("gagal memuat QR"));
      };
      img.src = url;
    });
    const kanvas = document.createElement("canvas");
    kanvas.width = ukuran * skala;
    kanvas.height = ukuran * skala;
    kanvas.getContext("2d")?.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.href = kanvas.toDataURL("image/png");
    a.download = namaFile;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
