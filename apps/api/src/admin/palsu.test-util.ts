// Repo palsu (memori) untuk tes API auth admin tanpa PostgreSQL. Semantik mengikuti repo DB
// (penguncian = domain `setelahGagal`, anti pakai ulang TOTP, kode pemulihan sekali pakai).
// SEMUA DATA FIKTIF.
import type {
  AdminUntukMasuk,
  DataAdminBaru,
  RepoAdminKatalog,
  RepoAuthAdmin,
  SesiAdminAktif,
} from "@nekat/db";
import { setelahGagal } from "@nekat/domain";
import type { KonfigAdmin } from "./konfig.js";

export const KONFIG_UJI: KonfigAdmin = {
  kunciTotp: Buffer.alloc(32, 7),
  kunciTotpVersi: 1,
  kunciHmac: Buffer.alloc(32, 9),
  sesiMenit: 60,
  originDiizinkan: ["https://nekat.contoh"],
};

interface AdminPalsu extends AdminUntukMasuk {
  nomorHpE164: string;
  peran: string[];
  kodePemulihan: { hash: Buffer; dipakai: boolean }[];
}

interface SesiPalsu {
  adminId: string;
  faktorKeduaPada: Date | null;
  kedaluwarsaPada: Date;
  dicabutPada: Date | null;
}

export const IZIN_PERAN: Record<string, string[]> = {
  owner: ["produk.ubah", "stok.ubah", "admin.kelola"],
  admin: ["produk.ubah", "stok.ubah"],
  // Peran uji tanpa izin stok (RBAC).
  cs_uji: ["produk.ubah"],
};

export class RepoAuthPalsu implements RepoAuthAdmin {
  readonly admin = new Map<string, AdminPalsu>();
  readonly sesi = new Map<string, SesiPalsu>();
  readonly audit: { jenis: string; data: Record<string, unknown>; refId: string | null }[] = [];

  cariUntukMasuk(hp: string) {
    return Promise.resolve([...this.admin.values()].find((a) => a.nomorHpE164 === hp) ?? null);
  }
  cariUntukMasukPerId(id: string) {
    return Promise.resolve(this.admin.get(id) ?? null);
  }
  #ubah(id: string, ubah: Partial<AdminPalsu>) {
    const a = this.admin.get(id);
    if (a) this.admin.set(id, { ...a, ...ubah });
  }
  catatGagal(adminId: string, sekarang: Date, k: { batasGagal: number; lamaKunciMenit: number }) {
    const a = this.admin.get(adminId);
    if (!a) return Promise.resolve({ gagalBeruntun: 0, dikunciSampai: null });
    const st = setelahGagal(a, sekarang, k);
    this.#ubah(adminId, st);
    return Promise.resolve(st);
  }
  terimaLangkahTotp(adminId: string, langkah: number) {
    const a = this.admin.get(adminId);
    if (!a || (a.totpLangkahTerakhir !== null && a.totpLangkahTerakhir >= langkah)) {
      return Promise.resolve(false);
    }
    this.#ubah(adminId, { totpLangkahTerakhir: langkah, gagalBeruntun: 0, dikunciSampai: null });
    return Promise.resolve(true);
  }
  pakaiKodePemulihan(adminId: string, hash: Buffer) {
    const k = this.admin.get(adminId)?.kodePemulihan.find((x) => !x.dipakai && x.hash.equals(hash));
    if (!k) return Promise.resolve(false);
    k.dipakai = true;
    return Promise.resolve(true);
  }
  resetGagal(adminId: string) {
    this.#ubah(adminId, { gagalBeruntun: 0, dikunciSampai: null });
    return Promise.resolve();
  }
  buatSesi(d: {
    idHash: Buffer;
    adminId: string;
    faktorKeduaPada: Date | null;
    kedaluwarsaPada: Date;
  }) {
    this.sesi.set(d.idHash.toString("hex"), { ...d, dicabutPada: null });
    return Promise.resolve();
  }
  cariSesi(idHash: Buffer, sekarang: Date): Promise<SesiAdminAktif | null> {
    const s = this.sesi.get(idHash.toString("hex"));
    const a = s ? this.admin.get(s.adminId) : undefined;
    if (!s || !a || s.dicabutPada || s.kedaluwarsaPada <= sekarang) return Promise.resolve(null);
    if (a.status !== "AKTIF" || !a.totpAktifPada) return Promise.resolve(null);
    return Promise.resolve({
      adminId: a.id,
      nama: a.nama,
      faktorKeduaPada: s.faktorKeduaPada,
      kedaluwarsaPada: s.kedaluwarsaPada,
      peran: a.peran,
      izin: [...new Set(a.peran.flatMap((p) => IZIN_PERAN[p] ?? []))].sort(),
    });
  }
  cabutSesi(idHash: Buffer, sekarang: Date) {
    const s = this.sesi.get(idHash.toString("hex"));
    if (s && !s.dicabutPada) s.dicabutPada = sekarang;
    return Promise.resolve();
  }
  cabutSemuaSesi(adminId: string, sekarang: Date) {
    for (const s of this.sesi.values()) if (s.adminId === adminId) s.dicabutPada ??= sekarang;
    return Promise.resolve();
  }
  catatAudit(jenis: string, data: Record<string, unknown>, refId: string | null) {
    this.audit.push({ jenis, data, refId });
    return Promise.resolve();
  }
  jumlahAdmin() {
    return Promise.resolve(this.admin.size);
  }
  adaNomorHp(hp: string) {
    return Promise.resolve([...this.admin.values()].some((a) => a.nomorHpE164 === hp));
  }
  buatAdmin(d: DataAdminBaru) {
    this.admin.set(d.id, {
      id: d.id,
      nama: d.nama,
      nomorHpE164: d.nomorHpE164,
      status: "AKTIF",
      kataSandiHash: d.kataSandiHash,
      totpRahasiaEnc: d.totpRahasiaEnc,
      totpKunciVersi: d.totpKunciVersi,
      totpAktifPada: new Date(),
      totpLangkahTerakhir: d.totpLangkahTerakhir,
      gagalBeruntun: 0,
      dikunciSampai: null,
      peran: [...d.peran],
      kodePemulihan: d.kodePemulihanHash.map((hash) => ({ hash, dipakai: false })),
    });
    return Promise.resolve();
  }
  /** Ganti peran (untuk tes RBAC). */
  aturPeran(adminId: string, peran: string[]) {
    this.#ubah(adminId, { peran });
  }
}

/** Repo katalog palsu: hanya mencatat panggilan (tes auth/RBAC/CSRF tidak butuh isi). */
export function repoKatalogPalsu(): RepoAdminKatalog & { panggilan: string[] } {
  const panggilan: string[] = [];
  const catat = <T>(nama: string, nilai: T) => {
    panggilan.push(nama);
    return Promise.resolve(nilai);
  };
  return {
    panggilan,
    daftarKategori: () => catat("daftarKategori", []),
    kategoriPerId: () => catat("kategoriPerId", null),
    daftarProduk: () => catat("daftarProduk", { isi: [], total: 0 }),
    ambilProduk: () => catat("ambilProduk", null),
    buatProduk: () => catat("buatProduk", "00000000-0000-7000-8000-000000000001"),
    ubahProduk: () => catat("ubahProduk", undefined),
    buatSku: () => catat("buatSku", "00000000-0000-7000-8000-000000000002"),
    ubahSku: () => catat("ubahSku", undefined),
    buatSatuan: () => catat("buatSatuan", "00000000-0000-7000-8000-000000000003"),
    ubahSatuan: () => catat("ubahSatuan", undefined),
    daftarGudang: () => catat("daftarGudang", []),
    daftarStok: () => catat("daftarStok", { isi: [], total: 0 }),
    aturStok: () => catat("aturStok", undefined),
    daftarLog: () => catat("daftarLog", []),
  };
}
