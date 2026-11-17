// Seed data referensi Fase 1 (T-013): kategori/subkategori contoh, peran & izin admin.
// TANPA harga, modal, margin, tarif, dan TANPA kategori rokok/bir (keputusan §7).
// Idempoten: aman dijalankan berulang.
import { sql } from "drizzle-orm";
import type { Db } from "./koneksi.js";
import { izin, kategori, peran, peranIzin } from "./skema/index.js";

interface SeedKategori {
  kode: string;
  nama: string;
  sub: readonly (readonly [kode: string, nama: string])[];
}

export const SEED_KATEGORI: readonly SeedKategori[] = [
  {
    kode: "sembako",
    nama: "Sembako",
    sub: [
      ["beras", "Beras"],
      ["minyak-goreng", "Minyak Goreng"],
      ["gula", "Gula"],
      ["telur", "Telur"],
      ["tepung", "Tepung"],
    ],
  },
  {
    kode: "dapur",
    nama: "Dapur & Bahan Masakan",
    sub: [
      ["bumbu", "Bumbu"],
      ["kecap-saus", "Kecap & Saus"],
      ["mi-instan", "Mi Instan"],
    ],
  },
  {
    kode: "minuman",
    nama: "Minuman",
    sub: [
      ["air-mineral", "Air Mineral"],
      ["teh-kopi", "Teh & Kopi"],
      ["susu", "Susu"],
      ["minuman-ringan", "Minuman Ringan"],
    ],
  },
  {
    kode: "makanan-ringan",
    nama: "Makanan Ringan",
    sub: [
      ["biskuit", "Biskuit"],
      ["keripik", "Keripik"],
      ["permen-cokelat", "Permen & Cokelat"],
    ],
  },
  {
    kode: "kebersihan-rumah",
    nama: "Kebersihan Rumah",
    sub: [
      ["sabun-cuci", "Sabun Cuci"],
      ["pembersih-lantai", "Pembersih Lantai"],
      ["tisu", "Tisu"],
    ],
  },
  {
    kode: "perawatan-diri",
    nama: "Perawatan Diri",
    sub: [
      ["sabun-mandi", "Sabun Mandi"],
      ["sampo", "Sampo"],
      ["pasta-gigi", "Pasta Gigi"],
    ],
  },
  {
    kode: "ibu-anak",
    nama: "Ibu & Anak",
    sub: [
      ["popok", "Popok"],
      ["susu-bayi", "Susu Bayi"],
    ],
  },
];

/** Kata kunci kategori terlarang Fase 1 (keputusan §7, P-24). Dipakai tes & validasi import. */
export const KATA_TERLARANG = [
  "rokok",
  "tembakau",
  "vape",
  "bir",
  "alkohol",
  "miras",
  "anggur",
] as const;

export const SEED_IZIN: readonly (readonly [
  kode: string,
  keterangan: string,
  hanyaOwner: boolean,
])[] = [
  ["harga.ubah", "Ubah modal, timpaan modal, margin/harga, aturan promo", false],
  ["produk.ubah", "Ubah produk, SKU, satuan jual", false],
  ["stok.ubah", "Ubah stok", false],
  ["grup.kelola", "Tahan, lepas, batalkan grup", false],
  ["pesanan.kelola", "Kelola pesanan", false],
  ["ongkir.ubah", "Ubah tarif ongkir & armada", false],
  ["cod.kelola", "Kelola COD", false],
  ["tinjauan.tangani", "Tangani antrean tinjauan", false],
  ["saldo.koreksi", "Ajukan koreksi saldo (alasan wajib)", false],
  ["pencairan.proses", "Proses pencairan saldo (alasan wajib)", false],
  ["pii.lihat", "Lihat nomor HP & alamat penuh per pesanan (tercatat)", false],
  ["admin.kelola", "Kelola admin", true],
  ["admin.reset_totp", "Reset TOTP admin lain", true],
  ["laporan.keuangan", "Lihat laporan keuangan", true],
  ["konfigurasi.ubah", "Ubah konfigurasi (PPN, TTL, biaya admin, ambang)", true],
  ["saldo.setujui", "Setujui koreksi saldo (four-eyes)", true],
];

export async function jalankanSeed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(peran)
      .values([
        { kode: "owner", nama: "Owner" },
        { kode: "admin", nama: "Admin" },
      ])
      .onConflictDoNothing();

    await tx
      .insert(izin)
      .values(SEED_IZIN.map(([kode, keterangan]) => ({ kode, keterangan })))
      .onConflictDoNothing();

    const pasangan = SEED_IZIN.flatMap(([kode, , hanyaOwner]) =>
      hanyaOwner
        ? [{ peranKode: "owner", izinKode: kode }]
        : [
            { peranKode: "owner", izinKode: kode },
            { peranKode: "admin", izinKode: kode },
          ],
    );
    await tx.insert(peranIzin).values(pasangan).onConflictDoNothing();

    for (const [i, k] of SEED_KATEGORI.entries()) {
      const [induk] = await tx
        .insert(kategori)
        .values({ kode: k.kode, nama: k.nama, urutan: i + 1 })
        .onConflictDoUpdate({ target: kategori.kode, set: { nama: sql`excluded.nama` } })
        .returning({ id: kategori.id });
      if (!induk) throw new Error(`Gagal membuat kategori ${k.kode}`);
      await tx
        .insert(kategori)
        .values(k.sub.map(([kode, nama], j) => ({ kode, nama, indukId: induk.id, urutan: j + 1 })))
        .onConflictDoNothing();
    }
  });
}
