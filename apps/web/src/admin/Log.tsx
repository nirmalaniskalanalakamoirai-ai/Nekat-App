// Log perubahan admin (log_admin, append-only): siapa, kapan, apa, sebelum → sesudah, alasan.
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiAdmin, GalatAdmin, LABEL_ENTITAS, type BarisLog } from "./api";

const fmtWaktu = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Jakarta",
});

const tampil = (v: unknown) => (v === null || v === undefined ? "—" : JSON.stringify(v));

/** Field yang berubah (baris baru: semua field sesudah). */
export function perubahan(l: Pick<BarisLog, "sebelum" | "sesudah">) {
  const sebelum = l.sebelum ?? {};
  const sesudah = l.sesudah ?? {};
  const kunci = [...new Set([...Object.keys(sebelum), ...Object.keys(sesudah)])].sort();
  return kunci
    .filter((k) => l.sebelum === null || JSON.stringify(sebelum[k]) !== JSON.stringify(sesudah[k]))
    .map((k) => ({
      field: k,
      sebelum: l.sebelum === null ? null : sebelum[k],
      sesudah: sesudah[k],
    }));
}

export function HalamanLog() {
  const q = useInfiniteQuery({
    queryKey: ["admin", "log"],
    queryFn: ({ pageParam }) => apiAdmin.log(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (h) => h.berikutnya ?? undefined,
  });
  const semua = q.data?.pages.flatMap((p) => p.log) ?? [];

  return (
    <section className="l-stack" aria-labelledby="judul-log">
      <h1 id="judul-log">Log perubahan</h1>
      <p className="adm-catatan">
        Semua perubahan produk, SKU, satuan jual, dan stok. Tidak bisa diubah atau dihapus.
      </p>
      {q.isPending && <div className="skeleton adm-skeleton" aria-label="Memuat" />}
      {q.error && (
        <p className="adm-galat" role="alert">
          {q.error instanceof GalatAdmin ? q.error.message : "Gagal memuat log."}
        </p>
      )}
      {q.data && semua.length === 0 && <p>Belum ada perubahan.</p>}
      <ol className="adm-log l-stack">
        {semua.map((l) => (
          <li key={l.id} className="card l-stack adm-log__item">
            <p className="adm-log__kepala">
              <strong>{LABEL_ENTITAS[l.entitasJenis] ?? l.entitasJenis}</strong>{" "}
              {l.sebelum === null ? "dibuat" : "diubah"} oleh {l.adminNama} ·{" "}
              <time dateTime={l.waktu}>{fmtWaktu.format(new Date(l.waktu))}</time>
            </p>
            {l.alasan && <p>Alasan: {l.alasan}</p>}
            <dl className="adm-log__beda">
              {perubahan(l).map((p) => (
                <div key={p.field}>
                  <dt>{p.field}</dt>
                  <dd>
                    {l.sebelum !== null && (
                      <>
                        <del>{tampil(p.sebelum)}</del> →{" "}
                      </>
                    )}
                    <ins>{tampil(p.sesudah)}</ins>
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
      {q.hasNextPage && (
        <button
          type="button"
          className="btn btn--secondary"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {q.isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}
        </button>
      )}
    </section>
  );
}
