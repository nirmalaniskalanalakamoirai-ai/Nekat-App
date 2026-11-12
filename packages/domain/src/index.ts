// @nekat/domain — fungsi murni: harga, pagar, ledger, grup, COD, ongkir (ADR-0001 §3.1).
// HANYA boleh mengimpor `@nekat/shared` (dijaga eslint-plugin-boundaries di CI).
// Tanpa DB/HTTP/framework/modul bawaan Node. Engine harga dibuat di T-020.

export { tambahRupiah } from "./uang.js";
