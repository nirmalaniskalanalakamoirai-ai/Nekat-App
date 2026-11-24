// Repositori baca katalog pembeli (T-025). Hanya SELECT. Penyaringan tayang (harga, stok,
// kategori terlarang) dilakukan domain `susunKatalog`; di sini hanya saringan murah (aktif).
// Modal & stok TIDAK dibaca di sini: keduanya lewat InventorySource (T-018), kecuali timpaan modal
// admin (P-25) yang memang milik NEKAT.
import type { DataKatalog, RepoKatalog } from "@nekat/domain";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../koneksi.js";
import {
  gudang,
  hargaLevel,
  kategori,
  modalTimpaan,
  produk,
  satuanJual,
  sku,
} from "../skema/index.js";

/** Batas parameter per `IN (...)` agar query tetap di bawah batas parameter PostgreSQL. */
const POTONGAN_IN = 5_000;

function potong<T>(daftar: readonly T[]): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < daftar.length; i += POTONGAN_IN) hasil.push(daftar.slice(i, i + POTONGAN_IN));
  return hasil;
}

type Pembaca = Pick<Db, "select">;

/** Semua bacaan dalam satu transaksi REPEATABLE READ read-only agar snapshot konsisten. */
async function muat(db: Pembaca): Promise<DataKatalog> {
  const barisKategori = await db
    .select({
      id: kategori.id,
      indukId: kategori.indukId,
      kode: kategori.kode,
      nama: kategori.nama,
      urutan: kategori.urutan,
      aktif: kategori.aktif,
    })
    .from(kategori)
    .orderBy(asc(kategori.urutan), asc(kategori.kode));

  const barisProduk = await db
    .select({
      id: produk.id,
      kategoriId: produk.kategoriId,
      nama: produk.nama,
      deskripsi: produk.deskripsi,
      gambarUrl: produk.gambarUrl,
      bebasPpn: produk.bebasPpn,
      tinjauanKategori: produk.tinjauanKategori,
      aktif: produk.aktif,
    })
    .from(produk)
    .where(eq(produk.aktif, true))
    .orderBy(asc(produk.id));

  const barisSku = await db
    .select({
      id: sku.id,
      produkId: sku.produkId,
      kodeSku: sku.kodeSku,
      namaVarian: sku.namaVarian,
      satuanDasar: sku.satuanDasar,
      aktifDiSumber: sku.aktifDiSumber,
    })
    .from(sku)
    .innerJoin(produk, eq(produk.id, sku.produkId))
    .where(and(eq(produk.aktif, true), eq(sku.aktifDiSumber, true)))
    .orderBy(asc(sku.id));

  const skuIds = barisSku.map((s) => s.id);
  const barisSatuan = [];
  for (const ids of potong(skuIds)) {
    barisSatuan.push(
      ...(await db
        .select({
          id: satuanJual.id,
          skuId: satuanJual.skuId,
          jenis: satuanJual.jenis,
          isiSatuanDasar: satuanJual.isiSatuanDasar,
          moqMitraGrosir: satuanJual.moqMitraGrosir,
          bolehGrup: satuanJual.bolehGrup,
        })
        .from(satuanJual)
        .where(inArray(satuanJual.skuId, ids))
        .orderBy(asc(satuanJual.id))),
    );
  }

  const sjIds = barisSatuan.map((s) => s.id);
  const barisHarga = [];
  const barisTimpaan = [];
  for (const ids of potong(sjIds)) {
    barisHarga.push(
      ...(await db
        .select({
          satuanJualId: hargaLevel.satuanJualId,
          level: hargaLevel.level,
          mode: hargaLevel.mode,
          marginPersen: hargaLevel.marginPersen,
          hargaJualRp: hargaLevel.hargaJualRp,
        })
        .from(hargaLevel)
        .where(inArray(hargaLevel.satuanJualId, ids))),
    );
    barisTimpaan.push(
      ...(await db
        .select({ satuanJualId: modalTimpaan.satuanJualId, modalRp: modalTimpaan.modalRp })
        .from(modalTimpaan)
        .where(and(inArray(modalTimpaan.satuanJualId, ids), isNull(modalTimpaan.dicabutPada)))),
    );
  }

  return {
    kategori: barisKategori,
    produk: barisProduk,
    sku: barisSku,
    satuanJual: barisSatuan,
    hargaLevel: barisHarga,
    timpaanModal: barisTimpaan,
  };
}

export function buatRepoKatalog(db: Db): RepoKatalog {
  return {
    muatData(): Promise<DataKatalog> {
      return db.transaction((tx) => muat(tx), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },

    async idGudang(kodeKonfig: string): Promise<string | null> {
      const [baris] = await db
        .select({ id: gudang.id })
        .from(gudang)
        .where(and(eq(gudang.kodeKonfig, kodeKonfig), eq(gudang.aktif, true)))
        .limit(1);
      return baris?.id ?? null;
    },
  };
}
