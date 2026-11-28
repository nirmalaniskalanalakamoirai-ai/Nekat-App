// Repositori login OTP WhatsApp pembeli (T-016): otp_permintaan, otp_gagal_harian, akun, sesi, log_audit.
// Kriptografi (HMAC nomor/kode, token sesi) dikerjakan di API; repo hanya menerima/menyimpan hasilnya.
//
// Jaminan konkurensi:
// - Kirim OTP: satu transaksi di bawah advisory lock global OTP → jeda kirim ulang, batas harian per
//   nomor, dan anggaran global tepat walau permintaan paralel; UK `otp_satu_hidup_uk` menjamin paling
//   banyak satu OTP hidup per (nomor, tujuan).
// - Verifikasi: jatah percobaan dipesan ATOMIK SEBELUM kode dibandingkan (UPDATE … percobaan + 1
//   … WHERE percobaan < maks RETURNING). Baris OTP terkunci sampai transaksi selesai, sehingga tebakan
//   paralel diserialkan: paling banyak `maksPercobaan` tebakan per kode, dan kode benar hanya bisa
//   dipakai sekali (sesi tidak ganda).
// - Penghitung gagal harian per nomor (`otp_gagal_harian.gagal`) dipesan di transaksi yang sama dan
//   TIDAK di-reset oleh kirim ulang. Kode benar mengembalikan jatahnya sendiri.
import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../koneksi.js";
import { akun, logAudit, otpPermintaan, sesi } from "../skema/index.js";

/** Kunci advisory lock transaksi kirim OTP (konstanta acak, khusus T-016). */
const KUNCI_LOCK_OTP = 7_016_204_811;

const TUJUAN = "LOGIN_PEMBELI";

export interface BatasKirimOtp {
  readonly kedaluwarsaMenit: number;
  readonly maksPercobaan: number;
  readonly jedaKirimUlangDetik: number;
  readonly maksKirimPerHari: number;
  /** 0 = tanpa batas. */
  readonly anggaranPerJam: number;
  readonly anggaranPerHari: number;
}

export interface DataOtpBaru {
  readonly hpHmac: Buffer;
  readonly kodeHmac: Buffer;
  readonly kodeKunciVersi: number;
  readonly ipHmac: Buffer;
  readonly sekarang: Date;
  /** Tanggal WIB (YYYY-MM-DD) & awal hari WIB, dihitung domain. */
  readonly tanggalWib: string;
  readonly awalHariWib: Date;
  readonly batas: BatasKirimOtp;
}

export type HasilBuatOtp =
  | { readonly ok: true; readonly id: string; readonly kedaluwarsaPada: Date }
  | { readonly ok: false; readonly alasan: "TERLALU_CEPAT"; readonly tungguDetik: number }
  | { readonly ok: false; readonly alasan: "BATAS_HP" | "ANGGARAN_JAM" | "ANGGARAN_HARI" };

export interface DataVerifikasiOtp {
  readonly hpHmac: Buffer;
  readonly hpHmacKunciVersi: number;
  /** HMAC nomor dengan SEMUA versi kunci yang dikenal (akun lama sebelum rotasi kunci). */
  readonly hpHmacSemuaVersi: readonly Buffer[];
  readonly nomorHpE164: string;
  /** Pembanding constant-time (di API); dipanggil SETELAH jatah dipesan. */
  readonly cocok: (kodeHmac: Buffer, kodeKunciVersi: number) => boolean;
  readonly sekarang: Date;
  readonly tanggalWib: string;
  readonly maksPercobaan: number;
  readonly maksGagalPerHari: number;
  readonly sesiBaru: { readonly idHash: Buffer; readonly kedaluwarsaPada: Date };
  /** Sesi pembeli lama di cookie yang sama → dicabut saat login (rotasi, CWE-384). */
  readonly sesiLamaHash: Buffer | null;
  /** N-13: centang opt-in WA di layar OTP. */
  readonly waOptin: boolean;
  /** Ringkasan ip_hmac (16 hex) untuk log_audit. */
  readonly ipRingkas: string;
}

export type HasilVerifikasiOtp =
  | { readonly ok: true; readonly akunId: string; readonly akunBaru: boolean }
  | { readonly ok: false; readonly alasan: "TIDAK_BERLAKU" | "BATAS_HARIAN" | "AKUN_TIDAK_AKTIF" }
  | { readonly ok: false; readonly alasan: "KODE_SALAH"; readonly sisaPercobaan: number };

export interface SesiPembeliAktif {
  readonly akunId: string;
  readonly kedaluwarsaPada: Date;
}

export interface RingkasanAkunSaya {
  readonly id: string;
  readonly nomorHpE164: string | null;
  readonly namaPanggilan: string | null;
  readonly jenisPelanggan: string;
  readonly status: string;
}

export interface RepoMasukPembeli {
  buatOtp(d: DataOtpBaru): Promise<HasilBuatOtp>;
  /** WA gagal dikirim: OTP dinonaktifkan dan jatah kirim harian dikembalikan. */
  batalkanOtpGagalKirim(
    id: string,
    hpHmac: Buffer,
    tanggalWib: string,
    sekarang: Date,
  ): Promise<void>;
  verifikasiOtp(d: DataVerifikasiOtp): Promise<HasilVerifikasiOtp>;
  /** Sesi pembeli hidup (belum dicabut/kedaluwarsa/idle) milik akun yang tidak dihapus. */
  cariSesi(idHash: Buffer, sekarang: Date, idleMs: number): Promise<SesiPembeliAktif | null>;
  /** Perbarui aktif terakhir (paling sering 1x/menit per sesi). */
  sentuhSesi(idHash: Buffer, sekarang: Date): Promise<void>;
  cabutSesi(idHash: Buffer, sekarang: Date): Promise<void>;
  ringkasanAkun(akunId: string): Promise<RingkasanAkunSaya | null>;
  /** log_audit aktor PENGGUNA, tanpa PII. */
  catatAudit(jenis: string, data: Record<string, unknown>, akunId: string | null): Promise<void>;
}

class Batal extends Error {
  constructor(readonly hasil: HasilVerifikasiOtp) {
    super("batal");
  }
}

export function buatRepoMasukPembeli(db: Db): RepoMasukPembeli {
  return {
    async buatOtp(d) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${KUNCI_LOCK_OTP})`);
        const b = d.batas;

        // 1. Jeda kirim ulang: OTP hidup yang masih "muda" untuk nomor ini.
        const batasJeda = new Date(d.sekarang.getTime() - b.jedaKirimUlangDetik * 1000);
        const [muda] = await tx
          .select({ dibuatPada: otpPermintaan.dibuatPada })
          .from(otpPermintaan)
          .where(
            and(
              eq(otpPermintaan.hpHmac, d.hpHmac),
              eq(otpPermintaan.tujuan, TUJUAN),
              isNull(otpPermintaan.terpakaiPada),
              isNull(otpPermintaan.digantikanPada),
              lt(otpPermintaan.percobaan, b.maksPercobaan),
              gt(otpPermintaan.dibuatPada, batasJeda),
            ),
          )
          .orderBy(sql`${otpPermintaan.dibuatPada} DESC`)
          .limit(1);
        if (muda) {
          const sisaMs =
            muda.dibuatPada.getTime() + b.jedaKirimUlangDetik * 1000 - d.sekarang.getTime();
          return {
            ok: false,
            alasan: "TERLALU_CEPAT",
            tungguDetik: Math.max(1, Math.ceil(sisaMs / 1000)),
          } as const;
        }

        // 2. Anggaran global (anti pumping, ADR §4.3). Semua tujuan OTP dihitung.
        if (b.anggaranPerJam > 0 || b.anggaranPerHari > 0) {
          const jamLalu = new Date(d.sekarang.getTime() - 3_600_000);
          const r = await tx.execute<{ jam: number; hari: number }>(sql`
            SELECT count(*) FILTER (WHERE dibuat_pada > ${jamLalu})::int AS jam,
                   count(*) FILTER (WHERE dibuat_pada >= ${d.awalHariWib})::int AS hari
              FROM ${otpPermintaan}
             WHERE dibuat_pada >= LEAST(${d.awalHariWib}::timestamptz, ${jamLalu}::timestamptz)`);
          const n = r.rows[0] ?? { jam: 0, hari: 0 };
          if (b.anggaranPerJam > 0 && n.jam >= b.anggaranPerJam) {
            return { ok: false, alasan: "ANGGARAN_JAM" } as const;
          }
          if (b.anggaranPerHari > 0 && n.hari >= b.anggaranPerHari) {
            return { ok: false, alasan: "ANGGARAN_HARI" } as const;
          }
        }

        // 3. Batas kirim harian per nomor (atomik; tidak bergantung pada urutan).
        const kirim = await tx.execute<{ kirim: number }>(sql`
          INSERT INTO otp_gagal_harian (hp_hmac, tanggal, gagal, kirim)
          VALUES (${d.hpHmac}, ${d.tanggalWib}::date, 0, 1)
          ON CONFLICT (hp_hmac, tanggal) DO UPDATE SET kirim = otp_gagal_harian.kirim + 1
           WHERE otp_gagal_harian.kirim < ${b.maksKirimPerHari}
          RETURNING kirim`);
        if (kirim.rows.length === 0) return { ok: false, alasan: "BATAS_HP" } as const;

        // 4. OTP lama untuk nomor ini langsung nonaktif.
        await tx
          .update(otpPermintaan)
          .set({ digantikanPada: d.sekarang })
          .where(
            and(
              eq(otpPermintaan.hpHmac, d.hpHmac),
              eq(otpPermintaan.tujuan, TUJUAN),
              isNull(otpPermintaan.terpakaiPada),
              isNull(otpPermintaan.digantikanPada),
            ),
          );

        const kedaluwarsaPada = new Date(d.sekarang.getTime() + b.kedaluwarsaMenit * 60_000);
        const [baru] = await tx
          .insert(otpPermintaan)
          .values({
            hpHmac: d.hpHmac,
            tujuan: TUJUAN,
            kodeHmac: d.kodeHmac,
            kodeKunciVersi: d.kodeKunciVersi,
            kedaluwarsaPada,
            ipHmac: d.ipHmac,
            dibuatPada: d.sekarang,
          })
          .returning({ id: otpPermintaan.id });
        if (!baru) throw new Error("insert otp_permintaan tanpa id");
        return { ok: true, id: baru.id, kedaluwarsaPada } as const;
      });
    },

    async batalkanOtpGagalKirim(id, hpHmac, tanggalWib, sekarang) {
      await db.transaction(async (tx) => {
        const r = await tx
          .update(otpPermintaan)
          .set({ digantikanPada: sekarang })
          .where(
            and(
              eq(otpPermintaan.id, id),
              isNull(otpPermintaan.terpakaiPada),
              isNull(otpPermintaan.digantikanPada),
            ),
          )
          .returning({ id: otpPermintaan.id });
        if (r.length === 0) return;
        await tx.execute(sql`
          UPDATE otp_gagal_harian SET kirim = GREATEST(kirim - 1, 0)
           WHERE hp_hmac = ${hpHmac} AND tanggal = ${tanggalWib}::date`);
      });
    },

    async verifikasiOtp(d) {
      try {
        return await db.transaction(async (tx) => {
          // 1. Pesan jatah percobaan kode (atomik, mengunci baris sampai commit).
          const jatah = await tx.execute<{
            id: string;
            kode_hmac: Buffer;
            kode_kunci_versi: number;
            percobaan: number;
          }>(sql`
            UPDATE ${otpPermintaan} SET percobaan = percobaan + 1
             WHERE hp_hmac = ${d.hpHmac} AND tujuan = ${TUJUAN}
               AND terpakai_pada IS NULL AND digantikan_pada IS NULL
               AND kedaluwarsa_pada > ${d.sekarang} AND percobaan < ${d.maksPercobaan}
            RETURNING id, kode_hmac, kode_kunci_versi, percobaan`);
          const otp = jatah.rows[0];
          if (!otp) return { ok: false, alasan: "TIDAK_BERLAKU" } as const;

          // 2. Pesan jatah gagal harian per nomor. Habis → seluruh transaksi dibatalkan (jatah kode
          //    tidak terpakai) dan kode TIDAK dibandingkan.
          const gagal = await tx.execute<{ gagal: number }>(sql`
            INSERT INTO otp_gagal_harian (hp_hmac, tanggal, gagal, kirim)
            VALUES (${d.hpHmac}, ${d.tanggalWib}::date, 1, 0)
            ON CONFLICT (hp_hmac, tanggal) DO UPDATE SET gagal = otp_gagal_harian.gagal + 1
             WHERE otp_gagal_harian.gagal < ${d.maksGagalPerHari}
            RETURNING gagal`);
          if (gagal.rows.length === 0) throw new Batal({ ok: false, alasan: "BATAS_HARIAN" });

          // 3. Bandingkan (constant-time, di API).
          if (!d.cocok(Buffer.from(otp.kode_hmac), otp.kode_kunci_versi)) {
            const sisa = Math.max(0, d.maksPercobaan - otp.percobaan);
            if (sisa === 0) {
              await tx.insert(logAudit).values({
                jenis: "OTP_PEMBELI_HANGUS",
                aktor: "PENGGUNA",
                refJenis: "otp_permintaan",
                refId: otp.id,
                data: { ip: d.ipRingkas },
              });
            }
            return { ok: false, alasan: "KODE_SALAH", sisaPercobaan: sisa } as const;
          }

          // 4. Kode benar: sekali pakai + jatah gagal harian dikembalikan.
          await tx
            .update(otpPermintaan)
            .set({ terpakaiPada: d.sekarang })
            .where(eq(otpPermintaan.id, otp.id));
          await tx.execute(sql`
            UPDATE otp_gagal_harian SET gagal = GREATEST(gagal - 1, 0)
             WHERE hp_hmac = ${d.hpHmac} AND tanggal = ${d.tanggalWib}::date`);

          // 5. Satu akun per nomor terverifikasi (hp_hmac UK). Akun lama dengan versi kunci HMAC lama
          //    dikenali lewat semua versi, lalu di-HMAC ulang dengan versi terbaru (M11).
          const semua = sql`ARRAY[${sql.join(
            d.hpHmacSemuaVersi.map((h) => sql`${h}::bytea`),
            sql`, `,
          )}]`;
          const cari = () =>
            tx.execute<{
              id: string;
              status: string;
              dianonimkan_pada: Date | null;
              hp_hmac_kunci_versi: number;
            }>(sql`
              SELECT id, status, dianonimkan_pada, hp_hmac_kunci_versi FROM ${akun}
               WHERE hp_hmac = ANY(${semua}) OR nomor_hp_e164 = ${d.nomorHpE164}
               ORDER BY (hp_hmac = ANY(${semua})) DESC
               LIMIT 1
               FOR UPDATE`);
          let a = (await cari()).rows[0];
          let akunBaru = false;
          if (!a) {
            const masuk = await tx.execute<{ id: string }>(sql`
              INSERT INTO ${akun} (nomor_hp_e164, hp_hmac, hp_hmac_kunci_versi, hp_terverifikasi_pada)
              VALUES (${d.nomorHpE164}, ${d.hpHmac}, ${d.hpHmacKunciVersi}, ${d.sekarang})
              ON CONFLICT DO NOTHING
              RETURNING id`);
            const id = masuk.rows[0]?.id;
            if (id) {
              akunBaru = true;
              a = {
                id,
                status: "AKTIF",
                dianonimkan_pada: null,
                hp_hmac_kunci_versi: d.hpHmacKunciVersi,
              };
            } else {
              a = (await cari()).rows[0];
            }
          }
          if (!a) throw new Error("akun tidak ditemukan setelah insert ON CONFLICT");
          if (a.status === "DIHAPUS" || a.dianonimkan_pada !== null) {
            await tx.insert(logAudit).values({
              jenis: "LOGIN_PEMBELI_DITOLAK",
              aktor: "PENGGUNA",
              refJenis: "akun",
              refId: a.id,
              data: { alasan: "AKUN_DIHAPUS", ip: d.ipRingkas },
            });
            return { ok: false, alasan: "AKUN_TIDAK_AKTIF" } as const;
          }
          if (!akunBaru) {
            await tx
              .update(akun)
              .set({
                hpTerverifikasiPada: d.sekarang,
                ...(a.hp_hmac_kunci_versi !== d.hpHmacKunciVersi
                  ? { hpHmac: d.hpHmac, hpHmacKunciVersi: d.hpHmacKunciVersi }
                  : {}),
                diubahPada: sql`now()`,
              })
              .where(eq(akun.id, a.id));
          }

          // 6. Rotasi sesi: sesi pembeli lama di perangkat ini dicabut; sesi baru dengan ID baru.
          if (d.sesiLamaHash) {
            await tx
              .update(sesi)
              .set({ dicabutPada: d.sekarang })
              .where(
                and(
                  eq(sesi.idHash, d.sesiLamaHash),
                  isNotNull(sesi.akunId),
                  isNull(sesi.dicabutPada),
                ),
              );
          }
          await tx.insert(sesi).values({
            idHash: d.sesiBaru.idHash,
            akunId: a.id,
            kedaluwarsaPada: d.sesiBaru.kedaluwarsaPada,
            reauthPada: d.sekarang,
            aktifTerakhirPada: d.sekarang,
            dibuatPada: d.sekarang,
          });

          await tx.insert(logAudit).values({
            jenis: "LOGIN_PEMBELI_BERHASIL",
            aktor: "PENGGUNA",
            refJenis: "akun",
            refId: a.id,
            data: { akunBaru, ip: d.ipRingkas },
          });
          // N-13: opt-in WA dicatat sebagai peristiwa (tabel akun_notifikasi menyusul, W-02).
          // Tidak dicentang = tidak mengubah apa pun (bukan pencabutan).
          if (d.waOptin) {
            await tx.insert(logAudit).values({
              jenis: "WA_OPTIN",
              aktor: "PENGGUNA",
              refJenis: "akun",
              refId: a.id,
              data: { sumber: "LOGIN_OTP", waktu: d.sekarang.toISOString() },
            });
          }
          return { ok: true, akunId: a.id, akunBaru } as const;
        });
      } catch (err) {
        if (err instanceof Batal) {
          await db.insert(logAudit).values({
            jenis: "OTP_PEMBELI_BATAS_HARIAN",
            aktor: "PENGGUNA",
            refJenis: null,
            refId: null,
            data: { ip: d.ipRingkas },
          });
          return err.hasil;
        }
        throw err;
      }
    },

    async cariSesi(idHash, sekarang, idleMs) {
      const [s] = await db
        .select({ akunId: akun.id, kedaluwarsaPada: sesi.kedaluwarsaPada })
        .from(sesi)
        .innerJoin(akun, eq(akun.id, sesi.akunId))
        .where(
          and(
            eq(sesi.idHash, idHash),
            isNull(sesi.dicabutPada),
            gt(sesi.kedaluwarsaPada, sekarang),
            gt(sesi.aktifTerakhirPada, new Date(sekarang.getTime() - idleMs)),
            sql`${akun.status} <> 'DIHAPUS'`,
            isNull(akun.dianonimkanPada),
          ),
        );
      return s ?? null;
    },

    async sentuhSesi(idHash, sekarang) {
      await db
        .update(sesi)
        .set({ aktifTerakhirPada: sekarang })
        .where(
          and(
            eq(sesi.idHash, idHash),
            isNotNull(sesi.akunId),
            lt(sesi.aktifTerakhirPada, new Date(sekarang.getTime() - 60_000)),
          ),
        );
    },

    async cabutSesi(idHash, sekarang) {
      await db
        .update(sesi)
        .set({ dicabutPada: sekarang })
        .where(and(eq(sesi.idHash, idHash), isNotNull(sesi.akunId), isNull(sesi.dicabutPada)));
    },

    async ringkasanAkun(akunId) {
      const [a] = await db
        .select({
          id: akun.id,
          nomorHpE164: akun.nomorHpE164,
          namaPanggilan: akun.namaPanggilan,
          jenisPelanggan: akun.jenisPelanggan,
          status: akun.status,
        })
        .from(akun)
        .where(eq(akun.id, akunId));
      return a ?? null;
    },

    async catatAudit(jenis, data, akunId) {
      await db.insert(logAudit).values({
        jenis,
        aktor: "PENGGUNA",
        refJenis: akunId ? "akun" : null,
        refId: akunId,
        data,
      });
    },
  };
}
