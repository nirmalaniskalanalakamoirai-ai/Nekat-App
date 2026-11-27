// Deret tab kategori/subkategori dengan jumlah (T-007 H-02 blok 4). Gulir horizontal di DALAM
// deret (`.l-scroll-x`), bukan halaman. Pola WAI-ARIA tabs aktivasi manual: panah kiri/kanan,
// Home/End memindah fokus; Enter/Spasi memilih. Jumlah dibaca "24 produk".
import { useRef, type KeyboardEvent } from "react";
import { TEKS } from "../../teks/id";

export interface ItemTab {
  readonly kunci: string;
  readonly label: string;
  readonly jumlah: number;
}

export interface DeretTabProps {
  readonly label: string;
  readonly item: readonly ItemTab[];
  readonly terpilih: string;
  readonly idPanel: string;
  readonly idAwalan: string;
  readonly onPilih: (kunci: string) => void;
}

export function idTab(idAwalan: string, kunci: string) {
  return `${idAwalan}-${kunci}`;
}

export function DeretTab({ label, item, terpilih, idPanel, idAwalan, onPilih }: DeretTabProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tombol = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const i = tombol.findIndex((t) => t === document.activeElement);
    if (i < 0) return;
    let j: number | null = null;
    if (e.key === "ArrowRight") j = (i + 1) % tombol.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + tombol.length) % tombol.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = tombol.length - 1;
    if (j === null) return;
    e.preventDefault();
    tombol[j]?.focus();
  };

  return (
    <div
      ref={ref}
      className="l-scroll-x deret-tab"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {item.map((t) => {
        const dipilih = t.kunci === terpilih;
        return (
          <button
            key={t.kunci}
            id={idTab(idAwalan, t.kunci)}
            type="button"
            role="tab"
            className="tab"
            aria-selected={dipilih}
            aria-controls={idPanel}
            tabIndex={dipilih ? 0 : -1}
            onClick={() => {
              onPilih(t.kunci);
            }}
          >
            {t.label} <span aria-hidden="true">({t.jumlah})</span>
            <span className="sr-only">, {TEKS.jumlahProdukSr(t.jumlah)}</span>
          </button>
        );
      })}
    </div>
  );
}
