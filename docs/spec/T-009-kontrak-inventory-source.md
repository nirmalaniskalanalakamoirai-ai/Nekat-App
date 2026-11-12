# T-009 — Kontrak `InventorySource`

Status: usulan v0.1 (12 Nov 2026) · Squad: Build & QA (Joseph) · Dasar: `keputusan.md` #8, ADR-0001 §4.1
Tergantung: T-001 (selesai). Dipakai oleh: T-018 (`LocalInventory`), T-019 (`GudangApiInventory`), T-022, T-023, T-040.

Inti: NEKAT membaca SKU, stok, dan harga modal dari satu antarmuka. Ada dua implementasi, `LocalInventory` (default) dan `GudangApiInventory`. Modul lain **hanya** membaca snapshot lokal dan tidak pernah memanggil Gudang langsung.

## 1. Batas tanggung jawab

| Milik `InventorySource` (adapter) | Milik NEKAT (modul `inventori`, bukan adapter) |
|---|---|
| Mengambil daftar SKU, stok tersedia, harga modal dari sumber | Snapshot lokal + kolom `disinkron_pada` |
| Konfirmasi stok riil saat cut-off | Reservasi stok per peserta (stok snapshot − reservasi aktif) |
| Mengirim permintaan picking per grup | Outbox `picking:{grup_id}`, retry, status di panel admin |
| Memetakan format sumber ke tipe NEKAT (anti-corruption layer) | Validasi modal, aturan "tidak tayang", pagar harga |

Reservasi **tidak** dikirim ke Gudang. Gudang baru tahu tentang pesanan setelah harga grup dikunci.

## 2. Tipe data (di `packages/shared`, divalidasi Zod)

Semua uang dalam **Rupiah integer** (`Rupiah = number`, bilangan bulat ≥ 0). Semua waktu ISO-8601 dengan offset eksplisit, disimpan `timestamptz`.

```ts
type SkuId = string;            // ID SKU milik NEKAT (stabil)
type SkuSumberId = string;      // ID SKU di sumber (Gudang); dipetakan lewat tabel pemetaan

interface SkuSumber {
  skuId: SkuId;
  skuSumberId: SkuSumberId | null;   // null untuk LocalInventory
  nama: string;
  satuanDasar: 'pcs' | 'pak' | 'lusin' | 'karton' | 'kg' | 'liter';
  isiPerSatuan: number;              // integer ≥ 1 (mis. karton isi 24)
  beratGram: number;                 // integer ≥ 0, dipakai kalkulator ongkir (T-031)
  barcode: string | null;
  aktifDiSumber: boolean;            // false → produk tidak tayang
  diubahPada: string;                // waktu perubahan terakhir di sumber
}

interface StokSumber {
  skuId: SkuId;
  tersedia: number;                  // integer ≥ 0, dalam satuanDasar
  dataPada: string;                  // waktu data stok menurut sumber
}

interface ModalSumber {
  skuId: SkuId;
  modalPerSatuan: Rupiah | null;     // null / ≤ 0 → produk TIDAK TAYANG (bukan harga nol)
  dataPada: string;
}

interface KonfirmasiStok {
  grupId: string;
  skuId: SkuId;
  qtyDibutuhkan: number;             // total qty peserta lunas pada grup
  kunciIdempotensi: string;          // `konfirmasi:{grup_id}`
}

interface StokTerkonfirmasi {
  grupId: string;
  skuId: SkuId;
  qtyTersedia: number;               // bisa < qtyDibutuhkan → alokasi parsial (flow B-09)
  dataPada: string;
}

interface PermintaanPicking {
  grupId: string;
  kunciIdempotensi: string;          // `picking:{grup_id}`
  slotKirim: { tanggal: string; mulai: string; selesai: string }; // WIB
  baris: Array<{
    pesananId: string;
    skuId: SkuId;
    qty: number;                     // qty teralokasi, bukan qty dipesan
    caraKirim: 'ANTAR_RUMAH' | 'DROP_POINT';
    dropPointId: string | null;
  }>;                                // TANPA nama, nomor HP, atau alamat pembeli
}

interface HasilPicking {
  grupId: string;
  status: 'DITERIMA' | 'DUPLIKAT';   // DUPLIKAT = kunci idempotensi sudah pernah diterima
  referensiSumber: string | null;    // nomor dokumen picking di Gudang
}
```

Data pribadi pembeli tidak pernah dikirim ke Gudang. Gudang cukup tahu barang, jumlah, slot, dan drop point.

## 3. Antarmuka

```ts
interface InventorySource {
  readonly nama: 'local' | 'gudang';
  listSku(sejak?: Date): Promise<SkuSumber[]>;
  getStok(skuIds: SkuId[]): Promise<StokSumber[]>;
  getHargaModal(skuIds: SkuId[]): Promise<ModalSumber[]>;
  konfirmasiStok(req: KonfirmasiStok): Promise<StokTerkonfirmasi>;
  kirimPermintaanPicking(req: PermintaanPicking): Promise<HasilPicking>;
}
```

Aturan umum:
- `skuIds` maksimal **200** per panggilan; pemanggil memecah batch.
- SKU yang tidak dikenal sumber tidak dilempar sebagai error; SKU itu tidak muncul di hasil. Pemanggil memperlakukannya sebagai stok 0 dan modal kosong (tidak tayang).
- `konfirmasiStok` dan `kirimPermintaanPicking` **wajib idempoten** berdasarkan `kunciIdempotensi`.
- Adapter tidak menulis ke database NEKAT. Penulisan snapshot dilakukan modul `inventori`.

## 4. Error

Semua adapter melempar `InventoryError` dengan kode tetap:

| Kode | Arti | Boleh retry? | Perilaku pemanggil |
|---|---|---|---|
| `SUMBER_TIDAK_TERJANGKAU` | timeout, koneksi gagal, HTTP 5xx | ya | pakai snapshot (lihat §6) |
| `DIBATASI` | HTTP 429 | ya, ikuti `Retry-After` | pakai snapshot |
| `DITOLAK` | HTTP 401/403 (kredensial salah) | tidak | alarm admin, pakai snapshot |
| `DATA_TIDAK_VALID` | respons tidak lolos skema Zod | tidak | baris tersebut diabaikan, dicatat di log |
| `KONFLIK_IDEMPOTENSI` | kunci sama dengan isi berbeda | tidak | alarm admin, grup tidak diproses ulang otomatis |

## 5. Timeout & retry (hanya `GudangApiInventory`)

| Panggilan | Timeout | Retry |
|---|---|---|
| `listSku`, `getStok`, `getHargaModal` (job sinkron) | 10 dtk | 3× backoff 2–8 dtk + jitter |
| `getStok` on-demand saat checkout | 2 dtk | tanpa retry; langsung pakai snapshot |
| `konfirmasiStok` (cut-off) | 10 dtk | 5× backoff hingga 60 dtk; gagal semua → grup `DITAHAN` |
| `kirimPermintaanPicking` (worker outbox) | 10 dtk | retry pg-boss dengan backoff eksponensial sampai 6 jam, lalu status `GAGAL` di panel admin |

## 6. Snapshot & batas usia data

- Job sinkron berkala menyimpan hasil ke snapshot lokal (`sku_snapshot`, `stok_snapshot`, `modal_snapshot`) beserta `disinkron_pada`.
- Katalog, engine harga, dan reservasi **selalu** membaca snapshot lokal.
- Batas usia data = konfigurasi `INVENTORY_MAKS_UMUR_DATA_MENIT` (nilai menunggu **P-10**; default teknis sementara 15 menit).
- Perilaku saat Gudang tak terjangkau = konfigurasi `INVENTORY_SAAT_GANGGUAN=jual_snapshot|tahan_checkout` (menunggu **H14**; default sementara `jual_snapshot`):
  - snapshot masih dalam batas usia → tetap jual, reservasi di atas snapshot;
  - snapshot lewat batas → ikut grup baru ditolak dengan pesan "Coba lagi sebentar" (flow M-03);
  - saat cut-off tanpa konfirmasi stok → grup `DITAHAN`, tidak dikirim ke picking.
- `LocalInventory` tidak pernah kedaluwarsa (sumber = database NEKAT sendiri).

## 7. Validasi data masuk

- Modal `null`, ≤ 0, atau bukan integer → produk tidak tayang, dicatat di log admin. Tidak pernah diubah menjadi 0.
- Stok negatif dari sumber → dianggap 0, dicatat.
- `isiPerSatuan` < 1 atau berat negatif → baris ditolak (`DATA_TIDAK_VALID`).
- Kategori rokok/bir dari sumber → SKU tidak diimpor di Fase 1 (`keputusan.md` #7).
- Perubahan modal **tidak** mengubah harga pesanan yang sudah dibuat; pesanan menyimpan snapshot modal sendiri (ADR §5).
- Pemetaan `skuSumberId` → `skuId` disimpan di tabel `pemetaan_sku_sumber`; SKU sumber baru tanpa pemetaan masuk antrean "perlu dipetakan" di panel admin dan tidak tayang.

## 8. Konfigurasi (environment variable, tanpa nilai rahasia di repo)

| Variabel | Contoh | Catatan |
|---|---|---|
| `INVENTORY_SOURCE` | `local` | `local` atau `gudang`; dibaca saat start, nilai lain → aplikasi gagal start |
| `GUDANG_API_BASE_URL` | `https://gudang.contoh.id/api` | wajib bila `gudang` |
| `GUDANG_API_TOKEN` | — | rahasia, hanya di secret store |
| `INVENTORY_MAKS_UMUR_DATA_MENIT` | `15` | P-10 |
| `INVENTORY_SAAT_GANGGUAN` | `jual_snapshot` | H14 |
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
1. `listSku` mengembalikan data yang lolos skema; SKU rokok/bir tidak muncul.
2. Modal kosong/≤ 0 menghasilkan `modalPerSatuan: null`, bukan 0.
3. SKU tak dikenal tidak muncul di hasil dan tidak melempar error.
4. `konfirmasiStok` dua kali dengan kunci sama → hasil sama.
5. `kirimPermintaanPicking` dua kali dengan kunci sama → kedua `DITERIMA`/`DUPLIKAT`, picking hanya satu.
6. Kunci sama, isi berbeda → `KONFLIK_IDEMPOTENSI`.
7. (Gudang) timeout → `SUMBER_TIDAK_TERJANGKAU`; 429 → `DIBATASI`; 401 → `DITOLAK`.
8. `PermintaanPicking` tidak memuat nama, nomor HP, atau alamat (dicek skema).

## 11. Butuh keputusan / data dari manusia

| # | Pertanyaan | Pemilik | Default sementara |
|---|---|---|---|
| I-01 | Spesifikasi API Gudang-Repo (endpoint SKU, stok, modal, konfirmasi stok, picking; cara autentikasi). Repo Gudang belum bisa diakses agen NEKAT | Joseph (tim Gudang) | `GudangApiInventory` dibuat terhadap mock sesuai kontrak ini; dipetakan ulang saat spesifikasi tersedia |
| P-10 | Batas usia data stok/modal | Joseph + Efan | 15 menit |
| H14 | Perilaku saat Gudang tak terjangkau | Joseph + Efan | `jual_snapshot` |
| I-02 | Apakah Gudang mendukung kunci idempotensi untuk picking? Bila tidak, NEKAT menyimpan `referensiSumber` dan mengecek dulu sebelum mengirim ulang | Joseph | NEKAT cek dulu sebelum kirim ulang |
