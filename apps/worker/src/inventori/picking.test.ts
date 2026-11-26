// Tes unit pengirim outbox picking (T-019) dengan repo & InventorySource palsu.
import type { EntriOutboxPicking, InventorySource, RepoOutboxPicking } from "@nekat/domain";
import { InventoryError, type HasilPicking, type PermintaanPicking } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { kirimOutboxPicking, LEASE_PICKING_MS } from "./picking.js";

const GRUP = "0190c000-0000-7000-8000-000000000001";
const KINI = new Date("2026-11-26T05:00:00Z");
const req: PermintaanPicking = {
  grupId: GRUP,
  lokasiId: "0190b000-0000-7000-8000-000000000001",
  kunciIdempotensi: `picking:${GRUP}:v1`,
  slotKirim: { tanggal: "2026-11-27", mulai: "09:00", selesai: "12:00" },
  baris: [
    {
      anggotaId: "a-1",
      skuId: "0190a000-0000-7000-8000-00000000000a",
      qty: 2,
      caraKirim: "DROP_POINT",
      dropPointId: "dp-1",
    },
  ],
};

function entri(ubah: Partial<EntriOutboxPicking> = {}): EntriOutboxPicking {
  return {
    id: "ob-1",
    kunciIdempotensi: req.kunciIdempotensi,
    payload: req,
    percobaan: 1,
    dibuatPada: new Date(KINI.getTime() - 60_000),
    ...ubah,
  };
}

function repoPalsu(daftar: EntriOutboxPicking[]) {
  const log: string[] = [];
  const repo: RepoOutboxPicking & { log: string[]; jadwal: Date[]; lease: number[] } = {
    log,
    jadwal: [],
    lease: [],
    antrekan: () => Promise.resolve({ baru: true }),
    klaim(_b, _s, leaseMs) {
      repo.lease.push(leaseMs);
      return Promise.resolve(daftar.splice(0));
    },
    tandaiTerkirim(id, h) {
      log.push(`terkirim:${id}:${h.status}:${String(h.referensiSumber)}`);
      return Promise.resolve();
    },
    jadwalkanUlang(id, kapan, kode) {
      repo.jadwal.push(kapan);
      log.push(`ulang:${id}:${kode}`);
      return Promise.resolve();
    },
    tandaiGagal(id, kode, jenis) {
      log.push(`gagal:${id}:${kode}:${jenis}`);
      return Promise.resolve();
    },
  };
  return repo;
}

function inventory(f: (r: PermintaanPicking) => Promise<HasilPicking>): InventorySource {
  const tolak = () => Promise.reject(new Error("tidak dipakai"));
  return {
    nama: "gudang",
    listSku: tolak,
    getStok: tolak,
    getHargaModal: tolak,
    konfirmasiStok: tolak,
    kirimPermintaanPicking: f,
  };
}

const opsi = (repo: RepoOutboxPicking, inv: InventorySource) => ({
  repo,
  inventory: inv,
  sekarang: () => KINI,
  acak: () => 0,
});

describe("kirimOutboxPicking", () => {
  it("terkirim → TERKIRIM dengan referensi Gudang; klaim memakai lease", async () => {
    const repo = repoPalsu([entri()]);
    const h = await kirimOutboxPicking(
      opsi(
        repo,
        inventory((r) =>
          Promise.resolve({ grupId: r.grupId, status: "DITERIMA", referensiSumber: "PK-1" }),
        ),
      ),
    );
    expect(h).toEqual({ terkirim: 1, dijadwalkanUlang: 0, gagal: 0 });
    expect(repo.log).toEqual(["terkirim:ob-1:DITERIMA:PK-1"]);
    expect(repo.lease).toEqual([LEASE_PICKING_MS]);
  });

  it("Gudang tak terjangkau → dijadwalkan ulang dengan backoff eksponensial", async () => {
    const repo = repoPalsu([entri({ percobaan: 1 }), entri({ id: "ob-2", percobaan: 4 })]);
    const h = await kirimOutboxPicking(
      opsi(
        repo,
        inventory(() => Promise.reject(new InventoryError("SUMBER_TIDAK_TERJANGKAU", "x"))),
      ),
    );
    expect(h.dijadwalkanUlang).toBe(2);
    expect(repo.jadwal.map((d) => d.getTime() - KINI.getTime())).toEqual([30_000, 240_000]);
    expect(repo.log[0]).toBe("ulang:ob-1:SUMBER_TIDAK_TERJANGKAU");
  });

  it("DIBATASI: Retry-After lebih lama dari backoff dihormati", async () => {
    const repo = repoPalsu([entri()]);
    await kirimOutboxPicking(
      opsi(
        repo,
        inventory(() =>
          Promise.reject(new InventoryError("DIBATASI", "x", { retrySetelahDetik: 50 })),
        ),
      ),
    );
    expect(repo.jadwal[0]?.getTime()).toBe(KINI.getTime() + 50_000);
  });

  it("lewat 6 jam sejak masuk outbox → GAGAL + antrean PICKING_GAGAL", async () => {
    const lama = entri({ percobaan: 20, dibuatPada: new Date(KINI.getTime() - 6 * 3_600_000) });
    const repo = repoPalsu([lama]);
    const h = await kirimOutboxPicking(
      opsi(
        repo,
        inventory(() => Promise.reject(new InventoryError("SUMBER_TIDAK_TERJANGKAU", "x"))),
      ),
    );
    expect(h.gagal).toBe(1);
    expect(repo.log).toEqual(["gagal:ob-1:SUMBER_TIDAK_TERJANGKAU:PICKING_GAGAL"]);
  });

  it("DITOLAK / DATA_TIDAK_VALID → GAGAL tanpa retry; KONFLIK → antrean KONFLIK_IDEMPOTENSI", async () => {
    for (const [kode, jenis] of [
      ["DITOLAK", "PICKING_GAGAL"],
      ["DATA_TIDAK_VALID", "PICKING_GAGAL"],
      ["KONFLIK_IDEMPOTENSI", "KONFLIK_IDEMPOTENSI"],
    ] as const) {
      const repo = repoPalsu([entri()]);
      await kirimOutboxPicking(
        opsi(
          repo,
          inventory(() => Promise.reject(new InventoryError(kode, "x"))),
        ),
      );
      expect(repo.log).toEqual([`gagal:ob-1:${kode}:${jenis}`]);
    }
  });

  it("payload rusak / kunci tidak cocok → GAGAL tanpa memanggil sumber", async () => {
    let dipanggil = 0;
    const inv = inventory(() => {
      dipanggil++;
      return Promise.reject(new Error("tidak boleh"));
    });
    const repo = repoPalsu([
      entri({ payload: { ...req, nama: "Bu Sari" } }),
      entri({ id: "ob-2", kunciIdempotensi: `picking:${GRUP}:v9` }),
    ]);
    const h = await kirimOutboxPicking(opsi(repo, inv));
    expect(h.gagal).toBe(2);
    expect(dipanggil).toBe(0);
  });
});
