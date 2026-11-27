// H-02 Katalog & pencarian — `/`, `/k/:kategori/:sub?`, `/cari?q=` (T-007 H-02, T-026).
// Satu komponen untuk ketiga rute (dipasang di route layout tanpa path, main.tsx) agar kolom cari
// tidak kehilangan fokus/isi saat URL berpindah `/` ↔ `/cari`.
//
// Harga HANYA dari server (GET /api/katalog/produk). "+" cepat memasukkan 1 × satuan kartu ke
// keranjang SEMENTARA per zona (keranjang server/grup menyusul T-022).
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { GalatApi } from "../api/klien";
import { satuanPendek } from "../harga/format";
import { ID_PITA_OFFLINE, useOnline } from "../jaringan/online";
import {
  ambilKategori,
  ambilProduk,
  normalisasiCari,
  PANJANG_CARI_MAKS,
  type KartuProdukApi,
  type SaringanProduk,
} from "../katalog/api";
import {
  aksiCari,
  bacaMode,
  bolehMuatOtomatis,
  JEDA_CARI_MS,
  SEMUA,
  tabKategori,
  tabSubkategori,
} from "../katalog/logika";
import { hapus, keranjangPenuh, qtyDi, tambah, ubahQty, urungkan } from "../keranjang/keranjang";
import { useKeranjang } from "../keranjang/simpanan";
import { DeretTab, idTab } from "../komponen/DeretTab/DeretTab";
import { KartuProduk } from "../komponen/KartuProduk/KartuProduk";
import { Snackbar, useSnackbar } from "../komponen/Snackbar/Snackbar";
import { Ikon } from "../layout/Ikon";
import { TEKS } from "../teks/id";
import { useZonaTerpilih } from "../zona/simpanan";
import "./katalog.css";

const JEDA_SKELETON_MS = 300;

/** Tampilkan `true` hanya setelah `aktif` bertahan `ms` (T-007 §4.1: maks 300 ms tanpa apa-apa). */
function useTertunda(aktif: boolean, ms: number): boolean {
  const [lewat, setLewat] = useState(false);
  useEffect(() => {
    if (!aktif) return;
    const t = window.setTimeout(() => {
      setLewat(true);
    }, ms);
    return () => {
      window.clearTimeout(t);
      setLewat(false);
    };
  }, [aktif, ms]);
  return aktif && lewat;
}

function KartuSkeleton() {
  return (
    <div className="kartu kartu--skeleton" aria-hidden="true">
      <div className="kartu__foto skeleton" />
      <div className="skeleton kartu__garis" />
      <div className="skeleton kartu__garis kartu__garis--pendek" />
      <div className="skeleton kartu__garis kartu__garis--pendek" />
    </div>
  );
}

function pesanGalat(err: unknown): { pesan: string; keZona: boolean } {
  if (err instanceof GalatApi && err.kode === "ZONA_TIDAK_DIKENAL") {
    return { pesan: TEKS.zonaTidakDikenal, keZona: true };
  }
  return { pesan: TEKS.gagalMuat, keZona: false };
}

export function Katalog() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const online = useOnline();
  const zona = useZonaTerpilih();
  const zonaKode = zona?.zonaKode;
  const mode = bacaMode(pathname, search);
  const [keranjang, ubahKeranjang] = useKeranjang(zonaKode ?? null);
  const snack = useSnackbar();

  const idPanel = useId();
  const idCari = useId();
  const idCatatanZona = useId();
  const idTabKat = useId();
  const idTabSub = useId();

  // ---- Pencarian dengan debounce: ketikan → (300 ms) → URL /cari?q= → query API ----
  const qUrl = mode.jenis === "cari" ? mode.q : "";
  const [teks, setTeks] = useState(qUrl);
  const qTerakhir = useRef(qUrl);
  const refCari = useRef<HTMLInputElement>(null);

  // URL berubah dari luar (tombol kembali, ikon cari app bar) → selaraskan kolom.
  useEffect(() => {
    if (qUrl !== qTerakhir.current) {
      qTerakhir.current = qUrl;
      setTeks(qUrl);
    }
  }, [qUrl]);

  // Ikon cari di app bar membuka /cari: keyboard langsung terbuka (T-007 H-02 blok 2).
  const diCari = mode.jenis === "cari";
  useEffect(() => {
    if (diCari) refCari.current?.focus();
  }, [diCari]);

  const terapkanCari = (nilai: string) => {
    const aksi = aksiCari(nilai, qTerakhir.current, diCari);
    if (aksi.jenis === "tetap") return;
    qTerakhir.current = aksi.q;
    void navigate(aksi.ke, { replace: aksi.replace });
  };

  useEffect(() => {
    if (teks.trim() === qTerakhir.current.trim()) return;
    const t = window.setTimeout(() => {
      terapkanCari(teks);
    }, JEDA_CARI_MS);
    return () => {
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya bereaksi pada ketikan
  }, [teks]);

  // ---- Data ----
  const kategoriQ = useQuery({
    queryKey: ["katalog", "kategori", zonaKode ?? null],
    queryFn: ({ signal }) => ambilKategori(zonaKode, signal),
    staleTime: 30_000,
  });

  const qApi = mode.jenis === "cari" ? normalisasiCari(mode.q) : undefined;
  const saringan: SaringanProduk = {
    zona: zonaKode,
    kategori: mode.jenis === "kategori" ? mode.kategori : undefined,
    subkategori: mode.jenis === "kategori" ? mode.sub : undefined,
    q: qApi,
  };
  const bolehMuat = mode.jenis !== "cari" || qApi !== undefined;

  const produkQ = useInfiniteQuery({
    queryKey: ["katalog", "produk", saringan],
    queryFn: ({ pageParam, signal }) => ambilProduk(saringan, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (h) => (h.halaman < h.totalHalaman ? h.halaman + 1 : undefined),
    enabled: bolehMuat,
    staleTime: 10_000,
  });

  const produk = useMemo(() => {
    const lihat = new Set<string>();
    const hasil: KartuProdukApi[] = [];
    for (const h of produkQ.data?.pages ?? []) {
      for (const p of h.produk) {
        if (lihat.has(p.id)) continue;
        lihat.add(p.id);
        hasil.push(p);
      }
    }
    return hasil;
  }, [produkQ.data]);
  const total = produkQ.data?.pages[0]?.total ?? 0;

  const memuatAwal = bolehMuat && produkQ.isPending && produkQ.fetchStatus === "fetching";
  const tampilSkeleton = useTertunda(memuatAwal, JEDA_SKELETON_MS);
  const tertahanOffline = bolehMuat && produkQ.isPending && produkQ.fetchStatus === "paused";

  // ---- Muat lebih banyak otomatis saat gulir + tombol cadangan ----
  const refUjung = useRef<HTMLDivElement>(null);
  const { fetchNextPage } = produkQ;
  const otomatis = bolehMuatOtomatis({
    hasNextPage: produkQ.hasNextPage,
    isFetchingNextPage: produkQ.isFetchingNextPage,
    isFetchNextPageError: produkQ.isFetchNextPageError,
    online,
  });
  useEffect(() => {
    const el = refUjung.current;
    if (!el || !otomatis || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) void fetchNextPage({ cancelRefetch: false });
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [otomatis, fetchNextPage]);

  // ---- Keranjang sementara ----
  const alasanHalaman = zonaKode === undefined ? idCatatanZona : null;

  const onTambah = (p: KartuProdukApi) => {
    const baru = ubahKeranjang((k) =>
      tambah(k, {
        idSatuanJual: p.satuan.id,
        idProduk: p.id,
        nama: p.nama,
        kodeSatuan: p.satuan.kode,
        isi: p.satuan.isi,
        tersedia: p.satuan.tersedia && online,
      }),
    );
    const qty = qtyDi(baru, p.satuan.id);
    if (qty === 0) {
      if (keranjangPenuh(baru)) {
        snack.umumkan(TEKS.keranjangPenuh);
        snack.tampilkan({ pesan: TEKS.keranjangPenuh });
      }
      return;
    }
    snack.umumkan(TEKS.ditambahkanLive(p.nama, qty));
    // Aksi "Ganti satuan" (T-008 §1.7) baru ditampilkan setelah halaman detail ada (T-028).
    snack.tampilkan({
      pesan:
        p.jumlahPilihanSatuan > 1
          ? TEKS.ditambahkan(satuanPendek(p.satuan.kode))
          : TEKS.ditambahkanKeranjang,
    });
  };

  const onUbahQty = (p: KartuProdukApi, qty: number) => {
    if (qty <= 0) {
      const { terhapus: t } = hapus(keranjang, p.satuan.id);
      if (t === null) return;
      ubahKeranjang((k) => hapus(k, p.satuan.id).keranjang);
      snack.umumkan(TEKS.dihapusLive(p.nama));
      snack.tampilkan({
        pesan: TEKS.dihapus(p.nama),
        aksi: {
          label: TEKS.urungkan,
          onKlik: () => {
            ubahKeranjang((k) => urungkan(k, t));
            snack.umumkan(TEKS.jumlahLive(p.nama, t.item.qty));
          },
        },
      });
      return;
    }
    const baru = ubahKeranjang((k) => ubahQty(k, p.satuan.id, qty, p.satuan.tersedia && online));
    snack.umumkan(TEKS.jumlahLive(p.nama, qtyDi(baru, p.satuan.id)));
  };

  // ---- Tab ----
  const kategori = kategoriQ.data ?? [];
  const katTerpilih = mode.jenis === "kategori" ? mode.kategori : undefined;
  const katAktif = kategori.find((k) => k.kode === katTerpilih);
  const itemKat = tabKategori(kategori, katTerpilih);
  const itemSub = tabSubkategori(katAktif, mode.jenis === "kategori" ? mode.sub : undefined);
  const kunciKat = katTerpilih ?? SEMUA;
  const kunciSub = mode.jenis === "kategori" ? (mode.sub ?? SEMUA) : SEMUA;
  const labelPanel =
    itemSub.length > 0 && kunciSub !== SEMUA
      ? idTab(idTabSub, kunciSub)
      : idTab(idTabKat, kunciKat);

  const populer = [...kategori]
    .filter((k) => k.jumlahProduk > 0)
    .sort((a, b) => b.jumlahProduk - a.jumlahProduk)
    .slice(0, 4);

  const judul =
    mode.jenis === "cari"
      ? TEKS.cariLabel
      : mode.jenis === "kategori"
        ? [katAktif?.nama, katAktif?.subkategori.find((s) => s.kode === mode.sub)?.nama]
            .filter(Boolean)
            .join(" · ") || TEKS.kategoriLabel
        : TEKS.belanja;

  // ---- Isi daftar ----
  let isi: ReactNode;
  if (mode.jenis === "cari" && qApi === undefined) {
    isi = mode.q.trim() === "" ? null : <p className="katalog__info">{TEKS.cariMinimal}</p>;
  } else if (tertahanOffline) {
    isi = <p className="katalog__info">{TEKS.offline}</p>;
  } else if (produkQ.isError && produk.length === 0) {
    const g = pesanGalat(produkQ.error);
    isi = (
      <div className="card l-stack katalog__keadaan" role="alert">
        <p>{g.pesan}</p>
        {g.keZona ? (
          <Link to="/zona" className="btn btn--primary">
            {TEKS.pilihZona}
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              void produkQ.refetch();
            }}
          >
            {TEKS.cobaLagi}
          </button>
        )}
      </div>
    );
  } else if (produkQ.isPending) {
    isi = tampilSkeleton ? (
      <div className="l-grid-products" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <KartuSkeleton key={i} />
        ))}
      </div>
    ) : null;
  } else if (produk.length === 0) {
    isi =
      mode.jenis === "cari" ? (
        <div className="l-stack katalog__keadaan">
          <p>{TEKS.cariKosong(mode.q.trim())}</p>
          {populer.length > 0 && (
            <>
              <h2 className="katalog__subjudul">{TEKS.kategoriPopuler}</h2>
              <div className="l-cluster">
                {populer.map((k) => (
                  <Link key={k.kode} to={`/k/${k.kode}`} className="chip">
                    {k.nama}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="l-stack katalog__keadaan">
          <p>{mode.jenis === "kategori" ? TEKS.kategoriKosong : TEKS.katalogKosong}</p>
          {mode.jenis === "kategori" && (
            <Link to="/" className="btn btn--secondary">
              {TEKS.lihatSemuaProduk}
            </Link>
          )}
        </div>
      );
  } else {
    isi = (
      <>
        <div className="l-grid-products">
          {produk.map((p) => (
            <KartuProduk
              key={p.id}
              data={p}
              qty={qtyDi(keranjang, p.satuan.id)}
              online={online}
              alasanHalaman={alasanHalaman}
              onTambah={onTambah}
              onUbahQty={onUbahQty}
            />
          ))}
        </div>
        <div ref={refUjung} className="katalog__ujung">
          {produkQ.hasNextPage && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={produkQ.isFetchingNextPage || !online}
              aria-describedby={online ? undefined : ID_PITA_OFFLINE}
              onClick={() => {
                void produkQ.fetchNextPage();
              }}
            >
              {produkQ.isFetchingNextPage ? TEKS.memuatLagi : TEKS.muatLagi}
            </button>
          )}
          {produkQ.isFetchNextPageError && (
            <p role="alert" className="katalog__info">
              {TEKS.gagalMuat}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <section className="katalog l-stack" aria-labelledby="judul-halaman">
      <h1 id="judul-halaman" className="katalog__judul">
        {judul}
      </h1>

      <form
        role="search"
        className="katalog__cari"
        onSubmit={(e) => {
          e.preventDefault();
          terapkanCari(teks);
        }}
      >
        <label htmlFor={idCari} className="sr-only">
          {TEKS.cariLabel}
        </label>
        <span className="katalog__cari-ikon">
          <Ikon nama="cari" ukuran={20} />
        </span>
        <input
          ref={refCari}
          id={idCari}
          className="input katalog__cari-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={PANJANG_CARI_MAKS}
          placeholder={TEKS.cariPlaceholder}
          value={teks}
          onChange={(e) => {
            setTeks(e.target.value);
          }}
        />
      </form>

      {zonaKode === undefined && (
        <div className="card katalog__zona" id={idCatatanZona}>
          <p>{TEKS.zonaBelumDipilih}</p>
          <Link to="/zona" className="btn btn--primary">
            {TEKS.pilihZona}
          </Link>
        </div>
      )}

      {mode.jenis !== "cari" && kategoriQ.isError && kategori.length === 0 && (
        <div className="katalog__galat-kategori" role="alert">
          <p>{TEKS.gagalKategori}</p>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              void kategoriQ.refetch();
            }}
          >
            {TEKS.cobaLagi}
          </button>
        </div>
      )}

      {mode.jenis !== "cari" && kategori.length > 0 && (
        <nav className="katalog__tab l-stack l-stack--sm" aria-label={TEKS.kategoriLabel}>
          <DeretTab
            label={TEKS.kategoriLabel}
            item={itemKat}
            terpilih={kunciKat}
            idPanel={idPanel}
            idAwalan={idTabKat}
            onPilih={(k) => {
              void navigate(k === SEMUA ? "/" : `/k/${k}`);
            }}
          />
          {katAktif && itemSub.length > 0 && (
            <DeretTab
              label={TEKS.subkategoriLabel(katAktif.nama)}
              item={itemSub}
              terpilih={kunciSub}
              idPanel={idPanel}
              idAwalan={idTabSub}
              onPilih={(s) => {
                void navigate(s === SEMUA ? `/k/${katAktif.kode}` : `/k/${katAktif.kode}/${s}`);
              }}
            />
          )}
        </nav>
      )}

      <div
        id={idPanel}
        className="l-stack katalog__panel"
        {...(mode.jenis !== "cari" && kategori.length > 0
          ? { role: "tabpanel", "aria-labelledby": labelPanel }
          : {})}
      >
        <h2 className="sr-only">{TEKS.daftarProduk}</h2>
        <p className="katalog__jumlah" role="status">
          {produkQ.isSuccess && produk.length > 0
            ? mode.jenis === "cari"
              ? TEKS.cariHasil(mode.q.trim(), total)
              : TEKS.jumlahProdukSr(total)
            : ""}
        </p>
        {isi}
      </div>

      <Snackbar isi={snack.isi} umum={snack.umum} tutup={snack.tutup} setJeda={snack.setJeda} />
    </section>
  );
}
