// Repositori baca untuk `LocalInventory` (T-018): sumber stok & modal = tabel NEKAT sendiri.
// Hanya SELECT. Timpaan modal (P-25) TIDAK diterapkan di sini: modal efektif dihitung modul inventori.
import type {
  BarisModalLokal,
  BarisSkuLokal,
  BarisStokLokal,
  RepoInventoriLokal,
} from "@nekat/domain";
import { and, asc, eq, gt, inArray, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../koneksi.js";
import { kategori, modalSatuanJual, produk, satuanJual, sku, stokLokasi } from "../skema/index.js";

export function buatRepoInventoriLokal(db: Db): RepoInventoriLokal {
  return {
    async daftarSku(sejak) {
      const induk = alias(kategori, "induk");
      const sjMaks = db
        .select({ skuId: satuanJual.skuId, maks: max(satuanJual.diubahPada).as("sj_maks") })
        .from(satuanJual)
        .groupBy(satuanJual.skuId)
        .as("sj_maks_q");
      // GREATEST mengabaikan NULL (SKU tanpa satuan jual).
      const diubah =
        sql<Date>`greatest(${sku.diubahPada}, ${produk.diubahPada}, ${sjMaks.maks})`.mapWith(
          sku.diubahPada,
        );

      const baris = await db
        .select({
          skuId: sku.id,
          namaProduk: produk.nama,
          namaVarian: sku.namaVarian,
          kategoriKode: kategori.kode,
          indukKategoriKode: induk.kode,
          satuanDasar: sku.satuanDasar,
          barcode: sku.barcode,
          aktifSku: sku.aktifDiSumber,
          aktifProduk: produk.aktif,
          diubahPada: diubah,
        })
        .from(sku)
        .innerJoin(produk, eq(produk.id, sku.produkId))
        .innerJoin(kategori, eq(kategori.id, produk.kategoriId))
        .leftJoin(induk, eq(induk.id, kategori.indukId))
        .leftJoin(sjMaks, eq(sjMaks.skuId, sku.id))
        .where(sejak ? gt(diubah, sejak) : undefined)
        .orderBy(asc(sku.id));

      if (baris.length === 0) return [];
      const sj = await db
        .select({
          skuId: satuanJual.skuId,
          jenis: satuanJual.jenis,
          isi: satuanJual.isiSatuanDasar,
          beratGram: satuanJual.beratGram,
        })
        .from(satuanJual)
        .where(
          inArray(
            satuanJual.skuId,
            baris.map((b) => b.skuId),
          ),
        )
        .orderBy(asc(satuanJual.skuId), asc(satuanJual.isiSatuanDasar));
      const perSku = new Map<string, { jenis: string; isi: number; beratGram: number }[]>();
      for (const s of sj) {
        const daftar = perSku.get(s.skuId) ?? [];
        daftar.push({ jenis: s.jenis, isi: s.isi, beratGram: s.beratGram });
        perSku.set(s.skuId, daftar);
      }

      return baris.map((b): BarisSkuLokal => ({
        skuId: b.skuId,
        namaProduk: b.namaProduk,
        namaVarian: b.namaVarian,
        kategoriKode: b.kategoriKode,
        indukKategoriKode: b.indukKategoriKode,
        satuanDasar: b.satuanDasar,
        barcode: b.barcode,
        aktif: b.aktifSku && b.aktifProduk,
        diubahPada: b.diubahPada,
        satuanJual: perSku.get(b.skuId) ?? [],
      }));
    },

    async stok(skuIds, gudangId): Promise<BarisStokLokal[]> {
      if (skuIds.length === 0) return [];
      return db
        .select({
          skuId: stokLokasi.skuId,
          gudangId: stokLokasi.gudangId,
          tersedia: stokLokasi.tersedia,
          dataPada: stokLokasi.dataPada,
        })
        .from(stokLokasi)
        .where(and(inArray(stokLokasi.skuId, [...skuIds]), eq(stokLokasi.gudangId, gudangId)))
        .orderBy(asc(stokLokasi.skuId));
    },

    async modal(skuIds): Promise<BarisModalLokal[]> {
      if (skuIds.length === 0) return [];
      // Satuan jual tanpa baris modal → modalRp NULL (tidak tayang), dataPada = perubahan satuan jual.
      return db
        .select({
          skuId: satuanJual.skuId,
          jenis: satuanJual.jenis,
          modalRp: modalSatuanJual.modalRp,
          dataPada:
            sql<Date>`coalesce(${modalSatuanJual.dataPada}, ${modalSatuanJual.diubahPada}, ${satuanJual.diubahPada})`.mapWith(
              satuanJual.diubahPada,
            ),
        })
        .from(satuanJual)
        .leftJoin(modalSatuanJual, eq(modalSatuanJual.satuanJualId, satuanJual.id))
        .where(inArray(satuanJual.skuId, [...skuIds]))
        .orderBy(asc(satuanJual.skuId), asc(satuanJual.isiSatuanDasar));
    },
  };
}
