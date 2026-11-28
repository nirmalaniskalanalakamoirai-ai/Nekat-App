// H-07 Masuk dengan OTP WhatsApp — `/masuk` (T-007 §H-07, T-016).
// Nomor HP (+62 tetap) → kirim kode → kode 6 digit (one-time-code) + opt-in WA (N-13, bawaan TIDAK
// dicentang) → kembali ke halaman asal (`?kembali=`). Pesan tidak membedakan nomor baru/lama.
import { normalisasiNomorHp, samarkanNomorHp } from "@nekat/shared";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { apiMasuk, GalatMasuk, PESAN_JARINGAN } from "./api";
import { formatMenitDetik, tujuanSetelahMasuk } from "./tujuan";
import "./masuk.css";

type Tahap = "nomor" | "kode";

function pesanDari(err: unknown): string {
  return err instanceof GalatMasuk ? err.message : PESAN_JARINGAN;
}

/** Detik tersisa sampai `batas` (ms epoch), diperbarui tiap detik. */
function useSisaDetik(batas: number | null): number {
  const [kini, setKini] = useState(() => Date.now());
  useEffect(() => {
    if (batas === null) return;
    const detak = () => {
      setKini(Date.now());
    };
    const awal = setTimeout(detak, 0);
    const t = setInterval(detak, 1000);
    return () => {
      clearTimeout(awal);
      clearInterval(t);
    };
  }, [batas]);
  return batas === null ? 0 : Math.max(0, Math.ceil((batas - kini) / 1000));
}

export function HalamanMasuk() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tujuan = tujuanSetelahMasuk(params.get("kembali"));

  const [tahap, setTahap] = useState<Tahap>("nomor");
  const [nomorTeks, setNomorTeks] = useState("");
  const [nomor, setNomor] = useState<string | null>(null);
  const [kode, setKode] = useState("");
  const [waOptin, setWaOptin] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [batasKirimUlang, setBatasKirimUlang] = useState<number | null>(null);
  const sisa = useSisaDetik(batasKirimUlang);

  const idNomor = useId();
  const idKode = useId();
  const idGalat = useId();
  const idOptin = useId();
  const kodeRef = useRef<HTMLInputElement>(null);
  const judulRef = useRef<HTMLHeadingElement>(null);

  // Sudah masuk → langsung ke tujuan.
  useEffect(() => {
    let batal = false;
    apiMasuk
      .saya()
      .then((s) => {
        if (s && !batal) void navigate(tujuan, { replace: true });
      })
      .catch(() => undefined);
    return () => {
      batal = true;
    };
  }, [navigate, tujuan]);

  // Fokus ke judul tiap ganti tahap (pembaca layar tahu konteks berubah).
  useEffect(() => {
    judulRef.current?.focus();
  }, [tahap]);

  async function kirimKode(nomorE164: string) {
    setSibuk(true);
    setGalat(null);
    setInfo(null);
    try {
      const r = await apiMasuk.mintaOtp(nomorE164);
      setNomor(nomorE164);
      setKode("");
      setTahap("kode");
      setBatasKirimUlang(Date.now() + r.kirimUlangDetik * 1000);
      setInfo(`Kode dikirim ke WhatsApp ${samarkanNomorHp(nomorE164)}.`);
    } catch (err) {
      if (err instanceof GalatMasuk && err.kode === "TERLALU_CEPAT" && err.tungguDetik) {
        // Kode sebelumnya masih berlaku: tetap di layar kode.
        setNomor(nomorE164);
        setTahap("kode");
        setBatasKirimUlang(Date.now() + err.tungguDetik * 1000);
      }
      setGalat(pesanDari(err));
    } finally {
      setSibuk(false);
    }
  }

  function kirimNomor(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = normalisasiNomorHp(nomorTeks);
    if (!n) {
      setGalat("Nomor HP belum benar. Contoh: 812 3456 7890.");
      return;
    }
    void kirimKode(n);
  }

  async function verifikasi(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nomor) return;
    if (!/^\d{6}$/.test(kode)) {
      setGalat("Kode terdiri dari 6 angka.");
      kodeRef.current?.focus();
      return;
    }
    setSibuk(true);
    setGalat(null);
    try {
      await apiMasuk.verifikasi(nomor, kode, waOptin);
      void navigate(tujuan, { replace: true });
    } catch (err) {
      setGalat(pesanDari(err));
      setKode("");
      if (err instanceof GalatMasuk && err.kode === "KODE_TIDAK_BERLAKU") {
        setBatasKirimUlang(null); // boleh langsung minta kode baru
      }
      if (err instanceof GalatMasuk && err.sisaPercobaan === 0) setBatasKirimUlang(null);
      kodeRef.current?.focus();
    } finally {
      setSibuk(false);
    }
  }

  function gantiNomor() {
    setTahap("nomor");
    setKode("");
    setGalat(null);
    setInfo(null);
    setBatasKirimUlang(null);
  }

  const galatEl = galat ? (
    <p id={idGalat} className="masuk__galat" role="alert">
      {galat}
    </p>
  ) : null;

  return (
    <section className="masuk l-stack" aria-labelledby="judul-masuk">
      <div className="masuk__kepala l-stack l-stack--sm">
        <span className="masuk__logo" aria-hidden="true">
          N
        </span>
        <h1 id="judul-masuk" ref={judulRef} tabIndex={-1}>
          {tahap === "nomor" ? "Masuk dengan WhatsApp" : "Masukkan kode"}
        </h1>
        {tahap === "nomor" ? (
          <p className="masuk__alasan">Masuk untuk ikut grup dan bayar.</p>
        ) : (
          <p className="masuk__alasan" aria-live="polite">
            {info ?? `Kode dikirim ke WhatsApp ${nomor ? samarkanNomorHp(nomor) : ""}.`}
          </p>
        )}
      </div>

      {tahap === "nomor" ? (
        <form className="l-stack" onSubmit={kirimNomor} noValidate>
          <div className="l-stack l-stack--sm">
            <label htmlFor={idNomor} className="masuk__label">
              Nomor WhatsApp
            </label>
            <div className="masuk__hp">
              <span className="masuk__awalan" aria-hidden="true">
                +62
              </span>
              <input
                id={idNomor}
                className="input masuk__hp-input"
                name="nomorHp"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="812 3456 7890"
                maxLength={20}
                value={nomorTeks}
                onChange={(e) => {
                  setNomorTeks(e.target.value);
                  if (galat) setGalat(null);
                }}
                aria-invalid={galat ? true : undefined}
                aria-describedby={galat ? idGalat : undefined}
                aria-label="Nomor WhatsApp, awalan +62"
                required
              />
            </div>
            {galatEl}
          </div>
          <button
            className="btn btn--primary btn--block"
            disabled={sibuk}
            aria-busy={sibuk || undefined}
          >
            {sibuk ? "Mengirim…" : "Kirim kode lewat WhatsApp"}
          </button>
          <p className="masuk__catatan">
            Kami kirim kode 6 angka ke WhatsApp nomor ini. Satu nomor untuk satu akun NEKAT.
          </p>
        </form>
      ) : (
        <form className="l-stack" onSubmit={(e) => void verifikasi(e)} noValidate>
          <div className="l-stack l-stack--sm">
            <label htmlFor={idKode} className="masuk__label">
              Kode 6 angka
            </label>
            <input
              id={idKode}
              ref={kodeRef}
              className="input masuk__kode"
              name="kode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={kode}
              onChange={(e) => {
                setKode(e.target.value.replace(/\D/g, "").slice(0, 6));
                if (galat) setGalat(null);
              }}
              aria-invalid={galat ? true : undefined}
              aria-describedby={galat ? idGalat : undefined}
              autoFocus
              required
            />
            {galatEl}
          </div>

          <div className="masuk__optin">
            <input
              id={idOptin}
              type="checkbox"
              className="masuk__centang"
              checked={waOptin}
              onChange={(e) => {
                setWaOptin(e.target.checked);
              }}
            />
            <label htmlFor={idOptin}>
              <span>Kirim info pesanan ke WhatsApp nomor ini</span>
              <span className="masuk__optin-ket">
                Boleh tidak dicentang. Info pesanan tetap ada di aplikasi.
              </span>
            </label>
          </div>

          <button
            className="btn btn--primary btn--block"
            disabled={sibuk}
            aria-busy={sibuk || undefined}
          >
            {sibuk ? "Memeriksa…" : "Masuk"}
          </button>

          <div className="masuk__aksi">
            {sisa > 0 ? (
              <p className="masuk__hitung">
                Kirim ulang dalam&nbsp;<span className="num">{formatMenitDetik(sisa)}</span>
              </p>
            ) : (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={sibuk}
                onClick={() => {
                  if (nomor) void kirimKode(nomor);
                }}
              >
                Kirim ulang kode
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={gantiNomor}>
              Ganti nomor
            </button>
          </div>
          {/* Diumumkan sekali saat kirim ulang tersedia (hitung mundur tidak diumumkan tiap detik). */}
          <p className="sr-only" aria-live="polite">
            {sisa === 0 && batasKirimUlang !== null ? "Kamu bisa kirim ulang kode sekarang." : ""}
          </p>
        </form>
      )}
    </section>
  );
}
