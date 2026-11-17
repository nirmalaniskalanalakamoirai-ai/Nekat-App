import { sql } from "drizzle-orm";
import type { Db } from "./koneksi.js";
import { izin, kategori, peran, peranIzin } from "./skema/index.js";

// Seed T-013a: kategori/subkategori contoh, peran & izin admin (T-004 §3.3).
// TANPA harga, modal, tarif, produk, dan TANPA kategori rokok/bir (keputusan §7).
// Idempoten: aman dijalankan berulang.

interface KategoriSeed {
  kode: string;
  nama: string;
  sub: readonly (readonly [kode: string, nama: string])[];
}

export const KATEGORI_SEED: readonly KategoriSeed[] = [
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
      ["bumbu", "Bumbu & Penyedap"],
      ["saus-kecap", "Saus & Kecap"],
      ["mi-instan", "Mi Instan"],
    ],
  },
  {
    kode: "minuman",
    nama: "Minuman",
    sub: [
      ["air-mineral", "Air Mineral"],
      ["kopi-teh", "Kopi & Teh"],
      ["susu", "Susu"],
    ],
  },
  {
    kode: "makanan-ringan",
    nama: "Makanan Ringan",
    sub: [
      ["biskuit", "Biskuit"],
      ["keripik", "Keripik"],
    ],
  },
  {
    kode: "rumah-tangga",
    nama: "Kebutuhan Rumah Tangga",
    sub: [
      ["sabun-cuci", "Sabun Cuci"],
      ["pembersih", "Pembersih Rumah"],
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
      ["susu-anak", "Susu Anak"],
    ],
  },
] as const;

/** Kode kategori yang tidak boleh ada di Fase 1 (keputusan §7). Dicek oleh tes seed. */
export const KATEGORI_TERLARANG = [
  "rokok",
  "tembakau",
  "bir",
  "alkohol",
  "minuman-beralkohol",
] as const;

export const PERAN_SEED = [
  ["owner", "Pemilik"],
  ["admin", "Admin"],
] as const;

export const IZIN_SEED: readonly (readonly [
  kode: string,
  keterangan: string,
  peran: readonly string[],
])[] = [
  ["harga.ubah", "Ubah modal, timpaan modal, margin/harga, aturan promo", ["owner", "admin"]],
  ["produk.ubah", "Ubah produk & satuan jual", ["owner", "admin"]],
  ["stok.ubah", "Ubah stok", ["owner", "admin"]],
  ["grup.kelola", "Tahan, lepas, batalkan grup", ["owner", "admin"]],
  ["pesanan.kelola", "Kelola pesanan", ["owner", "admin"]],
  ["ongkir.ubah", "Ubah tarif & armada", ["owner", "admin"]],
  ["cod.kelola", "Kelola COD", ["owner", "admin"]],
  ["tinjauan.tangani", "Tangani antrean tinjauan", ["owner", "admin"]],
  ["saldo.koreksi", "Ajukan koreksi saldo (alasan wajib)", ["owner", "admin"]],
  ["pencairan.proses", "Proses pencairan saldo", ["owner", "admin"]],
  ["pii.lihat", "Lihat nomor HP & alamat tanpa samaran (tercatat)", ["owner", "admin"]],
  ["admin.kelola", "Kelola akun admin", ["owner"]],
  ["admin.reset_totp", "Reset TOTP admin lain", ["owner"]],
  ["laporan.keuangan", "Lihat laporan keuangan", ["owner"]],
  ["konfigurasi.ubah", "Ubah konfigurasi (PPN, TTL, biaya admin, ambang)", ["owner"]],
  ["saldo.setujui", "Setujui koreksi saldo (four-eyes)", ["owner"]],
];

export async function jalankanSeed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, k] of KATEGORI_SEED.entries()) {
      const [induk] = await tx
        .insert(kategori)
        .values({ kode: k.kode, nama: k.nama, urutan: i })
        .onConflictDoUpdate({
          target: kategori.kode,
          set: { nama: k.nama, urutan: i, diubahPada: sql`now()` },
        })
        .returning({ id: kategori.id });
      if (!induk) throw new Error(`Gagal menyimpan kategori ${k.kode}`);
      for (const [j, [kode, nama]] of k.sub.entries()) {
        await tx
          .insert(kategori)
          .values({ kode, nama, urutan: j, indukId: induk.id })
          .onConflictDoUpdate({
            target: kategori.kode,
            set: { nama, urutan: j, indukId: induk.id, diubahPada: sql`now()` },
          });
      }
    }

    for (const [kode, nama] of PERAN_SEED) {
      await tx
        .insert(peran)
        .values({ kode, nama })
        .onConflictDoUpdate({ target: peran.kode, set: { nama } });
    }
    for (const [kode, keterangan, daftarPeran] of IZIN_SEED) {
      await tx
        .insert(izin)
        .values({ kode, keterangan })
        .onConflictDoUpdate({ target: izin.kode, set: { keterangan } });
      for (const p of daftarPeran) {
        await tx.insert(peranIzin).values({ peranKode: p, izinKode: kode }).onConflictDoNothing();
      }
    }
  });
}
