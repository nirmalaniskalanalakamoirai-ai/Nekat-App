// Tes status sesi panel admin dengan QueryClient nyata + fetch palsu (bug-01/bug-02 Evidence Collector).
// Dijalankan di Node: QueryObserver = yang dipakai useQuery di AdminApp.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiAdmin, aturSaatSesiHabis, type Saya } from "./api";
import { akhiriSesi, KUNCI_SAYA, mulaiSesi } from "./sesi";
import { isiBebas, jenisTerpilih, jenisTersedia } from "./satuan";

const SAYA: Saya = {
  admin: { id: "a1", nama: "Admin Uji", peran: ["owner"], izin: ["produk.ubah"] },
  csrfToken: "csrf-uji",
  sesiBerakhir: "2026-11-27T10:00:00Z",
  sumberInventori: "local",
};

function json(status: number, isi: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(isi), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Observer `saya` persis seperti useQuery di AdminApp; kembalikan state terakhir. */
function amatiSaya(qc: QueryClient) {
  const obs = new QueryObserver<Saya | null>(qc, {
    queryKey: KUNCI_SAYA,
    queryFn: apiAdmin.saya,
    retry: false,
  });
  let terakhir = obs.getCurrentResult();
  const henti = obs.subscribe((r) => {
    terakhir = r;
  });
  return {
    get status() {
      return terakhir.status;
    },
    get data() {
      return terakhir.data;
    },
    henti,
  };
}

const tunggu = async (cek: () => boolean) => {
  for (let i = 0; i < 50 && !cek(); i++) await new Promise((s) => setTimeout(s, 5));
};

describe("sesi panel admin (bug-01, bug-02)", () => {
  let qc: QueryClient;
  let fetchPalsu: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
  beforeEach(() => {
    qc = new QueryClient();
    fetchPalsu = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal("fetch", fetchPalsu);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    aturSaatSesiHabis(null);
    qc.clear();
  });

  it("bug-01: /saya 401 → data null (form masuk), tidak macet pending, tidak memicu 'sesi habis'", async () => {
    const sesiHabis = vi.fn(() => {
      // Pola lama yang membuat macet: menghapus query yang sedang berjalan.
      akhiriSesi(qc);
    });
    aturSaatSesiHabis(sesiHabis);
    fetchPalsu.mockResolvedValue(json(401, { kode: "PERLU_MASUK", pesan: "x" }));
    const o = amatiSaya(qc);
    await tunggu(() => o.status !== "pending");
    expect(o.status).toBe("success");
    expect(o.data).toBeNull();
    expect(sesiHabis).not.toHaveBeenCalled();
    o.henti();
  });

  it("401 di rute data saat `saya` sedang dimuat tidak membuat observer `saya` pending selamanya", async () => {
    let lepas: (r: Response) => void = () => undefined;
    fetchPalsu.mockImplementation((url) =>
      url.endsWith("/saya")
        ? new Promise<Response>((s) => {
            lepas = s;
          })
        : Promise.resolve(json(401, { kode: "PERLU_MASUK", pesan: "x" })),
    );
    aturSaatSesiHabis(() => {
      akhiriSesi(qc);
    });
    const o = amatiSaya(qc);
    await expect(apiAdmin.daftarProduk("", 1)).rejects.toThrow(); // memicu sesi habis
    lepas(json(401, {}));
    await tunggu(() => o.status !== "pending");
    expect(o.status).toBe("success");
    expect(o.data).toBeNull();
    o.henti();
  });

  it("bug-02: keluar → saya = null, query data panel dihapus, saya tetap ada (bisa masuk lagi)", async () => {
    fetchPalsu.mockResolvedValue(json(200, SAYA));
    const o = amatiSaya(qc);
    await tunggu(() => o.status === "success");
    expect(o.data?.admin.nama).toBe("Admin Uji");
    qc.setQueryData(["admin", "produk", "", 1], { produk: [], total: 0, halaman: 1 });

    fetchPalsu.mockResolvedValue(json(204, null));
    await apiAdmin.keluar();
    akhiriSesi(qc);
    await tunggu(() => o.data === null);
    expect(o.data).toBeNull(); // UI menampilkan form masuk, bukan nama admin
    expect(qc.getQueryData(["admin", "produk", "", 1])).toBeUndefined();
    expect(qc.getQueryCache().find({ queryKey: KUNCI_SAYA })).toBeDefined();

    // Masuk lagi → saya diambil ulang dan observer yang sama mendapat data baru.
    fetchPalsu.mockResolvedValue(json(200, SAYA));
    await mulaiSesi(qc, "csrf-baru");
    await tunggu(() => o.data !== null);
    expect(o.data?.admin.id).toBe("a1");
    o.henti();
  });
});

describe("pilihan satuan jual (bug-03)", () => {
  it("pilihan yang sudah dipakai tidak terkirim: jenis aktif = opsi pertama yang tersedia", () => {
    const tersedia = jenisTersedia(new Set(["DUS"]));
    expect(tersedia).not.toContain("DUS");
    // State lama "DUS" (setelah DUS ditambahkan) → yang tampil & terkirim sama: PCS_1.
    expect(jenisTerpilih("DUS", tersedia)).toBe("PCS_1");
    expect(isiBebas(jenisTerpilih("DUS", tersedia))).toBe(false);
    expect(jenisTerpilih("KOLI", tersedia)).toBe("KOLI");
    expect(isiBebas("KOLI")).toBe(true);
    expect(
      jenisTerpilih("PCS_1", jenisTersedia(new Set(["PCS_1", "PCS_3", "LUSIN", "DUS", "KOLI"]))),
    ).toBeNull();
  });
});
