// Status sesi panel admin di cache React Query (T-036).
//
// Aturan (perbaikan bug-01/bug-02 Evidence Collector):
// - Query `saya` TIDAK pernah dihapus (`removeQueries`) selagi ada observer: menghapus query yang
//   sedang berjalan membuat observer menunggu selamanya ("Memuat panel admin…" macet).
// - "Belum masuk" = `saya` berisi `null` (bukan galat). 401 di /saya bukan "sesi habis".
// - Sesi habis / keluar → `saya` di-set `null`, lalu hanya query DATA panel yang dihapus.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { aturCsrf } from "./api";

export const KUNCI_SAYA = ["admin", "saya"] as const;

function kunciSaya(k: QueryKey): boolean {
  return k.length === KUNCI_SAYA.length && k[0] === KUNCI_SAYA[0] && k[1] === KUNCI_SAYA[1];
}

/** Sesi berakhir (401 di rute data, atau setelah keluar): tampilkan form masuk. */
export function akhiriSesi(qc: QueryClient): void {
  aturCsrf(null);
  void qc.cancelQueries({ queryKey: KUNCI_SAYA });
  qc.setQueryData(KUNCI_SAYA, null);
  qc.removeQueries({ queryKey: ["admin"], predicate: (q) => !kunciSaya(q.queryKey) });
}

/** Setelah masuk berhasil: ambil ulang `saya`. */
export function mulaiSesi(qc: QueryClient, csrf: string): Promise<void> {
  aturCsrf(csrf);
  return qc.invalidateQueries({ queryKey: KUNCI_SAYA });
}
