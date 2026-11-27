// Tes API panel admin (inject Fastify) dengan repo palsu: masuk 2 langkah, sesi & rotasi,
// penguncian, CSRF, origin, jenis konten, RBAC, batas laju, mode Gudang. DATA FIKTIF.
import { beforeEach, describe, expect, it } from "vitest";
import { buatApp } from "../app.js";
import { buatAdminBaru } from "./buat-admin.js";
import { COOKIE_PRA, COOKIE_SESI } from "./http-util.js";
import { buatRahasiaTotp, kodeTotp, langkahTotp, type ParameterScrypt } from "./kripto.js";
import { LayananAuthAdmin } from "./layanan-auth.js";
import type { OpsiSemafor } from "./semafor.js";
import { KONFIG_UJI, RepoAuthPalsu, repoKatalogPalsu } from "./palsu.test-util.js";
import type { OpsiRuteAdmin } from "./rute.js";

const SCRYPT_UJI: ParameterScrypt = { logN: 10, r: 8, p: 1 };
const HP = "+6281200000001";
const SANDI = "kata-sandi-uji-panjang-01";
const ORIGIN = "https://nekat.contoh";

interface Lingkungan {
  app: ReturnType<typeof buatApp>;
  repo: RepoAuthPalsu;
  katalog: ReturnType<typeof repoKatalogPalsu>;
  rahasia: Buffer;
  adminId: string;
  majukan: (detik: number) => void;
  kodeSekarang: () => string;
}

async function siapkan(
  opsiRute: Partial<OpsiRuteAdmin> = {},
  peran: "owner" | "admin" = "owner",
  ekstra: { semafor?: OpsiSemafor; trustProxy?: string[] } = {},
): Promise<Lingkungan> {
  let jam = new Date("2026-11-27T03:00:00Z");
  const repo = new RepoAuthPalsu();
  const rahasia = buatRahasiaTotp();
  if (peran !== "owner") {
    // Admin pertama wajib owner: buat owner lain dulu.
    await buatAdminBaru(
      repo,
      KONFIG_UJI,
      {
        nama: "Owner Lain",
        nomorHpE164: "+6281200000009",
        peran: "owner",
        kataSandi: SANDI,
        rahasiaTotp: rahasia,
        kodeKonfirmasi: kodeTotp(rahasia, langkahTotp(jam)),
      },
      { sekarang: jam, scrypt: SCRYPT_UJI },
    );
  }
  const { id } = await buatAdminBaru(
    repo,
    KONFIG_UJI,
    {
      nama: "Admin Uji",
      nomorHpE164: HP,
      peran,
      kataSandi: SANDI,
      rahasiaTotp: rahasia,
      kodeKonfirmasi: kodeTotp(rahasia, langkahTotp(jam)),
    },
    { sekarang: jam, scrypt: SCRYPT_UJI },
  );
  const katalog = repoKatalogPalsu();
  const auth = new LayananAuthAdmin({
    repo,
    konfig: KONFIG_UJI,
    sekarang: () => jam,
    scrypt: SCRYPT_UJI,
    ...(ekstra.semafor ? { semaforScrypt: ekstra.semafor } : {}),
  });
  const app = buatApp({
    logger: false,
    ...(ekstra.trustProxy ? { trustProxy: ekstra.trustProxy } : {}),
    admin: {
      auth,
      katalog,
      sumberInventori: "local",
      originDiizinkan: KONFIG_UJI.originDiizinkan,
      batasMasukPerMenit: 100,
      ...opsiRute,
    },
  });
  return {
    app,
    repo,
    katalog,
    rahasia,
    adminId: id,
    majukan: (d) => {
      jam = new Date(jam.getTime() + d * 1000);
    },
    kodeSekarang: () => kodeTotp(rahasia, langkahTotp(jam)),
  };
}

/** Ambil nilai cookie dari header set-cookie. */
function cookieDari(setCookie: string | string[] | undefined, nama: string): string | undefined {
  const daftar = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of daftar) {
    const m = new RegExp(`^${nama}=([^;]*)`).exec(c);
    if (m) return m[1];
  }
  return undefined;
}

async function langkah1(l: Lingkungan, sandi = SANDI, hp = HP) {
  return l.app.inject({
    method: "POST",
    url: "/api/admin/masuk",
    headers: { origin: ORIGIN },
    payload: { nomorHp: hp, kataSandi: sandi },
  });
}

async function masukPenuh(l: Lingkungan) {
  l.majukan(30); // langkah TOTP berikutnya (kode konfirmasi CLI tidak bisa dipakai ulang)
  const r1 = await langkah1(l);
  expect(r1.statusCode).toBe(200);
  const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? "";
  const csrfPra = r1.json<{ csrfToken: string }>().csrfToken;
  const r2 = await l.app.inject({
    method: "POST",
    url: "/api/admin/masuk/totp",
    headers: { cookie: `${COOKIE_PRA}=${pra}`, "x-csrf-token": csrfPra, origin: ORIGIN },
    payload: { kode: l.kodeSekarang() },
  });
  expect(r2.statusCode).toBe(200);
  const sesi = cookieDari(r2.headers["set-cookie"], COOKIE_SESI) ?? "";
  return { pra, sesi, csrf: r2.json<{ csrfToken: string }>().csrfToken, r2 };
}

describe("masuk admin (kata sandi + TOTP wajib, H9)", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = await siapkan();
  });

  it("alur penuh: cookie aman, sesi dirotasi, /saya memuat peran & izin", async () => {
    const r1 = await langkah1(l);
    expect(r1.statusCode).toBe(200);
    const sc1 = String(r1.headers["set-cookie"]);
    expect(sc1).toMatch(/^__Host-nekat_admin_pra=/);
    expect(sc1).toContain("HttpOnly");
    expect(sc1).toContain("Secure");
    expect(sc1).toContain("SameSite=Strict");
    expect(sc1).toContain("Path=/");
    expect(r1.headers["cache-control"]).toBe("no-store");

    const { pra, sesi, csrf, r2 } = await masukPenuh(l);
    expect(sesi).not.toBe("");
    expect(sesi).not.toBe(pra);
    expect(JSON.stringify(r2.headers["set-cookie"])).toContain(`${COOKIE_PRA}=;`);

    const saya = await l.app.inject({
      method: "GET",
      url: "/api/admin/saya",
      headers: { cookie: `${COOKIE_SESI}=${sesi}` },
    });
    expect(saya.statusCode).toBe(200);
    const isi = saya.json<{ admin: { izin: string[]; peran: string[] }; csrfToken: string }>();
    expect(isi.admin.peran).toEqual(["owner"]);
    expect(isi.admin.izin).toContain("produk.ubah");
    expect(isi.csrfToken).toBe(csrf);
    // Respons tidak pernah memuat rahasia.
    expect(saya.body).not.toMatch(/scrypt|totp_?rahasia|kataSandi/i);
    expect(l.repo.audit.map((a) => a.jenis)).toContain("LOGIN_ADMIN_BERHASIL");
  });

  it("sesi pra (baru lolos kata sandi) tidak bisa membuka panel", async () => {
    const r1 = await langkah1(l);
    const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? "";
    for (const cookie of [`${COOKIE_SESI}=${pra}`, `${COOKIE_PRA}=${pra}`]) {
      const r = await l.app.inject({ method: "GET", url: "/api/admin/saya", headers: { cookie } });
      expect(r.statusCode).toBe(401);
    }
  });

  it("sesi pra kedaluwarsa setelah 5 menit", async () => {
    l.majukan(30);
    const r1 = await langkah1(l);
    const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? "";
    const csrf = r1.json<{ csrfToken: string }>().csrfToken;
    l.majukan(5 * 60 + 1);
    const r2 = await l.app.inject({
      method: "POST",
      url: "/api/admin/masuk/totp",
      headers: { cookie: `${COOKIE_PRA}=${pra}`, "x-csrf-token": csrf },
      payload: { kode: l.kodeSekarang() },
    });
    expect(r2.statusCode).toBe(401);
    expect(r2.json<{ kode: string }>().kode).toBe("SESI_PRA_HABIS");
  });

  it("pesan gagal seragam: HP tak dikenal = kata sandi salah (tanpa enumerasi)", async () => {
    const a = await langkah1(l, "salah-salah-salah-1");
    const b = await langkah1(l, SANDI, "+6281299999999");
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.body).toBe(b.body);
    expect(a.headers["set-cookie"]).toBeUndefined();
  });

  it("TOTP salah, kode kosong-format, dan kode dipakai ulang ditolak", async () => {
    const { r2 } = await masukPenuh(l);
    expect(r2.statusCode).toBe(200);
    // Kode yang sama (langkah sama) dipakai ulang → ditolak.
    const r1 = await langkah1(l);
    const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? "";
    const csrf = r1.json<{ csrfToken: string }>().csrfToken;
    const h = { cookie: `${COOKIE_PRA}=${pra}`, "x-csrf-token": csrf };
    const ulang = await l.app.inject({
      method: "POST",
      url: "/api/admin/masuk/totp",
      headers: h,
      payload: { kode: l.kodeSekarang() },
    });
    expect(ulang.statusCode).toBe(401);
    const format = await l.app.inject({
      method: "POST",
      url: "/api/admin/masuk/totp",
      headers: h,
      payload: { kode: "12ab56" },
    });
    expect(format.statusCode).toBe(400);
  });

  it("CSRF wajib di langkah TOTP", async () => {
    l.majukan(30);
    const r1 = await langkah1(l);
    const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? "";
    const r = await l.app.inject({
      method: "POST",
      url: "/api/admin/masuk/totp",
      headers: { cookie: `${COOKIE_PRA}=${pra}`, "x-csrf-token": "palsu" },
      payload: { kode: l.kodeSekarang() },
    });
    expect(r.statusCode).toBe(403);
  });

  it("kode pemulihan bisa dipakai sekali", async () => {
    const kode = await (async () => {
      // Buat ulang admin di repo baru agar kode pemulihan diketahui tes.
      const repo = new RepoAuthPalsu();
      const jam = new Date("2026-11-27T03:00:00Z");
      const rahasia = buatRahasiaTotp();
      const h = await buatAdminBaru(
        repo,
        KONFIG_UJI,
        {
          nama: "Admin Pulih",
          nomorHpE164: HP,
          peran: "owner",
          kataSandi: SANDI,
          rahasiaTotp: rahasia,
          kodeKonfirmasi: kodeTotp(rahasia, langkahTotp(jam)),
        },
        { sekarang: jam, scrypt: SCRYPT_UJI },
      );
      const auth = new LayananAuthAdmin({
        repo,
        konfig: KONFIG_UJI,
        sekarang: () => jam,
        scrypt: SCRYPT_UJI,
      });
      return {
        app: buatApp({
          logger: false,
          admin: {
            auth,
            katalog: repoKatalogPalsu(),
            sumberInventori: "local",
            originDiizinkan: [],
          },
        }),
        kode: h.kodePemulihan[0] ?? "",
      };
    })();
    const coba = async () => {
      const r1 = await kode.app.inject({
        method: "POST",
        url: "/api/admin/masuk",
        payload: { nomorHp: HP, kataSandi: SANDI },
      });
      const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? "";
      return kode.app.inject({
        method: "POST",
        url: "/api/admin/masuk/totp",
        headers: {
          cookie: `${COOKIE_PRA}=${pra}`,
          "x-csrf-token": r1.json<{ csrfToken: string }>().csrfToken,
        },
        payload: { kodePemulihan: kode.kode.toLowerCase() },
      });
    };
    expect((await coba()).statusCode).toBe(200);
    expect((await coba()).statusCode).toBe(401);
  });
});

describe("penguncian akun (CWE-307)", () => {
  it("5x kata sandi salah → dikunci; kata sandi benar pun ditolak sampai 15 menit lewat", async () => {
    const l = await siapkan();
    for (let i = 0; i < 5; i++)
      expect((await langkah1(l, `salah-salah-${String(i)}-xx`)).statusCode).toBe(401);
    expect(l.repo.audit.map((a) => a.jenis)).toContain("LOGIN_ADMIN_DIKUNCI");
    expect((await langkah1(l)).statusCode).toBe(401);
    l.majukan(15 * 60 + 1);
    expect((await langkah1(l)).statusCode).toBe(200);
  });

  it("gagal TOTP ikut dihitung dan lolos kata sandi TIDAK mereset penghitung", async () => {
    const l = await siapkan();
    l.majukan(30);
    const salahTotp = async () => {
      const r1 = await langkah1(l);
      expect(r1.statusCode).toBe(200);
      const pra = cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? "";
      return l.app.inject({
        method: "POST",
        url: "/api/admin/masuk/totp",
        headers: {
          cookie: `${COOKIE_PRA}=${pra}`,
          "x-csrf-token": r1.json<{ csrfToken: string }>().csrfToken,
        },
        payload: { kode: l.kodeSekarang() === "000000" ? "111111" : "000000" },
      });
    };
    for (let i = 0; i < 5; i++) expect((await salahTotp()).statusCode).toBe(401);
    // Sekarang terkunci: langkah 1 dengan kata sandi benar pun gagal.
    expect((await langkah1(l)).statusCode).toBe(401);
    expect(l.repo.admin.get(l.adminId)?.dikunciSampai).not.toBeNull();
  });
});

describe("CSRF, origin, jenis konten, sesi", () => {
  let l: Lingkungan;
  let sesi: string;
  let csrf: string;
  beforeEach(async () => {
    l = await siapkan();
    ({ sesi, csrf } = await masukPenuh(l));
  });

  const produkBaru = { kategoriId: "00000000-0000-7000-8000-000000000010", nama: "Beras Uji 5 kg" };

  it("mutasi tanpa / dengan token CSRF salah → 403; token benar → diteruskan", async () => {
    const tanpa = await l.app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: { cookie: `${COOKIE_SESI}=${sesi}` },
      payload: produkBaru,
    });
    expect(tanpa.statusCode).toBe(403);
    expect(tanpa.json<{ kode: string }>().kode).toBe("CSRF_TIDAK_VALID");
    const salah = await l.app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: { cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": `${csrf}x` },
      payload: produkBaru,
    });
    expect(salah.statusCode).toBe(403);
    expect(l.katalog.panggilan).not.toContain("buatProduk");
    const benar = await l.app.inject({
      method: "POST",
      url: "/api/admin/produk",
      headers: { cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": csrf, origin: ORIGIN },
      payload: produkBaru,
    });
    expect(benar.statusCode).toBe(201);
    expect(l.katalog.panggilan).toContain("buatProduk");
  });

  it("origin asing & Sec-Fetch-Site cross-site ditolak", async () => {
    for (const h of [{ origin: "https://jahat.contoh" }, { "sec-fetch-site": "cross-site" }]) {
      const r = await l.app.inject({
        method: "POST",
        url: "/api/admin/produk",
        headers: { cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": csrf, ...h },
        payload: produkBaru,
      });
      expect(r.statusCode).toBe(403);
    }
  });

  it("body text/plain (form lintas situs) → 415", async () => {
    const r = await l.app.inject({
      method: "POST",
      url: "/api/admin/masuk",
      headers: { "content-type": "text/plain" },
      payload: JSON.stringify({ nomorHp: HP, kataSandi: SANDI }),
    });
    expect(r.statusCode).toBe(415);
  });

  it("keluar mencabut sesi di server", async () => {
    const r = await l.app.inject({
      method: "POST",
      url: "/api/admin/keluar",
      headers: { cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": csrf },
    });
    expect(r.statusCode).toBe(204);
    const saya = await l.app.inject({
      method: "GET",
      url: "/api/admin/saya",
      headers: { cookie: `${COOKIE_SESI}=${sesi}` },
    });
    expect(saya.statusCode).toBe(401);
  });

  it("sesi kedaluwarsa (ADMIN_SESI_MENIT) → 401", async () => {
    l.majukan(KONFIG_UJI.sesiMenit * 60 + 1);
    const r = await l.app.inject({
      method: "GET",
      url: "/api/admin/saya",
      headers: { cookie: `${COOKIE_SESI}=${sesi}` },
    });
    expect(r.statusCode).toBe(401);
  });

  it("tanpa cookie → 401 di semua rute panel", async () => {
    for (const url of ["/api/admin/saya", "/api/admin/produk", "/api/admin/log"]) {
      expect((await l.app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });
});

describe("RBAC per izin", () => {
  it("peran tanpa stok.ubah tidak bisa membaca/mengubah stok, tetap bisa produk", async () => {
    const l = await siapkan({}, "admin");
    const { sesi, csrf } = await masukPenuh(l);
    l.repo.aturPeran(l.adminId, ["cs_uji"]);
    const h = { cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": csrf };
    const stok = await l.app.inject({
      method: "GET",
      url: "/api/admin/stok?gudangId=00000000-0000-7000-8000-000000000020",
      headers: h,
    });
    expect(stok.statusCode).toBe(403);
    expect(stok.json<{ kode: string }>().kode).toBe("TANPA_IZIN");
    const ubah = await l.app.inject({
      method: "PUT",
      url: "/api/admin/stok",
      headers: h,
      payload: {
        skuId: "00000000-0000-7000-8000-000000000021",
        gudangId: "00000000-0000-7000-8000-000000000020",
        tersedia: 5,
        tersediaSebelum: null,
        alasan: "uji",
      },
    });
    expect(ubah.statusCode).toBe(403);
    expect(l.katalog.panggilan).not.toContain("aturStok");
    const produk = await l.app.inject({ method: "GET", url: "/api/admin/produk", headers: h });
    expect(produk.statusCode).toBe(200);
  });

  it("peran tanpa izin apa pun tidak bisa produk", async () => {
    const l = await siapkan({}, "admin");
    const { sesi } = await masukPenuh(l);
    l.repo.aturPeran(l.adminId, []);
    const r = await l.app.inject({
      method: "GET",
      url: "/api/admin/produk",
      headers: { cookie: `${COOKIE_SESI}=${sesi}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("mode stok & batas laju & belum dikonfigurasi", () => {
  it("INVENTORY_SOURCE=gudang: stok hanya baca (409), status aktif SKU tidak bisa diubah", async () => {
    const l = await siapkan({ sumberInventori: "gudang" });
    const { sesi, csrf } = await masukPenuh(l);
    const h = { cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": csrf };
    const lihat = await l.app.inject({
      method: "GET",
      url: "/api/admin/stok?gudangId=00000000-0000-7000-8000-000000000020",
      headers: h,
    });
    expect(lihat.json<{ dapatDiubah: boolean; sumber: string }>()).toMatchObject({
      dapatDiubah: false,
      sumber: "gudang",
    });
    const ubah = await l.app.inject({
      method: "PUT",
      url: "/api/admin/stok",
      headers: h,
      payload: {
        skuId: "00000000-0000-7000-8000-000000000021",
        gudangId: "00000000-0000-7000-8000-000000000020",
        tersedia: 5,
        tersediaSebelum: null,
        alasan: "uji",
      },
    });
    expect(ubah.statusCode).toBe(409);
    expect(ubah.json<{ kode: string }>().kode).toBe("STOK_HANYA_BACA");
    const sku = await l.app.inject({
      method: "PATCH",
      url: "/api/admin/sku/00000000-0000-7000-8000-000000000021",
      headers: h,
      payload: { aktif: false },
    });
    expect(sku.statusCode).toBe(409);
    expect(l.katalog.panggilan).not.toContain("aturStok");
  });

  it("batas laju masuk per IP → 429 + Retry-After", async () => {
    const l = await siapkan({ batasMasukPerMenit: 3 });
    for (let i = 0; i < 3; i++) await langkah1(l, `salah-salah-${String(i)}-xx`);
    const r = await langkah1(l);
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("panel belum dikonfigurasi → 503", async () => {
    const app = buatApp({ logger: false });
    const r = await app.inject({ method: "GET", url: "/api/admin/saya" });
    expect(r.statusCode).toBe(503);
  });
});

describe("perbaikan audit S1–S7", () => {
  async function pra(l: Lingkungan) {
    const r1 = await langkah1(l);
    expect(r1.statusCode).toBe(200);
    return {
      cookie: `${COOKIE_PRA}=${cookieDari(r1.headers["set-cookie"], COOKIE_PRA) ?? ""}`,
      "x-csrf-token": r1.json<{ csrfToken: string }>().csrfToken,
    };
  }
  const kodeSalah = (l: Lingkungan) => (l.kodeSekarang() === "000000" ? "111111" : "000000");

  it("maks 3 percobaan faktor kedua per sesi pra, lalu sesi pra dicabut (kode benar pun ditolak)", async () => {
    const l = await siapkan();
    l.majukan(30);
    const h = await pra(l);
    for (let i = 0; i < 3; i++) {
      const r = await l.app.inject({
        method: "POST",
        url: "/api/admin/masuk/totp",
        headers: h,
        payload: { kode: kodeSalah(l) },
      });
      expect(r.statusCode).toBe(401);
    }
    const benar = await l.app.inject({
      method: "POST",
      url: "/api/admin/masuk/totp",
      headers: h,
      payload: { kode: l.kodeSekarang() },
    });
    expect(benar.statusCode).toBe(401);
    expect(benar.json<{ kode: string }>().kode).toBe("SESI_PRA_HABIS");
  });

  it("kunci karena kata sandi salah: login baru ditahan, sesi yang sedang berjalan TIDAK dicabut", async () => {
    const l = await siapkan();
    const { sesi } = await masukPenuh(l);
    for (let i = 0; i < 3; i++) await langkah1(l); // kata sandi benar berulang
    expect(l.repo.admin.get(l.adminId)?.gagalBeruntun).toBe(0);
    for (let i = 0; i < 5; i++) await langkah1(l, `salah-salah-${String(i)}-xx`);
    expect((await langkah1(l)).statusCode).toBe(401); // login baru ditahan
    const saya = await l.app.inject({
      method: "GET",
      url: "/api/admin/saya",
      headers: { cookie: `${COOKIE_SESI}=${sesi}` },
    });
    expect(saya.statusCode).toBe(200);
  });

  it("kunci karena TOTP salah (kata sandi sudah benar) mencabut semua sesi penuh", async () => {
    const l = await siapkan();
    const { sesi } = await masukPenuh(l);
    l.majukan(30);
    for (let i = 0; i < 5; i++) {
      const h = await pra(l);
      await l.app.inject({
        method: "POST",
        url: "/api/admin/masuk/totp",
        headers: h,
        payload: { kode: kodeSalah(l) },
      });
    }
    expect(l.repo.audit.at(-1)).toMatchObject({
      jenis: "LOGIN_ADMIN_DIKUNCI",
      data: { sesiDicabut: true },
    });
    const saya = await l.app.inject({
      method: "GET",
      url: "/api/admin/saya",
      headers: { cookie: `${COOKIE_SESI}=${sesi}` },
    });
    expect(saya.statusCode).toBe(401);
  });

  it("semafor penuh tidak membuat HP tak dikenal 503 permanen (hash dummy di luar semafor)", async () => {
    const l = await siapkan({}, "owner", { semafor: { maks: 1, maksAntre: 0, tungguMs: 10 } });
    const takDikenal = () => langkah1(l, "salah-salah-salah", "+6281299999999");
    const serbu = await Promise.all(Array.from({ length: 5 }, takDikenal));
    expect(serbu.map((x) => x.statusCode)).toContain(503);
    // Setelah beban reda: HP tak dikenal & HP dikenal sama-sama 401 (bukan 503 tersangkut).
    expect((await takDikenal()).statusCode).toBe(401);
    expect((await langkah1(l, "salah-salah-salah")).statusCode).toBe(401);
  });

  it("sesi idle > ADMIN_SESI_IDLE_MENIT berakhir; aktivitas memperpanjang", async () => {
    const l = await siapkan();
    const { sesi } = await masukPenuh(l);
    const saya = () =>
      l.app.inject({
        method: "GET",
        url: "/api/admin/saya",
        headers: { cookie: `${COOKIE_SESI}=${sesi}` },
      });
    l.majukan(20 * 60);
    expect((await saya()).statusCode).toBe(200); // disentuh
    l.majukan(20 * 60);
    expect((await saya()).statusCode).toBe(200); // 20 menit sejak sentuhan terakhir
    l.majukan(KONFIG_UJI.sesiIdleMenit * 60 + 1);
    expect((await saya()).statusCode).toBe(401);
  });

  it("header anti clickjacking & 401 sebelum validasi body", async () => {
    const l = await siapkan();
    const r = await l.app.inject({
      method: "POST",
      url: "/api/admin/produk",
      payload: { bukan: "skema" },
    });
    expect(r.statusCode).toBe(401);
    expect(r.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(r.headers["x-frame-options"]).toBe("DENY");
  });

  it("scrypt di bawah semafor: kelebihan beban → 503 SERVER_SIBUK", async () => {
    const l = await siapkan({}, "owner", { semafor: { maks: 1, maksAntre: 0, tungguMs: 10 } });
    const hasil = await Promise.all(Array.from({ length: 4 }, () => langkah1(l)));
    const kode = hasil.map((x) => x.statusCode);
    expect(kode).toContain(200);
    expect(kode).toContain(503);
    // Percobaan yang ditolak karena sibuk tidak memakan jatah penguncian.
    expect(l.repo.admin.get(l.adminId)?.gagalBeruntun).toBe(0);
  });

  it("batas laju masuk global bisa dimatikan (0)", async () => {
    const l = await siapkan({ batasMasukGlobalPerMenit: 0, batasMasukPerMenit: 1000 });
    for (let i = 0; i < 20; i++) {
      const r = await l.app.inject({
        method: "POST",
        url: "/api/admin/masuk",
        remoteAddress: `198.51.100.${String(i)}`,
        payload: { nomorHp: "+6281299999999", kataSandi: "salah-salah-salah" },
      });
      expect(r.statusCode).toBe(401);
    }
  });

  it("batas laju masuk global (semua IP) → 503", async () => {
    const l = await siapkan({ batasMasukGlobalPerMenit: 2 });
    const kode: number[] = [];
    for (let i = 0; i < 3; i++) {
      kode.push(
        (
          await l.app.inject({
            method: "POST",
            url: "/api/admin/masuk",
            remoteAddress: `198.51.100.${String(i)}`,
            payload: { nomorHp: HP, kataSandi: "salah-salah-salah" },
          })
        ).statusCode,
      );
    }
    expect(kode).toEqual([401, 401, 503]);
  });

  it("X-Forwarded-For hanya dipercaya dari proxy terdaftar (anti spoofing batas laju)", async () => {
    const coba = async (trustProxy: string[] | undefined, dari: string) => {
      const l = await siapkan({ batasMasukPerMenit: 2 }, "owner", trustProxy ? { trustProxy } : {});
      const kode: number[] = [];
      for (let i = 0; i < 3; i++) {
        kode.push(
          (
            await l.app.inject({
              method: "POST",
              url: "/api/admin/masuk",
              remoteAddress: dari,
              headers: { "x-forwarded-for": `203.0.113.${String(i)}` },
              payload: { nomorHp: HP, kataSandi: "salah-salah-salah" },
            })
          ).statusCode,
        );
      }
      return kode;
    };
    // Tanpa proxy tepercaya: XFF palsu diabaikan → IP sama → kena batas.
    expect(await coba(undefined, "192.0.2.9")).toEqual([401, 401, 429]);
    // Koneksi bukan dari proxy terdaftar: XFF diabaikan.
    expect(await coba(["127.0.0.1"], "192.0.2.9")).toEqual([401, 401, 429]);
    // Dari proxy terdaftar: IP klien dari XFF → tiap klien berbeda.
    expect(await coba(["127.0.0.1"], "127.0.0.1")).toEqual([401, 401, 401]);
  });

  it("mode Gudang: SKU baru dari panel ditolak (409) sampai ada pemetaan SKU", async () => {
    const l = await siapkan({ sumberInventori: "gudang" });
    const { sesi, csrf } = await masukPenuh(l);
    const r = await l.app.inject({
      method: "POST",
      url: "/api/admin/produk/00000000-0000-7000-8000-000000000001/sku",
      headers: { cookie: `${COOKIE_SESI}=${sesi}`, "x-csrf-token": csrf },
      payload: { kodeSku: "ABC-1", satuanDasar: "pcs" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ kode: string }>().kode).toBe("SKU_DARI_GUDANG");
    expect(l.katalog.panggilan).not.toContain("buatSku");
  });
});
