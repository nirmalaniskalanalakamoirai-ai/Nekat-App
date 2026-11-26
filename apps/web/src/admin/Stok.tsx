// Stok per gudang (T-036). INVENTORY_SOURCE=local → bisa diubah (alasan wajib, tercatat di log);
// gudang → hanya baca (sumber kebenaran stok = API Gudang).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiAdmin, GalatAdmin, nilaiForm, type BarisStok } from "./api";
import { Paginasi } from "./Paginasi";

const fmtWaktu = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function HalamanStok() {
  const gudang = useQuery({ queryKey: ["admin", "gudang"], queryFn: apiAdmin.gudang });
  const [gudangId, setGudangId] = useState<string | null>(null);
  const [cari, setCari] = useState("");
  const [halaman, setHalaman] = useState(1);
  const pilihan = gudangId ?? gudang.data?.gudang[0]?.id ?? null;
  const stok = useQuery({
    queryKey: ["admin", "stok", pilihan, cari, halaman],
    queryFn: () => apiAdmin.stok(pilihan ?? "", cari, halaman),
    enabled: pilihan !== null,
  });

  return (
    <section className="l-stack" aria-labelledby="judul-stok">
      <h1 id="judul-stok">Stok & Gudang</h1>
      {gudang.data?.gudang.length === 0 && <p>Belum ada gudang (isi dari config/lokasi.json).</p>}
      {gudang.data && gudang.data.gudang.length > 0 && (
        <div className="l-cluster">
          <label className="adm-field">
            <span>Gudang</span>
            <select
              className="input"
              value={pilihan ?? ""}
              onChange={(e) => {
                setGudangId(e.target.value);
                setHalaman(1);
              }}
            >
              {gudang.data.gudang.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nama}
                  {g.aktif ? "" : " (nonaktif)"}
                </option>
              ))}
            </select>
          </label>
          <form
            className="l-cluster"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              setCari(nilaiForm(new FormData(e.currentTarget), "cari"));
              setHalaman(1);
            }}
          >
            <label className="adm-field">
              <span>Cari produk / SKU</span>
              <input className="input adm-cari" name="cari" defaultValue={cari} />
            </label>
            <button className="btn btn--secondary">Cari</button>
          </form>
        </div>
      )}
      {stok.data && !stok.data.dapatDiubah && (
        <p className="adm-peringatan" role="status">
          Sumber stok = API Gudang. Stok hanya bisa dilihat di sini; ubah di sistem Gudang.
        </p>
      )}
      {stok.isPending && pilihan && <div className="skeleton adm-skeleton" aria-label="Memuat" />}
      {stok.error && (
        <p className="adm-galat" role="alert">
          {stok.error instanceof GalatAdmin ? stok.error.message : "Gagal memuat stok."}
        </p>
      )}
      {stok.data?.stok.length === 0 && <p>Belum ada SKU.</p>}
      {stok.data && stok.data.stok.length > 0 && (
        <table className="adm-tabel">
          <thead>
            <tr>
              <th scope="col">Produk</th>
              <th scope="col">Kode SKU</th>
              <th scope="col">Tersedia</th>
              <th scope="col">Data per</th>
              {stok.data.dapatDiubah && <th scope="col">Ubah stok</th>}
            </tr>
          </thead>
          <tbody>
            {stok.data.stok.map((b) => (
              <BarisStokAdmin key={b.skuId} b={b} dapatDiubah={stok.data.dapatDiubah} />
            ))}
          </tbody>
        </table>
      )}
      {stok.data && <Paginasi halaman={halaman} total={stok.data.total} onGanti={setHalaman} />}
    </section>
  );
}

function BarisStokAdmin({ b, dapatDiubah }: { b: BarisStok; dapatDiubah: boolean }) {
  const qc = useQueryClient();
  const simpan = useMutation({
    mutationFn: apiAdmin.aturStok,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "stok"] }),
  });
  return (
    <tr>
      <td data-label="Produk">
        {b.namaProduk}
        {b.namaVarian ? ` · ${b.namaVarian}` : ""}
      </td>
      <td data-label="Kode SKU">{b.kodeSku}</td>
      <td data-label="Tersedia">
        {b.tersedia === null ? "—" : `${b.tersedia.toLocaleString("id-ID")} ${b.satuanDasar}`}
      </td>
      <td data-label="Data per">{b.dataPada ? fmtWaktu.format(new Date(b.dataPada)) : "—"}</td>
      {dapatDiubah && (
        <td data-label="Ubah stok">
          <form
            className="l-cluster"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              simpan.mutate({
                skuId: b.skuId,
                gudangId: b.gudangId,
                tersedia: Number(f.get("tersedia")),
                // Kunci optimistik: nilai yang sedang dilihat (409 bila sudah diubah orang lain).
                tersediaSebelum: b.tersedia,
                alasan: nilaiForm(f, "alasan"),
              });
            }}
          >
            <input
              className="input adm-angka"
              name="tersedia"
              type="number"
              min={0}
              required
              defaultValue={b.tersedia ?? 0}
              aria-label={`Stok baru ${b.kodeSku}`}
            />
            <input
              className="input"
              name="alasan"
              required
              minLength={3}
              maxLength={500}
              placeholder="Alasan (mis. opname)"
              aria-label={`Alasan ubah stok ${b.kodeSku}`}
            />
            <button className="btn btn--secondary" disabled={simpan.isPending}>
              Simpan
            </button>
            <span role="status" aria-live="polite" className="adm-catatan">
              {simpan.isSuccess ? "Tersimpan." : ""}
            </span>
            {simpan.error && (
              <span className="adm-galat" role="alert">
                {simpan.error instanceof GalatAdmin ? simpan.error.message : "Gagal menyimpan."}
              </span>
            )}
          </form>
        </td>
      )}
    </tr>
  );
}
