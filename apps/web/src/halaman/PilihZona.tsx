import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ambilDaftarZona, cekZona, type HasilCekZona } from "../zona/api";
import { simpanZona, tujuanSetelahZona } from "../zona/simpanan";
import "./pilih-zona.css";

// H-01 Pilih zona (T-007 §H-01, T-015). Izin lokasi HANYA diminta saat tombol ditekan.

type Tahap =
  | { jenis: "awal" }
  | { jenis: "mencari" }
  | { jenis: "izin-ditolak" }
  | { jenis: "gagal"; pesan: string }
  | { jenis: "di-luar" };

const BATAS_GPS_MS = 10_000;

function ambilPosisi(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("TIDAK_DIDUKUNG"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: BATAS_GPS_MS,
      maximumAge: 5 * 60_000,
    });
  });
}

export function PilihZona() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tujuan = tujuanSetelahZona(params.get("kembali"));
  const [tahap, setTahap] = useState<Tahap>({ jenis: "awal" });
  const [manual, setManual] = useState(false);
  const [cari, setCari] = useState("");
  const idCari = useId();
  const daftarRef = useRef<HTMLHeadingElement>(null);

  const daftar = useQuery({
    queryKey: ["zona"],
    queryFn: ambilDaftarZona,
    enabled: manual,
    staleTime: 5 * 60_000,
  });

  const hasilCari = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const semua = daftar.data?.zona ?? [];
    if (!q) return semua;
    return semua.filter(
      (z) =>
        z.namaKelurahan.toLowerCase().includes(q) ||
        z.dropPoint.some((d) => d.nama.toLowerCase().includes(q)),
    );
  }, [cari, daftar.data]);

  const pilih = (h: Extract<HasilCekZona, { status: "DALAM_ZONA" }>) => {
    simpanZona({
      zonaKode: h.zonaKode,
      namaKelurahan: h.namaKelurahan,
      dropPointKode: h.dropPointKode,
      dropPointNama: h.dropPointNama,
    });
    void navigate(tujuan);
  };

  const bukaManual = () => {
    setManual(true);
    requestAnimationFrame(() => daftarRef.current?.focus());
  };

  const pakaiLokasi = async () => {
    setTahap({ jenis: "mencari" });
    let pos: GeolocationPosition;
    try {
      pos = await ambilPosisi();
    } catch (e) {
      const kode = (e as GeolocationPositionError).code;
      if (kode === 1) setTahap({ jenis: "izin-ditolak" });
      else
        setTahap({
          jenis: "gagal",
          pesan: "Lokasimu belum ketemu. Pastikan GPS menyala, atau pilih manual.",
        });
      return;
    }
    try {
      const h = await cekZona(pos.coords.latitude, pos.coords.longitude);
      if (h.status === "DALAM_ZONA") pilih(h);
      else setTahap({ jenis: "di-luar" });
    } catch (e) {
      setTahap({ jenis: "gagal", pesan: (e as Error).message || "Terjadi gangguan. Coba lagi." });
    }
  };

  if (tahap.jenis === "di-luar" && !manual) {
    return (
      <section className="zona l-stack" aria-labelledby="judul-halaman">
        <h1 id="judul-halaman">NEKAT belum melayani lokasimu</h1>
        <p>
          Saat ini NEKAT baru melayani beberapa kelurahan. Kamu tetap bisa melihat-lihat katalog.
        </p>
        <div className="l-stack l-stack--sm">
          <Link to="/" className="btn btn--primary btn--block">
            Lihat katalog saja
          </Link>
          <button type="button" className="btn btn--secondary btn--block" onClick={bukaManual}>
            Pilih lokasi lain
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="zona l-stack" aria-labelledby="judul-halaman">
      <div className="zona__kepala l-stack l-stack--sm">
        <span className="zona__logo" aria-hidden="true">
          N
        </span>
        <h1 id="judul-halaman">Belanja bareng tetangga, lebih hemat</h1>
        <p>Pilih lokasimu supaya harga, stok, dan grup sesuai kelurahanmu.</p>
      </div>

      <div className="l-stack l-stack--sm">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => void pakaiLokasi()}
          disabled={tahap.jenis === "mencari"}
          aria-busy={tahap.jenis === "mencari"}
        >
          {tahap.jenis === "mencari" ? "Mencari lokasimu…" : "Pakai lokasiku sekarang"}
        </button>
        {!manual && (
          <button type="button" className="btn btn--ghost btn--block" onClick={bukaManual}>
            Pilih manual
          </button>
        )}
      </div>

      <div aria-live="polite" className="zona__status">
        {tahap.jenis === "izin-ditolak" && (
          <p>Tidak apa-apa, pilih lokasi secara manual di bawah.</p>
        )}
        {tahap.jenis === "gagal" && <p>{tahap.pesan}</p>}
        {tahap.jenis === "di-luar" && (
          <p>Lokasimu di luar zona layanan. Pilih kelurahan lain di bawah.</p>
        )}
      </div>

      {(manual || tahap.jenis === "izin-ditolak" || tahap.jenis === "gagal") && (
        <div className="l-stack l-stack--sm">
          <h2 ref={daftarRef} tabIndex={-1}>
            Pilih kelurahan
          </h2>
          <label htmlFor={idCari} className="zona__label">
            Cari kelurahan atau drop point
          </label>
          <input
            id={idCari}
            className="input"
            type="search"
            value={cari}
            onChange={(e) => {
              setManual(true);
              setCari(e.target.value);
            }}
            onFocus={() => {
              setManual(true);
            }}
            placeholder="mis. Cikokol"
            autoComplete="off"
          />
          {daftar.isPending && manual && <p>Memuat daftar kelurahan…</p>}
          {daftar.isError && (
            <p role="alert">
              {daftar.error.message}{" "}
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void daftar.refetch()}
              >
                Coba lagi
              </button>
            </p>
          )}
          {daftar.isSuccess && hasilCari.length === 0 && <p>Tidak ketemu &ldquo;{cari}&rdquo;.</p>}
          <ul className="zona__daftar" aria-label="Daftar kelurahan">
            {hasilCari.flatMap((z) =>
              z.dropPoint.map((d) => (
                <li key={d.kode}>
                  <button
                    type="button"
                    className="zona__opsi tap"
                    onClick={() => {
                      pilih({
                        status: "DALAM_ZONA",
                        zonaKode: z.kode,
                        namaKelurahan: z.namaKelurahan,
                        dropPointKode: d.kode,
                        dropPointNama: d.nama,
                        jarakMeter: 0,
                      });
                    }}
                  >
                    <span className="zona__opsi-nama">{z.namaKelurahan}</span>
                    <span className="zona__opsi-dp">
                      Drop point: {d.nama}
                      {d.jamAmbil ? ` · ${d.jamAmbil}` : ""}
                    </span>
                  </button>
                </li>
              )),
            )}
          </ul>
        </div>
      )}

      <p className="zona__privasi">
        Lokasi hanya dipakai untuk mencari drop point terdekat dan tidak disimpan.{" "}
        <Link to="/akun">Kebijakan Privasi</Link>
      </p>
    </section>
  );
}
