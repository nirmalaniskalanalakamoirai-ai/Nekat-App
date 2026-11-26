// Snapshot lokal inventori (T-019, T-009 §1/§6): pemetaan ID sumber, pembaca snapshot untuk katalog,
// dan penulis snapshot untuk job sinkron Gudang. Tabel snapshot = `stok_lokasi` & `modal_satuan_jual`
// (T-004 §3.6–§3.7; kolom `disinkron_pada`). Tidak ada harga jual/margin yang ditulis di sini.
import type {
  BarisModalLokal,
  BarisStokLokal,
  PembacaSnapshotInventori,
  PemetaanSumberInventori,
  RepoSinkronInventori,
  TinjauanSinkron,
} from "@nekat/domain";
import type { ModalSumber, SkuSumber } from "@nekat/shared";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../koneksi.js";
import {
  antreanTinjauan,
  gudang,
  hargaLevel,
  logAudit,
  modalSatuanJual,
  pemetaanSkuSumber,
  satuanJual,
  sku,
  stokLokasi,
} from "../skema/index.js";

/** ID NEKAT = UUID kanonik huruf kecil; lainnya dianggap tidak dikenal (tanpa normalisasi). */
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POTONGAN = 5_000;

function potong<T>(daftar: readonly T[]): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < daftar.length; i += POTONGAN) hasil.push(daftar.slice(i, i + POTONGAN));
  return hasil;
}

function uuidSaja(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((id) => POLA_UUID.test(id));
}

// ---------------------------------------------------------------------------------------------
// Pemetaan (dipakai GudangApiInventory; hanya baca)
// ---------------------------------------------------------------------------------------------

export function buatPemetaanSumberPg(db: Db): PemetaanSumberInventori {
  return {
    async skuKeSumber(skuIds) {
      const hasil = new Map<string, string>();
      for (const ids of potong(uuidSaja(skuIds))) {
        const baris = await db
          .select({ skuId: pemetaanSkuSumber.skuId, sumber: pemetaanSkuSumber.skuSumberId })
          .from(pemetaanSkuSumber)
          .where(inArray(pemetaanSkuSumber.skuId, ids));
        for (const b of baris) hasil.set(b.skuId, b.sumber);
      }
      return hasil;
    },

    async skuDariSumber(skuSumberIds) {
      const hasil = new Map<string, string>();
      for (const ids of potong([...new Set(skuSumberIds)])) {
        const baris = await db
          .select({ skuId: pemetaanSkuSumber.skuId, sumber: pemetaanSkuSumber.skuSumberId })
          .from(pemetaanSkuSumber)
          .where(inArray(pemetaanSkuSumber.skuSumberId, ids));
        for (const b of baris) hasil.set(b.sumber, b.skuId);
      }
      return hasil;
    },

    async lokasiKeSumber(lokasiId) {
      if (!POLA_UUID.test(lokasiId)) return null;
      // DEFAULT SEMENTARA (IG-03): kode lokasi Gudang = gudang.kode_konfig.
      const [b] = await db
        .select({ kode: gudang.kodeKonfig })
        .from(gudang)
        .where(and(eq(gudang.id, lokasiId), eq(gudang.aktif, true)))
        .limit(1);
      return b?.kode ?? null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Pembaca snapshot (katalog, engine harga, reservasi): TIDAK memanggil InventorySource
// ---------------------------------------------------------------------------------------------

export function buatPembacaSnapshotInventori(db: Db): PembacaSnapshotInventori {
  return {
    async stok(skuIds, gudangId): Promise<BarisStokLokal[]> {
      const ids = uuidSaja(skuIds);
      if (ids.length === 0 || !POLA_UUID.test(gudangId)) return [];
      const hasil: BarisStokLokal[] = [];
      for (const bagian of potong(ids)) {
        hasil.push(
          ...(await db
            .select({
              skuId: stokLokasi.skuId,
              gudangId: stokLokasi.gudangId,
              tersedia: stokLokasi.tersedia,
              // Umur data = yang tertua dari waktu data sumber dan sinkron terakhir (P-10).
              dataPada:
                sql<Date>`least(${stokLokasi.dataPada}, ${stokLokasi.disinkronPada})`.mapWith(
                  stokLokasi.dataPada,
                ),
            })
            .from(stokLokasi)
            .where(and(inArray(stokLokasi.skuId, bagian), eq(stokLokasi.gudangId, gudangId)))
            .orderBy(asc(stokLokasi.skuId))),
        );
      }
      return hasil;
    },

    async modal(skuIds): Promise<BarisModalLokal[]> {
      const ids = uuidSaja(skuIds);
      const hasil: BarisModalLokal[] = [];
      for (const bagian of potong(ids)) {
        hasil.push(
          ...(await db
            .select({
              skuId: satuanJual.skuId,
              jenis: satuanJual.jenis,
              modalRp: modalSatuanJual.modalRp,
              // LEAST mengabaikan NULL: baris MANUAL tanpa disinkron_pada memakai waktu datanya.
              dataPada:
                sql<Date>`least(coalesce(${modalSatuanJual.dataPada}, ${modalSatuanJual.diubahPada}, ${satuanJual.diubahPada}), ${modalSatuanJual.disinkronPada})`.mapWith(
                  satuanJual.diubahPada,
                ),
            })
            .from(satuanJual)
            .leftJoin(modalSatuanJual, eq(modalSatuanJual.satuanJualId, satuanJual.id))
            .where(inArray(satuanJual.skuId, bagian))
            .orderBy(asc(satuanJual.skuId), asc(satuanJual.isiSatuanDasar))),
        );
      }
      return hasil;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Penulis snapshot (job sinkron Gudang di worker)
// ---------------------------------------------------------------------------------------------

/** UUID deterministik dari teks (entitas tinjauan yang ID-nya bukan UUID, mis. SKU sumber). */
export function uuidDariTeks(ruang: string, teks: string): string {
  const h = createHash("sha256").update(`${ruang}\u0000${teks}`).digest("hex");
  // Bentuk UUID v8 (RFC 9562, "custom"): versi 8, varian 10xx.
  const varian = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${varian}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function buatRepoSinkronInventori(db: Db): RepoSinkronInventori {
  const audit = async (jenis: string, data: Readonly<Record<string, unknown>>) => {
    await db.insert(logAudit).values({ jenis, aktor: "SISTEM", refJenis: "inventori", data });
  };

  return {
    async skuTerpetakan() {
      const baris = await db
        .select({ skuId: pemetaanSkuSumber.skuId })
        .from(pemetaanSkuSumber)
        .orderBy(asc(pemetaanSkuSumber.skuId));
      return baris.map((b) => b.skuId);
    },

    async lokasiAktif() {
      const baris = await db
        .select({ id: gudang.id })
        .from(gudang)
        .where(eq(gudang.aktif, true))
        .orderBy(asc(gudang.id));
      return baris.map((b) => b.id);
    },

    async terapkanSku(hasil, opsi) {
      return db.transaction(async (tx) => {
        const terpetakan = (
          await tx.select({ skuId: pemetaanSkuSumber.skuId }).from(pemetaanSkuSumber)
        ).map((b) => b.skuId);
        const target = new Map<string, boolean>();
        let satuanBeda = 0;
        const masuk = new Map<string, SkuSumber>(hasil.map((h) => [h.skuId, h]));
        const lokal = new Map<string, string>();
        for (const ids of potong([...masuk.keys()].filter((id) => POLA_UUID.test(id)))) {
          for (const b of await tx
            .select({ id: sku.id, satuanDasar: sku.satuanDasar })
            .from(sku)
            .where(inArray(sku.id, ids))) {
            lokal.set(b.id, b.satuanDasar);
          }
        }
        for (const [skuId, h] of masuk) {
          const satuan = lokal.get(skuId);
          if (satuan === undefined) continue;
          // Satuan dasar beda → stok/isi tidak bisa dibandingkan: nonaktifkan, admin meninjau (IG-01).
          if (satuan !== h.satuanDasar) {
            satuanBeda++;
            target.set(skuId, false);
            continue;
          }
          target.set(skuId, h.aktifDiSumber);
        }
        let dinonaktifkan = 0;
        let ditahan = false;
        if (opsi.penuh) {
          const hilang = terpetakan.filter((id) => !masuk.has(id));
          if (hilang.length > opsi.maksNonaktif) {
            // Anomali (IG-08): terlalu banyak SKU "hilang" sekaligus → kemungkinan galat Gudang.
            // Penonaktifan ditahan; admin meninjau lewat log audit.
            ditahan = true;
            await tx.insert(logAudit).values({
              jenis: "SINKRON_GUDANG_ANOMALI_NONAKTIF",
              aktor: "SISTEM",
              refJenis: "inventori",
              data: {
                calon: hilang.length,
                batas: opsi.maksNonaktif,
                terpetakan: terpetakan.length,
              },
            });
          } else {
            for (const id of hilang) {
              target.set(id, false);
              dinonaktifkan++;
            }
          }
        }
        let diubah = 0;
        // Urut id agar urutan kunci baris konsisten antar-proses.
        for (const [id, aktif] of [...target].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          const r = await tx
            .update(sku)
            .set({ aktifDiSumber: aktif })
            .where(and(eq(sku.id, id), sql`${sku.aktifDiSumber} IS DISTINCT FROM ${aktif}`))
            .returning({ id: sku.id });
          diubah += r.length;
        }
        if (satuanBeda > 0) {
          await tx.insert(logAudit).values({
            jenis: "SINKRON_GUDANG_SATUAN_BEDA",
            aktor: "SISTEM",
            refJenis: "inventori",
            data: { jumlah: satuanBeda },
          });
        }
        return { diubah, dinonaktifkan, satuanBeda, ditahan };
      });
    },

    async simpanStok(lokasiId, diminta, stok, opsi) {
      const baris = new Map<string, { tersedia: number; dataPada: Date }>();
      for (const s of stok) {
        if (s.lokasiId !== lokasiId) continue;
        baris.set(s.skuId, { tersedia: s.tersedia, dataPada: new Date(s.dataPada) });
      }
      if (opsi.isiNol) {
        for (const id of diminta) {
          if (!baris.has(id)) baris.set(id, { tersedia: 0, dataPada: opsi.waktu });
        }
      }
      const nilai = [...baris]
        .filter(([id]) => POLA_UUID.test(id))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([skuId, b]) => ({
          skuId,
          gudangId: lokasiId,
          tersedia: b.tersedia,
          dataPada: b.dataPada,
          disinkronPada: opsi.waktu,
        }));
      if (nilai.length === 0) return 0;
      let n = 0;
      for (const bagian of potong(nilai)) {
        const r = await db
          .insert(stokLokasi)
          .values(bagian)
          .onConflictDoUpdate({
            target: [stokLokasi.skuId, stokLokasi.gudangId],
            set: {
              tersedia: sql`excluded.tersedia`,
              dataPada: sql`excluded.data_pada`,
              disinkronPada: sql`excluded.disinkron_pada`,
            },
            // Data sumber yang lebih tua dari snapshot (respons datang tidak berurutan) tidak menimpa.
            setWhere: sql`${stokLokasi.dataPada} <= excluded.data_pada`,
          })
          .returning({ skuId: stokLokasi.skuId });
        n += r.length;
      }
      return n;
    },

    async simpanModal(diminta, modal, waktu) {
      const kosong = { disimpan: 0, dikosongkan: 0, turun: 0, naik: 0, peringatanRupiah: 0 };
      const ids = uuidSaja(diminta);
      if (ids.length === 0) return kosong;
      const masuk = new Map<string, ModalSumber>(
        modal.map((m) => [`${m.skuId}\u0000${m.satuan}`, m]),
      );
      return db.transaction(async (tx) => {
        const r = { ...kosong };
        const catat = (jenis: string, refId: string, data: Record<string, unknown>) =>
          tx
            .insert(logAudit)
            .values({ jenis, aktor: "SISTEM", refJenis: "satuan_jual", refId, data });
        for (const bagian of potong(ids)) {
          const sj = await tx
            .select({
              id: satuanJual.id,
              skuId: satuanJual.skuId,
              jenis: satuanJual.jenis,
              modalGudangLama: modalSatuanJual.modalGudangRp,
              dataPadaLama: modalSatuanJual.dataPada,
            })
            .from(satuanJual)
            .leftJoin(modalSatuanJual, eq(modalSatuanJual.satuanJualId, satuanJual.id))
            .where(inArray(satuanJual.skuId, bagian))
            .orderBy(asc(satuanJual.id));
          if (sj.length === 0) continue;
          // Harga jual RUPIAH tersimpan (untuk peringatan "berhenti tayang" saat modal naik).
          const hargaRupiah = new Map<string, { level: string; harga: number }[]>();
          for (const h of await tx
            .select({
              satuanJualId: hargaLevel.satuanJualId,
              level: hargaLevel.level,
              harga: hargaLevel.hargaJualRp,
            })
            .from(hargaLevel)
            .where(
              and(
                inArray(
                  hargaLevel.satuanJualId,
                  sj.map((x) => x.id),
                ),
                eq(hargaLevel.mode, "RUPIAH"),
              ),
            )) {
            if (h.harga === null) continue;
            const d = hargaRupiah.get(h.satuanJualId) ?? [];
            d.push({ level: h.level, harga: h.harga });
            hargaRupiah.set(h.satuanJualId, d);
          }

          const nilai = [];
          for (const s of sj) {
            const m = masuk.get(`${s.skuId}\u0000${s.jenis}`);
            const dataPada = m ? new Date(m.dataPada) : waktu;
            // Pagar urutan: data sumber yang lebih tua dari snapshot tidak menimpa (sama dengan stok).
            if (s.dataPadaLama !== null && dataPada < s.dataPadaLama) continue;
            const baru = m?.modalPerSatuan ?? null;
            const lama = s.modalGudangLama;
            if (baru === null) r.dikosongkan++;
            else r.disimpan++;
            if (baru !== null && lama !== null && baru < lama) {
              // K-02: penurunan modal hanya dicatat (tanpa ambang tahan).
              r.turun++;
              await catat("MODAL_GUDANG_TURUN", s.id, { sebelumRp: lama, sesudahRp: baru });
            }
            if (baru !== null && lama !== null && baru > lama) {
              r.naik++;
              await catat("MODAL_GUDANG_NAIK", s.id, { sebelumRp: lama, sesudahRp: baru });
              // Harga jual RUPIAH ≤ modal baru → engine menahan satuan ini (tidak tayang): peringatkan.
              const kena = (hargaRupiah.get(s.id) ?? []).filter((h) => h.harga <= baru);
              if (kena.length > 0) {
                r.peringatanRupiah++;
                await catat("MODAL_NAIK_HARGA_RUPIAH_TIDAK_TAYANG", s.id, {
                  modalBaruRp: baru,
                  level: kena.map((h) => h.level).sort(),
                });
              }
            }
            nilai.push({
              satuanJualId: s.id,
              modalRp: baru,
              sumber: "GUDANG",
              modalGudangRp: baru,
              dataPada,
              disinkronPada: waktu,
            });
          }
          if (nilai.length === 0) continue;
          await tx
            .insert(modalSatuanJual)
            .values(nilai)
            .onConflictDoUpdate({
              target: modalSatuanJual.satuanJualId,
              set: {
                modalRp: sql`excluded.modal_rp`,
                sumber: sql`excluded.sumber`,
                modalGudangRp: sql`excluded.modal_gudang_rp`,
                dataPada: sql`excluded.data_pada`,
                disinkronPada: sql`excluded.disinkron_pada`,
              },
              // Pertahanan berlapis untuk proses paralel: data lebih tua tidak menimpa.
              setWhere: sql`${modalSatuanJual.dataPada} IS NULL OR ${modalSatuanJual.dataPada} <= excluded.data_pada`,
            });
        }
        return r;
      });
    },

    async catatTinjauan(t: TinjauanSinkron) {
      if (t.jenis === "MODAL_PECAHAN") {
        if (!POLA_UUID.test(t.skuId)) return;
        const [sj] = await db
          .select({ id: satuanJual.id })
          .from(satuanJual)
          .where(and(eq(satuanJual.skuId, t.skuId), eq(satuanJual.jenis, t.satuan)))
          .limit(1);
        if (!sj) return;
        await db
          .insert(antreanTinjauan)
          .values({
            jenis: "MODAL_PECAHAN",
            entitasJenis: "satuan_jual",
            entitasId: sj.id,
            data: { sumber: "gudang", nilaiMentah: t.nilaiMentah.slice(0, 50) },
          })
          .onConflictDoNothing();
        return;
      }
      await db
        .insert(antreanTinjauan)
        .values({
          jenis: "SKU_BELUM_DIPETAKAN",
          entitasJenis: "sku_sumber",
          entitasId: uuidDariTeks("sku_sumber", t.skuSumberId),
          data: { skuSumberId: t.skuSumberId.slice(0, 100), nama: t.nama.slice(0, 200) },
        })
        .onConflictDoNothing();
    },

    catatAudit: audit,
  };
}
