// Masuk admin 2 langkah: nomor HP + kata sandi → kode authenticator (TOTP) atau kode pemulihan.
import { useState, type SyntheticEvent } from "react";
import { apiAdmin, aturCsrf, GalatAdmin, nilaiForm, normalisasiHp } from "./api";

export function Masuk({ onMasuk }: { onMasuk: (csrf: string) => void }) {
  const [langkah, setLangkah] = useState<"sandi" | "totp">("sandi");
  const [pakaiPemulihan, setPakaiPemulihan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function kirimSandi(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const sandi = f.get("kataSandi");
    setSibuk(true);
    setGalat(null);
    try {
      const r = await apiAdmin.masuk(
        normalisasiHp(nilaiForm(f, "nomorHp")),
        // Kata sandi TIDAK di-trim (spasi bisa bagian dari kata sandi).
        typeof sandi === "string" ? sandi : "",
      );
      aturCsrf(r.csrfToken);
      setLangkah("totp");
    } catch (err) {
      setGalat(err instanceof GalatAdmin ? err.message : "Gagal terhubung. Coba lagi.");
    } finally {
      setSibuk(false);
    }
  }

  async function kirimKode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const kode = nilaiForm(f, "kode");
    setSibuk(true);
    setGalat(null);
    try {
      const r = await apiAdmin.masukTotp(
        pakaiPemulihan ? { kodePemulihan: kode } : { kode: kode.replace(/\s/g, "") },
      );
      onMasuk(r.csrfToken);
    } catch (err) {
      if (err instanceof GalatAdmin && (err.kode === "SESI_PRA_HABIS" || err.status === 403)) {
        setLangkah("sandi");
      }
      setGalat(err instanceof GalatAdmin ? err.message : "Gagal terhubung. Coba lagi.");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <main className="adm-masuk" id="isi-admin">
      <div className="card l-stack adm-masuk__kartu">
        <h1>Masuk panel admin</h1>
        {galat && (
          <p className="adm-galat" role="alert">
            {galat}
          </p>
        )}
        {langkah === "sandi" ? (
          <form className="l-stack" onSubmit={(e) => void kirimSandi(e)}>
            <label className="adm-field">
              <span>Nomor HP</span>
              <input
                className="input"
                name="nomorHp"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                placeholder="08… atau +628…"
                required
              />
            </label>
            <label className="adm-field">
              <span>Kata sandi</span>
              <input
                className="input"
                name="kataSandi"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="btn btn--primary btn--block" disabled={sibuk}>
              {sibuk ? "Memeriksa…" : "Lanjut"}
            </button>
          </form>
        ) : (
          <form className="l-stack" onSubmit={(e) => void kirimKode(e)}>
            <p>
              {pakaiPemulihan
                ? "Masukkan salah satu kode pemulihan (sekali pakai)."
                : "Buka aplikasi authenticator lalu masukkan kode 6 digit NEKAT Admin."}
            </p>
            <label className="adm-field">
              <span>{pakaiPemulihan ? "Kode pemulihan" : "Kode authenticator"}</span>
              <input
                key={pakaiPemulihan ? "pulih" : "totp"}
                className="input adm-kode"
                name="kode"
                autoComplete="one-time-code"
                inputMode={pakaiPemulihan ? "text" : "numeric"}
                pattern={pakaiPemulihan ? undefined : "[0-9]{6}"}
                maxLength={pakaiPemulihan ? 20 : 6}
                required
                autoFocus
              />
            </label>
            <button className="btn btn--primary btn--block" disabled={sibuk}>
              {sibuk ? "Memeriksa…" : "Masuk"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setPakaiPemulihan((p) => !p);
              }}
            >
              {pakaiPemulihan ? "Pakai kode authenticator" : "Tidak bisa buka authenticator?"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
