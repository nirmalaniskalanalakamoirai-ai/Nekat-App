import { keRupiah, type Rupiah } from "@nekat/shared";

/**
 * Penjumlahan rupiah. Semua aritmetika uang lewat helper di `@nekat/domain` (ADR-0001 §5.1).
 * Melempar bila hasil melewati batas bilangan bulat aman.
 */
export function tambahRupiah(a: Rupiah, b: Rupiah): Rupiah {
  return keRupiah(a + b);
}
