// H-04 Keranjang — versi SEMENTARA (T-026). Keranjang server, Belanja Bareng, perbandingan & checkout
// menyusul (T-022, T-029, T-033).
//
// Keputusan total (T-008 U-04 DEFAULT): klien hanya boleh mengalikan harga × jumlah di stepper DETAIL;
// "total keranjang, perbandingan grup vs sendiri, dan tagihan tetap dari server". Karena belum ada
// endpoint keranjang, halaman ini TIDAK menampilkan total/subtotal sama sekali, hanya harga satuan
// terbaru per baris dari server (GET /api/katalog/produk/:id, sama dengan kartu & detail).
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import { GalatApi } from "../api/klien";
import { labelSatuan } from "../harga/format";
import { ID_PITA_OFFLINE, useOnline } from "../jaringan/online";
import { ambilDetail, type DetailProdukApi } from "../katalog/api";
import { hapus, QTY_MAKS, ubahQty, urungkan, type ItemKeranjang } from "../keranjang/keranjang";
import { useKeranjang } from "../keranjang/simpanan";
import { Harga } from "../komponen/Harga/Harga";
import { Snackbar, useSnackbar } from "../komponen/Snackbar/Snackbar";
import { Stepper } from "../komponen/Stepper/Stepper";
import { Ikon } from "../layout/Ikon";
import { TEKS } from "../teks/id";
import { useZonaTerpilih } from "../zona/simpanan";
import "./keranjang.css";

interface InfoBaris {
  readonly memuat: boolean;
  readonly gagal: boolean;
  /** Produk tidak tayang lagi (404). */
  readonly hilang: boolean;
  readonly detail: DetailProdukApi | undefined;
}

function Baris({
  item,
  info,
  online,
  onUbah,
  onHapus,
}: {
  item: ItemKeranjang;
  info: InfoBaris;
  online: boolean;
  onUbah: (qty: number, bolehNaik: boolean) => void;
  onHapus: () => void;
}) {
  const satuan = info.detail?.satuan.find((s) => s.id === item.idSatuanJual);
  const nama = info.detail?.nama ?? item.nama;
  const satuanHilang = info.detail !== undefined && satuan === undefined;
  const tidakTersedia = info.hilang || satuanHilang;
  const labelStok = satuan && satuan.statusStok !== "TERSEDIA" ? satuan.labelStok : null;
  const bolehNaik = online && satuan?.tersedia === true;
  const idStatus = `status-${item.idSatuanJual}`;
  const gambar = info.detail?.gambarUrl ?? null;

  return (
    <li className={tidakTersedia ? "baris baris--mati" : "baris"}>
      <div className="baris__foto" aria-hidden="true">
        {gambar ? (
          <img src={gambar} alt="" width={64} height={64} loading="lazy" decoding="async" />
        ) : (
          <Ikon nama="gambar" />
        )}
      </div>
      <div className="baris__isi">
        <p className="baris__nama">
          {tidakTersedia ? (
            nama
          ) : (
            <Link to={`/p/${encodeURIComponent(item.idProduk)}`}>{nama}</Link>
          )}
        </p>
        <p className="baris__satuan">{labelSatuan({ kode: item.kodeSatuan, isi: item.isi })}</p>

        {tidakTersedia ? (
          <p className="baris__status" id={idStatus}>
            {info.hilang ? TEKS.barangTidakTersedia : TEKS.satuanTidakTersedia}
          </p>
        ) : info.memuat && !info.detail ? (
          <div className="skeleton baris__garis" aria-hidden="true" />
        ) : (
          <Harga
            harga={online && satuan ? satuan.harga : null}
            kode={item.kodeSatuan}
            varian="baris"
          />
        )}
        {labelStok && online && (
          <p className="baris__status" id={idStatus}>
            {labelStok}
          </p>
        )}
        {info.gagal && !info.detail && <p className="baris__status">{TEKS.gagalMuat}</p>}

        <div className="baris__aksi">
          {tidakTersedia ? (
            <button type="button" className="btn btn--secondary" onClick={onHapus}>
              {TEKS.hapus}
            </button>
          ) : (
            <>
              <Stepper
                nama={nama}
                qty={item.qty}
                bolehTambah={bolehNaik && item.qty < QTY_MAKS}
                alasanTambahNonaktif={!online ? ID_PITA_OFFLINE : labelStok ? idStatus : undefined}
                onTambah={() => {
                  onUbah(item.qty + 1, bolehNaik);
                }}
                onKurangi={() => {
                  if (item.qty <= 1) onHapus();
                  else onUbah(item.qty - 1, bolehNaik);
                }}
              />
              <button
                type="button"
                className="btn btn--ghost baris__hapus"
                aria-label={TEKS.hapusAria(nama)}
                onClick={onHapus}
              >
                <Ikon nama="hapus" ukuran={20} />
                <span aria-hidden="true">{TEKS.hapus}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function Keranjang() {
  const zona = useZonaTerpilih();
  const zonaKode = zona?.zonaKode;
  const online = useOnline();
  const [keranjang, ubahKeranjang] = useKeranjang(zonaKode ?? null);
  const snack = useSnackbar();

  // Satu permintaan per PRODUK (bukan per baris): harga & stok terbaru dari server.
  const idProduk = [...new Set(keranjang.item.map((i) => i.idProduk))];
  const hasil = useQueries({
    queries: idProduk.map((id) => ({
      queryKey: ["katalog", "detail", id, zonaKode ?? null],
      queryFn: ({ signal }: { signal: AbortSignal }) => ambilDetail(id, zonaKode, signal),
      staleTime: 10_000,
      enabled: zonaKode !== undefined,
      retry: (n: number, err: unknown) => !(err instanceof GalatApi && err.status === 404) && n < 2,
    })),
  });
  const infoPer = new Map<string, InfoBaris>();
  idProduk.forEach((id, i) => {
    const q = hasil[i];
    infoPer.set(id, {
      memuat: q?.isPending ?? true,
      gagal: q?.isError ?? false,
      hilang: q?.error instanceof GalatApi && q.error.status === 404,
      detail: q?.data,
    });
  });

  if (zonaKode === undefined) {
    return (
      <section className="keranjang l-stack" aria-labelledby="judul-halaman">
        <h1 id="judul-halaman">{TEKS.keranjangJudul}</h1>
        <div className="card l-stack">
          <p>{TEKS.zonaBelumDipilih}</p>
          <Link to="/zona" className="btn btn--primary">
            {TEKS.pilihZona}
          </Link>
        </div>
      </section>
    );
  }

  const onHapus = (item: ItemKeranjang) => {
    const { terhapus } = hapus(keranjang, item.idSatuanJual);
    if (!terhapus) return;
    ubahKeranjang((k) => hapus(k, item.idSatuanJual).keranjang);
    const nama = infoPer.get(item.idProduk)?.detail?.nama ?? item.nama;
    snack.umumkan(TEKS.dihapusLive(nama));
    snack.tampilkan({
      pesan: TEKS.dihapus(nama),
      aksi: {
        label: TEKS.urungkan,
        onKlik: () => {
          ubahKeranjang((k) => urungkan(k, terhapus));
          snack.umumkan(TEKS.jumlahLive(nama, terhapus.item.qty));
        },
      },
    });
  };

  return (
    <section className="keranjang l-stack" aria-labelledby="judul-halaman">
      <div className="l-stack l-stack--sm">
        <h1 id="judul-halaman" className="keranjang__judul">
          {TEKS.keranjangJudul}
        </h1>
        <p className="keranjang__zona">{TEKS.keranjangZona(zona?.namaKelurahan ?? "")}</p>
      </div>

      <p className="keranjang__sementara" role="note">
        {TEKS.keranjangSementara}
      </p>

      {keranjang.item.length === 0 ? (
        <div className="l-stack keranjang__kosong">
          <p>{TEKS.keranjangKosong}</p>
          <Link to="/" className="btn btn--primary">
            {TEKS.mulaiBelanja}
          </Link>
        </div>
      ) : (
        <>
          <ul className="keranjang__daftar" aria-label="Barang di keranjang">
            {keranjang.item.map((item) => (
              <Baris
                key={item.idSatuanJual}
                item={item}
                online={online}
                info={
                  infoPer.get(item.idProduk) ?? {
                    memuat: true,
                    gagal: false,
                    hilang: false,
                    detail: undefined,
                  }
                }
                onUbah={(qty, bolehNaik) => {
                  const baru = ubahKeranjang((k) => ubahQty(k, item.idSatuanJual, qty, bolehNaik));
                  const n = baru.item.find((i) => i.idSatuanJual === item.idSatuanJual)?.qty ?? 0;
                  snack.umumkan(TEKS.jumlahLive(item.nama, n));
                }}
                onHapus={() => {
                  onHapus(item);
                }}
              />
            ))}
          </ul>
          <p className="keranjang__total">{TEKS.totalNanti}</p>
        </>
      )}

      <Snackbar isi={snack.isi} umum={snack.umum} tutup={snack.tutup} />
    </section>
  );
}
