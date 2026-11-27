// Pagar sinkron: daftar jenis ledger di @nekat/domain harus sama dengan CHECK skema DB (T-021).
import { JENIS_DEBIT, JENIS_KREDIT, JENIS_LEDGER } from "@nekat/domain";
import { describe, expect, it } from "vitest";
import { JENIS_DEBIT_SALDO, JENIS_KREDIT_SALDO, JENIS_LEDGER_SALDO } from "../skema/saldo.js";

describe("jenis ledger domain = skema DB", () => {
  it("kredit, debit, dan semua jenis sama persis", () => {
    expect([...JENIS_KREDIT]).toEqual([...JENIS_KREDIT_SALDO]);
    expect([...JENIS_DEBIT]).toEqual([...JENIS_DEBIT_SALDO]);
    expect([...JENIS_LEDGER]).toEqual([...JENIS_LEDGER_SALDO]);
  });
});
