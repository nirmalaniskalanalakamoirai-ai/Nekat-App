// Repositori autentikasi admin (T-036): admin, sesi, izin, kode pemulihan TOTP, log audit login.
// Rahasia (hash kata sandi, TOTP terenkripsi) hanya keluar dari repo ini ke layanan auth API,
// tidak pernah ke rute/DTO. Kriptografi dikerjakan di API, bukan di sini.
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../koneksi.js";
import { admin, adminPeran, kodePemulihanTotp, logAudit, peranIzin, sesi } from "../skema/index.js";

export interface AdminUntukMasuk {
  readonly id: string;
  readonly nama: string;
  readonly status: string;
  readonly kataSandiHash: string | null;
  readonly totpRahasiaEnc: Buffer | null;
  readonly totpKunciVersi: number | null;
  readonly totpAktifPada: Date | null;
  readonly totpLangkahTerakhir: number | null;
  readonly gagalBeruntun: number;
  readonly dikunciSampai: Date | null;
}

export interface SesiAdminAktif {
  readonly adminId: string;
  readonly nama: string;
  /** NULL = baru lolos kata sandi, belum TOTP (sesi "pra"). */
  readonly faktorKeduaPada: Date | null;
  readonly kedaluwarsaPada: Date;
  readonly peran: readonly string[];
  readonly izin: readonly string[];
}

export interface DataAdminBaru {
  readonly nama: string;
  readonly nomorHpE164: string;
  readonly kataSandiHash: string;
  /** Dibuat di API dengan AAD = id; karena itu id dibuat di API juga. */
  readonly id: string;
  readonly totpRahasiaEnc: Buffer;
  readonly totpKunciVersi: number;
  readonly totpLangkahTerakhir: number;
  readonly peran: readonly string[];
  readonly kodePemulihanHash: readonly Buffer[];
}

export interface RepoAuthAdmin {
  cariUntukMasuk(nomorHpE164: string): Promise<AdminUntukMasuk | null>;
  cariUntukMasukPerId(id: string): Promise<AdminUntukMasuk | null>;
  /**
   * PESAN satu jatah percobaan secara ATOMIK SEBELUM verifikasi (aman terhadap tebakan paralel):
   * penghitung naik lebih dulu; percobaan yang lolos lalu mereset (`resetGagal` /
   * `terimaLangkahTotp`). null = sedang dikunci / jatah habis → tolak tanpa verifikasi.
   * Semantik penghitung = domain `setelahGagal` (kunci yang sudah lewat → mulai dari 1).
   */
  pesanPercobaan(
    adminId: string,
    sekarang: Date,
    kebijakan: { readonly batasGagal: number; readonly lamaKunciMenit: number },
  ): Promise<{ gagalBeruntun: number; dikunciSampai: Date | null } | null>;
  /**
   * Kembalikan satu jatah (percobaan yang ternyata BENAR kata sandinya, atau gagal karena sistem).
   * Bila penghitung turun di bawah batas, kunci yang dipasang pemesanan itu dilepas.
   */
  kembalikanPercobaan(adminId: string, kebijakan: { readonly batasGagal: number }): Promise<void>;
  /** Pesan satu percobaan faktor kedua pada sesi pra (atomik). null = jatah sesi habis / dicabut. */
  pesanPercobaanPra(idHash: Buffer, batas: number): Promise<number | null>;
  /**
   * Terima langkah TOTP secara atomik: hanya bila `langkah` > langkah terakhir (anti pakai ulang).
   * Sekaligus mereset penghitung gagal. false = kode sudah pernah dipakai.
   */
  terimaLangkahTotp(adminId: string, langkah: number): Promise<boolean>;
  /** Tandai kode pemulihan terpakai (atomik, sekali pakai). false = tidak ada / sudah dipakai. */
  pakaiKodePemulihan(adminId: string, kodeHash: Buffer): Promise<boolean>;
  resetGagal(adminId: string): Promise<void>;
  buatSesi(data: {
    idHash: Buffer;
    adminId: string;
    faktorKeduaPada: Date | null;
    kedaluwarsaPada: Date;
    /** Waktu dibuat (jam aplikasi) = aktif terakhir awal. */
    sekarang: Date;
  }): Promise<void>;
  /**
   * Sesi admin yang belum dicabut, belum kedaluwarsa, tidak idle lebih dari `idleMenit`, milik
   * admin AKTIF ber-TOTP.
   */
  cariSesi(idHash: Buffer, sekarang: Date, idleMenit: number): Promise<SesiAdminAktif | null>;
  /** Perbarui waktu aktif terakhir (paling sering 1x/menit per sesi). */
  sentuhSesi(idHash: Buffer, sekarang: Date): Promise<void>;
  cabutSesi(idHash: Buffer, sekarang: Date): Promise<void>;
  cabutSemuaSesi(adminId: string, sekarang: Date): Promise<void>;
  /** Kejadian login (berhasil/gagal/dikunci) ke `log_audit`, tanpa PII. */
  catatAudit(jenis: string, data: Record<string, unknown>, refId: string | null): Promise<void>;
  jumlahAdmin(): Promise<number>;
  adaNomorHp(nomorHpE164: string): Promise<boolean>;
  buatAdmin(data: DataAdminBaru): Promise<void>;
}

const kolomMasuk = {
  id: admin.id,
  nama: admin.nama,
  status: admin.status,
  kataSandiHash: admin.kataSandiHash,
  totpRahasiaEnc: admin.totpRahasiaEnc,
  totpKunciVersi: admin.totpKunciVersi,
  totpAktifPada: admin.totpAktifPada,
  totpLangkahTerakhir: admin.totpLangkahTerakhir,
  gagalBeruntun: admin.gagalBeruntun,
  dikunciSampai: admin.dikunciSampai,
};

export function buatRepoAuthAdmin(db: Db): RepoAuthAdmin {
  return {
    async cariUntukMasuk(nomorHpE164) {
      const [a] = await db.select(kolomMasuk).from(admin).where(eq(admin.nomorHpE164, nomorHpE164));
      return a ?? null;
    },

    async cariUntukMasukPerId(id) {
      const [a] = await db.select(kolomMasuk).from(admin).where(eq(admin.id, id));
      return a ?? null;
    },

    async pesanPercobaan(adminId, sekarang, k) {
      const kini = sekarang.toISOString();
      const kunciLewat = sql`(${admin.dikunciSampai} IS NOT NULL AND ${admin.dikunciSampai} <= ${kini}::timestamptz)`;
      const gagalBaru = sql`(CASE WHEN ${kunciLewat} THEN 1 ELSE ${admin.gagalBeruntun} + 1 END)`;
      // Baris dikunci UPDATE: permintaan paralel diserialkan; hanya `batasGagal` yang mendapat jatah.
      const [b] = await db
        .update(admin)
        .set({
          gagalBeruntun: sql`LEAST(${gagalBaru}, 32767)`,
          dikunciSampai: sql`CASE
            WHEN ${gagalBaru} >= ${k.batasGagal} THEN ${kini}::timestamptz + make_interval(mins => ${k.lamaKunciMenit})
            WHEN ${kunciLewat} THEN NULL
            ELSE ${admin.dikunciSampai} END`,
          diubahPada: sql`now()`,
        })
        .where(
          and(
            eq(admin.id, adminId),
            or(kunciLewat, and(isNull(admin.dikunciSampai), lt(admin.gagalBeruntun, k.batasGagal))),
          ),
        )
        .returning({ gagalBeruntun: admin.gagalBeruntun, dikunciSampai: admin.dikunciSampai });
      return b ?? null;
    },

    async kembalikanPercobaan(adminId, k) {
      await db
        .update(admin)
        .set({
          gagalBeruntun: sql`GREATEST(${admin.gagalBeruntun} - 1, 0)`,
          dikunciSampai: sql`CASE WHEN ${admin.gagalBeruntun} - 1 < ${k.batasGagal} THEN NULL ELSE ${admin.dikunciSampai} END`,
          diubahPada: sql`now()`,
        })
        .where(and(eq(admin.id, adminId), gt(admin.gagalBeruntun, 0)));
    },

    async pesanPercobaanPra(idHash, batas) {
      const [b] = await db
        .update(sesi)
        .set({ percobaanFaktorKedua: sql`${sesi.percobaanFaktorKedua} + 1` })
        .where(
          and(
            eq(sesi.idHash, idHash),
            isNull(sesi.dicabutPada),
            isNull(sesi.faktorKeduaPada),
            lt(sesi.percobaanFaktorKedua, batas),
          ),
        )
        .returning({ n: sesi.percobaanFaktorKedua });
      return b?.n ?? null;
    },

    async terimaLangkahTotp(adminId, langkah) {
      const baris = await db
        .update(admin)
        .set({
          totpLangkahTerakhir: langkah,
          gagalBeruntun: 0,
          dikunciSampai: null,
          diubahPada: sql`now()`,
        })
        .where(
          and(
            eq(admin.id, adminId),
            or(isNull(admin.totpLangkahTerakhir), lt(admin.totpLangkahTerakhir, langkah)),
          ),
        )
        .returning({ id: admin.id });
      return baris.length === 1;
    },

    async pakaiKodePemulihan(adminId, kodeHash) {
      const baris = await db
        .update(kodePemulihanTotp)
        .set({ dipakaiPada: sql`now()` })
        .where(
          and(
            eq(kodePemulihanTotp.adminId, adminId),
            eq(kodePemulihanTotp.kodeHash, kodeHash),
            isNull(kodePemulihanTotp.dipakaiPada),
          ),
        )
        .returning({ id: kodePemulihanTotp.id });
      return baris.length === 1;
    },

    async resetGagal(adminId) {
      await db
        .update(admin)
        .set({ gagalBeruntun: 0, dikunciSampai: null, diubahPada: sql`now()` })
        .where(eq(admin.id, adminId));
    },

    async buatSesi(data) {
      await db.insert(sesi).values({
        idHash: data.idHash,
        adminId: data.adminId,
        faktorKeduaPada: data.faktorKeduaPada,
        kedaluwarsaPada: data.kedaluwarsaPada,
        aktifTerakhirPada: data.sekarang,
      });
    },

    async cariSesi(idHash, sekarang, idleMenit) {
      const [s] = await db
        .select({
          adminId: admin.id,
          nama: admin.nama,
          faktorKeduaPada: sesi.faktorKeduaPada,
          kedaluwarsaPada: sesi.kedaluwarsaPada,
        })
        .from(sesi)
        .innerJoin(admin, eq(admin.id, sesi.adminId))
        .where(
          and(
            eq(sesi.idHash, idHash),
            isNull(sesi.dicabutPada),
            gt(sesi.kedaluwarsaPada, sekarang),
            gt(sesi.aktifTerakhirPada, new Date(sekarang.getTime() - idleMenit * 60_000)),
            eq(admin.status, "AKTIF"),
            sql`${admin.totpAktifPada} IS NOT NULL`,
          ),
        );
      if (!s) return null;
      const baris = await db
        .select({ peran: adminPeran.peranKode, izin: peranIzin.izinKode })
        .from(adminPeran)
        .leftJoin(peranIzin, eq(peranIzin.peranKode, adminPeran.peranKode))
        .where(eq(adminPeran.adminId, s.adminId));
      const peran = [...new Set(baris.map((b) => b.peran))].sort();
      const izin = [
        ...new Set(baris.map((b) => b.izin).filter((i): i is string => i !== null)),
      ].sort();
      return { ...s, peran, izin };
    },

    async sentuhSesi(idHash, sekarang) {
      await db
        .update(sesi)
        .set({ aktifTerakhirPada: sekarang })
        .where(
          and(
            eq(sesi.idHash, idHash),
            lt(sesi.aktifTerakhirPada, new Date(sekarang.getTime() - 60_000)),
          ),
        );
    },

    async cabutSesi(idHash, sekarang) {
      await db
        .update(sesi)
        .set({ dicabutPada: sekarang })
        .where(and(eq(sesi.idHash, idHash), isNull(sesi.dicabutPada)));
    },

    async cabutSemuaSesi(adminId, sekarang) {
      await db
        .update(sesi)
        .set({ dicabutPada: sekarang })
        .where(and(eq(sesi.adminId, adminId), isNull(sesi.dicabutPada)));
    },

    async catatAudit(jenis, data, refId) {
      await db.insert(logAudit).values({
        jenis,
        aktor: "ADMIN",
        refJenis: refId ? "admin" : null,
        refId,
        data,
      });
    },

    async jumlahAdmin() {
      const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(admin);
      return b?.n ?? 0;
    },

    async adaNomorHp(nomorHpE164) {
      const [b] = await db
        .select({ id: admin.id })
        .from(admin)
        .where(eq(admin.nomorHpE164, nomorHpE164));
      return b !== undefined;
    },

    async buatAdmin(d) {
      await db.transaction(async (tx) => {
        await tx.insert(admin).values({
          id: d.id,
          nama: d.nama,
          nomorHpE164: d.nomorHpE164,
          kataSandiHash: d.kataSandiHash,
          kataSandiDiubahPada: sql`now()`,
          totpRahasiaEnc: d.totpRahasiaEnc,
          totpKunciVersi: d.totpKunciVersi,
          totpAktifPada: sql`now()`,
          totpLangkahTerakhir: d.totpLangkahTerakhir,
        });
        await tx.insert(adminPeran).values(d.peran.map((p) => ({ adminId: d.id, peranKode: p })));
        if (d.kodePemulihanHash.length > 0) {
          await tx
            .insert(kodePemulihanTotp)
            .values(d.kodePemulihanHash.map((kodeHash) => ({ adminId: d.id, kodeHash })));
        }
        // Tanpa PII (nama & nomor HP tidak dicatat).
        await tx.insert(logAudit).values({
          jenis: "ADMIN_DIBUAT_CLI",
          aktor: "SISTEM",
          refJenis: "admin",
          refId: d.id,
          data: { peran: [...d.peran] },
        });
      });
    },
  };
}
