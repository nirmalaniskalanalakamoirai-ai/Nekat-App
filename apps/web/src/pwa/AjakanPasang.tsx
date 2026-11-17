import { useEffect, useState } from "react";

// H-06 "Tambah ke layar utama". Komponen siap pakai; dipasang di H-05/H-11 setelah
// aksi bernilai (ikut grup / bayar), bukan saat pertama buka (T-007 §H-06).

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KUNCI_DITUTUP = "nekat:ajakan-pasang-ditutup";
const JEDA_MS = 7 * 24 * 60 * 60 * 1000;

function sudahTerpasang(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

function baruDitutup(): boolean {
  try {
    const t = Number(localStorage.getItem(KUNCI_DITUTUP));
    return Number.isFinite(t) && Date.now() - t < JEDA_MS;
  } catch {
    return false;
  }
}

function catatDitutup() {
  try {
    localStorage.setItem(KUNCI_DITUTUP, String(Date.now()));
  } catch {
    // Penyimpanan tidak tersedia: ajakan bisa muncul lagi, tidak apa-apa.
  }
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function AjakanPasang() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [tampil, setTampil] = useState(() => !sudahTerpasang() && !baruDitutup());

  useEffect(() => {
    const tangkap = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", tangkap);
    return () => {
      window.removeEventListener("beforeinstallprompt", tangkap);
    };
  }, []);

  if (!tampil || (!prompt && !isIos())) return null;

  const tutup = () => {
    catatDitutup();
    setTampil(false);
  };

  const pasang = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
    setTampil(false);
  };

  return (
    <div
      className="pasang card l-stack l-stack--sm"
      role="region"
      aria-label="Pasang aplikasi NEKAT"
    >
      <p>Pasang NEKAT di layar HP biar gampang cek grup.</p>
      {prompt ? null : (
        <p>Ketuk ikon Bagikan di Safari, lalu pilih &ldquo;Tambah ke Layar Utama&rdquo;.</p>
      )}
      <div className="l-cluster">
        {prompt && (
          <button type="button" className="btn btn--primary" onClick={() => void pasang()}>
            Pasang
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={tutup}>
          Nanti saja
        </button>
      </div>
    </div>
  );
}
