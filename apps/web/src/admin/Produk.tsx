// Produk, SKU, satuan jual (T-036). Harga & margin TIDAK di sini (menu Harga & margin, T-037).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  apiAdmin,
  GalatAdmin,
  LABEL_SATUAN,
  nilaiForm,
  type JenisSatuan,
  type Kategori,
  type ProdukRingkas,
  type Sku,
} from "./api";
import { Paginasi } from "./Paginasi";

const teks = nilaiForm;

function Galat({ err }: { err: unknown }) {
  if (!err) return null;
  const pesan = err instanceof GalatAdmin ? err.message : "Terjadi gangguan. Coba lagi.";
  return (
    <p className="adm-galat" role="alert">
      {pesan}
    </p>
  );
}

function StatusProduk({ p }: { p: Pick<ProdukRingkas, "aktif" | "tinjauanKategori"> }) {
  return (
    <span className="l-cluster adm-status">
      <span className={p.aktif ? "chip chip--success" : "chip"}>
        {p.aktif ? "Aktif" : "Nonaktif"}
      </span>
      {p.tinjauanKategori === "MENUNGGU" && (
        <span className="chip chip--warning" title="Nama mirip barang terlarang (P-24)">
          Perlu ditinjau
        </span>
      )}
    </span>
  );
}

export function DaftarProduk() {
  const [cari, setCari] = useState("");
  const [halaman, setHalaman] = useState(1);
  const q = useQuery({
    queryKey: ["admin", "produk", cari, halaman],
    queryFn: () => apiAdmin.daftarProduk(cari, halaman),
  });

  return (
    <section className="l-stack" aria-labelledby="judul-produk">
      <div className="adm-judul">
        <h1 id="judul-produk">Produk & SKU</h1>
        <Link to="/admin/produk/baru" className="btn btn--primary">
          Tambah produk
        </Link>
      </div>
      <form
        className="l-cluster"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setCari(teks(new FormData(e.currentTarget), "cari"));
          setHalaman(1);
        }}
      >
        <label className="sr-only" htmlFor="cari-produk">
          Cari nama, kode SKU, atau barcode
        </label>
        <input
          id="cari-produk"
          name="cari"
          className="input adm-cari"
          placeholder="Cari nama, kode SKU, barcode"
          defaultValue={cari}
        />
        <button className="btn btn--secondary">Cari</button>
      </form>
      <p className="adm-catatan">
        Harga & margin diisi di menu Harga & margin. Produk tanpa harga tidak tayang.
      </p>
      {q.isPending && <div className="skeleton adm-skeleton" aria-label="Memuat" />}
      <Galat err={q.error} />
      {q.data?.produk.length === 0 && <p>Belum ada produk.</p>}
      {q.data && q.data.produk.length > 0 && (
        <table className="adm-tabel">
          <thead>
            <tr>
              <th scope="col">Nama</th>
              <th scope="col">Kategori</th>
              <th scope="col">SKU</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data.produk.map((p) => (
              <tr key={p.id}>
                <td data-label="Nama">
                  <Link to={`/admin/produk/${p.id}`}>{p.nama}</Link>
                </td>
                <td data-label="Kategori">
                  {p.indukKategoriNama ? `${p.indukKategoriNama} › ` : ""}
                  {p.kategoriNama}
                </td>
                <td data-label="SKU">{p.jumlahSku}</td>
                <td data-label="Status">
                  <StatusProduk p={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.data && <Paginasi halaman={halaman} total={q.data.total} onGanti={setHalaman} />}
    </section>
  );
}

/** Subkategori yang boleh dipilih: aktif, induk ada, bukan kategori terlarang (P-24). */
function PilihKategori({ kategori, nilai }: { kategori: Kategori[]; nilai?: string }) {
  const sub = kategori.filter((k) => k.indukId !== null && k.aktif && !k.terlarang);
  const induk = kategori.filter((k) => k.indukId === null && !k.terlarang);
  return (
    <select className="input" name="kategoriId" required defaultValue={nilai ?? ""}>
      <option value="" disabled>
        Pilih subkategori
      </option>
      {induk.map((i) => (
        <optgroup key={i.id} label={i.nama}>
          {sub
            .filter((s) => s.indukId === i.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.nama}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function FormProduk({ sumber = "local" }: { sumber?: "local" | "gudang" }) {
  const { id } = useParams();
  const navigasi = useNavigate();
  const qc = useQueryClient();
  const kategori = useQuery({ queryKey: ["admin", "kategori"], queryFn: apiAdmin.kategori });
  const detail = useQuery({
    queryKey: ["admin", "produk", "detail", id],
    queryFn: () => apiAdmin.produk(id ?? ""),
    enabled: id !== undefined,
  });
  const [tersimpan, setTersimpan] = useState(false);

  const simpan = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (id) {
        await apiAdmin.ubahProduk(id, data);
        return id;
      }
      return (await apiAdmin.buatProduk(data)).id;
    },
    onSuccess: async (idBaru) => {
      await qc.invalidateQueries({ queryKey: ["admin", "produk"] });
      setTersimpan(true);
      if (!id) void navigasi(`/admin/produk/${idBaru}`, { replace: true });
    },
  });

  function kirim(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setTersimpan(false);
    simpan.mutate({
      kategoriId: teks(f, "kategoriId"),
      nama: teks(f, "nama"),
      deskripsi: teks(f, "deskripsi"),
      gambarUrl: teks(f, "gambarUrl"),
      aktif: f.get("aktif") === "on",
      ...(id && teks(f, "alasan") ? { alasan: teks(f, "alasan") } : {}),
    });
  }

  if (id && detail.isPending) return <div className="skeleton adm-skeleton" aria-label="Memuat" />;
  if (id && detail.error) return <Galat err={detail.error} />;
  const p = detail.data?.produk;

  return (
    <div className="l-stack adm-form-produk">
      <p>
        <Link to="/admin/produk">← Daftar produk</Link>
      </p>
      <section className="card l-stack" aria-labelledby="judul-form-produk">
        <div className="adm-judul">
          <h1 id="judul-form-produk">{p ? p.nama : "Produk baru"}</h1>
          {p && <StatusProduk p={p} />}
        </div>
        {p?.tinjauanKategori === "MENUNGGU" && (
          <p className="adm-peringatan" role="status">
            Nama produk mirip barang terlarang (tembakau/nikotin/alkohol, P-24). Produk tidak tayang
            sampai kategorinya ditinjau.
          </p>
        )}
        <form className="l-stack" onSubmit={kirim} key={p?.diubahPada ?? "baru"}>
          <label className="adm-field">
            <span>Subkategori</span>
            {kategori.data ? (
              <PilihKategori
                kategori={kategori.data.kategori}
                {...(p ? { nilai: p.kategoriId } : {})}
              />
            ) : (
              <span className="skeleton adm-skeleton--baris" />
            )}
          </label>
          <label className="adm-field">
            <span>Nama produk</span>
            <input className="input" name="nama" required maxLength={200} defaultValue={p?.nama} />
          </label>
          <label className="adm-field">
            <span>Deskripsi (opsional)</span>
            <textarea
              className="input adm-textarea"
              name="deskripsi"
              maxLength={2000}
              defaultValue={p?.deskripsi ?? ""}
            />
          </label>
          <label className="adm-field">
            <span>URL gambar https:// (opsional)</span>
            <input
              className="input"
              name="gambarUrl"
              type="url"
              pattern="https://.*"
              maxLength={500}
              defaultValue={p?.gambarUrl ?? ""}
            />
          </label>
          <label className="adm-centang">
            <input type="checkbox" name="aktif" defaultChecked={p?.aktif ?? true} /> Aktif
          </label>
          {id && (
            <label className="adm-field">
              <span>Alasan perubahan (opsional, tercatat di log)</span>
              <input className="input" name="alasan" maxLength={500} />
            </label>
          )}
          <Galat err={simpan.error} />
          {/* Wilayah live selalu ada agar pembaca layar mengumumkan perubahan isinya. */}
          <p role="status" aria-live="polite" className="adm-catatan">
            {tersimpan && !simpan.isPending ? "Tersimpan." : ""}
          </p>
          <button className="btn btn--primary" disabled={simpan.isPending}>
            {simpan.isPending ? "Menyimpan…" : id ? "Simpan perubahan" : "Buat produk"}
          </button>
        </form>
      </section>
      {id && detail.data && <BagianSku produkId={id} sku={detail.data.sku} sumber={sumber} />}
    </div>
  );
}

function BagianSku({
  produkId,
  sku,
  sumber,
}: {
  produkId: string;
  sku: Sku[];
  sumber: "local" | "gudang";
}) {
  const qc = useQueryClient();
  const segarkan = () => qc.invalidateQueries({ queryKey: ["admin", "produk"] });
  const tambah = useMutation({
    mutationFn: (d: Record<string, unknown>) => apiAdmin.buatSku(produkId, d),
    onSuccess: segarkan,
  });

  return (
    <section className="l-stack" aria-labelledby="judul-sku">
      <h2 id="judul-sku">SKU & satuan jual</h2>
      {sku.length === 0 && <p>Belum ada SKU.</p>}
      {sku.map((s) => (
        <KartuSku key={s.id} sku={s} sumber={sumber} onBerubah={segarkan} />
      ))}
      <form
        className="card l-stack"
        aria-label="Tambah SKU"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          tambah.mutate(
            {
              kodeSku: teks(f, "kodeSku"),
              barcode: teks(f, "barcode"),
              namaVarian: teks(f, "namaVarian"),
              satuanDasar: teks(f, "satuanDasar"),
            },
            {
              onSuccess: () => {
                form.reset();
              },
            },
          );
        }}
      >
        <h3>Tambah SKU</h3>
        <div className="adm-grid">
          <label className="adm-field">
            <span>Kode SKU</span>
            <input
              className="input"
              name="kodeSku"
              required
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
            />
          </label>
          <label className="adm-field">
            <span>Barcode (opsional)</span>
            <input className="input" name="barcode" inputMode="numeric" pattern="[0-9]{8,14}" />
          </label>
          <label className="adm-field">
            <span>Nama varian (opsional)</span>
            <input className="input" name="namaVarian" maxLength={100} />
          </label>
          <label className="adm-field">
            <span>Satuan dasar stok</span>
            <select className="input" name="satuanDasar" defaultValue="pcs">
              <option value="pcs">pcs</option>
              <option value="gram">gram</option>
              <option value="ml">ml</option>
            </select>
          </label>
        </div>
        <Galat err={tambah.error} />
        <button className="btn btn--secondary" disabled={tambah.isPending}>
          Tambah SKU
        </button>
      </form>
    </section>
  );
}

const JENIS: JenisSatuan[] = ["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"];

function KartuSku({
  sku,
  sumber,
  onBerubah,
}: {
  sku: Sku;
  sumber: "local" | "gudang";
  onBerubah: () => Promise<void>;
}) {
  const [jenis, setJenis] = useState<JenisSatuan>("PCS_1");
  const ubahSku = useMutation({
    mutationFn: (d: Record<string, unknown>) => apiAdmin.ubahSku(sku.id, d),
    onSuccess: onBerubah,
  });
  const tambahSatuan = useMutation({
    mutationFn: (d: Record<string, unknown>) => apiAdmin.buatSatuan(sku.id, d),
    onSuccess: onBerubah,
  });
  const ubahSatuan = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Record<string, unknown> }) =>
      apiAdmin.ubahSatuan(id, d),
    onSuccess: onBerubah,
  });
  const dipakai = new Set(sku.satuan.map((x) => x.jenis));
  const isiBebas = jenis === "DUS" || jenis === "KOLI";

  return (
    <article className="card l-stack" aria-label={`SKU ${sku.kodeSku}`}>
      <div className="adm-judul">
        <h3>
          {sku.kodeSku}
          {sku.namaVarian ? ` · ${sku.namaVarian}` : ""}
        </h3>
        <span className="l-cluster">
          <span className="chip">{sku.satuanDasar}</span>
          {sku.barcode && <span className="chip">{sku.barcode}</span>}
          <span className={sku.aktifDiSumber ? "chip chip--success" : "chip"}>
            {sku.aktifDiSumber ? "Aktif" : "Nonaktif"}
          </span>
          {sumber === "local" && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={ubahSku.isPending}
              onClick={() => {
                ubahSku.mutate({ aktif: !sku.aktifDiSumber });
              }}
            >
              {sku.aktifDiSumber ? "Nonaktifkan" : "Aktifkan"}
            </button>
          )}
        </span>
      </div>
      <Galat err={ubahSku.error} />

      <table className="adm-tabel">
        <thead>
          <tr>
            <th scope="col">Satuan jual</th>
            <th scope="col">Isi ({sku.satuanDasar})</th>
            <th scope="col">Berat (gram)</th>
            <th scope="col">Tayang</th>
            <th scope="col">
              <span className="sr-only">Aksi</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sku.satuan.map((x) => (
            <tr key={x.id}>
              <td data-label="Satuan jual">{LABEL_SATUAN[x.jenis]}</td>
              <td data-label="Isi">
                {x.jenis === "DUS" || x.jenis === "KOLI" ? (
                  <input
                    className="input adm-angka"
                    form={`satuan-${x.id}`}
                    name="isi"
                    type="number"
                    min={2}
                    defaultValue={x.isiSatuanDasar}
                    aria-label={`Isi ${LABEL_SATUAN[x.jenis]}`}
                  />
                ) : (
                  x.isiSatuanDasar
                )}
              </td>
              <td data-label="Berat (gram)">
                <input
                  className="input adm-angka"
                  form={`satuan-${x.id}`}
                  name="berat"
                  type="number"
                  min={0}
                  defaultValue={x.beratGram}
                  aria-label={`Berat ${LABEL_SATUAN[x.jenis]} (gram)`}
                />
              </td>
              <td data-label="Tayang">
                {x.tayang ? "Ya" : "Belum"}
                {!x.tayang && x.alasanTidakTayang.length > 0 && (
                  <span className="adm-catatan"> ({x.alasanTidakTayang.join(", ")})</span>
                )}
              </td>
              <td>
                <form
                  id={`satuan-${x.id}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const isi = f.get("isi");
                    ubahSatuan.mutate({
                      id: x.id,
                      d: {
                        beratGram: Number(f.get("berat")),
                        ...(isi !== null ? { isiSatuanDasar: Number(isi) } : {}),
                      },
                    });
                  }}
                >
                  <button className="btn btn--ghost" disabled={ubahSatuan.isPending}>
                    Simpan
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Galat err={ubahSatuan.error} />

      {dipakai.size < JENIS.length && (
        <form
          className="l-cluster adm-tambah-satuan"
          aria-label={`Tambah satuan jual ${sku.kodeSku}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            tambahSatuan.mutate({
              jenis,
              beratGram: Number(f.get("beratGram")),
              ...(isiBebas ? { isiSatuanDasar: Number(f.get("isiSatuanDasar")) } : {}),
            });
          }}
        >
          <label className="adm-field">
            <span>Satuan</span>
            <select
              className="input"
              value={jenis}
              onChange={(e) => {
                setJenis(e.target.value as JenisSatuan);
              }}
            >
              {JENIS.filter((j) => !dipakai.has(j)).map((j) => (
                <option key={j} value={j}>
                  {LABEL_SATUAN[j]}
                </option>
              ))}
            </select>
          </label>
          {isiBebas && (
            <label className="adm-field">
              <span>Isi per {LABEL_SATUAN[jenis].toLowerCase()}</span>
              <input
                className="input adm-angka"
                name="isiSatuanDasar"
                type="number"
                min={2}
                required
              />
            </label>
          )}
          <label className="adm-field">
            <span>Berat (gram)</span>
            <input className="input adm-angka" name="beratGram" type="number" min={0} required />
          </label>
          <button className="btn btn--secondary" disabled={tambahSatuan.isPending}>
            Tambah satuan
          </button>
          <Galat err={tambahSatuan.error} />
        </form>
      )}
    </article>
  );
}
