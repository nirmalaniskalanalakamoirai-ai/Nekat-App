// Tes integrasi T-029: rute bayar → LayananBayar → repo PostgreSQL NYATA → XenditGateway → MOCK Xendit lokal.
// Bukan uji ke Xendit nyata. Jalan bila DATABASE_URL_TEST diisi. SEMUA DATA FIKTIF; angka rupiah = data uji.
import { randomBytes } from "node:crypto";
import { XenditGateway } from "@nekat/adapters";
import { buatDb, buatRepoPembayaran, jalankanMigrasi, jalankanSeed, type Db } from "@nekat/db";
import { LayananBayar, type PeristiwaBayar } from "@nekat/domain";
import { tagihanBayarSchema, type TagihanBayar } from "@nekat/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  mulaiMockXendit,
  type MockXendit,
} from "../../../../packages/adapters/src/pembayaran/mock-xendit.test-util.js";
import { buatApp } from "../app.js";

const URL_ADMIN = process.env["DATABASE_URL_TEST"];
const NAMA_MERCHANT = "PT Uji Merchant";

describe.skipIf(!URL_ADMIN)("bayar tagihan QRIS/VA (PostgreSQL nyata + mock Xendit)", () => {
  let db: Db;
  let mock: MockXendit;
  let app: ReturnType<typeof buatApp>;
  const namaDb = `nekat_uji_bayar_${randomBytes(4).toString("hex")}`;
  const id: Record<string, string> = {};
  const peristiwa: PeristiwaBayar[] = [];
  let nomorHp = 81400000000;
  let nomorKode = 0;

  const q = async (s: string) => (await db.$client.query<Record<string, unknown>>(s)).rows;
  const satu = async (s: string) => String((await q(s))[0]?.["id"]);

  const buatAkun = () =>
    satu(`INSERT INTO akun (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
          VALUES ('+62${String(nomorHp++)}', '\\x${randomBytes(16).toString("hex")}', 1, now()) RETURNING id`);

  const kodeLink = () => {
    const abjad = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let n = nomorKode++ + 5000;
    let s = "";
    for (let i = 0; i < 6; i++) {
      s += abjad[n % abjad.length] ?? "A";
      n = Math.floor(n / abjad.length);
    }
    return s;
  };

  /** Invoice DITERBITKAN milik `akun`, terbit `menitLalu` menit lalu, TTL 60 menit (F-26). */
  const buatTagihan = async (
    akun: string,
    o: { total?: number; saldo?: number; menitLalu?: number } = {},
  ) => {
    const g =
      await satu(`INSERT INTO grup (kode_link, host_akun_id, zona_id, slot_kirim_id, gudang_id)
      VALUES ('${kodeLink()}', '${akun}', '${id["zona"] ?? ""}', '${id["slot"] ?? ""}', '${id["gudang"] ?? ""}') RETURNING id`);
    const total = o.total ?? 150_000;
    const saldo = o.saldo ?? 0;
    const lalu = o.menitLalu ?? 1;
    return satu(`INSERT INTO invoice (nomor, grup_id, pembayar_akun_id, diterbitkan_pada, ttl_menit, kedaluwarsa_pada,
        subtotal_barang_rp, total_rp, saldo_dipakai_rp, sisa_bayar_rp)
      VALUES ('INV-${randomBytes(4).toString("hex")}', '${g}', '${akun}',
        date_trunc('second', now()) - interval '${String(lalu)} minutes', 60,
        date_trunc('second', now()) - interval '${String(lalu)} minutes' + interval '60 minutes',
        ${String(total)}, ${String(total)}, ${String(saldo)}, ${String(total - saldo)}) RETURNING id`);
  };

  const pembayaranDb = (inv: string) =>
    q(`SELECT id, status, metode, kanal, jumlah_rp, xendit_ref, kunci_idempotensi, instruksi, alasan_gagal,
              kedaluwarsa_pada FROM pembayaran WHERE invoice_id = '${inv}' ORDER BY dibuat_pada, id`);

  const bayar = async (akun: string, inv: string, body: unknown) => {
    const r = await app.inject({
      method: "POST",
      url: `/api/tagihan/${inv}/bayar`,
      headers: { "x-uji-akun": akun },
      payload: body as Record<string, unknown>,
    });
    return { status: r.statusCode, json: r.json<unknown>(), header: r.headers };
  };
  const dto = (j: unknown): TagihanBayar => tagihanBayarSchema.parse(j);

  beforeAll(async () => {
    const a = buatDb(URL_ADMIN ?? "");
    await a.$client.query(`CREATE DATABASE ${namaDb}`);
    await a.$client.end();
    const u = new URL(URL_ADMIN ?? "");
    u.pathname = `/${namaDb}`;
    db = buatDb(u.toString());
    await jalankanMigrasi(db);
    await jalankanSeed(db);
    id["gudang"] = await satu(
      "INSERT INTO gudang (kode_konfig, nama, jenis) VALUES ('g-bayar', 'Gudang', 'PUSAT') RETURNING id",
    );
    id["zona"] = await satu(
      `INSERT INTO zona (kode_konfig, nama_kelurahan, gudang_id) VALUES ('z-bayar', 'Kelurahan Uji', '${id["gudang"]}') RETURNING id`,
    );
    id["slot"] = await satu(`INSERT INTO slot_kirim (zona_id, tanggal, mulai, selesai, cut_off_pada)
      VALUES ('${id["zona"]}', '2026-12-30', '09:00', '12:00', '2026-12-29T00:00:00Z') RETURNING id`);

    mock = await mulaiMockXendit();
    const gateway = new XenditGateway({
      mode: "test",
      ambilKunci: () => mock.kunci,
      kanalVa: ["BNI", "BRI"],
      baseUrlUntukTes: mock.url,
      timeoutMs: { buat: 400, cek: 400, batal: 400 },
    });
    const repo = buatRepoPembayaran(db);
    app = buatApp({
      logger: false,
      tagihan: {
        repoBaca: repo,
        layanan: new LayananBayar({
          repo,
          gateway,
          namaMerchant: NAMA_MERCHANT,
          catat: (p) => peristiwa.push(p),
        }),
        // Pengganti sesi T-016 HANYA untuk tes.
        autentikasi: (req) => {
          const h = req.headers["x-uji-akun"];
          return Promise.resolve(typeof h === "string" ? { akunId: h } : null);
        },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await mock.tutup();
    await db.$client.end();
    const a = buatDb(URL_ADMIN ?? "");
    await a.$client.query(`DROP DATABASE IF EXISTS ${namaDb} WITH (FORCE)`);
    await a.$client.end();
  });

  afterEach(() => {
    mock.bersihkanGangguan();
    mock.tanpaPencarian(false);
  });

  it("tanpa sesi → 401 sebelum validasi; tanpa autentikasi bawaan juga 401", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/tagihan/bukan-uuid/bayar",
      payload: {},
    });
    expect(r.statusCode).toBe(401);
    const bawaan = buatApp({ logger: false });
    const g = await bawaan.inject({
      method: "GET",
      url: `/api/tagihan/${"0".repeat(8)}-0000-7000-8000-${"0".repeat(12)}/pembayaran`,
    });
    expect(g.statusCode).toBe(401);
    await bawaan.close();
  });

  it("QRIS happy path: satu baris MENUNGGU, kunci bayar:{invoice}:1, nominal = sisa bayar, kedaluwarsa = TTL invoice", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun, { total: 150_000, saldo: 20_000 });
    const r = await bayar(akun, inv, { metode: "QRIS" });
    expect(r.status).toBe(200);
    expect(r.header["cache-control"]).toBe("no-store");
    const d = dto(r.json);
    expect(d.hasil).toBe("OK");
    expect(d.pembayaran).toMatchObject({
      metode: "QRIS",
      status: "MENUNGGU",
      tahap: "SIAP",
      jumlahRp: 130_000,
    });
    expect(d.pembayaran?.instruksi?.jenis).toBe("QRIS");
    expect(d.pembayaran?.kedaluwarsaPada).toBe(d.tagihan.kedaluwarsaPada);
    const [b] = await pembayaranDb(inv);
    expect(b).toMatchObject({
      status: "MENUNGGU",
      kunci_idempotensi: `bayar:${inv}:1`,
      jumlah_rp: "130000",
    });
    expect(b?.["xendit_ref"]).toMatch(/^pr-/);
    // Body ke Xendit: reference_id = pembayaran.id, expires_at absolut = kedaluwarsa invoice.
    const kirim = mock.permintaan.filter((p) => p.rute === "buat").at(-1);
    expect(kirim?.body).toMatchObject({
      reference_id: b?.["id"],
      request_amount: 130000,
      channel_properties: { expires_at: d.tagihan.kedaluwarsaPada.replace(/\.\d{3}Z$/, ".000Z") },
    });
    // GET status mengembalikan instruksi yang sama tanpa memanggil Xendit.
    const n = mock.permintaan.length;
    const g = await app.inject({
      method: "GET",
      url: `/api/tagihan/${inv}/pembayaran`,
      headers: { "x-uji-akun": akun },
    });
    expect(dto(g.json()).pembayaran?.instruksi).toEqual(d.pembayaran?.instruksi);
    expect(mock.permintaan.length).toBe(n);
  });

  it("VA: nama penerima = nama merchant, bank wajib & terdaftar", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    expect((await bayar(akun, inv, { metode: "VA" })).status).toBe(422);
    expect((await bayar(akun, inv, { metode: "VA", kanal: "BCA" })).status).toBe(422);
    expect((await bayar(akun, inv, { metode: "QRIS", kanal: "BNI" })).status).toBe(422);
    expect((await bayar(akun, inv, { metode: "EWALLET" })).status).toBe(400);
    expect((await bayar(akun, inv, { metode: "QRIS", jumlahRp: 1 })).status).toBe(400);
    const d = dto((await bayar(akun, inv, { metode: "VA", kanal: "BRI" })).json);
    expect(d.pembayaran?.instruksi).toMatchObject({
      jenis: "VA",
      bank: "BRI",
      namaPenerima: NAMA_MERCHANT,
    });
    expect(mock.permintaan.filter((p) => p.rute === "buat").at(-1)?.body).toMatchObject({
      channel_code: "BRI_VIRTUAL_ACCOUNT",
      channel_properties: { display_name: NAMA_MERCHANT },
    });
  });

  it("TC-PAY-27: 6 POST /bayar paralel → satu baris, satu tagihan Xendit, instruksi sama", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    const hasil = await Promise.all(
      Array.from({ length: 6 }, () => bayar(akun, inv, { metode: "QRIS" })),
    );
    expect(hasil.map((h) => h.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const ins = hasil.map((h) => JSON.stringify(dto(h.json).pembayaran?.instruksi));
    expect(new Set(ins).size).toBe(1);
    expect(await pembayaranDb(inv)).toHaveLength(1);
    const [b] = await pembayaranDb(inv);
    expect([...mock.tagihan.values()].filter((t) => t.reference_id === b?.["id"])).toHaveLength(1);
  });

  it("FP-01/TC-PAY-26: timeout setelah tercatat → MENYIAPKAN & xendit_ref NULL; ulang → cekStatus(external_id) memulihkan", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    mock.ganggu("buat", { setelahTercatat: true, tundaMs: 700, kali: 1 });
    const r1 = dto((await bayar(akun, inv, { metode: "QRIS" })).json);
    expect(r1.hasil).toBe("MENYIAPKAN");
    expect(r1.pembayaran).toMatchObject({
      status: "MENUNGGU",
      tahap: "MENYIAPKAN",
      instruksi: null,
    });
    let [b] = await pembayaranDb(inv);
    expect(b?.["xendit_ref"]).toBeNull();
    const id1 = String(b?.["id"]);

    const nBuat = mock.permintaan.filter((p) => p.rute === "buat").length;
    const r2 = dto((await bayar(akun, inv, { metode: "QRIS" })).json);
    expect(r2.hasil).toBe("OK");
    expect(r2.pembayaran?.id).toBe(id1);
    // Pemulihan lewat GET cari reference_id (external_id dari DB), bukan POST baru.
    const cari = mock.permintaan.filter((p) => p.rute === "cari").at(-1);
    expect(cari?.url).toContain(`reference_id=${id1}`);
    expect(mock.permintaan.filter((p) => p.rute === "buat").length).toBe(nBuat);
    [b] = await pembayaranDb(inv);
    expect(b?.["xendit_ref"]).toBe(mock.cariRef(id1)?.payment_request_id);
    expect(await pembayaranDb(inv)).toHaveLength(1);
    expect(peristiwa.some((p) => p.jenis === "PULIH_DARI_CEK" && p.pembayaranId === id1)).toBe(
      true,
    );
  });

  it("timeout sebelum tercatat + pencarian tidak tersedia → buat ulang dengan external_id SAMA", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    mock.ganggu("buat", { tundaMs: 700, kali: 1 });
    expect(dto((await bayar(akun, inv, { metode: "QRIS" })).json).hasil).toBe("MENYIAPKAN");
    mock.tanpaPencarian(true);
    const r = dto((await bayar(akun, inv, { metode: "QRIS" })).json);
    expect(r.hasil).toBe("OK");
    const rows = await pembayaranDb(inv);
    expect(rows).toHaveLength(1);
    const buat = mock.permintaan.filter(
      (p) =>
        p.rute === "buat" && (p.body as { reference_id?: string }).reference_id === rows[0]?.["id"],
    );
    expect(buat.length).toBe(2);
    expect(new Set(buat.map((p) => p.header["idempotency-key"])).size).toBe(1);
  });

  it("FP-25/TC-PAY-29: gagal permanen → GAGAL + alasan; metode lain berhasil (n = 2)", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    mock.ganggu("buat", {
      status: 400,
      body: { error_code: "API_VALIDATION_ERROR", message: "request_amount is below minimum" },
      kali: 1,
    });
    const r1 = dto((await bayar(akun, inv, { metode: "VA", kanal: "BNI" })).json);
    expect(r1.hasil).toBe("METODE_GAGAL");
    expect(r1.pembayaran).toMatchObject({
      status: "GAGAL",
      alasanGagal: "NOMINAL_DI_BAWAH_MINIMUM",
      instruksi: null,
    });
    const r2 = dto((await bayar(akun, inv, { metode: "QRIS" })).json);
    expect(r2.hasil).toBe("OK");
    const rows = await pembayaranDb(inv);
    expect(rows.map((x) => [x["status"], x["kunci_idempotensi"]])).toEqual([
      ["GAGAL", `bayar:${inv}:1`],
      ["MENUNGGU", `bayar:${inv}:2`],
    ]);
  });

  it("5xx → tetap MENUNGGU (bukan GAGAL); kunci Xendit salah → 503 fail closed", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    mock.ganggu("buat", { status: 502, kali: 1 });
    expect(dto((await bayar(akun, inv, { metode: "QRIS" })).json).hasil).toBe("MENYIAPKAN");
    expect((await pembayaranDb(inv))[0]?.["status"]).toBe("MENUNGGU");
    mock.ganggu("cari", { status: 401, kali: 1 });
    const r = await bayar(akun, inv, { metode: "QRIS" });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ kode: "GATEWAY_TIDAK_AKTIF" });
  });

  it("ganti metode QRIS → VA: batal di Xendit dulu, lama KEDALUWARSA, baru MENUNGGU; kedaluwarsa invoice tetap", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    const q1 = dto((await bayar(akun, inv, { metode: "QRIS" })).json);
    const v = dto((await bayar(akun, inv, { metode: "VA", kanal: "BNI" })).json);
    expect(v.hasil).toBe("OK");
    expect(v.pembayaran?.metode).toBe("VA");
    expect(v.pembayaran?.kedaluwarsaPada).toBe(q1.pembayaran?.kedaluwarsaPada);
    const rows = await pembayaranDb(inv);
    expect(rows.map((x) => x["status"])).toEqual(["KEDALUWARSA", "MENUNGGU"]);
    expect(mock.cariRef(String(rows[0]?.["id"]))?.status).toBe("CANCELED");
    // Ganti bank juga = ganti metode.
    const v2 = dto((await bayar(akun, inv, { metode: "VA", kanal: "BRI" })).json);
    expect(v2.pembayaran?.kanal).toBe("BRI");
    expect((await pembayaranDb(inv)).map((x) => x["status"])).toEqual([
      "KEDALUWARSA",
      "KEDALUWARSA",
      "MENUNGGU",
    ]);
  });

  it("FP-24/TC-PAY-28: batal ke Xendit timeout → tidak ada pembayaran baru, instruksi lama tetap", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    const q1 = dto((await bayar(akun, inv, { metode: "QRIS" })).json);
    mock.ganggu("batal", { tundaMs: 700, kali: 1 });
    const r = dto((await bayar(akun, inv, { metode: "VA", kanal: "BNI" })).json);
    expect(r.hasil).toBe("GANTI_METODE_GAGAL");
    expect(r.pembayaran?.id).toBe(q1.pembayaran?.id);
    expect(r.pembayaran?.instruksi).toEqual(q1.pembayaran?.instruksi);
    expect((await pembayaranDb(inv)).map((x) => x["status"])).toEqual(["MENUNGGU"]);
  });

  it("ganti metode ketika QR lama ternyata sudah dibayar → SEDANG_DIPERIKSA, tidak membuat baru, tidak menandai LUNAS", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    const q1 = dto((await bayar(akun, inv, { metode: "QRIS" })).json);
    mock.bayar(String(q1.pembayaran?.id));
    const r = dto((await bayar(akun, inv, { metode: "VA", kanal: "BNI" })).json);
    expect(r.hasil).toBe("SEDANG_DIPERIKSA");
    expect((await pembayaranDb(inv)).map((x) => x["status"])).toEqual(["MENUNGGU"]);
    expect((await q(`SELECT status FROM invoice WHERE id = '${inv}'`))[0]?.["status"]).toBe(
      "DITERBITKAN",
    );
  });

  it("ganti metode paralel → tetap satu pembayaran hidup", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    await bayar(akun, inv, { metode: "QRIS" });
    const h = await Promise.all([
      bayar(akun, inv, { metode: "VA", kanal: "BNI" }),
      bayar(akun, inv, { metode: "VA", kanal: "BNI" }),
      bayar(akun, inv, { metode: "VA", kanal: "BNI" }),
    ]);
    expect(h.every((x) => x.status === 200)).toBe(true);
    const hidup = (await pembayaranDb(inv)).filter((x) => x["status"] === "MENUNGGU");
    expect(hidup).toHaveLength(1);
    expect(hidup[0]?.["kanal"]).toBe("BNI");
  });

  it("akses akun lain → 404 (POST & GET); tagihan lewat TTL → 409; tagihan LUNAS → 409", async () => {
    const pemilik = await buatAkun();
    const lain = await buatAkun();
    const inv = await buatTagihan(pemilik);
    expect((await bayar(lain, inv, { metode: "QRIS" })).status).toBe(404);
    const g = await app.inject({
      method: "GET",
      url: `/api/tagihan/${inv}/pembayaran`,
      headers: { "x-uji-akun": lain },
    });
    expect(g.statusCode).toBe(404);
    const lewat = await buatTagihan(pemilik, { menitLalu: 61 });
    expect((await bayar(pemilik, lewat, { metode: "QRIS" })).json).toMatchObject({
      kode: "TAGIHAN_KEDALUWARSA",
    });
    await q(`UPDATE invoice SET status = 'LUNAS', lunas_pada = now() WHERE id = '${inv}'`);
    const r = await bayar(pemilik, inv, { metode: "QRIS" });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ kode: "SUDAH_LUNAS" });
  });

  it("migrasi 0008: LUNAS_TERLAMBAT di luar UK satu-hidup; KEDALUWARSA/GAGAL → LUNAS_TERLAMBAT boleh, → LUNAS tidak", async () => {
    const akun = await buatAkun();
    const inv = await buatTagihan(akun);
    const ins = (status: string, n: number, paid = "now()") =>
      satu(`INSERT INTO pembayaran (invoice_id, metode, jumlah_rp, kunci_idempotensi, status, kedaluwarsa_pada, paid_at_gateway)
            VALUES ('${inv}', 'QRIS', 1000, 'bayar:${inv}:${String(n)}', '${status}', now(), ${paid}) RETURNING id`);
    const kedaluwarsa = await ins("KEDALUWARSA", 1, "NULL");
    const hidup = await ins("MENUNGGU", 2, "NULL");
    await q(
      `UPDATE pembayaran SET status = 'LUNAS_TERLAMBAT', paid_at_gateway = now() WHERE id = '${kedaluwarsa}'`,
    );
    // Masih ada pembayaran hidup lain: LUNAS_TERLAMBAT tidak menyentuh partial UK.
    expect((await q(`SELECT status FROM pembayaran WHERE id = '${hidup}'`))[0]?.["status"]).toBe(
      "MENUNGGU",
    );
    const gagal = await ins("GAGAL", 3, "NULL");
    await expect(
      q(`UPDATE pembayaran SET status = 'LUNAS', paid_at_gateway = now() WHERE id = '${gagal}'`),
    ).rejects.toThrow(/pembayaran_status_akhir/);
    await expect(
      q(`UPDATE pembayaran SET status = 'LUNAS_TERLAMBAT' WHERE id = '${gagal}'`),
    ).rejects.toThrow(/pembayaran_lunas_lengkap/);
    await expect(
      q(`UPDATE pembayaran SET status = 'MENUNGGU' WHERE id = '${kedaluwarsa}'`),
    ).rejects.toThrow(/pembayaran_status_akhir/);
    // Instruksi hanya bila ada xendit_ref; VA wajib kanal (baris baru).
    await expect(
      q(`UPDATE pembayaran SET instruksi = '{"jenis":"QRIS"}' WHERE id = '${hidup}'`),
    ).rejects.toThrow(/pembayaran_instruksi_butuh_ref/);
    await expect(
      q(
        `INSERT INTO pembayaran (invoice_id, metode, jumlah_rp, kunci_idempotensi, status) VALUES ('${inv}', 'VA', 1, 'x-${String(Date.now())}', 'GAGAL')`,
      ),
    ).rejects.toThrow(/pembayaran_kanal_va/);
    await expect(
      q(`UPDATE pembayaran SET alasan_gagal = 'NOMINAL_DI_BAWAH_MINIMUM' WHERE id = '${hidup}'`),
    ).rejects.toThrow(/pembayaran_alasan_gagal/);
  });

  it("log peristiwa tanpa QR string / nomor VA / kunci", () => {
    const teks = JSON.stringify(peristiwa);
    expect(teks).not.toMatch(/00020101|MOCK|xnd_/);
    for (const t of mock.tagihan.values()) {
      for (const a of t.actions) expect(teks).not.toContain(a.value);
    }
  });
});
