# T-009 — Kontrak `InventorySource`

Status: usulan v0.3 (15 Nov 2026, T-047: sinkron `keputusan.md` §11–§13 — snapshot saat invoice K-15/P-08, modal per satuan jual K-01, K-02, K-03; v0.2 12 Nov: keputusan PR #9 + temuan keamanan) · Squad: Build & QA (Joseph) · Dasar: `keputusan.md` #8, §11–§13, ADR-0001 §4.1
Tergantung: T-001 (selesai). Dipakai oleh: T-018 (`LocalInventory`), T-019 (`GudangApiInventory`), T-022, T-023, T-040.

Inti: NEKAT membaca SKU, stok, dan harga modal dari satu antarmuka. Ada dua implementasi, `LocalInventory` (default) dan `GudangApiInventory`. Modul lain **hanya** membaca snapshot lokal dan tidak pernah memanggil Gudang langsung.

## 1. Batas tanggung jawab

| Milik `InventorySource` (adapter) | Milik NEKAT (modul `inventori`, bukan adapter) |
|---|---|
| Mengambil daftar SKU, stok tersedia, harga modal dari sumber | Snapshot lokal + kolom `disinkron_pada` |
| Cek stok cabang saat invoice terbit & konfirmasi stok riil saat cut-off | Reservasi stok per baris invoice, dibuat **saat invoice terbit** (stok snapshot − reservasi aktif); barang yang hanya di keranjang tidak memotong stok (P-08) |
| Mengirim permintaan picking per grup | Outbox `picking:{grup_id}`, retry, status di panel admin |
| Memetakan format sumber ke tipe NEKAT (anti-corruption layer) | Validasi modal, aturan "tidak tayang", pagar harga |

Reservasi **tidak** dikirim ke Gudang. Gudang baru tahu tentang pesanan setelah harga grup dikunci saat cut-off (flow T-002 v0.6 §6).

## 2. Tipe data (di `packages/shared`, divalidasi Zod)

Semua uang memakai tipe bermerek `Rupiah` dari `packages/shared` (integer aman ≥ 0, dicek `Number.isSafeInteger`; ADR §5.1). Adapter **tidak membulatkan** nilai apa pun (H6: tanpa pembulatan). Modal dibaca **per satuan jual** (K-01); modal yang bukan integer ditangani menurut §7. Semua waktu ISO-8601 dengan offset eksplisit, disimpan `timestamptz`.

```ts
type SkuId = string;            // ID SKU milik NEKAT (stabil)
type SkuSumberId = string;      // ID SKU di sumber (Gudang); dipetakan lewat tabel pemetaan

interface SkuSumber {
  skuId: SkuId;
  skuSumberId: SkuSumberId | null;   // null untuk LocalInventory
  nama: string;                      // 1–200 karakter (Zod), di-escape saat tampil di panel admin
  kategori: string;                  // kode kategori sumber, dipakai filter rokok/bir (§7)
  satuanDasar: 'pcs' | 'kg' | 'liter';
  konversiSatuan: Array<{            // P-03: satuan kuantitas yang tersedia per produk
    satuan: 'PCS_3' | 'LUSIN' | 'DUS' | 'KOLI';   // kode kanonik P-03 (PCS_1 = satuanDasar)
    isi: number;                     // integer ≥ 1, dalam satuanDasar (mis. dus isi 24 pcs, koli isi 4 dus = 96)
  }>;                                // boleh kosong (produk hanya dijual 1 pcs); tiap satuan maks. sekali
  beratGram: number;                 // integer ≥ 0, dipakai kalkulator ongkir (T-031)
  barcode: string | null;
  aktifDiSumber: boolean;            // false → produk tidak tayang
  diubahPada: string;                // waktu perubahan terakhir di sumber
}

interface StokSumber {
  skuId: SkuId;
  lokasiId: string;                  // gudang/toko cabang (F-20)
  tersedia: number;                  // integer ≥ 0, dalam satuanDasar
  dataPada: string;                  // waktu data stok menurut sumber
}

interface ModalSumber {
  skuId: SkuId;
  satuan: 'PCS_1' | 'PCS_3' | 'LUSIN' | 'DUS' | 'KOLI';   // K-01: modal per satuan jual, tanpa pembagian karton
  modalPerSatuan: Rupiah | null;     // null / ≤ 0 / pecahan → satuan jual TIDAK TAYANG (bukan harga nol)
  dataPada: string;
}

interface KonfirmasiStok {
  grupId: string;
  skuId: SkuId;
  lokasiId: string;                  // cabang penerima pesanan (F-20)
  qtyDibutuhkan: number;             // total qty baris anggota lunas pada grup (dalam satuanDasar)
  kunciIdempotensi: string;          // `konfirmasi:{grup_id}:v{versi}`
}

interface StokTerkonfirmasi {
  grupId: string;
  skuId: SkuId;
  qtyTersedia: number;               // bisa < qtyDibutuhkan → alokasi parsial (flow B-09)
  dataPada: string;
}

interface PermintaanPicking {
  grupId: string;
  lokasiId: string;                  // cabang yang menyiapkan barang (F-20)
  kunciIdempotensi: string;          // `picking:{grup_id}:v{versi_alokasi}`; versi naik bila alokasi dikoreksi admin
  slotKirim: { tanggal: string; mulai: string; selesai: string }; // WIB
  baris: Array<{
    anggotaId: string;               // id anggota grup (bukan data pribadi)
    skuId: SkuId;
    qty: number;                     // qty teralokasi, bukan qty dipesan
    caraKirim: 'ANTAR_RUMAH' | 'DROP_POINT';
    dropPointId: string | null;
  }>;                                // TANPA nama, nomor HP, atau alamat pembeli
}

interface HasilPicking {
  grupId: string;
  status: 'DITERIMA' | 'DUPLIKAT';   // DUPLIKAT = kunci idempotensi sudah pernah diterima
  referensiSumber: string | null;    // nomor dokumen picking di Gudang; maks. 100 karakter, di-escape saat tampil
}
```

Data pribadi pembeli tidak pernah dikirim ke Gudang. Gudang cukup tahu barang, jumlah, slot, dan drop point.

## 3. Antarmuka

```ts
interface InventorySource {
  readonly nama: 'local' | 'gudang';
  listSku(sejak?: Date): Promise<SkuSumber[]>;
  getStok(skuIds: SkuId[], lokasiId: string): Promise<StokSumber[]>;
  getHargaModal(skuIds: SkuId[]): Promise<ModalSumber[]>;
  konfirmasiStok(req: KonfirmasiStok): Promise<StokTerkonfirmasi>;
  kirimPermintaanPicking(req: PermintaanPicking): Promise<HasilPicking>;
}
```

Aturan umum:
- `skuIds` maksimal **200** per panggilan; pemanggil memecah batch.
- SKU yang tidak dikenal sumber tidak dilempar sebagai error; SKU itu tidak muncul di hasil. Pemanggil memperlakukannya sebagai stok 0 dan modal kosong (tidak tayang).
- `konfirmasiStok` dan `kirimPermintaanPicking` **wajib idempoten** berdasarkan `kunciIdempotensi`. "Isi sama" = hash SHA-256 dari payload kanonik (kunci JSON terurut, baris diurutkan `anggotaId`,`skuId`); kunci sama dengan hash berbeda → `KONFLIK_IDEMPOTENSI`.
- Ketersediaan barang dicek di cabang penerima pesanan (`lokasiId`) **saat invoice terbit** (checkout grup) dan dikonfirmasi lagi saat cut-off (F-20, P-08). Masuk keranjang tidak memanggil adapter dan tidak memotong stok.
- Adapter tidak menulis ke database NEKAT. Penulisan snapshot dilakukan modul `inventori`.

## 4. Error

Semua adapter melempar `InventoryError` dengan kode tetap:

| Kode | Arti | Boleh retry? | Perilaku pemanggil |
|---|---|---|---|
| `SUMBER_TIDAK_TERJANGKAU` | timeout, koneksi gagal, HTTP 5xx, redirect | ya | job sinkron: coba lagi; checkout: **tahan checkout** (H14, §6) |
| `DIBATASI` | HTTP 429 | ya, ikuti `Retry-After` (maks. 60 dtk) | sama dengan baris di atas |
| `DITOLAK` | HTTP 401/403 (kredensial salah) | tidak | alarm admin; checkout ditahan (H14) |
| `DATA_TIDAK_VALID` | respons tidak lolos skema Zod, atau melebihi batas ukuran | tidak | baris SKU/stok diabaikan dan dicatat; baris **modal** yang gagal → SKU **tidak tayang** (snapshot modal lama TIDAK dipakai) sampai baris valid diterima |
| `KONFLIK_IDEMPOTENSI` | kunci sama dengan isi berbeda | tidak | alarm admin, grup tidak diproses ulang otomatis |

## 5. Timeout & retry (hanya `GudangApiInventory`)

| Panggilan | Timeout | Retry |
|---|---|---|
| `listSku`, `getStok`, `getHargaModal` (job sinkron) | 10 dtk | 3× backoff 2–8 dtk + jitter |
| `getStok` on-demand saat checkout | 2 dtk | tanpa retry; gagal → tahan checkout (H14, §6) |
| `konfirmasiStok` (cut-off) | 10 dtk | 5× backoff hingga 60 dtk; gagal semua → grup `DITAHAN` |
| `kirimPermintaanPicking` (worker outbox) | 10 dtk | retry pg-boss dengan backoff eksponensial sampai 6 jam, lalu status `GAGAL` di panel admin |

### 5.1 Koneksi ke Gudang (keamanan)

- `GUDANG_API_URL` wajib skema `https://` dan divalidasi saat start (nilai lain → aplikasi gagal start). Host diambil dari konfigurasi saja, tidak pernah dari data respons.
- Token dikirim hanya lewat header `Authorization: Bearer …`, tidak pernah di URL/query. Path log `headers.authorization` diredaksi (sama dengan API, PR #8).
- HTTP client **tidak mengikuti redirect** (redirect diperlakukan `SUMBER_TIDAK_TERJANGKAU`), agar token tidak terkirim ke host lain (CWE-918).
- Batas ukuran respons per panggilan (default teknis 5 MB) → lebih besar = `DATA_TIDAK_VALID`.
- Cara autentikasi final mengikuti spesifikasi Gudang (I-01); aturan di atas tetap berlaku.

## 6. Snapshot & batas usia data

- Job sinkron berkala menyimpan hasil ke snapshot lokal (`sku_snapshot`, `stok_snapshot`, `modal_snapshot`) beserta `disinkron_pada`.
- Katalog, engine harga, dan reservasi **selalu** membaca snapshot lokal.
- Batas usia data = konfigurasi `INVENTORY_MAKS_UMUR_DATA_MENIT`, default **15 menit** (P-10, diputuskan 12 Nov).
- Perilaku saat Gudang tak terjangkau = konfigurasi `INVENTORY_SAAT_GANGGUAN`, default **`tahan_checkout`** (H14, diputuskan 12 Nov):
  - `tahan_checkout` (default): pengecekan stok di cabang saat checkout gagal (`SUMBER_TIDAK_TERJANGKAU`/`DIBATASI`/`DITOLAK`) → checkout ditahan dengan pesan "Stok sedang dicek, coba lagi sebentar"; tidak ada invoice Xendit yang dibuat. Katalog tetap tampil dari snapshot;
  - `jual_snapshot` (opsi, hanya bila manusia mengubah H14): snapshot dalam batas usia → tetap jual;
  - snapshot lewat batas usia → checkout grup (penerbitan invoice) ditolak dengan pesan "Coba lagi sebentar" (flow T-002 v0.6 M-03), apa pun modenya; menambah barang ke keranjang tetap boleh (tidak mengikat stok, P-08);
  - saat cut-off tanpa konfirmasi stok → grup `DITAHAN`, tidak dikirim ke picking.
- `LocalInventory` tidak pernah kedaluwarsa (sumber = database NEKAT sendiri).

## 7. Validasi data masuk

- Modal `null` atau ≤ 0 → produk tidak tayang, dicatat di log admin. Tidak pernah diubah menjadi 0.
- Modal bukan integer → **tidak dibulatkan** (H6); satuan jual masuk antrean "perlu ditinjau: modal pecahan" di panel admin dan tidak tayang (K-01, diputuskan 13 Nov). Modal wajib diinput/dikirim per satuan jual; adapter tidak membagi modal karton.
- Penurunan modal dibanding snapshot sebelumnya → **hanya dicatat** di log admin, tanpa ambang tahan (K-02, diputuskan 13 Nov).
- Stok negatif dari sumber → dianggap 0, dicatat.
- `konversiSatuan[].isi` < 1, satuan ganda, atau berat negatif → baris ditolak (`DATA_TIDAK_VALID`).
- Kategori rokok/bir dari sumber (field `kategori`) → SKU tidak diimpor di Fase 1 (`keputusan.md` #7).
- **Snapshot harga & modal saat invoice (K-15, P-08; menggantikan F-08 "saat grup dibuka"):** tidak ada `modal_snapshot_grup`. Saat invoice barang terbit, setiap baris invoice menyimpan salinan modal (nilai, sumber `gudang`/`local`/`timpaan`, `dataPada`) dan harga dari tabel harga terkini, dengan syarat data modal ≤ batas usia (P-10). Perubahan modal sesudahnya tidak mengubah invoice itu. Barang yang hanya di keranjang memakai harga live dan tidak memotong stok. Bila stok habis sebelum invoice lunas, invoice dibatalkan (P-08; flow T-002 A5).
- **Saat cut-off:** pagar ≥ modal memakai **modal terkini** dari snapshot lokal (≤ batas usia); modal terkini di atas harga dibayar → grup `DITAHAN` untuk admin (P-09/P-26, diputuskan 14 Nov).
- **Timpaan modal saat mode Gudang (P-25):** admin dengan izin `harga.ubah` (login OTP + TOTP, H9) boleh menimpa modal per satuan jual lewat panel/CSV. Disimpan terpisah (`modal_timpaan`: nilai, alasan wajib, siapa, kapan, `kedaluwarsa_pada` opsional); nilai Gudang tetap disinkron untuk perbandingan. Selama timpaan aktif, timpaan dipakai dan panel menampilkan selisih terhadap nilai Gudang. Timpaan berlaku **sampai dicabut admin** (K-03); bila `kedaluwarsa_pada` diisi dan tercapai, sistem mengirim **pemberitahuan otomatis** ke admin untuk barang itu beserta catatannya (timpaan tidak dicabut otomatis). Timpaan wajib integer > 0 dan memicu pemeriksaan ulang pagar harga; setiap perubahan tercatat di log admin.
- Invoice yang sudah terbit **tetap** memakai snapshot barisnya; timpaan baru, modal tidak valid, atau sinkron baru berlaku untuk harga live, invoice berikutnya, dan pemeriksaan pagar saat cut-off.
- Pemetaan `skuSumberId` → `skuId` disimpan di tabel `pemetaan_sku_sumber`; SKU sumber baru tanpa pemetaan masuk antrean "perlu dipetakan" di panel admin dan tidak tayang.

## 8. Konfigurasi (environment variable, tanpa nilai rahasia di repo)

| Variabel | Contoh | Catatan |
|---|---|---|
| `INVENTORY_SOURCE` | `local` | `local` atau `gudang`; dibaca saat start, nilai lain → aplikasi gagal start |
| `GUDANG_API_URL` | `https://gudang.contoh.id/api` | wajib bila `gudang`; harus `https://` (§5.1). Nama sama dengan `.env.example` PR #8 |
| `GUDANG_API_TOKEN` | — | rahasia, hanya di secret store |
| `INVENTORY_MAKS_UMUR_DATA_MENIT` | `15` | P-10 (diputuskan) |
| `INVENTORY_SAAT_GANGGUAN` | `tahan_checkout` | H14 (diputuskan) |
| `INVENTORY_INTERVAL_SINKRON_MENIT` | `5` | job sinkron berkala |

## 9. Perbedaan dua implementasi

| Perilaku | `LocalInventory` | `GudangApiInventory` |
|---|---|---|
| Sumber data | tabel NEKAT (panel admin / CSV, T-036/T-038) | API Gudang-Repo |
| `listSku` | baca tabel produk NEKAT | tarik dari Gudang + pemetaan SKU |
| `konfirmasiStok` | kembalikan stok tabel NEKAT saat itu | panggil Gudang |
| `kirimPermintaanPicking` | buat daftar picking internal (tampilan admin / PDF) | kirim ke Gudang, simpan `referensiSumber` |
| Gangguan | tidak ada | §5 dan §6 |

## 10. Tes kontrak (dibuat di T-018/T-019)

Satu set tes yang sama dijalankan terhadap `LocalInventory` dan `GudangApiInventory` (dengan mock server Gudang):
1. `listSku` mengembalikan data yang lolos skema; SKU berkategori rokok/bir tidak muncul.
2. Modal kosong/≤ 0 menghasilkan `modalPerSatuan: null`, bukan 0.
3. SKU tak dikenal tidak muncul di hasil dan tidak melempar error.
4. `konfirmasiStok` dua kali dengan kunci sama → hasil sama.
5. `kirimPermintaanPicking` dua kali dengan kunci sama → kedua `DITERIMA`/`DUPLIKAT`, picking hanya satu.
6. Kunci sama, isi berbeda → `KONFLIK_IDEMPOTENSI`.
7. (Gudang) timeout → `SUMBER_TIDAK_TERJANGKAU`; 429 → `DIBATASI`; 401 → `DITOLAK`.
8. `PermintaanPicking` tidak memuat nama, nomor HP, atau alamat (dicek skema).
9. (Gudang) redirect 3xx tidak diikuti; respons > batas ukuran → `DATA_TIDAK_VALID`; token tidak muncul di log.
10. Baris modal tidak valid → satuan jual tidak tayang walau snapshot lama ada; modal pecahan tidak dibulatkan dan masuk antrean tinjau (K-01).
11. `getStok` memakai `lokasiId`; stok cabang lain tidak dipakai.
12. `getHargaModal` mengembalikan modal per satuan jual (`satuan`), bukan per karton yang dibagi.
13. `PermintaanPicking` memakai `anggotaId` dan qty teralokasi; tidak ada field `pesananId` atau data pribadi.

## 11. Butuh keputusan / data dari manusia

| # | Pertanyaan | Pemilik | Default sementara |
|---|---|---|---|
| I-01 | Spesifikasi API Gudang-Repo (endpoint SKU, stok, modal, konfirmasi stok, picking; cara autentikasi). Repo Gudang belum bisa diakses agen NEKAT | Joseph (tim Gudang) | `GudangApiInventory` dibuat terhadap mock sesuai kontrak ini; dipetakan ulang saat spesifikasi tersedia |
| I-02 | Apakah Gudang mendukung kunci idempotensi untuk picking? Bila tidak, NEKAT menyimpan `referensiSumber` dan mengecek dulu sebelum mengirim ulang | Joseph | NEKAT cek dulu sebelum kirim ulang |

Sudah diputuskan dan diterapkan di dokumen ini: P-10 = 15 menit, H14 = tahan checkout, F-20 = cek stok di cabang, P-03 = satuan 1 pcs/3 pcs/lusin/dus/koli, P-25 = modal boleh ditimpa (12 Nov); K-01 = modal per satuan jual, pecahan → tidak tayang + tinjau; K-02 = penurunan modal hanya dicatat; K-03 = timpaan sampai dicabut + kedaluwarsa opsional dengan pemberitahuan; K-15/P-08 = snapshot harga & modal saat invoice, menggantikan F-08 (13 Nov); P-09/P-26 = DITAHAN (14 Nov). ADR-0001 §4.1/§9 H14 masih menyebut default "jual snapshot" — di luar cakupan T-047 (hanya H9), diusulkan sebagai task lanjutan.
