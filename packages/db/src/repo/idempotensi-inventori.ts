// Penyimpan idempotensi tahan lama untuk `InventorySource` (tindak lanjut T-018): tabel `idempotensi_inventori`.
// Atomik lintas proses API/worker: `INSERT ... ON CONFLICT DO NOTHING`, lalu baca entri pertama yang menang.
// `hasil` disimpan sebagai jsonb → hanya nilai JSON (string/number/boolean/null/objek/array); `Date` tidak dipakai
// di hasil InventorySource (waktu berupa string ISO, T-009).
import type { EntriIdempotensi, PenyimpanIdempotensi } from "@nekat/domain";
import { and, eq } from "drizzle-orm";
import type { Db } from "../koneksi.js";
import { idempotensiInventori } from "../skema/index.js";

export function buatPenyimpanIdempotensiPg(db: Db): PenyimpanIdempotensi {
  return {
    async simpanBilaBelumAda<T>(
      ruang: "konfirmasi" | "picking",
      kunci: string,
      entri: EntriIdempotensi<T>,
    ): Promise<{ baru: boolean; entri: EntriIdempotensi<T> }> {
      const masuk = await db
        .insert(idempotensiInventori)
        .values({ ruang, kunci, hash: entri.hash, hasil: entri.hasil })
        .onConflictDoNothing()
        .returning({ kunci: idempotensiInventori.kunci });
      if (masuk.length > 0) return { baru: true, entri };

      const [lama] = await db
        .select({ hash: idempotensiInventori.hash, hasil: idempotensiInventori.hasil })
        .from(idempotensiInventori)
        .where(and(eq(idempotensiInventori.ruang, ruang), eq(idempotensiInventori.kunci, kunci)));
      // Tidak mungkin terjadi kecuali baris dihapus (retensi) di antara dua query: anggap konflik keras.
      if (!lama) throw new Error("Entri idempotensi hilang setelah konflik insert");
      return { baru: false, entri: { hash: lama.hash, hasil: lama.hasil as T } };
    },

    async ambil<T>(
      ruang: "konfirmasi" | "picking",
      kunci: string,
    ): Promise<EntriIdempotensi<T> | null> {
      const [lama] = await db
        .select({ hash: idempotensiInventori.hash, hasil: idempotensiInventori.hasil })
        .from(idempotensiInventori)
        .where(and(eq(idempotensiInventori.ruang, ruang), eq(idempotensiInventori.kunci, kunci)));
      return lama ? { hash: lama.hash, hasil: lama.hasil as T } : null;
    },
  };
}
