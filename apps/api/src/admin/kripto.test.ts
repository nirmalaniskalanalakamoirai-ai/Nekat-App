import { describe, expect, it } from "vitest";
import { cekKataSandi, uuidV7 } from "./buat-admin.js";
import { BatasLaju, bacaCookie, cookieSesi } from "./http-util.js";
import { alamatAtauCidr, bacaKonfigAdmin, KonfigAdminTidakValidError } from "./konfig.js";
import { GalatSibuk, Semafor } from "./semafor.js";
import {
  base32,
  buatKodePemulihan,
  cocokKataSandi,
  cocokTotp,
  dariBase32,
  dekripsiRahasia,
  enkripsiRahasia,
  hashKataSandi,
  hashKodePemulihan,
  kodeTotp,
  uriOtpauth,
} from "./kripto.js";

const UJI = { logN: 10, r: 8, p: 1 };

describe("scrypt kata sandi", () => {
  it("hash berformat, garam acak, verifikasi benar/salah", async () => {
    const a = await hashKataSandi("rahasia-sangat-panjang", UJI);
    const b = await hashKataSandi("rahasia-sangat-panjang", UJI);
    expect(a).toMatch(/^scrypt\$10\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(await cocokKataSandi("rahasia-sangat-panjang", a)).toBe(true);
    expect(await cocokKataSandi("rahasia-sangat-panjang!", a)).toBe(false);
  });

  it("format rusak / parameter di luar batas → false, tidak melempar", async () => {
    for (const s of ["", "bcrypt$x", "scrypt$30$8$1$aa$bb", "scrypt$10$8$1$aa$pendek"]) {
      expect(await cocokKataSandi("apa saja", s)).toBe(false);
    }
  });

  it("bawaan memakai parameter OWASP (N=2^17)", async () => {
    const h = await hashKataSandi("x".repeat(12));
    expect(h.startsWith("scrypt$17$8$1$")).toBe(true);
  });
});

describe("TOTP RFC 6238 (vektor uji SHA-1, 6 digit)", () => {
  const rahasia = Buffer.from("12345678901234567890", "ascii");
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, kode) => {
    expect(kodeTotp(rahasia, Math.floor(t / 30))).toBe(kode);
    expect(cocokTotp(rahasia, kode, new Date(t * 1000))).toBe(Math.floor(t / 30));
  });

  it("jendela ±1 langkah, di luar itu ditolak", () => {
    const t = new Date(1234567890 * 1000);
    const langkah = Math.floor(1234567890 / 30);
    expect(cocokTotp(rahasia, kodeTotp(rahasia, langkah - 1), t)).toBe(langkah - 1);
    expect(cocokTotp(rahasia, kodeTotp(rahasia, langkah + 1), t)).toBe(langkah + 1);
    expect(cocokTotp(rahasia, kodeTotp(rahasia, langkah + 2), t)).toBeNull();
    expect(cocokTotp(rahasia, "abc123", t)).toBeNull();
  });

  it("base32 bolak-balik & URI otpauth tanpa nomor HP", () => {
    const b = Buffer.from("0123456789abcdefghij");
    expect(dariBase32(base32(b)).equals(b)).toBe(true);
    expect(base32(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    const uri = uriOtpauth(b, "Admin Uji");
    expect(uri).toMatch(/^otpauth:\/\/totp\/NEKAT%20Admin%3AAdmin%20Uji\?secret=/);
    expect(uri).toContain("issuer=NEKAT+Admin");
  });
});

describe("AES-256-GCM rahasia TOTP (AAD = admin_id)", () => {
  const kunci = Buffer.alloc(32, 3);
  const rahasia = Buffer.from("rahasia-totp-20-byte");
  it("enkripsi → dekripsi untuk admin yang sama", () => {
    const c = enkripsiRahasia(kunci, "admin-a", rahasia);
    expect(c.includes(rahasia)).toBe(false);
    expect(dekripsiRahasia(kunci, "admin-a", c).equals(rahasia)).toBe(true);
  });
  it("ciphertext dipindah ke admin lain / kunci lain / diubah → gagal", () => {
    const c = enkripsiRahasia(kunci, "admin-a", rahasia);
    expect(() => dekripsiRahasia(kunci, "admin-b", c)).toThrow();
    expect(() => dekripsiRahasia(Buffer.alloc(32, 4), "admin-a", c)).toThrow();
    const rusak = Buffer.from(c);
    rusak[rusak.length - 1] = (rusak[rusak.length - 1] ?? 0) ^ 1;
    expect(() => dekripsiRahasia(kunci, "admin-a", rusak)).toThrow();
  });
});

describe("kode pemulihan", () => {
  it("format XXXX-XXXX-XXXX tanpa karakter ambigu; hash terikat admin & tak peka huruf", () => {
    const k = buatKodePemulihan();
    expect(k).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const p1 = Buffer.alloc(32, 1);
    const h = (kunci: Buffer, id: string, kode: string) => hashKodePemulihan(kunci, id, kode);
    expect(h(p1, "a", k).equals(h(p1, "a", k.toLowerCase().replace(/-/g, " ")))).toBe(true);
    expect(h(p1, "a", k).equals(h(p1, "b", k))).toBe(false);
    // Pepper (ADMIN_HMAC_KUNCI) beda → hash beda: DB bocor saja tidak cukup.
    expect(h(p1, "a", k).equals(h(Buffer.alloc(32, 2), "a", k))).toBe(false);
  });
});

describe("aturan kata sandi & uuid v7", () => {
  it("panjang minimal, tidak boleh memuat nomor HP", () => {
    expect(cekKataSandi("pendek", "+6281200000001")).toMatch(/minimal/);
    expect(cekKataSandi("aaaaaaaaaaaaaaa", "+6281200000001")).toMatch(/mudah/);
    expect(cekKataSandi("x81200000001yz", "+6281200000001")).toMatch(/nomor HP/);
    expect(cekKataSandi("kuda-baterai-staples-benar", "+6281200000001")).toBeNull();
  });
  it("uuid v7 valid dan urut waktu", () => {
    const a = uuidV7(new Date("2026-01-01T00:00:00Z"));
    const b = uuidV7(new Date("2026-01-01T00:00:01Z"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe("cookie & batas laju", () => {
  it("bacaCookie hanya menerima token base64url", () => {
    const t = "A".repeat(43);
    expect(bacaCookie(`x=1; __Host-nekat_admin=${t}`, "__Host-nekat_admin")).toBe(t);
    expect(bacaCookie("__Host-nekat_admin=<script>", "__Host-nekat_admin")).toBeUndefined();
    expect(bacaCookie(undefined, "a")).toBeUndefined();
    expect(cookieSesi("n", t, 60)).toBe(
      `n=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=60`,
    );
  });
  it("jendela tetap per kunci", () => {
    let kini = 0;
    const b = new BatasLaju({ maks: 2, jendelaMs: 1000, sekarang: () => kini });
    expect([b.ambil("ip"), b.ambil("ip"), b.ambil("ip"), b.ambil("lain")]).toEqual([
      true,
      true,
      false,
      true,
    ]);
    kini = 1000;
    expect(b.ambil("ip")).toBe(true);
  });
});

describe("konfigurasi admin dari env", () => {
  const k32 = Buffer.alloc(32, 1).toString("base64");
  const k32b = Buffer.alloc(32, 2).toString("base64");
  it("kunci TOTP = kunci HMAC ditolak; idle bawaan 30 menit", () => {
    expect(() => bacaKonfigAdmin({ ADMIN_TOTP_KUNCI: k32, ADMIN_HMAC_KUNCI: k32 })).toThrow(
      /ADMIN_HMAC_KUNCI/,
    );
    expect(bacaKonfigAdmin({ ADMIN_TOTP_KUNCI: k32, ADMIN_HMAC_KUNCI: k32b })?.sesiIdleMenit).toBe(
      30,
    );
  });
  it("TRUST_PROXY hanya alamat/CIDR (bukan hop/kata kunci)", () => {
    for (const ok of ["127.0.0.1", "10.0.0.0/8", "::1", "fd00::/8"]) {
      expect(alamatAtauCidr(ok)).toBe(true);
    }
    for (const salah of ["1", "true", "loopback", "10.0.0.0/33", "300.1.1.1", "1.2.3.4/8/1"]) {
      expect(alamatAtauCidr(salah)).toBe(false);
    }
  });
  it("tanpa kunci → null (panel 503); lengkap → valid; sebagian/salah → galat sebut nama saja", () => {
    expect(bacaKonfigAdmin({})).toBeNull();
    const k = bacaKonfigAdmin({
      ADMIN_TOTP_KUNCI: k32,
      ADMIN_HMAC_KUNCI: k32b,
      APP_BASE_URL: "https://nekat.contoh/x",
    });
    expect(k?.originDiizinkan).toEqual(["https://nekat.contoh"]);
    expect(k?.sesiMenit).toBe(240);
    expect(k?.masukGlobalPerMenit).toBe(600);
    try {
      bacaKonfigAdmin({ ADMIN_TOTP_KUNCI: "rahasia-pendek", ADMIN_SESI_MENIT: "99999" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(KonfigAdminTidakValidError);
      const pesan = (err as Error).message;
      expect(pesan).toContain("ADMIN_TOTP_KUNCI");
      expect(pesan).toContain("ADMIN_HMAC_KUNCI");
      expect(pesan).toContain("ADMIN_SESI_MENIT");
      expect(pesan).not.toContain("rahasia-pendek");
    }
  });
});

describe("semafor scrypt (DoS)", () => {
  it("maks bersamaan dihormati; antrean penuh / tunggu habis → GalatSibuk", async () => {
    const sem = new Semafor({ maks: 1, maksAntre: 1, tungguMs: 50 });
    let lepas: () => void = () => undefined;
    const pertama = sem.jalankan(
      () =>
        new Promise<string>((s) => {
          lepas = () => {
            s("a");
          };
        }),
    );
    const kedua = sem.jalankan(() => Promise.resolve("b")); // antre
    await expect(sem.jalankan(() => Promise.resolve("c"))).rejects.toBeInstanceOf(GalatSibuk);
    expect(sem.berjalan).toBe(1);
    lepas();
    expect(await pertama).toBe("a");
    expect(await kedua).toBe("b");
    // Tunggu habis.
    const lama = sem.jalankan(() => new Promise((s) => setTimeout(s, 200)));
    await expect(sem.jalankan(() => Promise.resolve(1))).rejects.toBeInstanceOf(GalatSibuk);
    await lama;
    expect(sem.berjalan).toBe(0);
  });
});
