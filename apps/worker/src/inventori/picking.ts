// Pengirim outbox picking (T-019, T-009 §5): pesanan terkonfirmasi → permintaan picking lewat
// InventorySource (LocalInventory = daftar picking internal; GudangApiInventory = kirim ke Gudang).
// Idempoten per `kunciIdempotensi` (adapter + penyimpan idempotensi). Retry berjenjang:
// 30 dtk × 2^(n−1) (maks. 30 menit) sampai 6 jam sejak masuk outbox, lalu GAGAL + antrean admin.
import { PROFIL_GUDANG } from "@nekat/adapters";
import { jadwalUlangPicking, type InventorySource, type RepoOutboxPicking } from "@nekat/domain";
import { InventoryError, permintaanPickingSchema } from "@nekat/shared";

/** Batas entri per putaran (bawaan). */
export const BATAS_PICKING_BAWAAN = 20;
/** Cadangan per entri di atas timeout HTTP (baca/tulis DB idempotensi & outbox). */
const CADANGAN_PER_ENTRI_MS = 5_000;
const LEASE_MINIMUM_MS = 2 * 60_000;

/**
 * Lease klaim mencakup SELURUH putaran: entri diproses berurutan, jadi entri terakhir baru dikirim
 * setelah (batas − 1) entri sebelumnya. Lease = max(2 menit, batas × (timeout picking + cadangan)).
 * Bila tetap terlewat, pemeriksaan pemilik klaim di repo (status MENUNGGU + percobaan) mencegah
 * dua worker sama-sama menandai entri; pengiriman ganda ke Gudang dicegah kunci idempotensi.
 */
export function leasePicking(batas: number): number {
  return Math.max(
    LEASE_MINIMUM_MS,
    batas * (PROFIL_GUDANG.picking.timeoutMs + CADANGAN_PER_ENTRI_MS),
  );
}

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
  /** Entri yang klaimnya sudah diambil alih worker lain (lease habis); tidak diubah. */
  readonly klaimHilang: number;
}

export async function kirimOutboxPicking(o: OpsiPicking): Promise<HasilPutaranPicking> {
  const sekarang = o.sekarang ?? (() => new Date());
  const acak = o.acak ?? Math.random;
  const batas = o.batas ?? BATAS_PICKING_BAWAAN;
  const entri = await o.repo.klaim(batas, sekarang(), leasePicking(batas));
  let terkirim = 0;
  let dijadwalkanUlang = 0;
  let gagal = 0;
  let klaimHilang = 0;
  /** Hitung hasil hanya bila klaim masih dipegang. */
  const hitung = (berlaku: boolean, tambah: () => void) => {
    if (berlaku) tambah();
    else klaimHilang++;
  };

  for (const e of entri) {
    const req = permintaanPickingSchema.safeParse(e.payload);
    if (!req.success || req.data.kunciIdempotensi !== e.kunciIdempotensi) {
      hitung(await o.repo.tandaiGagal(e, "DATA_TIDAK_VALID", "PICKING_GAGAL"), () => gagal++);
      continue;
    }
    try {
      const hasil = await o.inventory.kirimPermintaanPicking(req.data);
      hitung(await o.repo.tandaiTerkirim(e, hasil, sekarang()), () => terkirim++);
    } catch (err) {
      const ie = err instanceof InventoryError ? err : null;
      if (ie?.kode === "KONFLIK_IDEMPOTENSI") {
        // Grup tidak diproses ulang otomatis (T-009 §4).
        hitung(await o.repo.tandaiGagal(e, ie.kode, "KONFLIK_IDEMPOTENSI"), () => gagal++);
        continue;
      }
      // Galat tak dikenal (mis. DB idempotensi putus) diperlakukan bisa diulang.
      const bolehUlang = ie === null || ie.bolehRetry;
      const kode = ie?.kode ?? "GALAT_LAIN";
      const lagi = bolehUlang
        ? jadwalUlangPicking(e.percobaan, e.dibuatPada, sekarang(), acak())
        : null;
      if (lagi === null) {
        hitung(await o.repo.tandaiGagal(e, kode, "PICKING_GAGAL"), () => gagal++);
      } else {
        // DIBATASI: hormati Retry-After bila lebih lama dari backoff.
        const minimal =
          ie?.retrySetelahDetik != null ? sekarang().getTime() + ie.retrySetelahDetik * 1000 : 0;
        hitung(
          await o.repo.jadwalkanUlang(e, new Date(Math.max(lagi.getTime(), minimal)), kode),
          () => dijadwalkanUlang++,
        );
      }
    }
  }
  return { terkirim, dijadwalkanUlang, gagal, klaimHilang };
}
