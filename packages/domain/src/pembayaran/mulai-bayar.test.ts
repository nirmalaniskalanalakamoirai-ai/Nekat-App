// Unit tes aturan & use case mulaiBayar dengan repo memori + gateway tiruan (tanpa DB/HTTP).
import { keRupiah } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { cekBolehBayar, GalatBayar, kunciBayar, keteranganTagihan } from "./aturan.js";
import { LayananBayar } from "./mulai-bayar.js";
import {
  GalatGateway,
  type HasilCekStatus,
  type PaymentGateway,
  type PembayaranTersimpan,
  type RepoPembayaran,
  type TagihanUntukBayar,
} from "./port.js";

const SEKARANG = new Date("2026-11-27T09:30:00Z");
const tagihan = (o: Partial<TagihanUntukBayar> = {}): TagihanUntukBayar => ({
  id: "inv-1",
  nomor: "INV-1",
  status: "DITERBITKAN",
  totalRp: keRupiah(100),
  saldoDipakaiRp: keRupiah(0),
  sisaBayarRp: keRupiah(100),
  kedaluwarsaPada: new Date("2026-11-27T10:00:00Z"),
  gabungan: false,
  jenis: "GRUP",
  ...o,
});

function kodeGalat(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof GalatBayar) return e.kode;
    throw e;
  }
  return "TIDAK_GAGAL";
}

describe("cekBolehBayar", () => {
  const cek = (t: TagihanUntukBayar, m: string, k: string | null, s = SEKARANG) =>
    kodeGalat(() => {
      cekBolehBayar(t, m, k, s, ["BNI"]);
    });
  it("status, kedaluwarsa, sisa bayar", () => {
    expect(cek(tagihan(), "QRIS", null)).toBe("TIDAK_GAGAL");
    expect(cek(tagihan({ status: "LUNAS" }), "QRIS", null)).toBe("SUDAH_LUNAS");
    expect(cek(tagihan({ status: "KEDALUWARSA" }), "QRIS", null)).toBe("TAGIHAN_TIDAK_AKTIF");
    expect(cek(tagihan({ status: "DIGANTI" }), "QRIS", null)).toBe("TAGIHAN_TIDAK_AKTIF");
    expect(cek(tagihan(), "QRIS", null, new Date("2026-11-27T10:00:00Z"))).toBe(
      "TAGIHAN_KEDALUWARSA",
    );
    expect(cek(tagihan({ sisaBayarRp: keRupiah(0) }), "QRIS", null)).toBe("SUDAH_LUNAS");
  });
  it("K-36: grup hanya QRIS/VA; VA wajib bank terdaftar; QRIS tanpa bank", () => {
    expect(cek(tagihan(), "EWALLET", null)).toBe("METODE_TIDAK_DIIZINKAN");
    expect(cek(tagihan(), "VA", null)).toBe("KANAL_TIDAK_VALID");
    expect(cek(tagihan(), "VA", "BCA")).toBe("KANAL_TIDAK_VALID");
    expect(cek(tagihan(), "VA", "BNI")).toBe("TIDAK_GAGAL");
    expect(cek(tagihan(), "QRIS", "BNI")).toBe("KANAL_TIDAK_VALID");
  });
  it("kunci idempotensi & keterangan tanpa PII", () => {
    expect(kunciBayar("inv-1", 2)).toBe("bayar:inv-1:2");
    expect(() => kunciBayar("inv-1", 0)).toThrow();
    expect(keteranganTagihan("INV-9")).toBe("Tagihan NEKAT INV-9");
  });
});

/** Repo memori sederhana: satu invoice, aturan sama dengan repo DB (tanpa kunci nyata). */
function repoMemori(t = tagihan()) {
  const baris: PembayaranTersimpan[] = [];
  const repo: RepoPembayaran = {
    siapkan(i) {
      cekBolehBayar(t, i.metode, i.kanal, i.sekarang, i.kanalVaDiizinkan);
      const hidup = baris.find((b) => b.status === "MENUNGGU");
      if (hidup) {
        return Promise.resolve(
          hidup.metode === i.metode && hidup.kanal === i.kanal
            ? { jenis: "ADA" as const, tagihan: t, pembayaran: hidup }
            : { jenis: "GANTI" as const, tagihan: t, lama: hidup },
        );
      }
      const p: PembayaranTersimpan = {
        id: `p-${String(baris.length + 1)}`,
        invoiceId: t.id,
        metode: i.metode,
        kanal: i.kanal,
        jumlahRp: t.sisaBayarRp,
        status: "MENUNGGU",
        xenditRef: null,
        instruksi: null,
        kedaluwarsaPada: t.kedaluwarsaPada,
        kunciIdempotensi: kunciBayar(t.id, baris.length + 1),
        alasanGagal: null,
      };
      baris.push(p);
      return Promise.resolve({ jenis: "BARU" as const, tagihan: t, pembayaran: p });
    },
    simpanHasilBuat(id, h) {
      const i = baris.findIndex((b) => b.id === id && b.status === "MENUNGGU");
      const lama = baris[i];
      if (!lama) return Promise.resolve(null);
      const baru = { ...lama, xenditRef: h.xenditRef, instruksi: h.instruksi };
      baris[i] = baru;
      return Promise.resolve(baru);
    },
    tandaiGagal(id, alasan) {
      const i = baris.findIndex((b) => b.id === id && b.status === "MENUNGGU");
      const lama = baris[i];
      if (lama) baris[i] = { ...lama, status: "GAGAL", alasanGagal: alasan };
      return Promise.resolve(lama !== undefined);
    },
    tutupUntukGanti(id) {
      const i = baris.findIndex((b) => b.id === id && b.status === "MENUNGGU");
      const lama = baris[i];
      if (lama) baris[i] = { ...lama, status: "KEDALUWARSA" };
      return Promise.resolve(lama !== undefined);
    },
    baca() {
      return Promise.resolve({ tagihan: t, pembayaran: baris.at(-1) ?? null });
    },
  };
  return { repo, baris };
}

function gatewayTiruan(
  o: { buat?: () => Promise<void>; cek?: () => Promise<HasilCekStatus> } = {},
) {
  const hitung = { buat: 0, cek: 0, batal: 0 };
  const gw: PaymentGateway = {
    nama: "palsu",
    mode: "test",
    kanalVa: ["BNI"],
    async buatPembayaran(p) {
      hitung.buat++;
      await (o.buat?.() ?? Promise.resolve());
      return {
        xenditRef: `ref-${p.pembayaranId}`,
        instruksi: { jenis: "QRIS", qrString: "QR" },
        kedaluwarsaPada: p.kedaluwarsaPada,
      };
    },
    async cekStatus() {
      hitung.cek++;
      return o.cek ? o.cek() : { ditemukan: false };
    },
    batalkan() {
      hitung.batal++;
      return Promise.resolve();
    },
    kedaluwarsakan() {
      return Promise.resolve();
    },
  };
  return { gw, hitung };
}

const input = { invoiceId: "inv-1", akunId: "akun-1", metode: "QRIS" as const, kanal: null };

describe("LayananBayar", () => {
  it("gateway belum dikonfigurasi → GATEWAY_TIDAK_AKTIF (fail closed)", async () => {
    const l = new LayananBayar({ repo: repoMemori().repo, gateway: null, namaMerchant: "PT Uji" });
    await expect(l.mulaiBayar(input)).rejects.toMatchObject({ kode: "GATEWAY_TIDAK_AKTIF" });
  });

  it("single-flight: POST bersamaan di satu proses → satu panggilan buat", async () => {
    const { repo, baris } = repoMemori();
    let lepas: () => void = () => undefined;
    const tahan = new Promise<void>((s) => {
      lepas = s;
    });
    const { gw, hitung } = gatewayTiruan({ buat: () => tahan });
    const l = new LayananBayar({ repo, gateway: gw, namaMerchant: "PT Uji", jam: () => SEKARANG });
    const a = l.mulaiBayar(input);
    await Promise.resolve();
    const b = l.mulaiBayar(input);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    lepas();
    const [ha, hb] = await Promise.all([a, b]);
    expect(hitung.buat).toBe(1);
    expect(ha.pembayaran.instruksi).toEqual(hb.pembayaran.instruksi);
    expect(baris).toHaveLength(1);
  });

  it("upaya lama EXPIRED di gateway padahal invoice hidup → ditutup, upaya baru n+1", async () => {
    const { repo, baris } = repoMemori();
    let pertama = true;
    const { gw } = gatewayTiruan({
      buat: () => {
        if (pertama) {
          pertama = false;
          return Promise.reject(new GalatGateway("TIMEOUT", "uji"));
        }
        return Promise.resolve();
      },
      cek: () =>
        Promise.resolve({
          ditemukan: true,
          statusNormal: "EXPIRED",
          jumlahRp: 100,
          mataUang: "IDR",
          externalId: "p-1",
          paidAt: null,
          xenditRef: "ref-x",
          instruksi: null,
        }),
    });
    const l = new LayananBayar({ repo, gateway: gw, namaMerchant: "PT Uji", jam: () => SEKARANG });
    expect((await l.mulaiBayar(input)).hasil).toBe("MENYIAPKAN");
    const h = await l.mulaiBayar(input);
    expect(h.hasil).toBe("OK");
    expect(baris.map((b) => [b.status, b.kunciIdempotensi])).toEqual([
      ["KEDALUWARSA", "bayar:inv-1:1"],
      ["MENUNGGU", "bayar:inv-1:2"],
    ]);
  });

  it("DITOLAK (validasi lain) → GAGAL DITOLAK_GATEWAY; galat non-gateway diteruskan", async () => {
    const { repo, baris } = repoMemori();
    const { gw } = gatewayTiruan({
      buat: () => Promise.reject(new GalatGateway("DITOLAK", "uji")),
    });
    const l = new LayananBayar({ repo, gateway: gw, namaMerchant: "PT Uji", jam: () => SEKARANG });
    const h = await l.mulaiBayar(input);
    expect(h.hasil).toBe("METODE_GAGAL");
    expect(baris[0]).toMatchObject({ status: "GAGAL", alasanGagal: "DITOLAK_GATEWAY" });

    const r2 = repoMemori();
    const { gw: gw2 } = gatewayTiruan({ buat: () => Promise.reject(new Error("bug")) });
    const l2 = new LayananBayar({
      repo: r2.repo,
      gateway: gw2,
      namaMerchant: "PT Uji",
      jam: () => SEKARANG,
    });
    await expect(l2.mulaiBayar(input)).rejects.toThrow("bug");
  });

  it("log peristiwa yang gagal tidak menggagalkan alur", async () => {
    const { gw } = gatewayTiruan();
    const l = new LayananBayar({
      repo: repoMemori().repo,
      gateway: gw,
      namaMerchant: "PT Uji",
      jam: () => SEKARANG,
      catat: () => {
        throw new Error("log mati");
      },
    });
    expect((await l.mulaiBayar(input)).hasil).toBe("OK");
  });
});
