// Rute saldo (T-021): 401 sampai T-016, DTO tanpa data internal, akun hanya dari sesi.
import type { HalamanRiwayat, RepoSaldo } from "@nekat/db";
import { keRupiah } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import { buatApp } from "../app.js";

const AKUN = "0190f1a2-0000-7000-8000-0000000000aa";

function repoPalsu(): RepoSaldo & { panggilan: { akunId: string; opsi: unknown }[] } {
  const panggilan: { akunId: string; opsi: unknown }[] = [];
  return {
    panggilan,
    riwayat(akunId, opsi) {
      panggilan.push({ akunId, opsi });
      const h: HalamanRiwayat = {
        saldoRp: keRupiah(2_000),
        entri: [
          {
            id: 7,
            waktu: new Date("2026-11-27T01:02:03Z"),
            jenis: "PAKAI_CHECKOUT",
            jenisTampil: "Dipakai untuk bayar tagihan",
            jumlahRp: -1_000,
            saldoSesudahRp: keRupiah(2_000),
            referensiTampil: "INV-1",
          },
        ],
        cursorBerikut: "7",
      };
      return Promise.resolve(h);
    },
  };
}

describe("GET /api/saldo", () => {
  it("bawaan (sebelum T-016): selalu 401, repo tidak disentuh, termasuk input aneh", async () => {
    const repo = repoPalsu();
    const app = buatApp({ logger: false, saldo: { repo } });
    for (const url of ["/api/saldo", "/api/saldo?batas=999", `/api/saldo?akunId=${AKUN}`]) {
      const r = await app.inject({ method: "GET", url, headers: { authorization: "Bearer x" } });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ kode: "BELUM_MASUK", pesan: expect.any(String) as string });
    }
    expect(repo.panggilan).toHaveLength(0);
    // Tanpa opsi saldo sama sekali juga 401.
    const r = await buatApp({ logger: false }).inject({ method: "GET", url: "/api/saldo" });
    expect(r.statusCode).toBe(401);
  });

  it("dengan sesi: saldo + riwayat untuk akun sesi saja; parameter akun dari klien diabaikan", async () => {
    const repo = repoPalsu();
    const app = buatApp({
      logger: false,
      saldo: { repo, autentikasi: () => Promise.resolve({ akunId: AKUN }) },
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/saldo?batas=5&cursor=9&akunId=0190f1a2-0000-7000-8000-0000000000bb",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      saldoRp: 2_000,
      entri: [
        {
          id: "7",
          waktu: "2026-11-27T01:02:03.000Z",
          jenisTampil: "Dipakai untuk bayar tagihan",
          jumlahRp: -1_000,
          saldoSesudahRp: 2_000,
          referensiTampil: "INV-1",
        },
      ],
      cursorBerikut: "7",
    });
    expect(repo.panggilan).toEqual([{ akunId: AKUN, opsi: { batas: 5, sebelumId: 9 } }]);
  });

  it("sesi dengan akunId bukan UUID → 401 (bukan 500), repo tidak disentuh", async () => {
    const repo = repoPalsu();
    const app = buatApp({
      logger: false,
      saldo: { repo, autentikasi: () => Promise.resolve({ akunId: "bukan-uuid" }) },
    });
    const r = await app.inject({ method: "GET", url: "/api/saldo" });
    expect(r.statusCode).toBe(401);
    expect(repo.panggilan).toHaveLength(0);
  });

  it("input tidak valid → 400; repo belum ada → 503", async () => {
    const auth = () => Promise.resolve({ akunId: AKUN });
    const app = buatApp({ logger: false, saldo: { repo: repoPalsu(), autentikasi: auth } });
    for (const url of ["/api/saldo?batas=0", "/api/saldo?batas=51", "/api/saldo?cursor=abc"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(400);
    }
    const tanpaRepo = buatApp({ logger: false, saldo: { repo: null, autentikasi: auth } });
    expect((await tanpaRepo.inject({ method: "GET", url: "/api/saldo" })).statusCode).toBe(503);
  });
});
