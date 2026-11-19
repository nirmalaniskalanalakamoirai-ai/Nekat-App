import { createHash } from "node:crypto";

/**
 * JSON kanonik (kunci objek terurut, tanpa spasi) untuk hash idempotensi (T-009 §3).
 * Hanya menerima nilai JSON biasa; angka non-finite ditolak agar hash tidak ambigu.
 */
export function jsonKanonik(nilai: unknown): string {
  if (nilai === null) return "null";
  switch (typeof nilai) {
    case "string":
    case "boolean":
      return JSON.stringify(nilai);
    case "number":
      if (!Number.isFinite(nilai)) throw new TypeError("angka non-finite tidak bisa dikanonkan");
      return JSON.stringify(nilai);
    case "object": {
      if (Array.isArray(nilai)) return `[${nilai.map(jsonKanonik).join(",")}]`;
      const obj = nilai as Record<string, unknown>;
      const kunci = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${kunci.map((k) => `${JSON.stringify(k)}:${jsonKanonik(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`tipe ${typeof nilai} tidak bisa dikanonkan`);
  }
}

/** SHA-256 (hex) dari JSON kanonik. */
export function hashKanonik(nilai: unknown): string {
  return createHash("sha256").update(jsonKanonik(nilai)).digest("hex");
}
