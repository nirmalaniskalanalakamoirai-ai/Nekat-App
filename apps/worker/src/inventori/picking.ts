// Pengirim outbox picking (T-019, T-009 §5): pesanan terkonfirmasi → permintaan picking lewat
// InventorySource (LocalInventory = daftar picking internal; GudangApiInventory = kirim ke Gudang).
// Idempoten per `kunciIdempotensi` (adapter + penyimpan idempotensi). Retry berjenjang:
// 30 dtk × 2^(n−1) (maks. 30 menit) sampai 6 jam sejak masuk outbox, lalu GAGAL + antrean admin.
import { jadwalUlangPicking, type InventorySource, type RepoOutboxPicking } from "@nekat/domain";
import { InventoryError, permintaanPickingSchema } from "@nekat/shared";

/** Lease klaim > timeout panggilan picking (10 dtk) dengan cadangan. */
export const LEASE_PICKING_MS = 2 * 60_000;

export interface OpsiPicking {
  readonly inventory: InventorySource;
  readonly repo: RepoOutboxPicking;
  readonly batas?: number;
  readonly sekarang?: () => Date;
  readonly acak?: () => number;
}

export interface HasilPutaranPicking {
  readonly terkirim: number;
  readonly dijadwalkanUlang: number;
  readonly gagal: number;
}

export async function kirimOutboxPicking(o: OpsiPicking): Promise<HasilPutaranPicking> {
  const sekarang = o.sekarang ?? (() => new Date());
  const acak = o.acak ?? Math.random;
  const entri = await o.repo.klaim(o.batas ?? 20, sekarang(), LEASE_PICKING_MS);
  let terkirim = 0;
  let dijadwalkanUlang = 0;
  let gagal = 0;

  for (const e of entri) {
    const req = permintaanPickingSchema.safeParse(e.payload);
    if (!req.success || req.data.kunciIdempotensi !== e.kunciIdempotensi) {
      await o.repo.tandaiGagal(e.id, "DATA_TIDAK_VALID", "PICKING_GAGAL");
      gagal++;
      continue;
    }
    try {
      const hasil = await o.inventory.kirimPermintaanPicking(req.data);
      await o.repo.tandaiTerkirim(e.id, hasil, sekarang());
      terkirim++;
    } catch (err) {
      const ie = err instanceof InventoryError ? err : null;
      if (ie?.kode === "KONFLIK_IDEMPOTENSI") {
        // Grup tidak diproses ulang otomatis (T-009 §4).
        await o.repo.tandaiGagal(e.id, ie.kode, "KONFLIK_IDEMPOTENSI");
        gagal++;
        continue;
      }
      // Galat tak dikenal (mis. DB idempotensi putus) diperlakukan bisa diulang.
      const bolehUlang = ie === null || ie.bolehRetry;
      const kode = ie?.kode ?? "GALAT_LAIN";
      const lagi = bolehUlang
        ? jadwalUlangPicking(e.percobaan, e.dibuatPada, sekarang(), acak())
        : null;
      if (lagi === null) {
        await o.repo.tandaiGagal(e.id, kode, "PICKING_GAGAL");
        gagal++;
      } else {
        // DIBATASI: hormati Retry-After bila lebih lama dari backoff.
        const minimal =
          ie?.retrySetelahDetik != null ? sekarang().getTime() + ie.retrySetelahDetik * 1000 : 0;
        await o.repo.jadwalkanUlang(e.id, new Date(Math.max(lagi.getTime(), minimal)), kode);
        dijadwalkanUlang++;
      }
    }
  }
  return { terkirim, dijadwalkanUlang, gagal };
}
