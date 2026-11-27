// Tes XenditGateway terhadap MOCK server lokal (bukan Xendit nyata; asumsi X-01–X-06 di xendit.ts).
import { GalatGateway, type PermintaanBuatPembayaran } from "@nekat/domain";
import { keRupiah } from "@nekat/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bacaKonfigPembayaran, KonfigPembayaranTidakValidError } from "./konfigurasi.js";
import { mulaiMockXendit, type MockXendit } from "./mock-xendit.test-util.js";
import { GatewayPalsu } from "./palsu.js";
import { buatPaymentGateway } from "./pabrik.js";
import { channelCode, normalkanStatus, XenditGateway } from "./xendit.js";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const permintaan = (o: Partial<PermintaanBuatPembayaran> = {}): PermintaanBuatPembayaran => ({
  pembayaranId: ID,
  invoiceId: "0193a1b2-c3d4-7e5f-8a9b-000000000001",
  jumlahRp: keRupiah(123_456),
  metode: "QRIS",
  kanal: null,
  kedaluwarsaPada: new Date("2026-11-27T10:00:00Z"),
  keterangan: "Tagihan NEKAT INV-1",
  namaVa: "PT Uji Merchant",
  ...o,
});

async function galat(p: Promise<unknown>): Promise<GalatGateway> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GalatGateway) return e;
    throw e;
  }
  throw new Error("diharapkan gagal");
}

describe("XenditGateway (mock lokal)", () => {
  let mock: MockXendit;
  let gw: XenditGateway;
  let idKe = 0;
  const idBaru = () => `0193a1b2-c3d4-7e5f-8a9b-${String(++idKe).padStart(12, "0")}`;

  beforeAll(async () => {
    mock = await mulaiMockXendit();
    gw = new XenditGateway({
      mode: "test",
      ambilKunci: () => mock.kunci,
      kanalVa: ["BNI", "BRI"],
      baseUrlUntukTes: mock.url,
      timeoutMs: { buat: 300, cek: 300, batal: 300 },
    });
  });
  afterAll(async () => {
    await mock.tutup();
  });
  afterEach(() => {
    mock.bersihkanGangguan();
    mock.tanpaPencarian(false);
  });

  it("QRIS: body sesuai asumsi X-02, kunci hanya di header, kedaluwarsa absolut", async () => {
    const id = idBaru();
    const h = await gw.buatPembayaran(permintaan({ pembayaranId: id }));
    expect(h.instruksi.jenis).toBe("QRIS");
    expect(h.xenditRef).toMatch(/^pr-/);
    const p = mock.permintaan.at(-1);
    expect(p?.rute).toBe("buat");
    expect(p?.body).toMatchObject({
      reference_id: id,
      type: "PAY",
      country: "ID",
      currency: "IDR",
      request_amount: 123456,
      channel_code: "QRIS",
      channel_properties: { expires_at: "2026-11-27T10:00:00.000Z" },
    });
    // QRIS tidak membawa nama; tidak ada data pembeli di body.
    expect(JSON.stringify(p?.body)).not.toMatch(/display_name|customer|phone|email/);
    expect(p?.header["idempotency-key"]).toBe(id);
    expect(p?.header["api-version"]).toBe("2024-11-11");
    expect(p?.url).not.toContain(mock.kunci);
  });

  it("VA: closed amount, nama VA = nama merchant, nomor VA dari actions", async () => {
    const id = idBaru();
    const h = await gw.buatPembayaran(permintaan({ pembayaranId: id, metode: "VA", kanal: "BNI" }));
    expect(h.instruksi).toMatchObject({
      jenis: "VA",
      bank: "BNI",
      namaPenerima: "PT Uji Merchant",
    });
    if (h.instruksi.jenis === "VA") expect(h.instruksi.nomorVa).toMatch(/^\d{6,32}$/);
    expect(mock.permintaan.at(-1)?.body).toMatchObject({
      channel_code: "BNI_VIRTUAL_ACCOUNT",
      channel_properties: { display_name: "PT Uji Merchant" },
    });
  });

  it("idempotency-key sama → tagihan yang sama (tidak ganda)", async () => {
    const id = idBaru();
    const a = await gw.buatPembayaran(permintaan({ pembayaranId: id }));
    const b = await gw.buatPembayaran(permintaan({ pembayaranId: id }));
    expect(b.xenditRef).toBe(a.xenditRef);
    expect([...mock.tagihan.values()].filter((t) => t.reference_id === id)).toHaveLength(1);
  });

  it("timeout setelah tercatat → TIMEOUT (boleh ulang); cekStatus tanpa ref menemukan lewat external_id", async () => {
    const id = idBaru();
    mock.ganggu("buat", { setelahTercatat: true, tundaMs: 600, kali: 1 });
    const e = await galat(gw.buatPembayaran(permintaan({ pembayaranId: id })));
    expect(e.kode).toBe("TIMEOUT");
    expect(e.bolehUlang).toBe(true);
    const s = await gw.cekStatus({ pembayaranId: id, xenditRef: null });
    expect(s.ditemukan).toBe(true);
    if (s.ditemukan) {
      expect(s.statusNormal).toBe("MENUNGGU");
      expect(s.externalId).toBe(id);
      expect(s.instruksi?.jenis).toBe("QRIS");
    }
    expect(mock.permintaan.at(-1)?.url).toContain(`reference_id=${id}`);
  });

  it("pencarian reference_id tidak tersedia (404) → tidak ditemukan, bukan galat", async () => {
    mock.tanpaPencarian(true);
    expect(await gw.cekStatus({ pembayaranId: idBaru(), xenditRef: null })).toEqual({
      ditemukan: false,
    });
  });

  it("cekStatus: SUCCEEDED → PAID dengan paid_at; nominal dari Xendit apa adanya (W5 di pemanggil)", async () => {
    const id = idBaru();
    const h = await gw.buatPembayaran(permintaan({ pembayaranId: id }));
    mock.bayar(id, { jumlah: 100 });
    const s = await gw.cekStatus({ pembayaranId: id, xenditRef: h.xenditRef });
    expect(s).toMatchObject({
      ditemukan: true,
      statusNormal: "PAID",
      jumlahRp: 100,
      mataUang: "IDR",
    });
    if (s.ditemukan) {
      expect(s.paidAt).toBeInstanceOf(Date);
      expect(s.instruksi).toBeNull();
    }
  });

  it("batalkan: sukses → CANCELED; kedua kali → TIDAK_AKTIF", async () => {
    const id = idBaru();
    const h = await gw.buatPembayaran(permintaan({ pembayaranId: id }));
    await gw.batalkan({ pembayaranId: id, xenditRef: h.xenditRef });
    expect((await galat(gw.batalkan({ pembayaranId: id, xenditRef: h.xenditRef }))).kode).toBe(
      "TIDAK_AKTIF",
    );
    const s = await gw.cekStatus({ pembayaranId: id, xenditRef: h.xenditRef });
    expect(s.ditemukan && s.statusNormal).toBe("EXPIRED");
  });

  it("pemetaan galat: 5xx, 429, 401, 409, nominal, redirect, respons besar, timeout", async () => {
    const kasus: [Parameters<MockXendit["ganggu"]>[1], string][] = [
      [{ status: 503, body: { error_code: "CHANNEL_UNAVAILABLE" } }, "GATEWAY_5XX"],
      [{ status: 429 }, "DIBATASI"],
      [{ status: 409, body: { error_code: "DUPLICATE_ERROR" } }, "DUPLIKAT"],
      [
        {
          status: 400,
          body: { error_code: "API_VALIDATION_ERROR", message: "request_amount too low" },
        },
        "NOMINAL_DI_BAWAH_MINIMUM",
      ],
      [
        { status: 400, body: { error_code: "API_VALIDATION_ERROR", message: "field x" } },
        "DITOLAK",
      ],
      [{ status: 403, body: { error_code: "INVALID_MERCHANT_SETTINGS" } }, "METODE_TIDAK_DIDUKUNG"],
      [{ status: 403, body: { error_code: "REQUEST_FORBIDDEN_ERROR" } }, "KONFIGURASI"],
      [{ redirect: true }, "GATEWAY_5XX"],
      [{ besarByte: 100_000 }, "RESPONS_TIDAK_VALID"],
      [{ tundaMs: 600 }, "TIMEOUT"],
    ];
    for (const [g, kode] of kasus) {
      mock.ganggu("buat", { ...g, kali: 1 });
      const e = await galat(gw.buatPembayaran(permintaan({ pembayaranId: idBaru() })));
      expect(e.kode, JSON.stringify(g)).toBe(kode);
      // Pesan galat tidak memuat kunci atau isi respons.
      expect(e.message).not.toContain(mock.kunci);
      expect(e.message).not.toMatch(/too low|field x/);
    }
  });

  it("kunci salah → KONFIGURASI (401), pesan tanpa kunci", async () => {
    const salah = new XenditGateway({
      mode: "test",
      ambilKunci: () => "xnd_development_kunciSalahYangPanjang000",
      kanalVa: ["BNI"],
      baseUrlUntukTes: mock.url,
    });
    const e = await galat(salah.buatPembayaran(permintaan({ pembayaranId: idBaru() })));
    expect(e.kode).toBe("KONFIGURASI");
    expect(e.message).not.toContain("kunciSalah");
  });

  it("e-wallet & bank tak terdaftar ditolak permanen tanpa panggilan HTTP", async () => {
    const n = mock.permintaan.length;
    expect((await galat(gw.buatPembayaran(permintaan({ metode: "EWALLET" })))).kode).toBe(
      "METODE_TIDAK_DIDUKUNG",
    );
    expect((await galat(gw.buatPembayaran(permintaan({ metode: "VA", kanal: "BCA" })))).kode).toBe(
      "METODE_TIDAK_DIDUKUNG",
    );
    expect(mock.permintaan.length).toBe(n);
  });

  it("respons tidak cocok (nominal beda) → tidak menampilkan instruksi", async () => {
    mock.ganggu("buat", {
      status: 200,
      kali: 1,
      body: {
        payment_request_id: "pr-00000000-0000-4000-8000-000000000000",
        reference_id: ID,
        status: "ACCEPTING_PAYMENTS",
        request_amount: 1,
        currency: "IDR",
        channel_code: "QRIS",
        actions: [{ descriptor: "QR_STRING", value: "x" }],
      },
    });
    expect((await galat(gw.buatPembayaran(permintaan()))).kode).toBe("RESPONS_TIDAK_VALID");
  });

  it("respons buat berstatus bukan menunggu / kanal beda → RESPONS_TIDAK_VALID (item review 4)", async () => {
    const pr = {
      payment_request_id: "pr-00000000-0000-4000-8000-000000000001",
      reference_id: ID,
      request_amount: 123456,
      currency: "IDR",
      channel_code: "QRIS",
      actions: [{ descriptor: "QR_STRING", value: "0002x" }],
    };
    for (const body of [
      { ...pr, status: "SUCCEEDED" },
      { ...pr, status: "CANCELED" },
      { ...pr, status: "ACCEPTING_PAYMENTS", channel_code: "BNI_VIRTUAL_ACCOUNT" },
    ]) {
      mock.ganggu("buat", { status: 200, kali: 1, body });
      expect((await galat(gw.buatPembayaran(permintaan()))).kode).toBe("RESPONS_TIDAK_VALID");
    }
  });

  it("cekStatus: metode & kanal dari channel_code; kanal tak dikenal → metode null tanpa instruksi", async () => {
    const id = idBaru();
    const h = await gw.buatPembayaran(permintaan({ pembayaranId: id, metode: "VA", kanal: "BRI" }));
    const s = await gw.cekStatus({ pembayaranId: id, xenditRef: h.xenditRef });
    expect(s).toMatchObject({ ditemukan: true, metode: "VA", kanal: "BRI" });
    const t = mock.cariRef(id);
    if (t) t.channel_code = "OVO";
    const s2 = await gw.cekStatus({ pembayaranId: id, xenditRef: h.xenditRef });
    expect(s2).toMatchObject({ ditemukan: true, metode: null, kanal: null, instruksi: null });
  });

  it("URL non-https ditolak kecuali host lokal untuk tes", () => {
    expect(
      () =>
        new XenditGateway({
          mode: "test",
          ambilKunci: () => "",
          kanalVa: [],
          baseUrlUntukTes: "http://contoh.id/",
        }),
    ).toThrow(/https/);
  });

  it("normalisasi status & channel code", () => {
    expect(normalkanStatus("ACCEPTING_PAYMENTS")).toBe("MENUNGGU");
    expect(normalkanStatus("SUCCEEDED")).toBe("PAID");
    expect(normalkanStatus("CANCELED")).toBe("EXPIRED");
    expect(normalkanStatus("FAILED")).toBe("FAILED");
    expect(normalkanStatus("AUTHORIZED")).toBe("LAINNYA");
    expect(channelCode("VA", "BRI")).toBe("BRI_VIRTUAL_ACCOUNT");
  });
});

describe("bacaKonfigPembayaran (pagar mode FP-02)", () => {
  const KUNCI_TEST = "xnd_development_abcdefghijklmnopqrstuvwxyz";
  const KUNCI_LIVE = "xnd_production_abcdefghijklmnopqrstuvwxyz";
  const dev = { NODE_ENV: "development" };
  const dasar = { ...dev, PEMBAYARAN_NAMA_MERCHANT: "PT Uji Merchant" };
  const salah = (env: Record<string, string>): string[] => {
    try {
      bacaKonfigPembayaran(env);
    } catch (e) {
      if (e instanceof KonfigPembayaranTidakValidError) {
        // Pesan hanya nama variabel.
        expect(e.message).not.toContain("abcdefgh");
        return [...e.variabel];
      }
      throw e;
    }
    return [];
  };

  it("bawaan nonaktif (null gateway)", () => {
    const k = bacaKonfigPembayaran(dev);
    expect(k.gateway).toBe("nonaktif");
    expect(buatPaymentGateway(k)).toBeNull();
  });

  it("non-production: kunci test diterima, kunci live ditolak", () => {
    const k = bacaKonfigPembayaran({
      ...dasar,
      PEMBAYARAN_GATEWAY: "xendit",
      XENDIT_SECRET_KEY: KUNCI_TEST,
    });
    expect(k.mode).toBe("test");
    expect(k.ambilKunci?.()).toBe(KUNCI_TEST);
    expect(JSON.stringify(k)).not.toContain(KUNCI_TEST);
    expect(buatPaymentGateway(k)?.nama).toBe("xendit");
    expect(
      salah({ ...dasar, PEMBAYARAN_GATEWAY: "xendit", XENDIT_SECRET_KEY: KUNCI_LIVE }),
    ).toEqual(["XENDIT_SECRET_KEY"]);
    // Kunci live terpasang di dev walau gateway belum aktif = salah pasang.
    expect(salah({ ...dev, XENDIT_SECRET_KEY: KUNCI_LIVE })).toEqual(["XENDIT_SECRET_KEY"]);
  });

  it("production: kunci test ditolak (TC-PAY-33), gateway palsu ditolak, kunci live diterima", () => {
    const prod = { ...dasar, NODE_ENV: "production" };
    expect(salah({ ...prod, PEMBAYARAN_GATEWAY: "xendit", XENDIT_SECRET_KEY: KUNCI_TEST })).toEqual(
      ["XENDIT_SECRET_KEY"],
    );
    expect(salah({ ...prod, XENDIT_SECRET_KEY: KUNCI_TEST })).toEqual(["XENDIT_SECRET_KEY"]);
    expect(salah({ ...prod, PEMBAYARAN_GATEWAY: "palsu" })).toEqual(["PEMBAYARAN_GATEWAY"]);
    const k = bacaKonfigPembayaran({
      ...prod,
      PEMBAYARAN_GATEWAY: "xendit",
      XENDIT_SECRET_KEY: KUNCI_LIVE,
    });
    expect(k.mode).toBe("live");
  });

  it("NODE_ENV wajib dikenal (pagar tidak gagal terbuka); palsu hanya development/test", () => {
    expect(salah({})).toEqual(["NODE_ENV"]);
    expect(salah({ NODE_ENV: "prod" })).toEqual(["NODE_ENV"]);
    expect(salah({ NODE_ENV: "Production" })).toEqual(["NODE_ENV"]);
    // NODE_ENV tak dikenal + kunci live: tetap gagal (tidak dianggap production maupun dev yang sah).
    expect(
      salah({
        ...dasar,
        NODE_ENV: "",
        PEMBAYARAN_GATEWAY: "xendit",
        XENDIT_SECRET_KEY: KUNCI_LIVE,
      }),
    ).toContain("NODE_ENV");
    const staging = { ...dasar, NODE_ENV: "staging" };
    expect(salah({ ...staging, PEMBAYARAN_GATEWAY: "palsu" })).toEqual(["PEMBAYARAN_GATEWAY"]);
    expect(
      salah({ ...staging, PEMBAYARAN_GATEWAY: "xendit", XENDIT_SECRET_KEY: KUNCI_LIVE }),
    ).toEqual(["XENDIT_SECRET_KEY"]);
    expect(
      bacaKonfigPembayaran({
        ...staging,
        PEMBAYARAN_GATEWAY: "xendit",
        XENDIT_SECRET_KEY: KUNCI_TEST,
      }).mode,
    ).toBe("test");
    expect(
      bacaKonfigPembayaran({ ...dasar, NODE_ENV: "test", PEMBAYARAN_GATEWAY: "palsu" }).gateway,
    ).toBe("palsu");
  });

  it("kunci boleh memuat + / = (base64), tidak boleh spasi/baris baru", () => {
    const g = { ...dasar, PEMBAYARAN_GATEWAY: "xendit" };
    expect(
      bacaKonfigPembayaran({ ...g, XENDIT_SECRET_KEY: "xnd_development_ab+cd/ef==ghijklmnop" })
        .gateway,
    ).toBe("xendit");
    expect(salah({ ...g, XENDIT_SECRET_KEY: "xnd_development_abcdefghij\nX-Evil: 1" })).toEqual([
      "XENDIT_SECRET_KEY",
    ]);
    expect(salah({ ...g, XENDIT_SECRET_KEY: "xnd_development_abcdefgh ijklmnopqr" })).toEqual([
      "XENDIT_SECRET_KEY",
    ]);
  });

  it("nama merchant & kanal VA divalidasi", () => {
    expect(salah({ ...dev, PEMBAYARAN_GATEWAY: "palsu" })).toEqual(["PEMBAYARAN_NAMA_MERCHANT"]);
    expect(salah({ ...dasar, PEMBAYARAN_GATEWAY: "palsu", XENDIT_KANAL_VA: "bni,x y" })).toEqual([
      "XENDIT_KANAL_VA",
    ]);
    const k = bacaKonfigPembayaran({
      ...dasar,
      PEMBAYARAN_GATEWAY: "palsu",
      XENDIT_KANAL_VA: "bri, bni ,BRI",
    });
    expect(k.kanalVa).toEqual(["BRI", "BNI"]);
    expect(buatPaymentGateway(k)).toBeInstanceOf(GatewayPalsu);
    expect(salah({ ...dev, PEMBAYARAN_GATEWAY: "stripe" })).toEqual(["PEMBAYARAN_GATEWAY"]);
  });
});

describe("GatewayPalsu", () => {
  it("idempoten per external_id, simulasi bayar/kedaluwarsa/timeout setelah tercatat", async () => {
    const gw = new GatewayPalsu();
    const a = await gw.buatPembayaran(permintaan());
    const b = await gw.buatPembayaran(permintaan());
    expect(b.xenditRef).toBe(a.xenditRef);
    expect(gw.jumlahTagihan()).toBe(1);
    expect(gw.simulasiBayar(ID, { jumlahRp: 5 })).toBe(true);
    const s = await gw.cekStatus({ pembayaranId: ID, xenditRef: null });
    expect(s).toMatchObject({ ditemukan: true, statusNormal: "PAID", jumlahRp: 5 });
    expect((await galat(gw.batalkan({ pembayaranId: ID, xenditRef: a.xenditRef }))).kode).toBe(
      "TIDAK_AKTIF",
    );

    gw.aturBerikut("buat", "TIMEOUT_SETELAH_TERCATAT");
    const id2 = "0193a1b2-c3d4-7e5f-8a9b-0000000000ff";
    expect((await galat(gw.buatPembayaran(permintaan({ pembayaranId: id2 })))).kode).toBe(
      "TIMEOUT",
    );
    expect((await gw.cekStatus({ pembayaranId: id2, xenditRef: null })).ditemukan).toBe(true);
  });
});
