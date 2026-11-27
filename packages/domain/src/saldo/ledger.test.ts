// Unit ledger saldo (T-021). Angka rupiah di sini hanya data uji, BUKAN harga/margin.
import { keRupiah } from "@nekat/shared";
import { describe, expect, it } from "vitest";
import {
  bacaCursorRiwayat,
  GalatSaldo,
  hitungPakaiSaldo,
  identitasKredit,
  JENIS_LEDGER,
  kunciDebitCheckout,
  kunciKoreksi,
  kunciSaldoBalik,
  LABEL_JENIS_LEDGER,
  labelJenisLedger,
  nominalKoreksi,
  nominalPositif,
  saldoSesudah,
  uuidKanonik,
  type SumberKredit,
} from "./ledger.js";

const A = "0190f1a2-0000-7000-8000-00000000000a";
const B = "0190f1a2-0000-7000-8000-00000000000b";

function kodeGalat(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof GalatSaldo) return e.kode;
    throw e;
  }
  throw new Error("Diharapkan GalatSaldo");
}

describe("kunci idempotensi deterministik (pembayaran.md §8.2)", () => {
  it("rumus kunci debit, saldo-balik, koreksi", () => {
    expect(kunciDebitCheckout(A)).toBe(`debit:${A}`);
    expect(kunciSaldoBalik(A)).toBe(`saldo-balik:${A}`);
    expect(kunciKoreksi(A)).toBe(`koreksi:${A}`);
  });

  const kasus: [SumberKredit, string, string, string][] = [
    [
      { jenis: "REFUND", alasan: "GRUP_BATAL", pesertaId: A, grupId: B },
      `refund:${A}:GRUP_BATAL:${B}`,
      "PESERTA_GRUP",
      A,
    ],
    [
      { jenis: "REFUND", alasan: "SLOT_BATAL", pesertaId: A, slotId: B },
      `refund:${A}:SLOT_BATAL:${B}`,
      "PESERTA_GRUP",
      A,
    ],
    [
      { jenis: "REFUND", alasan: "STOK_HABIS", barisInvoiceId: A },
      `refund:${A}:STOK_HABIS`,
      "BARIS_INVOICE",
      A,
    ],
    [
      { jenis: "REFUND", alasan: "ALOKASI", barisInvoiceId: A, jobCutoffId: `cutoff:${B}` },
      `refund:${A}:ALOKASI:cutoff:${B}`,
      "BARIS_INVOICE",
      A,
    ],
    [{ jenis: "REFUND", alasan: "KELUHAN", keluhanId: A }, `keluhan:${A}`, "KELUHAN", A],
    [{ jenis: "SELISIH_HARGA", grupId: B, pesertaId: A }, `selisih:${B}:${A}`, "PESERTA_GRUP", A],
    [
      { jenis: "REFUND_ONGKIR", invoiceId: A, pesertaId: B },
      `refund_ongkir:${A}:${B}`,
      "INVOICE",
      A,
    ],
    [{ jenis: "BAYAR_TERLAMBAT", pembayaranId: A }, `bayar_terlambat:${A}`, "PEMBAYARAN", A],
  ];

  it.each(kasus)("%o → kunci tabel §8.2", (sumber, kunci, refJenis, refId) => {
    const id = identitasKredit(sumber);
    expect(id.kunciIdempotensi).toBe(kunci);
    expect(id.jenis).toBe(sumber.jenis);
    expect(id.referensiJenis).toBe(refJenis);
    expect(id.referensiId).toBe(refId);
  });

  it("sumber sama → kunci sama (huruf besar dinormalkan); sumber beda → kunci beda", () => {
    const s1 = identitasKredit({ jenis: "SELISIH_HARGA", grupId: B, pesertaId: A });
    const s2 = identitasKredit({ jenis: "SELISIH_HARGA", grupId: B.toUpperCase(), pesertaId: A });
    expect(s2.kunciIdempotensi).toBe(s1.kunciIdempotensi);
    const semua = kasus.map(([s]) => identitasKredit(s).kunciIdempotensi);
    expect(new Set(semua).size).toBe(semua.length);
  });

  it("menolak id bukan UUID & id cut-off berisi spasi", () => {
    expect(kodeGalat(() => kunciDebitCheckout("1"))).toBe("ID_TIDAK_VALID");
    expect(kodeGalat(() => uuidKanonik(`${A} `))).toBe("ID_TIDAK_VALID");
    expect(
      kodeGalat(() =>
        identitasKredit({
          jenis: "REFUND",
          alasan: "ALOKASI",
          barisInvoiceId: A,
          jobCutoffId: "a b",
        }),
      ),
    ).toBe("ID_TIDAK_VALID");
    expect(
      kodeGalat(() => identitasKredit({ jenis: "PENCAIRAN" } as unknown as SumberKredit)),
    ).toBe("ID_TIDAK_VALID");
  });
});

describe("nominal", () => {
  it("nominal positif: integer aman > 0", () => {
    expect(nominalPositif(1)).toBe(1);
    for (const n of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(kodeGalat(() => nominalPositif(n))).toBe("NOMINAL_TIDAK_VALID");
    }
  });

  it("nominal koreksi: bertanda, ≠ 0, integer", () => {
    expect(nominalKoreksi(-5)).toBe(-5);
    expect(kodeGalat(() => nominalKoreksi(0))).toBe("NOMINAL_TIDAK_VALID");
    expect(kodeGalat(() => nominalKoreksi(0.5))).toBe("NOMINAL_TIDAK_VALID");
  });

  it("pakai saldo = min(saldo, maks): menutup penuh atau sebagian, tanpa pembulatan", () => {
    expect(hitungPakaiSaldo(keRupiah(7001), keRupiah(5000))).toBe(5000);
    expect(hitungPakaiSaldo(keRupiah(3333), keRupiah(5000))).toBe(3333);
    expect(hitungPakaiSaldo(keRupiah(0), keRupiah(5000))).toBe(0);
  });

  it("saldo sesudah tidak boleh negatif", () => {
    expect(saldoSesudah(keRupiah(10), -10)).toBe(0);
    expect(kodeGalat(() => saldoSesudah(keRupiah(10), -11))).toBe("SALDO_KURANG");
    expect(kodeGalat(() => saldoSesudah(keRupiah(Number.MAX_SAFE_INTEGER), 1))).toBe(
      "NOMINAL_TIDAK_VALID",
    );
  });
});

describe("tampilan & cursor", () => {
  it("setiap jenis punya label bahasa pengguna", () => {
    for (const j of JENIS_LEDGER) expect(LABEL_JENIS_LEDGER[j].length).toBeGreaterThan(0);
    expect(labelJenisLedger("TIDAK_DIKENAL")).toBe("Mutasi poin");
  });

  it("cursor hanya angka positif", () => {
    expect(bacaCursorRiwayat(undefined)).toBeUndefined();
    expect(bacaCursorRiwayat("")).toBeUndefined();
    expect(bacaCursorRiwayat("42")).toBe(42);
    for (const c of ["0", "-1", "1e3", "abc", "01", "99999999999999999"]) {
      expect(kodeGalat(() => bacaCursorRiwayat(c))).toBe("ID_TIDAK_VALID");
    }
  });
});
