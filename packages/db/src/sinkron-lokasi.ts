// T-015b · Sinkron config/lokasi.json → tabel gudang, zona, drop_point.
//
// Satu sumber kebenaran: config/lokasi.json (M7). DB hanya menyimpan cerminan tanpa koordinat
// (kode_konfig, nama, relasi, aktif) agar slot kirim, grup, invoice, alamat bisa ber-FK ke zona/drop point.
//
// Aturan:
// - Idempoten: config yang sama dijalankan berulang → 0 perubahan, 0 baris log.
// - Entri di config → dibuat/diperbarui dan `aktif = true`. Drop point pusat zona = drop point pertama.
// - Entri di DB yang tidak ada lagi di config (dan masih aktif) → DILEPAS: dihapus bila belum dipakai
//   baris lain (FK RESTRICT ke grup, invoice, slot, alamat, stok, ...), selain itu hanya dinonaktifkan.
//   Baris yang sudah nonaktif dibiarkan (riwayat).
// - Drop point tidak boleh pindah zona (riwayat grup/invoice ikut berubah makna): pakai kode baru.
// - Pagar operasional (default sementara Z-03, menunggu Randy + Ops): zona/drop point/gudang yang
//   masih dipakai slot kirim DIBUKA atau grup belum final tidak boleh dilepas, dan zona seperti itu
//   tidak boleh pindah gudang — kecuali `paksa`. Lihat `rencanakanSinkronLokasi`.
// - Pagar skema: semua FK ke gudang/zona/drop_point harus ON DELETE RESTRICT (bukan CASCADE /
//   SET NULL / NO ACTION deferrable) agar "hapus bila belum dipakai" tidak ikut menghapus riwayat.
// - Semua dalam satu transaksi + advisory lock; tiap perubahan dicatat di log_audit (aktor SISTEM).
import { createHash } from "node:crypto";
import type { KonfigLokasi } from "@nekat/shared";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "./koneksi.js";
import { dropPoint, gudang, logAudit, STATUS_PESERTA_NONAKTIF, zona } from "./skema/index.js";

export type JenisEntitasLokasi = "gudang" | "zona" | "drop_point";
export type NilaiLokasi = Record<string, string | boolean | null>;

export type LangkahSinkronLokasi =
  | {
      readonly aksi: "TAMBAH";
      readonly jenis: JenisEntitasLokasi;
      readonly kode: string;
      readonly sesudah: NilaiLokasi;
    }
  | {
      readonly aksi: "UBAH";
      readonly jenis: JenisEntitasLokasi;
      readonly kode: string;
      /** Hanya kolom yang berubah. */
      readonly sebelum: NilaiLokasi;
      readonly sesudah: NilaiLokasi;
    }
  | { readonly aksi: "LEPAS"; readonly jenis: JenisEntitasLokasi; readonly kode: string };

export type PerubahanLokasi = LangkahSinkronLokasi & {
  /** Hanya untuk LEPAS, setelah diterapkan. */
  readonly hasil?: "DIHAPUS" | "DINONAKTIFKAN";
};

export interface RencanaSinkronLokasi {
  readonly langkah: readonly LangkahSinkronLokasi[];
  /** Tidak kosong = sinkron ditolak, tidak ada yang ditulis (tidak bisa dipaksa). */
  readonly konflik: readonly string[];
  /** Masih dipakai slot DIBUKA / grup belum final (Z-03). Menolak sinkron kecuali `paksa`. */
  readonly konflikPemakaian: readonly string[];
}

export interface HasilSinkronLokasi {
  readonly kering: boolean;
  readonly perubahan: readonly PerubahanLokasi[];
  /** Hanya terisi pada mode kering (mode terapkan melempar GalatSinkronLokasi). */
  readonly konflik: readonly string[];
  /** Mode kering: konflik pemakaian; mode terapkan dengan `paksa`: yang dipaksa lewat. */
  readonly konflikPemakaian: readonly string[];
}

// ---- Status DB (dirujuk lewat kode, bukan id, agar rencana mudah dibaca & diuji) ----

export interface BarisGudangDb {
  readonly id: string;
  readonly kode: string;
  readonly nama: string;
  readonly jenis: string;
  readonly aktif: boolean;
}
export interface BarisZonaDb {
  readonly id: string;
  readonly kode: string;
  readonly namaKelurahan: string;
  readonly gudang: string;
  readonly dropPointPusat: string | null;
  readonly aktif: boolean;
}
export interface BarisDropPointDb {
  readonly id: string;
  readonly kode: string;
  readonly zona: string;
  readonly gudang: string;
  readonly nama: string;
  readonly alamatPublik: string | null;
  readonly jamAmbil: string | null;
  readonly aktif: boolean;
}
/** Kode entri yang sedang dipakai operasi berjalan (Z-03). */
export interface PemakaianAktifLokasi {
  /** Zona dengan slot_kirim berstatus DIBUKA. */
  readonly zonaSlotDibuka: readonly string[];
  /** Zona dengan grup belum final. */
  readonly zonaGrupBelumFinal: readonly string[];
  /** Drop point yang dipilih peserta hidup di grup belum final. */
  readonly dropPointPesertaHidup: readonly string[];
  /** Gudang penerima grup belum final. */
  readonly gudangGrupBelumFinal: readonly string[];
}
export interface StatusLokasiDb {
  readonly gudang: readonly BarisGudangDb[];
  readonly zona: readonly BarisZonaDb[];
  readonly dropPoint: readonly BarisDropPointDb[];
  /** Tidak diisi = tidak ada pemakaian aktif. */
  readonly pemakaian?: PemakaianAktifLokasi;
}

/** Status grup yang sudah final (tidak ada lagi pengiriman/penagihan berjalan). */
export const STATUS_GRUP_FINAL = ["GAGAL", "BATAL", "SELESAI"] as const;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Eksekutor = Db | Tx;

// ---- Target dari config ----

interface Target {
  gudang: Map<string, { nama: string; jenis: string; aktif: boolean }>;
  zona: Map<
    string,
    { namaKelurahan: string; gudang: string; dropPointPusat: string; aktif: boolean }
  >;
  dropPoint: Map<
    string,
    {
      zona: string;
      gudang: string;
      nama: string;
      alamatPublik: string | null;
      jamAmbil: string | null;
      aktif: boolean;
    }
  >;
}

function targetDariKonfig(k: KonfigLokasi): Target {
  const t: Target = { gudang: new Map(), zona: new Map(), dropPoint: new Map() };
  for (const g of k.gudang) t.gudang.set(g.kode, { nama: g.nama, jenis: g.jenis, aktif: true });
  for (const z of k.zona) {
    // Skema menjamin dropPoint ≥ 1.
    const pusat = z.dropPoint[0]?.kode ?? "";
    t.zona.set(z.kode, {
      namaKelurahan: z.namaKelurahan,
      gudang: z.gudang,
      dropPointPusat: pusat,
      aktif: true,
    });
    for (const d of z.dropPoint) {
      t.dropPoint.set(d.kode, {
        zona: z.kode,
        // Drop point melayani dari gudang zonanya (F-20).
        gudang: z.gudang,
        nama: d.nama,
        alamatPublik: d.alamatPublik ?? null,
        jamAmbil: d.jamAmbil ?? null,
        aktif: true,
      });
    }
  }
  return t;
}

function beda(
  sebelum: NilaiLokasi,
  sesudah: NilaiLokasi,
): { sebelum: NilaiLokasi; sesudah: NilaiLokasi } | null {
  const a: NilaiLokasi = {};
  const b: NilaiLokasi = {};
  for (const [kunci, nilai] of Object.entries(sesudah)) {
    if (sebelum[kunci] !== nilai) {
      a[kunci] = sebelum[kunci] ?? null;
      b[kunci] = nilai;
    }
  }
  return Object.keys(b).length > 0 ? { sebelum: a, sesudah: b } : null;
}

function rencanakanJenis<B extends { kode: string; aktif: boolean }>(
  jenis: JenisEntitasLokasi,
  barisDb: readonly B[],
  target: Map<string, NilaiLokasi>,
  keNilai: (b: B) => NilaiLokasi,
): { simpan: LangkahSinkronLokasi[]; lepas: LangkahSinkronLokasi[] } {
  const perKode = new Map(barisDb.map((b) => [b.kode, b]));
  const simpan: LangkahSinkronLokasi[] = [];
  for (const [kode, nilai] of target) {
    const ada = perKode.get(kode);
    if (!ada) {
      simpan.push({ aksi: "TAMBAH", jenis, kode, sesudah: nilai });
      continue;
    }
    const d = beda(keNilai(ada), nilai);
    if (d) simpan.push({ aksi: "UBAH", jenis, kode, ...d });
  }
  const lepas: LangkahSinkronLokasi[] = barisDb
    .filter((b) => b.aktif && !target.has(b.kode))
    .sort((x, y) => x.kode.localeCompare(y.kode))
    .map((b) => ({ aksi: "LEPAS", jenis, kode: b.kode }));
  return { simpan, lepas };
}

/**
 * Fungsi murni: bandingkan config dengan isi DB. Urutan langkah = urutan penerapan
 * (gudang → zona → drop point, lalu pelepasan drop point → zona → gudang).
 */
export function rencanakanSinkronLokasi(
  konfig: KonfigLokasi,
  status: StatusLokasiDb,
): RencanaSinkronLokasi {
  const t = targetDariKonfig(konfig);
  const konflik: string[] = [];
  for (const d of status.dropPoint) {
    const tujuan = t.dropPoint.get(d.kode);
    if (tujuan && tujuan.zona !== d.zona) {
      konflik.push(
        `drop point ${d.kode} terdaftar di zona ${d.zona}, config menaruhnya di zona ${tujuan.zona}; ` +
          `pindah zona tidak diizinkan (riwayat grup/invoice) — pakai kode drop point baru`,
      );
    }
  }
  const p = status.pemakaian;
  const konflikPemakaian: string[] = [];
  const alasanZona = (kode: string) =>
    [
      p?.zonaSlotDibuka.includes(kode) ? "slot kirim DIBUKA" : null,
      p?.zonaGrupBelumFinal.includes(kode) ? "grup belum final" : null,
    ]
      .filter((x) => x !== null)
      .join(" & ");
  for (const zDb of status.zona) {
    const tujuan = t.zona.get(zDb.kode);
    const alasan = alasanZona(zDb.kode);
    if (tujuan && tujuan.gudang !== zDb.gudang && alasan) {
      konflikPemakaian.push(
        `zona ${zDb.kode} pindah gudang ${zDb.gudang} → ${tujuan.gudang} saat masih ada ${alasan}`,
      );
    }
  }
  const g = rencanakanJenis("gudang", status.gudang, t.gudang, (b) => ({
    nama: b.nama,
    jenis: b.jenis,
    aktif: b.aktif,
  }));
  const z = rencanakanJenis("zona", status.zona, t.zona, (b) => ({
    namaKelurahan: b.namaKelurahan,
    gudang: b.gudang,
    dropPointPusat: b.dropPointPusat,
    aktif: b.aktif,
  }));
  const d = rencanakanJenis("drop_point", status.dropPoint, t.dropPoint, (b) => ({
    zona: b.zona,
    gudang: b.gudang,
    nama: b.nama,
    alamatPublik: b.alamatPublik,
    jamAmbil: b.jamAmbil,
    aktif: b.aktif,
  }));
  for (const l of d.lepas) {
    if (p?.dropPointPesertaHidup.includes(l.kode))
      konflikPemakaian.push(
        `drop point ${l.kode} dilepas saat masih dipilih peserta grup belum final`,
      );
  }
  for (const l of z.lepas) {
    const alasan = alasanZona(l.kode);
    if (alasan) konflikPemakaian.push(`zona ${l.kode} dilepas saat masih ada ${alasan}`);
  }
  for (const l of g.lepas) {
    if (p?.gudangGrupBelumFinal.includes(l.kode))
      konflikPemakaian.push(`gudang ${l.kode} dilepas saat masih menerima grup belum final`);
  }
  return {
    langkah: [...g.simpan, ...z.simpan, ...d.simpan, ...d.lepas, ...z.lepas, ...g.lepas],
    konflik,
    konflikPemakaian,
  };
}

// ---- Baca DB ----

export async function bacaStatusLokasiDb(db: Eksekutor): Promise<StatusLokasiDb> {
  const g = await db
    .select({
      id: gudang.id,
      kode: gudang.kodeKonfig,
      nama: gudang.nama,
      jenis: gudang.jenis,
      aktif: gudang.aktif,
    })
    .from(gudang);
  const z = await db
    .select({
      id: zona.id,
      kode: zona.kodeKonfig,
      namaKelurahan: zona.namaKelurahan,
      gudangId: zona.gudangId,
      dropPointPusatId: zona.dropPointPusatId,
      aktif: zona.aktif,
    })
    .from(zona);
  const d = await db
    .select({
      id: dropPoint.id,
      kode: dropPoint.kodeKonfig,
      zonaId: dropPoint.zonaId,
      gudangId: dropPoint.gudangId,
      nama: dropPoint.nama,
      alamatPublik: dropPoint.alamatPublik,
      jamAmbil: dropPoint.jamAmbil,
      aktif: dropPoint.aktif,
    })
    .from(dropPoint);
  const final = sql.raw(STATUS_GRUP_FINAL.map((x) => `'${x}'`).join(", "));
  const nonaktif = sql.raw(STATUS_PESERTA_NONAKTIF.map((x) => `'${x}'`).join(", "));
  const daftarKode = async (kueri: SQL) =>
    ((await db.execute(kueri)).rows as { kode: string }[]).map((r) => r.kode).sort();
  const pemakaian: PemakaianAktifLokasi = {
    zonaSlotDibuka: await daftarKode(sql`
      SELECT DISTINCT z.kode_konfig AS kode FROM slot_kirim s JOIN zona z ON z.id = s.zona_id
      WHERE s.status = 'DIBUKA'`),
    zonaGrupBelumFinal: await daftarKode(sql`
      SELECT DISTINCT z.kode_konfig AS kode FROM grup g JOIN zona z ON z.id = g.zona_id
      WHERE g.status NOT IN (${final})`),
    dropPointPesertaHidup: await daftarKode(sql`
      SELECT DISTINCT d.kode_konfig AS kode FROM peserta_grup p
      JOIN grup g ON g.id = p.grup_id JOIN drop_point d ON d.id = p.drop_point_id
      WHERE g.status NOT IN (${final}) AND p.status NOT IN (${nonaktif})`),
    gudangGrupBelumFinal: await daftarKode(sql`
      SELECT DISTINCT gd.kode_konfig AS kode FROM grup g JOIN gudang gd ON gd.id = g.gudang_id
      WHERE g.status NOT IN (${final})`),
  };
  const kodeGudang = new Map(g.map((x) => [x.id, x.kode]));
  const kodeZona = new Map(z.map((x) => [x.id, x.kode]));
  const kodeDp = new Map(d.map((x) => [x.id, x.kode]));
  return {
    pemakaian,
    gudang: g,
    zona: z.map((x) => ({
      id: x.id,
      kode: x.kode,
      namaKelurahan: x.namaKelurahan,
      gudang: kodeGudang.get(x.gudangId) ?? "",
      dropPointPusat: x.dropPointPusatId === null ? null : (kodeDp.get(x.dropPointPusatId) ?? null),
      aktif: x.aktif,
    })),
    dropPoint: d.map((x) => ({
      id: x.id,
      kode: x.kode,
      zona: kodeZona.get(x.zonaId) ?? "",
      gudang: kodeGudang.get(x.gudangId) ?? "",
      nama: x.nama,
      alamatPublik: x.alamatPublik,
      jamAmbil: x.jamAmbil,
      aktif: x.aktif,
    })),
  };
}

/**
 * FK ke gudang/zona/drop_point yang TIDAK aman untuk "hapus bila belum dipakai": aksi hapus selain
 * RESTRICT (CASCADE, SET NULL, SET DEFAULT, NO ACTION) — NO ACTION deferrable bisa lolos savepoint.
 * FK melingkar zona → drop_point memakai RESTRICT (dicek seketika walau DEFERRABLE).
 */
export async function periksaFkLokasi(db: Eksekutor): Promise<string[]> {
  const r = await db.execute(sql`
    SELECT conrelid::regclass::text AS tabel, conname::text AS nama, confdeltype::text AS aksi
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid IN ('gudang'::regclass, 'zona'::regclass, 'drop_point'::regclass)
      AND (confdeltype <> 'r' OR (condeferrable AND confdeltype = 'a'))
    ORDER BY 1, 2`);
  return (r.rows as { tabel: string; nama: string; aksi: string }[]).map(
    (x) => `FK ${x.tabel}.${x.nama} (on delete '${x.aksi}') harus ON DELETE RESTRICT`,
  );
}

// ---- Terapkan ----

export class GalatSinkronLokasi extends Error {
  constructor(pesan: string) {
    super(pesan);
    this.name = "GalatSinkronLokasi";
  }
}

export interface OpsiSinkronLokasi {
  /** true = hanya hitung rencana, tidak menulis apa pun (pratinjau / cek selisih). */
  readonly kering?: boolean;
  /** Config bertanda `uji: true` (koordinat fiktif) ditolak kecuali ini true (mis. staging, tes). */
  readonly izinkanUji?: boolean;
  /** Sidik isi file config (sha256 hex) untuk jejak di log_audit. */
  readonly sidikKonfig?: string;
  /** Lewati konflik pemakaian (Z-03): slot DIBUKA / grup belum final. Dicatat di log_audit. */
  readonly paksa?: boolean;
}

/** Kunci advisory transaksi: cegah dua sinkron berjalan bersamaan. */
const KUNCI_SINKRON = 7_015_002;
export const JENIS_LOG_SINKRON = "SINKRON_LOKASI";

export function sidikIsiKonfig(isi: string): string {
  return createHash("sha256").update(isi).digest("hex");
}

function kodePg(e: unknown): string | undefined {
  let x: unknown = e;
  while (x instanceof Error) {
    const k = (x as { code?: unknown }).code;
    if (typeof k === "string") return k;
    x = x.cause;
  }
  return undefined;
}

/** Hapus di savepoint; bila masih dirujuk (FK 23503) → false dan savepoint dibatalkan. */
async function cobaHapus(tx: Tx, hapus: (sp: Tx) => Promise<unknown>): Promise<boolean> {
  try {
    await tx.transaction(async (sp) => {
      await hapus(sp);
    });
    return true;
  } catch (e) {
    if (kodePg(e) === "23503") return false;
    throw e;
  }
}

const adaLepas = (r: RencanaSinkronLokasi) => r.langkah.some((l) => l.aksi === "LEPAS");

function wajib<T>(m: Map<string, T>, kode: string, apa: string): T {
  const v = m.get(kode);
  if (v === undefined) throw new GalatSinkronLokasi(`${apa} ${kode} tidak ditemukan saat sinkron`);
  return v;
}

/**
 * Selaraskan DB dengan config. Konflik → GalatSinkronLokasi, tidak ada yang ditulis.
 * Mode kering: hanya membaca.
 */
export async function sinkronLokasi(
  db: Db,
  konfig: KonfigLokasi,
  opsi: OpsiSinkronLokasi = {},
): Promise<HasilSinkronLokasi> {
  if (konfig.uji === true && opsi.izinkanUji !== true) {
    throw new GalatSinkronLokasi(
      'config bertanda "uji": true (koordinat fiktif); tidak disinkronkan ke DB tanpa izin eksplisit (--izinkan-uji)',
    );
  }
  if (opsi.kering === true) {
    // Transaksi read-only: pratinjau dijamin tidak menulis apa pun.
    return db.transaction(
      async (tx) => {
        const rencana = rencanakanSinkronLokasi(konfig, await bacaStatusLokasiDb(tx));
        const fk = adaLepas(rencana) ? await periksaFkLokasi(tx) : [];
        return {
          kering: true,
          perubahan: rencana.langkah,
          konflik: [...fk, ...rencana.konflik],
          konflikPemakaian: rencana.konflikPemakaian,
        };
      },
      { accessMode: "read only" },
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${KUNCI_SINKRON})`);
    const status = await bacaStatusLokasiDb(tx);
    const rencana = rencanakanSinkronLokasi(konfig, status);
    if (rencana.konflik.length > 0) throw new GalatSinkronLokasi(rencana.konflik.join("; "));
    if (rencana.konflikPemakaian.length > 0 && opsi.paksa !== true) {
      throw new GalatSinkronLokasi(
        `${rencana.konflikPemakaian.join("; ")} — tutup slot/selesaikan grup dulu, atau --paksa`,
      );
    }
    // Pagar skema sebelum fase pelepasan (dan sebelum ada yang ditulis).
    if (adaLepas(rencana)) {
      const fk = await periksaFkLokasi(tx);
      if (fk.length > 0) throw new GalatSinkronLokasi(fk.join("; "));
    }

    const t = targetDariKonfig(konfig);
    const idGudang = new Map(status.gudang.map((x) => [x.kode, x.id]));
    const idZona = new Map(status.zona.map((x) => [x.kode, x.id]));
    const idDp = new Map(status.dropPoint.map((x) => [x.kode, x.id]));
    const kini = sql`now()`;
    const hasil = new Map<LangkahSinkronLokasi, PerubahanLokasi>();
    const langkahJenis = (jenis: JenisEntitasLokasi, aksi: LangkahSinkronLokasi["aksi"]) =>
      rencana.langkah.filter((l) => l.jenis === jenis && l.aksi === aksi);
    const simpan = (jenis: JenisEntitasLokasi) =>
      rencana.langkah.filter((l) => l.jenis === jenis && l.aksi !== "LEPAS");

    // 1. Gudang.
    for (const l of simpan("gudang")) {
      const v = wajib(t.gudang, l.kode, "gudang");
      if (l.aksi === "TAMBAH") {
        const [baris] = await tx
          .insert(gudang)
          .values({ kodeKonfig: l.kode, nama: v.nama, jenis: v.jenis, aktif: true })
          .returning({ id: gudang.id });
        if (baris) idGudang.set(l.kode, baris.id);
      } else {
        await tx
          .update(gudang)
          .set({ nama: v.nama, jenis: v.jenis, aktif: true, diubahPada: kini })
          .where(eq(gudang.id, wajib(idGudang, l.kode, "gudang")));
      }
    }

    // 2. Zona (baru: nonaktif & tanpa drop point pusat dulu; CHECK zona_aktif_butuh_drop_point).
    for (const l of simpan("zona")) {
      const v = wajib(t.zona, l.kode, "zona");
      const gudangId = wajib(idGudang, v.gudang, "gudang");
      if (l.aksi === "TAMBAH") {
        const [baris] = await tx
          .insert(zona)
          .values({ kodeKonfig: l.kode, namaKelurahan: v.namaKelurahan, gudangId, aktif: false })
          .returning({ id: zona.id });
        if (baris) idZona.set(l.kode, baris.id);
      } else {
        await tx
          .update(zona)
          .set({ namaKelurahan: v.namaKelurahan, gudangId, diubahPada: kini })
          .where(eq(zona.id, wajib(idZona, l.kode, "zona")));
      }
    }

    // 3. Drop point.
    for (const l of simpan("drop_point")) {
      const v = wajib(t.dropPoint, l.kode, "drop point");
      const nilai = {
        zonaId: wajib(idZona, v.zona, "zona"),
        gudangId: wajib(idGudang, v.gudang, "gudang"),
        nama: v.nama,
        alamatPublik: v.alamatPublik,
        jamAmbil: v.jamAmbil,
        aktif: true,
      };
      if (l.aksi === "TAMBAH") {
        const [baris] = await tx
          .insert(dropPoint)
          .values({ kodeKonfig: l.kode, ...nilai })
          .returning({ id: dropPoint.id });
        if (baris) idDp.set(l.kode, baris.id);
      } else {
        await tx
          .update(dropPoint)
          .set({ ...nilai, diubahPada: kini })
          .where(eq(dropPoint.id, wajib(idDp, l.kode, "drop point")));
      }
    }

    // 4. Zona: drop point pusat + aktif.
    for (const l of simpan("zona")) {
      if (l.aksi === "UBAH" && !("dropPointPusat" in l.sesudah) && !("aktif" in l.sesudah))
        continue;
      const v = wajib(t.zona, l.kode, "zona");
      await tx
        .update(zona)
        .set({
          dropPointPusatId: wajib(idDp, v.dropPointPusat, "drop point"),
          aktif: true,
          diubahPada: kini,
        })
        .where(eq(zona.id, wajib(idZona, l.kode, "zona")));
    }

    // 5. Pelepasan. Zona dinonaktifkan dulu agar penunjuk drop point pusatnya boleh dikosongkan.
    for (const l of langkahJenis("zona", "LEPAS")) {
      await tx
        .update(zona)
        .set({ aktif: false, diubahPada: kini })
        .where(eq(zona.id, wajib(idZona, l.kode, "zona")));
    }
    for (const l of langkahJenis("drop_point", "LEPAS")) {
      const id = wajib(idDp, l.kode, "drop point");
      const terhapus = await cobaHapus(tx, async (sp) => {
        // FK zona.drop_point_pusat_id → drop_point ON DELETE RESTRICT: dicek seketika (walau FK-nya
        // DEFERRABLE), jadi penunjuk dari zona nonaktif dikosongkan dulu (zona aktif sudah dipindah ke
        // drop point pusat baru di langkah 4). Bila hapus gagal karena perujuk lain, savepoint ikut
        // membatalkan pengosongan ini.
        await sp
          .update(zona)
          .set({ dropPointPusatId: null, diubahPada: kini })
          .where(and(eq(zona.dropPointPusatId, id), eq(zona.aktif, false)));
        await sp.delete(dropPoint).where(eq(dropPoint.id, id));
      });
      if (!terhapus) {
        await tx
          .update(dropPoint)
          .set({ aktif: false, diubahPada: kini })
          .where(eq(dropPoint.id, id));
      }
      hasil.set(l, { ...l, hasil: terhapus ? "DIHAPUS" : "DINONAKTIFKAN" });
    }
    for (const l of langkahJenis("zona", "LEPAS")) {
      const id = wajib(idZona, l.kode, "zona");
      const terhapus = await cobaHapus(tx, (sp) => sp.delete(zona).where(eq(zona.id, id)));
      hasil.set(l, { ...l, hasil: terhapus ? "DIHAPUS" : "DINONAKTIFKAN" });
    }
    for (const l of langkahJenis("gudang", "LEPAS")) {
      const id = wajib(idGudang, l.kode, "gudang");
      await tx.update(gudang).set({ aktif: false, diubahPada: kini }).where(eq(gudang.id, id));
      const terhapus = await cobaHapus(tx, (sp) => sp.delete(gudang).where(eq(gudang.id, id)));
      hasil.set(l, { ...l, hasil: terhapus ? "DIHAPUS" : "DINONAKTIFKAN" });
    }

    const perubahan: PerubahanLokasi[] = rencana.langkah.map((l) => hasil.get(l) ?? l);

    // 6. Log perubahan (append-only, tanpa PII: hanya kode & nama tempat usaha).
    if (perubahan.length > 0) {
      await tx.insert(logAudit).values(
        perubahan.map((p) => ({
          jenis: JENIS_LOG_SINKRON,
          aktor: "SISTEM",
          refJenis: p.jenis,
          refId: p.kode,
          data: {
            aksi: p.aksi,
            ...(p.aksi === "UBAH" ? { sebelum: p.sebelum, sesudah: p.sesudah } : {}),
            ...(p.aksi === "TAMBAH" ? { sesudah: p.sesudah } : {}),
            ...(p.hasil ? { hasil: p.hasil } : {}),
            ...(opsi.sidikKonfig ? { sidikKonfig: opsi.sidikKonfig } : {}),
            ...(rencana.konflikPemakaian.length > 0 ? { dipaksa: rencana.konflikPemakaian } : {}),
          },
        })),
      );
    }
    return {
      kering: false,
      perubahan,
      konflik: [],
      konflikPemakaian: rencana.konflikPemakaian,
    };
  });
}

/** Satu baris teks per perubahan (untuk CLI & log). */
export function teksPerubahanLokasi(p: PerubahanLokasi): string {
  const nilai = (v: NilaiLokasi) =>
    Object.entries(v)
      .map(([k, x]) => `${k}=${JSON.stringify(x)}`)
      .join(", ");
  switch (p.aksi) {
    case "TAMBAH":
      return `+ ${p.jenis} ${p.kode} (${nilai(p.sesudah)})`;
    case "UBAH":
      return `~ ${p.jenis} ${p.kode}: ${Object.keys(p.sesudah)
        .map((k) => `${k} ${JSON.stringify(p.sebelum[k])} → ${JSON.stringify(p.sesudah[k])}`)
        .join(", ")}`;
    case "LEPAS":
      return `- ${p.jenis} ${p.kode}${p.hasil ? ` → ${p.hasil}` : " (hapus bila belum dipakai, selain itu nonaktifkan)"}`;
  }
}
