// H-10 Tagihan & pembayaran — /tagihan/:id (T-007 §5 H-10, T-029).
// Status SELALU dari server (polling ringan GET .../pembayaran); halaman tidak pernah menganggap lunas
// sendiri. Nominal dari server, tidak dihitung di klien. Hitung mundur memakai jam server (T-007 §4.5).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MetodeBayarApi, TagihanBayar } from "@nekat/shared";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Link, useParams } from "react-router";
import { ambilStatus, GalatTagihan, mulaiBayar, type DataTagihan } from "./api";
import {
  jamWib,
  kelompokDigit,
  labelDigit,
  mmss,
  namaBank,
  pengumumanSisa,
  rupiah,
  selisihJamMs,
  sisaDetik,
  tingkatHitungMundur,
} from "./format";
import { GambarQr, simpanQrPng } from "./Qr";
import { T } from "./teks";
import "./tagihan.css";

const INTERVAL_POLLING_MS = 5_000;

function langgananOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function useDetik(): number {
  const [sekarang, setSekarang] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setSekarang(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  return sekarang;
}

type Keadaan =
  | "PILIH_METODE"
  | "MENYIAPKAN"
  | "MENUNGGU_BAYAR"
  | "MEMERIKSA"
  | "LUNAS"
  | "TERLAMBAT"
  | "DIPERIKSA"
  | "WAKTU_HABIS"
  | "KEDALUWARSA"
  | "DIBATALKAN"
  | "DIGANTI";

/** Tanda keadaan server; "sedang diperiksa" lokal berlaku sampai tanda ini berubah. */
function tandaStatus(d: TagihanBayar): string {
  return `${d.tagihan.status}|${d.pembayaran?.id ?? "-"}|${d.pembayaran?.status ?? "-"}`;
}

function keadaanDari(d: TagihanBayar, sisa: number, diperiksaLokal: boolean): Keadaan {
  const t = d.tagihan.status;
  const p = d.pembayaran;
  if (t === "LUNAS") return "LUNAS";
  if (p?.status === "LUNAS_TERLAMBAT") return "TERLAMBAT";
  if (t === "KEDALUWARSA") return "KEDALUWARSA";
  if (t === "DIBATALKAN") return "DIBATALKAN";
  if (t === "DIGANTI") return "DIGANTI";
  if (p?.status === "NOMINAL_TIDAK_COCOK") return "DIPERIKSA";
  if (p?.status === "LUNAS" || d.hasil === "SEDANG_DIPERIKSA" || diperiksaLokal) return "MEMERIKSA";
  // Waktu habis menurut jam server, tetapi server belum menutup: jangan anggap batal (§4.5).
  if (sisa <= 0) return "WAKTU_HABIS";
  if (p?.status === "MENUNGGU") return p.tahap === "SIAP" ? "MENUNGGU_BAYAR" : "MENYIAPKAN";
  return "PILIH_METODE";
}

export function HalamanTagihan() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const online = useSyncExternalStore(
    langgananOnline,
    () => navigator.onLine,
    () => true,
  );
  const sekarang = useDetik();
  const [gantiMetode, setGantiMetode] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  // POST menjawab SEDANG_DIPERIKSA (pembayaran lama ternyata sudah dibayar): pertahankan "memeriksa" di
  // polling GET berikutnya (hasil = null) sampai status dari server berubah.
  const [diperiksaPada, setDiperiksaPada] = useState<string | null>(null);

  const kunci = ["tagihan", id] as const;
  const status = useQuery({
    queryKey: kunci,
    queryFn: () => ambilStatus(id),
    retry: (n, e) => !(e instanceof GalatTagihan && [401, 404].includes(e.status)) && n < 2,
    refetchInterval: (q) => {
      const d = q.state.data?.data;
      if (!d) return false;
      const final = d.tagihan.status !== "DITERBITKAN";
      return final ? false : INTERVAL_POLLING_MS;
    },
    refetchIntervalInBackground: false,
  });

  const bayar = useMutation({
    mutationFn: (v: { metode: MetodeBayarApi; kanal?: string }) =>
      mulaiBayar(id, v.metode, v.kanal),
    onSuccess: (h: DataTagihan) => {
      qc.setQueryData(kunci, h);
      setDiperiksaPada(h.data.hasil === "SEDANG_DIPERIKSA" ? tandaStatus(h.data) : null);
      setGantiMetode(false);
      const hasil = h.data.hasil;
      setPesan(
        hasil === "GANTI_METODE_GAGAL"
          ? T.gantiGagal
          : hasil === "METODE_GAGAL"
            ? T.metodeGagal
            : hasil === "MENYIAPKAN"
              ? T.menyiapkanUlang
              : null,
      );
    },
    onError: (e) => {
      setPesan(e instanceof GalatTagihan ? e.message : T.gangguan);
      void qc.invalidateQueries({ queryKey: kunci });
    },
  });

  if (status.isPending) {
    return (
      <section className="tagihan l-stack" aria-busy="true" aria-labelledby="judul-halaman">
        <h1 id="judul-halaman">{T.judul}</h1>
        <div className="skeleton tagihan__skeleton" />
        <p>{T.memuat}</p>
      </section>
    );
  }
  if (status.isError) {
    const e = status.error;
    const belumMasuk = e instanceof GalatTagihan && e.status === 401;
    const tidakAda = e instanceof GalatTagihan && e.status === 404;
    return (
      <section className="tagihan l-stack" aria-labelledby="judul-halaman">
        <h1 id="judul-halaman">{T.judul}</h1>
        <p role="alert">{belumMasuk ? T.belumMasuk : tidakAda ? T.tidakDitemukan : T.gangguan}</p>
        {belumMasuk ? (
          <Link className="btn btn--primary" to="/masuk">
            {T.masuk}
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void status.refetch()}
          >
            {T.cobaLagi}
          </button>
        )}
      </section>
    );
  }

  const { data: d, diterimaMs } = status.data;
  const selisih = selisihJamMs(d.waktuServer, diterimaMs);
  const sisa = sisaDetik(d.tagihan.kedaluwarsaPada, sekarang, selisih);
  const keadaan = keadaanDari(d, sisa, diperiksaPada !== null && diperiksaPada === tandaStatus(d));
  const p = d.pembayaran;
  const bolehPilih = keadaan === "PILIH_METODE" || (gantiMetode && keadaan === "MENUNGGU_BAYAR");
  // Sedang dikonfirmasi/diperiksa: jangan tampilkan ajakan bayar (nominal, hitung mundur, QR/VA).
  const sedangDicek =
    keadaan === "MEMERIKSA" || keadaan === "DIPERIKSA" || keadaan === "WAKTU_HABIS";

  return (
    <section className="tagihan l-stack" aria-labelledby="judul-halaman">
      <h1 id="judul-halaman">{d.tagihan.gabungan ? T.judulGabungan : T.judul}</h1>
      <p className="tagihan__nomor">{T.nomor(d.tagihan.nomor)}</p>

      {!online && (
        // Satu-satunya pita offline di halaman ini (pita umum AppShell disembunyikan untuk /tagihan).
        <p className="tagihan__info" role="status">
          {T.offline}
        </p>
      )}

      {d.tagihan.status === "DITERBITKAN" && !sedangDicek && (
        <HitungMundur sisa={sisa} kedaluwarsaIso={d.tagihan.kedaluwarsaPada} />
      )}

      {!sedangDicek && (
        <div className="card tagihan__nominal">
          <p className="tagihan__label">
            {keadaan === "LUNAS"
              ? T.dibayar
              : d.tagihan.status === "DITERBITKAN"
                ? T.bayar
                : T.nominalTagihan}
          </p>
          <p className="tagihan__angka num">{rupiah(d.tagihan.sisaBayarRp)}</p>
          {d.tagihan.saldoDipakaiRp > 0 && (
            <dl className="tagihan__rincian">
              <div>
                <dt>{T.total}</dt>
                <dd className="num">{rupiah(d.tagihan.totalRp)}</dd>
              </div>
              <div>
                <dt>{T.saldoDipakai}</dt>
                <dd className="num">−{rupiah(d.tagihan.saldoDipakaiRp)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {pesan && (
        <p className="tagihan__peringatan" role="alert">
          {pesan}
        </p>
      )}

      <StatusAkhir keadaan={keadaan} d={d} />

      {keadaan === "MENYIAPKAN" && p && (
        <div className="card l-stack">
          <p role="status">{T.menyiapkan}</p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={bayar.isPending}
            onClick={() => {
              bayar.mutate(p.kanal ? { metode: p.metode, kanal: p.kanal } : { metode: p.metode });
            }}
          >
            {T.cobaLagi}
          </button>
        </div>
      )}

      {keadaan === "MENUNGGU_BAYAR" && p?.instruksi && !gantiMetode && <Instruksi d={d} />}

      {bolehPilih && d.metodeTersedia.length > 0 && (
        <PilihMetode
          d={d}
          sibuk={bayar.isPending}
          onPilih={(metode, kanal) => {
            setPesan(null);
            bayar.mutate(kanal ? { metode, kanal } : { metode });
          }}
          onBatal={
            gantiMetode
              ? () => {
                  setGantiMetode(false);
                }
              : null
          }
        />
      )}
      {bolehPilih && d.metodeTersedia.length === 0 && d.tagihan.status === "DITERBITKAN" && (
        <p className="tagihan__peringatan" role="alert">
          {T.gangguan}
        </p>
      )}

      {keadaan === "MENUNGGU_BAYAR" && !gantiMetode && (
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => {
            setGantiMetode(true);
          }}
        >
          {T.gantiMetode}
        </button>
      )}
    </section>
  );
}

function HitungMundur({ sisa, kedaluwarsaIso }: { sisa: number; kedaluwarsaIso: string }) {
  const tingkat = tingkatHitungMundur(sisa);
  return (
    <div className="card tagihan__waktu" role="timer" aria-live="off">
      {/* Live region terpisah: hanya berubah saat melewati 30/10/5/2 menit (bukan tiap detik). */}
      <p className="sr-only" aria-live="polite">
        {pengumumanSisa(sisa)}
      </p>
      <p className="countdown" data-level={tingkat === "normal" ? undefined : tingkat}>
        {mmss(sisa)}
      </p>
      <p>
        {T.bayarSebelum(jamWib(kedaluwarsaIso))}
        {tingkat === "warning" && <strong className="tagihan__tegas"> · {T.segeraBayar}</strong>}
        {tingkat === "danger" && <strong className="tagihan__tegas"> · {T.hampirHabis}</strong>}
      </p>
    </div>
  );
}

function StatusAkhir({ keadaan, d }: { keadaan: Keadaan; d: TagihanBayar }) {
  const teks: Partial<
    Record<Keadaan, { judul: string; isi?: string; jenis: "sukses" | "info" | "bahaya" }>
  > = {
    LUNAS: { judul: T.lunas, jenis: "sukses" },
    MEMERIKSA: { judul: T.memeriksa, jenis: "info" },
    WAKTU_HABIS: { judul: T.waktuHabis, jenis: "info" },
    DIPERIKSA: { judul: T.diperiksa, jenis: "info" },
    TERLAMBAT: { judul: T.terlambat(rupiah(d.pembayaran?.jumlahRp ?? 0)), jenis: "info" },
    KEDALUWARSA: { judul: T.kedaluwarsa, jenis: "bahaya" },
    DIBATALKAN: { judul: T.dibatalkan, jenis: "bahaya" },
    DIGANTI: { judul: T.diganti, jenis: "info" },
  };
  const t = teks[keadaan];
  if (!t) return null;
  return (
    <div className={`card tagihan__status tagihan__status--${t.jenis}`} role="status">
      <p className="tagihan__status-judul">
        {t.jenis === "sukses" && <span aria-hidden="true">✓ </span>}
        {t.judul}
      </p>
      {keadaan === "LUNAS" && (
        <Link className="btn btn--primary" to="/pesanan">
          {T.lihatPesanan}
        </Link>
      )}
      {(keadaan === "KEDALUWARSA" ||
        keadaan === "DIBATALKAN" ||
        keadaan === "DIGANTI" ||
        keadaan === "TERLAMBAT") && (
        // Halaman Saldo (H-12) belum dibangun → semua jalan keluar ke katalog untuk sekarang.
        <Link className="btn btn--primary" to="/">
          {T.belanjaLagi}
        </Link>
      )}
    </div>
  );
}

function Instruksi({ d }: { d: TagihanBayar }) {
  const ins = d.pembayaran?.instruksi;
  const [disalin, setDisalin] = useState("");
  if (!ins) return null;
  const nominal = rupiah(d.pembayaran?.jumlahRp ?? d.tagihan.sisaBayarRp);
  if (ins.jenis === "QRIS") {
    return (
      <div className="card l-stack tagihan__instruksi">
        <h2>{T.qrisJudul}</h2>
        <div className="tagihan__qr">
          <GambarQr qrString={ins.qrString} label={T.qrAlt(nominal)} />
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => void simpanQrPng(ins.qrString, `QRIS-${d.tagihan.nomor}.png`)}
        >
          {T.simpanQr}
        </button>
        <ol className="tagihan__langkah">
          {T.langkahQris.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
      </div>
    );
  }
  const salin = (teks: string) => {
    void navigator.clipboard
      .writeText(teks)
      .then(() => {
        setDisalin(T.disalin);
      })
      .catch(() => {
        setDisalin(T.gagalSalin);
      });
  };
  return (
    <div className="card l-stack tagihan__instruksi">
      <h2>{T.vaJudul(namaBank(ins.bank))}</h2>
      <div className="tagihan__va">
        <p className="tagihan__label">{T.nomorVa}</p>
        <p className="tagihan__va-nomor num" aria-label={labelDigit(ins.nomorVa)}>
          {kelompokDigit(ins.nomorVa)}
        </p>
        <p className="tagihan__va-nama">{T.atasNama(ins.namaPenerima)}</p>
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => {
          salin(ins.nomorVa);
        }}
      >
        {T.salinNomor}
      </button>
      <p className="sr-only" aria-live="polite">
        {disalin}
      </p>
      {disalin && (
        <p className="tagihan__salin" aria-hidden="true">
          {disalin}
        </p>
      )}
      <p className="tagihan__catatan">{T.vaNominalTepat(nominal)}</p>
      <details className="tagihan__akordeon">
        <summary>{T.lewatMBanking}</summary>
        <ol className="tagihan__langkah">
          {T.langkahMBanking(namaBank(ins.bank)).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
      </details>
      <details className="tagihan__akordeon">
        <summary>{T.lewatAtm}</summary>
        <ol className="tagihan__langkah">
          {T.langkahAtm(namaBank(ins.bank)).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function PilihMetode({
  d,
  sibuk,
  onPilih,
  onBatal,
}: {
  d: TagihanBayar;
  sibuk: boolean;
  onPilih: (metode: MetodeBayarApi, kanal?: string) => void;
  onBatal: (() => void) | null;
}) {
  const idLegend = useId();
  const p = d.pembayaran;
  const awal = p?.status === "MENUNGGU" ? p.metode : "QRIS";
  const [metode, setMetode] = useState<MetodeBayarApi>(awal);
  const bankVa = d.metodeTersedia.find((m) => m.metode === "VA")?.kanal ?? [];
  const [bank, setBank] = useState(p?.kanal ?? bankVa[0] ?? "");
  const sama =
    p?.status === "MENUNGGU" && p.metode === metode && (metode === "QRIS" || p.kanal === bank);
  return (
    <form
      className="card l-stack tagihan__metode"
      onSubmit={(e) => {
        e.preventDefault();
        onPilih(metode, metode === "VA" ? bank : undefined);
      }}
    >
      <fieldset className="l-stack l-stack--sm" aria-describedby={idLegend}>
        <legend id={idLegend}>{T.pilihMetode}</legend>
        {d.metodeTersedia.map((m) => (
          <label key={m.metode} className="tagihan__opsi">
            <input
              type="radio"
              name="metode"
              value={m.metode}
              checked={metode === m.metode}
              onChange={() => {
                setMetode(m.metode);
              }}
            />
            <span>{m.metode === "QRIS" ? T.opsiQris : T.opsiVa}</span>
          </label>
        ))}
      </fieldset>
      {metode === "VA" && bankVa.length > 0 && (
        <fieldset className="l-stack l-stack--sm">
          <legend>{T.pilihBank}</legend>
          <div className="tagihan__bank">
            {bankVa.map((k) => (
              <label key={k} className="tagihan__opsi">
                <input
                  type="radio"
                  name="bank"
                  value={k}
                  checked={bank === k}
                  onChange={() => {
                    setBank(k);
                  }}
                />
                <span>{namaBank(k)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={sibuk || sama || (metode === "VA" && !bank)}
      >
        {sibuk ? T.memproses : T.tampilkanInstruksi}
      </button>
      {sama && <p className="tagihan__catatan">{T.metodeAktif}</p>}
      {onBatal && (
        <button type="button" className="btn btn--ghost btn--block" onClick={onBatal}>
          {T.batalGanti}
        </button>
      )}
      {onBatal && <p className="tagihan__catatan">{T.catatanGanti}</p>}
    </form>
  );
}
