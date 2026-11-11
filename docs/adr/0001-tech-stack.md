# ADR-0001: Tech stack NEKAT Fase 1

## Status

**Diusulkan** — 10 Nov 2026, oleh agen Software Architect (task T-001).
Menjadi **Diterima** setelah PR T-001 di-merge oleh pemilik squad Build & QA (lihat H10 di bagian 9).
Semua task berjenis kode di `project-specs/backlog.md` menunggu ADR ini di-merge.

Revisi: **v0.4** (11 Nov 2026, sesi QA) — penyelarasan nama kolom `akun_id`, label default sementara H14 & F-11,
aturan webhook/OTP/IDOR/sesi, baris ongkir & diskon di §5.3. **v0.5** (putaran 2): peta kunci batal seluruh pesanan /
batalkan grup, izin aksi `harga.ubah` di §7, istilah `waktu_bayar` (= `paid_at` dari gateway). v0.3 = revisi setelah Evidence Collector & Code Reviewer.

**Rujukan silang:** ID flow (A-xx, B-xx, M-xx, P-xx, R-xx, §6) merujuk `docs/flow/group-order.md` di **PR #2 (T-002,
belum di-merge)**; aturan harga merujuk `docs/spec/engine-harga.md` di **PR #3 (T-003, belum di-merge)**.
Ketiga PR sebaiknya di-merge bersama.

Dokumen acuan: `CLAUDE.md`, `project-specs/keputusan.md` (wajib diikuti), `project-specs/fase-1-mvp.md`,
`project-specs/backlog.md`, `project-specs/keputusan-terbuka.md`, `project-specs/jadwal-otomatis.md`, `docs/legal/`.

ADR ini **tidak** memuat harga, persentase margin, tarif ongkir, atau biaya layanan pihak ketiga.
Setiap kelas biaya yang disebut adalah perkiraan kasar yang wajib dicek ulang sebelum dipakai.

---

## 1. Konteks & kebutuhan

### 1.1 Situasi

- **Tim kecil.** Tiga pemilik squad manusia (Randy, Efan, Joseph). Sebagian besar kode ditulis oleh agen AI,
  diperiksa Evidence Collector, Code Reviewer, AI-Generated Code Auditor, lalu Reality Checker.
  Manusia meninjau PR hanya di jendela 13.00–14.00 WIB (`jadwal-otomatis.md`).
- **Pilot kecil.** 1 zona (radius 2–3 km dari drop point), target 50 rumah tangga aktif, ≥1 grup tercapai per hari.
  Beban puncak diperkirakan puluhan permintaan per detik paling tinggi; skala bukan masalah utama di Fase 1.
- **PWA mobile first**, Bahasa Indonesia. Aplikasi native baru di Fase 5.
- **Uang nyata sejak hari pertama:** pembayaran Xendit (QRIS, VA, e-wallet), saldo pengguna, selisih harga ke saldo,
  refund, COD bersyarat (maks. Rp500.000 per pesanan).
- **Integrasi:** Gudang (`InventorySource`), Xendit, gateway WhatsApp (OTP & notifikasi), n8n (otomasi tepi).
- **Job terjadwal penting bisnis:** cut-off per slot kirim & kunci harga grup, daftar picking, daftar antar per slot,
  laporan harian owner, evaluasi KPI COD mingguan. Semua dalam zona waktu **WIB (Asia/Jakarta)**.

### 1.2 Kebutuhan yang menentukan pilihan

| Kode | Kebutuhan | Mengapa penting |
|---|---|---|
| K1 | Bahasa **bertipe kuat** dan sangat populer | Agen AI menulis kode lebih benar di ekosistem yang banyak contohnya; kompilator menangkap kesalahan sebelum review manusia |
| K2 | **Mudah dites**: unit, integrasi dengan DB nyata, E2E Playwright | Gerbang QA otomatis adalah pengganti utama reviewer manusia |
| K3 | **Transaksi ACID** + kunci baris untuk saldo, kunci harga, kuota | Kesalahan uang tidak bisa ditoleransi |
| K4 | Satu bahasa di backend & frontend bila memungkinkan | Tipe & validasi bersama (harga kartu = harga detail), lebih sedikit konteks untuk agen |
| K5 | Job terjadwal yang **idempoten**, sadar zona waktu, dan bisa diulang | Cut-off & evaluasi KPI tidak boleh jalan dua kali atau terlewat |
| K6 | Biaya operasi & beban perawatan rendah | Pilot; tidak ada SRE sampai Fase 5 |
| K7 | Batas modul yang jelas & port untuk vendor | Gudang, Xendit, WhatsApp bisa diganti/di-mock tanpa menyentuh logika bisnis |

### 1.3 Gaya arsitektur

**Modular monolith** dengan inti domain bergaya *ports & adapters* yang ringan.
Microservices ditolak: tim kecil, batas domain masih bergerak (lihat F-01..F-18, P-01..P-21), dan transaksi lintas
modul (pesanan + saldo + grup) jauh lebih aman dalam satu database.

Modul (bounded context awal): `akun`, `zona`, `katalog`, `inventori`, `harga`, `grup`, `pesanan`, `pembayaran`,
`saldo`, `ongkir`, `cod`, `notifikasi`, `admin`, `laporan`.
Logika yang punya invarian kuat (engine harga, pagar harga, ledger saldo, kelayakan COD, aturan grup ≥3 akun)
ditulis sebagai **fungsi murni** tanpa impor framework/DB, sehingga bisa diuji ribuan kasus dengan cepat.

---

## 2. Opsi yang dipertimbangkan

- **A — TypeScript full-stack** (Node.js + Fastify + PostgreSQL + React PWA): satu bahasa untuk API, worker, PWA;
  skema Zod dan tipe dipakai bersama.
- **B — Laravel (PHP)** + PostgreSQL/MySQL + Inertia/Vue atau React: "baterai lengkap" (ORM, antrean, scheduler,
  auth, admin Filament).
- **C — Go (atau Kotlin/Spring) API + React PWA**: performa & tipe kuat di backend, tetapi dua bahasa.
- **D — BaaS (Supabase/Firebase) + PWA** (singkat): cepat untuk CRUD, tetapi logika uang, cut-off, dan ledger
  tersebar di aturan platform, sulit dites, terkunci vendor. Ditolak untuk inti; Supabase hanya relevan sebagai
  penyedia PostgreSQL terkelola (H3).

### Tabel perbandingan

Skala: ++ sangat baik, + baik, 0 netral, − kurang.

| Kriteria | A. TS/Node | B. Laravel | C. Go + React | D. BaaS |
|---|---|---|---|---|
| K1 Tipe kuat end-to-end | ++ (strict TS) | 0 (PHP bertipe opsional, PHPStan) | + backend, frontend tetap TS | 0 |
| K1 Popularitas / kualitas kode agen AI | ++ | + | + | + |
| K2 Kemudahan tes (unit + Playwright) | ++ (Vitest + Playwright satu bahasa) | + (Pest/PHPUnit + Playwright JS) | + | − |
| K3 ACID & kunci baris | ++ (PostgreSQL) | ++ | ++ | 0 (via RPC/SQL) |
| K4 Satu bahasa backend–frontend | ++ | − | − | + |
| K5 Job terjadwal idempoten | + (pg-boss, perlu disiplin) | ++ (Queue + Scheduler bawaan) | 0 (rakit sendiri) | − |
| K6 Biaya & perawatan | + | + | + | + awal, − saat tumbuh |
| K7 Port/adapter vendor | ++ | + | ++ | − |
| Panel admin cepat | 0 (dibangun sendiri) | ++ (Filament) | 0 | + |
| Jalan ke app native Fase 5 | ++ (React Native/Expo berbagi tipe & logika) | 0 | 0 | + |
| Risiko utama | Banyak pilihan pustaka → wajib dibakukan di ADR | Dua bahasa bila PWA React; tipe lebih lemah | Dua bahasa, lebih banyak kode boilerplate | Lock-in, sulit dites |

**Kesimpulan:** A unggul pada K1, K2, K4, K7 dan jalan ke Fase 5. B unggul pada kecepatan panel admin dan
scheduler bawaan; keunggulan itu kami tutup dengan pilihan pustaka yang dibakukan di bagian 3.
Yang kami korbankan dengan memilih A: tidak ada "satu cara resmi" seperti Laravel, sehingga konvensi harus
ditulis eksplisit (ADR ini + aturan lint) dan panel admin dibuat sendiri.

---

## 3. Keputusan yang diusulkan

| Area | Pilihan | Catatan |
|---|---|---|
| Bahasa | **TypeScript** mode `strict`, ESM | `noUncheckedIndexedAccess`, larang `any` lewat ESLint |
| Runtime | **Node.js Active LTS terbaru saat T-012 (cek ulang)**, dipin di `.nvmrc` & `engines` | Sama di dev, CI, staging, production |
| Paket | **pnpm workspaces** | Lockfile wajib di-commit |
| Backend HTTP | **Fastify** + `fastify-type-provider-zod` | Validasi input/output dengan Zod; OpenAPI dihasilkan dari skema lewat `@fastify/swagger` + `jsonSchemaTransform` dari type provider |
| Validasi & kontrak | **Zod** di `packages/shared` | Dipakai API, worker, PWA, dan tes |
| Database | **PostgreSQL** (17.x atau terbaru yang didukung penyedia) | ACID, `SELECT ... FOR UPDATE`, constraint `CHECK`, `timestamptz` |
| ORM / query | **Drizzle ORM** + **drizzle-kit** untuk migrasi | Migrasi berupa file SQL yang di-review di PR; query mentah tetap mudah untuk kunci baris |
| Antrean & scheduler | **pg-boss** (antrean di PostgreSQL) | Tanpa Redis; cron dengan `tz: 'Asia/Jakarta'`; singleton key untuk idempotensi |
| Frontend | **React** + **Vite** + **React Router** + **TanStack Query** | SPA PWA; tidak ada perhitungan harga di klien |
| PWA | **vite-plugin-pwa** (Workbox): manifest, service worker, banner "Tambah ke layar utama" | Cache aset statis saja; data harga/stok selalu dari jaringan |
| Styling | CSS dengan design token dari T-007 | Pustaka komponen ditentukan UX Architect |
| Panel admin | Bagian dari PWA (`/admin`), rute & API terpisah dengan RBAC | Satu basis kode, satu sistem auth |
| Sesi & auth | Sesi server di PostgreSQL, cookie `HttpOnly; Secure; SameSite=Lax` | Bisa dicabut seketika (lebih aman dari JWT panjang); token CSRF untuk mutasi |
| Log | **pino** (JSON) dengan `redact` untuk PII & rahasia | Lihat bagian 7 |
| Unit & integrasi | **Vitest**; tes integrasi memakai PostgreSQL nyata (service container CI) | Tidak memakai mock DB untuk logika uang |
| E2E | **Playwright** (Chromium + WebKit, viewport ponsel) | Xendit sandbox / adapter palsu, WhatsApp mode `log` |
| Mock vendor | **MSW** atau server mock Fastify kecil | Mock Gudang (T-019), Xendit, WhatsApp |
| Lint & format | ESLint (typescript-eslint) + Prettier | Aturan batas modul (`eslint-plugin-boundaries` atau setara) |
| CI | **GitHub Actions** | Rincian di 3.4 |
| Hosting | Container Docker; pilot di VPS/region dekat Indonesia (H3, H12) | Staging & production terpisah total |

Versi pustaka persis ditetapkan saat scaffold (T-012) sebagai versi stabil terbaru, dipin di lockfile.

### 3.1 Struktur repo (monorepo)

```
nekat-app/
├── apps/
│   ├── api/            # Fastify: HTTP API, webhook Xendit, halaman /g/:kode (meta OG untuk pratinjau WhatsApp)
│   ├── worker/         # proses pg-boss: cut-off, picking, daftar antar, laporan, KPI COD, outbox WA/Gudang
│   └── web/            # React PWA (pembeli + /admin)
├── packages/
│   ├── domain/         # fungsi murni: harga, pagar, ledger, grup, COD, ongkir. TANPA impor DB/HTTP/framework
│   ├── shared/         # skema Zod, tipe Rupiah, kode error, teks UI bersama
│   ├── db/             # skema Drizzle, migrasi SQL, repositori, seed (tanpa harga, tanpa rokok/bir; import CSV menolak kategori rokok/bir)
│   └── adapters/       # InventorySource, PaymentGateway (Xendit), WhatsAppGateway, Clock
├── e2e/                # Playwright
├── config/             # lokasi.json (koordinat dari Joseph), konfigurasi non-rahasia
├── docs/               # adr/, flow/, spec/, legal/
├── n8n/                # ekspor JSON workflow n8n (tanpa kredensial)
└── .env.example        # daftar variabel, TANPA nilai rahasia
```

Aturan dependensi (dicek lint di CI): `domain` tidak bergantung pada apa pun selain `shared`;
`adapters` dan `db` boleh bergantung pada `domain`; `apps/*` merangkai semuanya. Controller tidak boleh memanggil
repositori langsung untuk operasi uang — wajib lewat use case modul (`pembayaran`, `saldo`, `grup`).

`api` dan `worker` dibangun dari kode yang sama tetapi dijalankan sebagai **proses terpisah**, sehingga job berat
tidak memperlambat API dan worker bisa di-restart sendiri.

### 3.2 Database & transaksi

- Satu database PostgreSQL per lingkungan (dev, test, staging, production). Tidak ada database bersama dengan Gudang
  (`keputusan.md` #8).
- Semua waktu disimpan sebagai `timestamptz` (UTC); konversi ke WIB hanya di tepi (tampilan, jadwal, tanggal bisnis).
  Waktu di event outbox/antar-modul ditulis ISO-8601 **dengan offset eksplisit** (`Z` atau `+07:00`), tidak pernah
  waktu lokal tanpa offset.
- Operasi uang/grup memakai transaksi eksplisit `READ COMMITTED` + kunci baris (`FOR UPDATE`). Status selalu dicek
  **di dalam** transaksi setelah kunci diambil, tidak dari bacaan sebelumnya. `SERIALIZABLE` tidak dipakai di Fase 1.
- **Urutan kunci tetap** (mencegah deadlock): `grup` (urut `grup_id`) → `stok_sku` (urut `sku_id`) → `peserta` →
  `pesanan` → `akun_saldo`. Operasi yang menyentuh beberapa grup mengunci semuanya dulu dengan urutan `grup_id`.
  `pesanan` dikunci bila transaksi perlu memeriksa "baris terakhir yang belum batal" (mis. `refund_ongkir:{pesanan_id}`,
  flow R-07); detailnya ditetapkan di T-004/T-021.

| Operasi | Baris yang dikunci (berurutan) | Cek di dalam transaksi |
|---|---|---|
| Ikut grup (checkout) | grup → stok SKU (snapshot) → akun_saldo bila pakai saldo | status grup ∈ {DIBUKA, BELUM_AKTIF, AKTIF}, `sekarang < cut-off`, stok − reservasi ≥ qty; buat peserta + reservasi |
| Webhook PAID / bayar penuh dengan saldo / konfirmasi COD | grup → peserta → akun_saldo (bila debit) | grup ∈ {DIBUKA, BELUM_AKTIF, AKTIF}, atau grup = CUT_OFF dengan `evaluasi_dimulai_pada IS NULL` dan `waktu_bayar ≤ cut-off` (masa tenggang, flow B-11.5; basis `waktu_bayar` menunggu F-11, lihat §4.2); selain itu → jalur bayar terlambat ke saldo (flow P17); hitung ulang akun terhitung dari data peserta |
| Batal oleh pengguna / akun dibekukan admin | grup → stok SKU → peserta → akun_saldo (refund). Pesanan MENUNGGU_BAYAR (flow P6) dan admin batalkan grup (flow G15): **semua grup pesanan urut `grup_id`** → stok SKU → peserta → `pesanan` → akun_saldo | sebelum cut-off; lepas reservasi; hitung ulang akun terhitung |
| Cut-off per grup (§3.3) | grup → stok SKU → peserta → akun_saldo (kredit selisih) | status grup = CUT_OFF; tulis harga final, alokasi, ledger, outbox dalam satu transaksi |
| Debit/kredit saldo lain (koreksi admin) | akun_saldo | `saldo + jumlah ≥ 0` |

- `UNIQUE` parsial `peserta(grup_id, akun_id) WHERE status` aktif (bukan BATAL/KEDALUWARSA/DIREFUND) mencegah satu
  akun tercatat dua kali di grup yang sama; `UNIQUE(produk_id, zona_id, slot_id)` pada grup (M-10; menunggu F-14).
- Invarian dijaga dua lapis: fungsi domain **dan** constraint DB (`CHECK`, `UNIQUE`, `NOT NULL`, FK).
- Migrasi: hanya maju, berupa SQL ter-review; migrasi yang merusak data dipecah menjadi dua rilis (expand → contract).

### 3.3 Antrean job & scheduler

| Job | Pemicu | Kunci idempotensi |
|---|---|---|
| Cut-off slot + kunci harga (prosedur `docs/flow/group-order.md` §6) | **Satu cron tiap menit** memproses setiap slot dengan `cut_off ≤ sekarang` yang `job_run`-nya belum `SELESAI` (sekaligus menggantikan watchdog M-01) | `cutoff:{slot_id}`; per grup status lewat update bersyarat `DIBUKA`/`BELUM_AKTIF`/`AKTIF` → `CUT_OFF` → `HARGA_TERKUNCI` / `GAGAL_LANJUT_SATUAN` / `GAGAL` / `DITAHAN` → `DIPROSES` …; **sejak `CUT_OFF` status hanya maju** dan menjadi checkpoint bila job diulang (M-02) |
| Daftar antar per slot | Setelah job cut-off slot selesai | `antar:{slot_id}` |
| Laporan harian owner | Cron WIB (jam ditentukan T-010) | `laporan:{tanggal_WIB}` |
| Evaluasi KPI COD mingguan | Cron WIB mingguan (hari/jam ditentukan T-010) | `kpi-cod:{tahun-minggu_ISO_WIB}` per pengguna |
| Kirim WhatsApp | Outbox | `wa:{template}:{ref_jenis}:{ref_id}:{akun_id}[:{periode_WIB}]` (periode untuk pesan berulang, mis. pengingat) |
| Permintaan picking (lokal atau ke Gudang) | Outbox **per grup**, ditulis dalam transaksi kunci harga (flow §6 langkah 9) **setelah harga dikunci & stok dialokasikan**: grup `HARGA_TERKUNCI` dan `GAGAL_LANJUT_SATUAN`. Tidak dikirim saat pesanan lunas | `picking:{grup_id}` |
| Rekonsiliasi Xendit vs ledger | Cron harian | `rekon:{tanggal_WIB}` |

Prinsip:
1. Tabel `job_run(nama_job, kunci_periode)` unik, dengan `status` (`BERJALAN`/`SELESAI`/`GAGAL`), `lease_sampai`,
   dan heartbeat yang memperpanjang lease. Run baru boleh **mengambil alih** bila status ≠ `SELESAI` dan lease habis
   (update bersyarat), sehingga job yang mati di tengah bisa diulang. `job_run` hanya mencegah dua run bersamaan;
   **pencegah efek ganda** adalah status grup (update bersyarat) dan `kunci_idempotensi` unik di ledger/outbox.
2. **Pola outbox hanya untuk efek eksternal** (WhatsApp, Gudang): ditulis dalam transaksi yang sama dengan perubahan
   bisnis, dikirim worker dengan retry + backoff. Tidak ada panggilan HTTP keluar di dalam transaksi DB.
   **Ledger saldo tidak pernah lewat outbox**: kredit/debit ditulis langsung di transaksi bisnisnya.
3. Semua logika yang bergantung waktu menerima port `Clock`, sehingga tes bisa "memajukan waktu" ke cut-off.
4. Tanggal bisnis dan minggu KPI dihitung di zona `Asia/Jakarta` (WIB tidak punya DST, tetapi tetap jangan mengandalkan
   zona waktu server: server dijalankan dengan `TZ=UTC`).
5. Job yang gagal setelah batas retry masuk antrean "mati" dan memunculkan peringatan ke kanal admin.
6. **Granularitas cut-off per slot** mengikuti asumsi A-01 di `docs/flow/group-order.md` (semua grup di satu slot
   berbagi satu waktu cut-off) dan **menunggu konfirmasi** (Operations/T-006). Bila ternyata per grup, kunci berubah
   menjadi `cutoff:{grup_id}`; prosedur per grup di dalam job tidak berubah.
7. API ikut/batal grup menolak sendiri bila `sekarang ≥ cut-off` (guard waktu), tidak bergantung pada job.

### 3.4 CI/CD & lingkungan

- **Setiap PR** (GitHub Actions): install dengan lockfile → lint → typecheck → unit test → tes integrasi (PostgreSQL
  service container) → build semua app → pemindai rahasia (gitleaks) → audit dependensi. PR tidak bisa di-merge
  bila gagal (branch protection di `main`).
- **E2E Playwright**: berjalan di PR yang menyentuh `apps/web`, `apps/api`, atau `packages/domain`, terhadap stack
  lokal di runner (Docker Compose), Xendit diganti adapter palsu; suite terhadap Xendit sandbox berjalan terjadwal
  di staging.
- **Staging**: deploy otomatis dari `main` (T-045), data uji tanpa harga asli, Xendit mode test, WhatsApp mode
  `sandbox`, domain sementara (#6).
- **Production**: deploy manual dari tag rilis, hanya setelah Reality Checker lulus dan persetujuan pemilik squad
  (`CLAUDE.md` aturan 3). Gerbang ini memakai *environment protection* GitHub; ketersediaannya untuk repo privat
  bergantung pada paket GitHub (lihat H7, perlu dicek).
- **Backup**: dump PostgreSQL harian terenkripsi ke object storage di lokasi berbeda + uji pemulihan berkala
  (minimal sebulan sekali, dicatat). Bila memakai PostgreSQL terkelola, aktifkan point-in-time recovery bila tersedia.
- **Observabilitas minimum**: endpoint `/health` & `/ready`, pemantau uptime eksternal, log JSON terpusat,
  error tracking (H8), metrik antrean (job tertunda/gagal).

---

## 4. Integrasi

### 4.1 Modul `InventorySource` (keputusan #8)

Kontrak rinci disusun di T-009; ADR ini menetapkan bentuk dan batasnya.

```ts
interface InventorySource {
  listSku(sejak?: Date): Promise<SkuSumber[]>;            // SKU, nama, satuan, berat
  getStok(skuIds: SkuId[]): Promise<StokSumber[]>;       // stok tersedia + waktu data
  getHargaModal(skuIds: SkuId[]): Promise<ModalSumber[]>; // modal dalam Rupiah (integer) + waktu data
  konfirmasiStok(req: KonfirmasiStok): Promise<StokTerkonfirmasi>; // saat cut-off: stok riil untuk qty total grup
  kirimPermintaanPicking(req: PermintaanPicking): Promise<HasilPicking>; // arah balik per grup, idempoten
}

// Milik NEKAT, BUKAN bagian adapter Gudang: reservasi di atas snapshot stok lokal
interface ReservasiStok {
  reservasi(idPeserta, sku, qty, kedaluwarsa): Promise<HasilReservasi>; // STOK_KURANG bila tidak cukup
  lepasReservasi(idReservasi): Promise<void>;
}
```

- **Reservasi stok dimiliki NEKAT**, dihitung di atas snapshot stok lokal (stok tersedia − reservasi aktif) dalam
  transaksi DB yang sama dengan pembuatan peserta. Gudang tidak menyimpan reservasi NEKAT; Gudang baru menerima
  permintaan picking setelah harga dikunci. *Masukan untuk T-009:* kontrak `InventorySource` memuat `konfirmasiStok`
  dan permintaan picking per grup; reservasi tetap di modul `inventori` NEKAT untuk kedua implementasi.
- **`LocalInventory`** (default): data dari tabel NEKAT sendiri, dikelola lewat panel admin / import CSV.
  `kirimPermintaanPicking` menghasilkan daftar picking internal (PDF/tampilan admin).
- **`GudangApiInventory`**: memanggil API Gudang-Repo. Berperan sebagai **anti-corruption layer**: memetakan SKU,
  satuan, dan format angka Gudang ke model NEKAT; data Gudang tidak pernah dipakai mentah oleh modul lain.
- **Toggle konfigurasi**: `INVENTORY_SOURCE=local|gudang` (dibaca saat start, divalidasi). Tidak dipilih per request.
- **Sinkron**: tarikan berkala (job) + tarikan on-demand saat checkout untuk stok; hasil disimpan sebagai *snapshot*
  lokal dengan kolom `disinkron_pada`. Katalog dan engine harga **selalu** membaca snapshot lokal, sehingga
  gangguan Gudang tidak menjatuhkan aplikasi. Batas usia data mengikuti P-10. Saat Gudang tidak bisa dihubungi:
  **default teknis sementara sampai H14 diputuskan** — tetap jual dengan snapshot selama umurnya di bawah batas
  (perilaku dibuat dapat dikonfigurasi agar bisa diganti menjadi "tahan checkout"); lewat batas → **ikut grup baru ditolak**
  ("Coba lagi sebentar", flow M-03); saat cut-off tanpa konfirmasi stok → grup `DITAHAN`.
- **Harga modal masuk dari Gudang lalu divalidasi**: modal ≤ 0 atau kosong → produk otomatis tidak tayang
  (bukan harga nol).
- **Arah balik**: **per grup, setelah harga dikunci & stok dialokasikan** (status `HARGA_TERKUNCI` atau
  `GAGAL_LANJUT_SATUAN`) → baris outbox `picking:{grup_id}` berisi daftar (peserta,
  qty teralokasi, cara kirim) → worker mengirim dengan kunci idempotensi, timeout pendek, retry + backoff, dan
  status terlihat di panel admin. Konfirmasi Gudang memindahkan grup ke `DIPROSES`. Grup `DITAHAN` tidak dikirim.
- Mock server Gudang untuk tes disediakan di T-019; tes kontrak yang sama dijalankan terhadap kedua implementasi.

### 4.2 Xendit (keputusan #2 dan #9)

- Adapter `PaymentGateway` dengan implementasi `XenditGateway` dan `FakeGateway` (tes/E2E). Pemakaian SDK resmi
  atau HTTP langsung diputuskan di T-029; keduanya berada di balik port yang sama.
- Metode: QRIS, Virtual Account, e-wallet. Mode test di dev/staging, mode live hanya di production; kunci dipilih
  dari environment variable, tidak pernah dari kode atau DB.
- **Membuat pembayaran**: `external_id` = ID pembayaran NEKAT (Fase 1: **satu pembayaran per pesanan**, sehingga
  kunci idempotensi Xendit setara dengan ID pesanan seperti di flow M-06); header idempotensi dikirim bila didukung endpoint
  terkait; nominal dalam rupiah integer yang dihitung server.
- **Webhook**:
  1. Verifikasi header `x-callback-token` dengan perbandingan *constant-time* terhadap nilai dari secret store;
     gagal → `401`, dicatat tanpa isi sensitif. Token ini statis, jadi **bukan bukti cukup** untuk uang:
  2. Untuk event PAID, server **wajib mengonfirmasi** lewat GET status invoice/pembayaran ke API Xendit (nominal,
     mata uang, `external_id`) sebelum menandai LUNAS. GET memakai **ID invoice yang tersimpan di DB** untuk
     `external_id` tersebut, **bukan** ID dari payload webhook; nominal & mata uang hasil GET dibandingkan dengan
     nominal pesanan yang **tersimpan di server** (tidak sama → tidak LUNAS, dicatat & alert) (CWE-345). Panggilan ini dilakukan **sebelum** transaksi DB dibuka;
     gagal/timeout → `5xx` agar Xendit mengulang.
  3. **Satu transaksi**: insert `webhook_event` (dedup `UNIQUE(gateway, external_id, status)`) + pemrosesan
     (kunci sesuai tabel §3.2, ubah status, tulis ledger, tulis outbox notifikasi). Insert gagal karena duplikat →
     `200` tanpa efek. Error lain → **rollback + `5xx`** sehingga Xendit mengulang dan tidak ada event "tercatat
     tapi tidak diproses". Status hanya maju; event yang mundur diabaikan dan dicatat.
  4. Event mentah disimpan dengan PII di-*redact* (nama, nomor HP, email pembayar) dan dihapus setelah masa retensi
     yang ditetapkan T-005/T-030.
  5. Rate limit di endpoint webhook tidak boleh menolak retry sah Xendit: batas dihitung terpisah dan longgar,
     request bertoken valid tidak di-throttle oleh batas umum.
  6. Halaman "kembali dari pembayaran" di PWA **tidak** dianggap bukti bayar.
- **Basis waktu bayar terlambat**: ikuti jawaban F-11; secara teknis kedua nilai (`waktu_bayar` = `paid_at` dari gateway, dan waktu
  webhook diterima) disimpan.
- **Refund & selisih → saldo**: sesuai keputusan #9, selisih harga dan refund dikreditkan ke ledger saldo.
  Refund ke metode bayar asal dan pencairan saldo **tidak dibangun di Fase 1** (H5/F-03); bila manusia memutuskan
  lain, itu menjadi task baru.
- **Rekonsiliasi harian**: bandingkan transaksi Xendit dengan pembayaran & ledger NEKAT; selisih dilaporkan ke owner.
- Biaya transaksi per metode tidak dicantumkan di sini; Finance Tracker mengambilnya dari kontrak/dashboard Xendit.

### 4.3 Gateway WhatsApp

- Port `WhatsAppGateway { kirimOtp, kirimTemplate }` dengan implementasi:
  - `LogGateway` (dev & tes): pesan ditulis ke log dan tabel `pesan_keluar`; OTP terlihat di halaman dev **hanya**
    bila `WA_MODE=log` (bukan bergantung `NODE_ENV`); penjaga start di bawah menjamin mode ini mustahil di production.
  - `SandboxGateway` (staging): ke nomor uji yang di-whitelist saja.
  - Implementasi produksi: tergantung H2 (Meta Cloud API langsung atau BSP resmi).
- **Penjaga start**: aplikasi menolak start di production bila `WA_MODE` bukan mode produksi, atau sebaliknya.
- Semua pengiriman lewat outbox dengan batas frekuensi per pengguna & per jenis (angka dari T-010/F-17).
- OTP: 6 digit acak kriptografis, disimpan sebagai hash, kedaluwarsa singkat, batas percobaan & batas kirim per nomor
  dan per IP (T-016). Satu akun per nomor HP (format E.164, `UNIQUE`). Aturan wajib (angka di T-016, CWE-307/799):
  - OTP **sekali pakai**: dihapus/ditandai terpakai saat berhasil; OTP lama batal saat OTP baru dikirim.
  - OTP **dibatalkan** setelah N kali salah; pengguna harus minta OTP baru.
  - **Batas total percobaan verifikasi per nomor per hari** yang tidak di-reset oleh kirim ulang (mencegah brute force
    lewat siklus kirim ulang).
  - **Anggaran kirim global** (per jam/hari) dengan alert, mencegah penyalahgunaan biaya pesan (*SMS/WA pumping*).
  - Respons "kirim OTP" sama untuk nomor terdaftar maupun belum (cegah enumerasi nomor).
- Pesan promo hanya untuk pengguna yang mencentang persetujuan promo (`docs/legal/kebijakan-privasi.md`).

### 4.4 n8n

Peran yang diusulkan (H4): **otomasi tepi, bukan sumber kebenaran.**

| Boleh | Tidak boleh |
|---|---|
| Mengambil data laporan dari *view* read-only khusus (tanpa nomor HP/alamat) | Menjalankan cut-off, mengunci harga, menulis ledger saldo, mengubah status bayar |
| Mengirim laporan harian/rekap ke WhatsApp/email owner | Menyimpan kredensial Xendit atau kunci DB tulis |
| Memicu aksi lewat endpoint internal NEKAT yang terautentikasi, idempoten, dan tercatat (mis. "kirim ulang laporan") | Menjadi satu-satunya tempat logika bisnis berada |
| Alur operasional ringan (pengingat tim, ekspor ke spreadsheet internal) | Akses langsung ke tabel transaksi |

Job inti (bagian 3.3) tetap di kode `apps/worker` agar teruji, ter-versi, dan ikut CI.
Workflow n8n diekspor ke folder `n8n/` (tanpa kredensial) dan di-review seperti kode.

---

## 5. Uang & aturan harga

### 5.1 Representasi rupiah

- Semua nominal rupiah disimpan sebagai **integer** (`bigint` di PostgreSQL), satuan rupiah penuh. **Tidak ada `float`,
  `real`, `double`, atau `numeric` berpecahan untuk uang.**
- Di TypeScript: tipe bermerek `Rupiah` (integer, dicek `Number.isSafeInteger`); parser `pg` dikonfigurasi agar
  `bigint` dibaca aman. Operasi aritmetika uang hanya lewat helper di `packages/domain` (tambah, kurang, kali jumlah,
  persen dengan pembulatan eksplisit).
- Persentase (margin, diskon) disimpan sebagai integer **basis poin** atau pecahan rasional, bukan float. Nilainya
  KOSONG sampai diisi pemilik (`keputusan.md` #6).
- **Pembulatan**: mode final menunggu H6/P-02. Kendala teknis yang tidak bisa ditawar: hasil pembulatan harga jual
  tidak pernah di bawah modal; sebelum H6 diputuskan, helper membulatkan **ke atas** ke rupiah penuh
  (diberi label "sementara, menunggu H6" di kode).
- Format tampilan (contoh format: `Rp{nominal}` dengan pemisah ribuan titik) hanya di lapisan UI dengan `Intl.NumberFormat('id-ID')`.

### 5.2 Ledger saldo (append-only)

- Tabel `ledger_saldo`: `id`, `akun_id`, `jumlah` (bigint bertanda: + kredit, − debit), `jenis`
  (selisih_harga, refund, pakai_checkout, koreksi_admin, ...), `referensi_jenis`, `referensi_id`,
  `kunci_idempotensi UNIQUE`, `dibuat_oleh`, `dibuat_pada`.
- **Tidak ada UPDATE/DELETE**: dicabut hak aksesnya untuk peran DB aplikasi dan dijaga trigger. Koreksi = baris
  pembalik baru dengan alasan.
- Saldo berjalan disimpan di `akun_saldo` (dikunci `FOR UPDATE` saat debit) dengan `CHECK (saldo >= 0)`; tes
  integrasi memastikan `akun_saldo.saldo = SUM(ledger_saldo.jumlah)` dan job harian memverifikasinya.
- Kredit selisih saat cut-off: satu baris per peserta per grup, kunci `selisih:{grup_id}:{peserta_id}`, sehingga
  job cut-off yang terulang tidak menggandakan saldo.
- Bentuk akuntansi lengkap (double-entry dengan akun kas/kewajiban) tidak dibuat di Fase 1; skema disiapkan agar bisa
  dipetakan kemudian bila dibutuhkan Finance Tracker.

### 5.3 Aturan harga di kode (`CLAUDE.md`)

| Aturan | Penegakan |
|---|---|
| Harga = modal + margin per level; tidak ada harga di bawah modal | Fungsi murni `hitungHarga` di `packages/domain`; validasi saat simpan di admin/CSV; `CHECK (harga >= modal)` pada snapshot harga pesanan |
| Pagar: harga grup individu ≥ Mitra Grosir ≥ Franchise | Validator domain dipanggil di setiap jalur tulis (panel, CSV, sinkron Gudang); tes properti (*property-based*) |
| Diskon + gratis ongkir tidak membuat harga akhir < modal | Dicek di engine harga sebelum pesanan dibuat; ditolak dengan peringatan |
| Tarif ongkir (tarif dasar armada, per kg, per km), kapasitas armada, aturan gratis ongkir & diskon diatur admin (`keputusan.md` #4) | Hanya dari konfigurasi admin di DB; **tidak ada konstanta tarif di kode**; nilai kosong → opsi "kirim ke rumah" tidak tersedia (ambil di drop point tetap bisa) |
| Harga & potongan dihitung server | Request klien tidak pernah membawa harga/diskon yang dipercaya; server menghitung ulang dari data tersimpan |
| Harga final grup dikunci saat cut-off; tier lebih murah → selisih ke saldo | Job cut-off: status grup + harga terkunci + kredit ledger dalam satu transaksi |
| Harga kartu = harga detail; promo terpisah | Satu endpoint/fungsi harga dipakai keduanya; PWA tidak menghitung harga; respons memisahkan `harga_aktif` dan `promo` |
| Produk tanpa harga tidak tayang | Query **katalog** hanya mengambil produk dengan harga valid **dan stok > 0**; tes E2E memastikan |
| Halaman grup dari link `/g/:kode` ≠ katalog | Halaman grup **tetap tampil** walau stok habis atau grup sudah lewat cut-off: bila `pendaftaran_ditutup = true` (stok habis) **atau** status ≥ `CUT_OFF` → tombol "Ikut grup" nonaktif / diarahkan ke slot berikutnya (flow B-02). Filter stok > 0 hanya berlaku untuk katalog |
| Tier Mitra wajib ada di engine Fase 1 | Pesanan ambil di drop point = tingkat Mitra (`keputusan.md` #4), jadi `hitungHarga` menerima level `INDIVIDU` dan `MITRA` sejak Fase 1 (Franchise disiapkan di skema & pagar, tidak dipakai). Syarat "total memenuhi syarat" mengikuti P-05 |
| COD hanya untuk pengguna lolos KPI 3 minggu berturut-turut, maks. Rp500.000 per pesanan | Konstanta yang sudah DIPUTUSKAN (3 minggu berturut-turut, Rp500.000) di satu tempat di `packages/domain`, dites; ambang KPI (jumlah pesanan, % sukses, dst.) dari **konfigurasi admin** dengan default usulan `keputusan.md` #2; opsi COD tidak dikirim ke klien bila tidak layak atau total melebihi batas; dibandingkan sesuai P-18; admin bisa mencabut COD manual dengan **alasan wajib** tercatat di `log_admin` |

Setiap baris item pesanan menyimpan **snapshot**: modal, harga per satuan, tier, dan versi aturan saat transaksi,
sehingga perubahan harga di kemudian hari tidak mengubah riwayat.

---

## 6. Konfigurasi & rahasia (ringkas)

- Konfigurasi non-rahasia (koordinat `config/lokasi.json`, zona, base URL/domain #6) di file ter-commit atau panel admin.
- Rahasia **hanya** lewat environment variable dari secret store (GitHub Actions secrets, secret manager/penyimpanan
  terenkripsi di host; pemilik akun H7). Divalidasi Zod saat start; wajib hilang → proses berhenti tanpa mencetak nilai.
- `.env.example` berisi **nama** variabel dan keterangan saja, nilai kosong atau placeholder jelas (`ganti_saya`).
  `.env*` selain `.env.example` ada di `.gitignore`; gitleaks berjalan di CI dan disarankan sebagai pre-commit hook.

---

## 7. Keamanan & data pribadi

**PII (nomor HP, alamat, titik lokasi).** Acuan: `docs/legal/kebijakan-privasi.md` dan UU No. 27/2022 (PDP).
- Nomor HP disimpan dalam format E.164 di kolom tersendiri; akses hanya lewat modul `akun`. Log & error tracking
  me-*redact* nomor HP, alamat, OTP, token, dan header otorisasi (pino `redact` + uji otomatis yang memastikan
  string nomor HP tidak muncul di log).
- Halaman grup hanya mengembalikan **jumlah** peserta dan nama panggilan tersamar ("Bu S***, RW 05"); API tidak
  pernah mengirim nomor HP/alamat peserta lain. Ini dites di API test (T-044).
- Data untuk kurir/drop point dibatasi: nama, nomor HP, alamat, isi pesanan untuk slot yang dia antar (H13).
- Enkripsi saat transit (TLS di semua endpoint, termasuk koneksi DB lintas jaringan) dan enkripsi disk/at-rest dari
  penyedia. Enkripsi per kolom untuk nomor HP **tidak** diusulkan di Fase 1 (menyulitkan keunikan & pencarian);
  dapat ditambah kemudian dengan *blind index*.
- Retensi data mengikuti kebijakan privasi; fitur hapus/anonimkan akun disiapkan di model data (T-004).
- Lokasi penyimpanan data (isian "[lokasi]" di kebijakan privasi) diputuskan di H12.
- Data KTP/verifikasi usia **tidak** ada di Fase 1 (rokok & bir di luar Fase 1, `keputusan.md` #7).

**Akses & peran admin (RBAC).**

Fase 1 hanya dua peran: `owner` (semua, termasuk kelola admin & laporan keuangan) dan `admin` (produk, harga,
stok, grup, pesanan, ongkir, COD; tidak bisa kelola admin). Skema memakai tabel izin per aksi sehingga nanti bisa
dipecah (mis. `admin_harga`, `admin_operasional`, `cs`) tanpa migrasi besar. Nama izin aksi memakai pola
`<domain>.<aksi>`; contoh yang sudah dirujuk dokumen lain: `harga.ubah` (ubah modal/margin/tier & aturan promo,
`docs/spec/engine-harga.md` §8). Fase 1: `owner` dan `admin` sama-sama punya `harga.ubah`; daftar lengkap di T-004.

- Setiap aksi admin yang mengubah data (harga, stok, COD, koreksi saldo, status pesanan) ditulis ke `log_admin`
  (append-only: siapa, kapan, sebelum/sesudah, alasan).
- Login admin: H9 — **rekomendasi kuat: TOTP wajib sebelum panel admin ke production, menunggu H9**. Sesi admin
  lebih pendek dari sesi pembeli; akses `/admin` dibatasi rate limit.

**Kepemilikan data (IDOR, CWE-639).** Setiap resource milik pengguna (pesanan, peserta, saldo, alamat) difilter
dengan `akun_id` **dari sesi**, tidak pernah dari parameter/body request. Tes API (T-044) wajib mencoba akses lintas
akun dan memastikan ditolak (`404`).

**Sesi.** ID sesi **dirotasi** saat login berhasil dan saat naik hak (pembeli → admin) (CWE-384); cookie
`HttpOnly`, `Secure`, `SameSite=Lax`; logout menghapus sesi di server.

**Pengerasan lainnya.** Rate limit di endpoint OTP, login, ikut grup, dan `GET /g/:kode` (mencegah enumerasi kode grup; webhook: batas terpisah, §4.2); header keamanan (CSP, HSTS);
kode link grup 6 karakter dari alfabet tanpa karakter ambigu, dibuat acak kriptografis dan `UNIQUE`;
pengguna DB aplikasi tanpa hak DDL (migrasi memakai pengguna terpisah); pengguna DB read-only terpisah untuk n8n/laporan;
pembaruan dependensi otomatis (Renovate/Dependabot) dengan CI wajib hijau.

---

## 8. Konsekuensi, risiko, dan rencana keluar

### 8.1 Lebih mudah / lebih sulit
- **Lebih mudah:** satu bahasa & satu set tipe (lebih sedikit kesalahan integrasi agen, harga kartu = detail dari
  satu fungsi); logika uang berupa fungsi murni yang mudah dites & diaudit; tanpa Redis (komponen: app, worker,
  PostgreSQL); `domain`/`shared` dapat dipakai ulang di app native Fase 5.
- **Lebih sulit:** panel admin dibuat sendiri (T-036..T-039); ekosistem Node luas → dependensi baru wajib alasan di
  PR; PostgreSQL jadi titik tunggal data **dan** antrean → beban & backup dipantau; PWA iOS terbatas (instal manual,
  push terbatas, tanpa deferred deep link) → WhatsApp kanal notifikasi utama (H11).

### 8.2 Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kode AI salah di logika uang (pembulatan, race condition) | Kerugian uang, saldo ganda | Fungsi murni + tes properti, constraint DB, kunci idempotensi, tes integrasi konkurensi, review wajib Payments Engineer |
| Job cut-off terlewat/ganda | Harga salah, selisih tidak terkredit | Cron tiap menit + `job_run` dengan lease (ambil alih bila mati), status grup hanya maju, kunci ledger unik, guard waktu di API, alert, tes dengan `Clock` palsu |
| Webhook palsu / duplikat | Pesanan tertandai lunas tanpa bayar | Token + konfirmasi GET status ke Xendit, cek nominal, dedup dalam satu transaksi, rekonsiliasi harian |
| Akun WhatsApp diblokir (terutama bila gateway tidak resmi) | OTP mati → tidak ada yang bisa checkout | H2: pakai jalur resmi; cadangan OTP (SMS) dinilai di H2 |
| Gudang API lambat/mati | Katalog/stok salah | Snapshot lokal, batas usia data (P-10), perilaku H14, mode `local` sebagai fallback |
| Satu server (VPS) mati | Layanan berhenti | Backup teruji, skrip deploy ulang dari nol, target pemulihan ditulis di T-045 |
| Kebocoran PII lewat log/n8n | Pelanggaran UU PDP | Redact + tes, view tanpa PII untuk n8n, audit T-046 |
| Rahasia ter-commit oleh agen | Kunci bocor | gitleaks di CI + pre-commit, rotasi kunci terdokumentasi, auditor AI-code |

### 8.3 Rencana keluar (reversibilitas)

| Komponen | Jika perlu diganti | Biaya perkiraan |
|---|---|---|
| pg-boss | Pindah ke BullMQ + Redis atau Temporal; job sudah di balik antarmuka `JobQueue` sederhana dan bersifat idempoten | Rendah–sedang |
| Drizzle | Migrasi sudah berupa SQL; ganti ke Kysely/SQL mentah per repositori | Sedang |
| Fastify | Rute tipis memanggil use case; pindah ke framework Node lain tanpa menyentuh `domain` | Rendah |
| Xendit | Implementasi baru `PaymentGateway`; ledger & mesin status tetap | Sedang (kontrak bisnis lebih berat dari kode) |
| Gateway WhatsApp | Implementasi baru `WhatsAppGateway`; template disimpan di NEKAT | Rendah |
| Gudang | `INVENTORY_SOURCE=local` kapan saja | Rendah |
| Hosting VPS | Image Docker portabel ke penyedia/managed lain; DB dipindah via dump/replikasi | Sedang |
| PWA → native | `domain`/`shared` dipakai ulang; UI ditulis ulang di React Native | Tinggi, sudah direncanakan Fase 5 |
| Seluruh stack (mis. pindah ke Laravel) | Hanya masuk akal sebelum T-013 (skema & migrasi) selesai; setelahnya biaya naik tajam | Tinggi — karena itu H1 diputuskan sekarang |

ADR ini ditinjau ulang paling lambat di awal Fase 5 (native, SRE) atau bila pilot melampaui 1 zona.

---

## 9. Keputusan terbuka untuk manusia

ID H1–H14 sama dengan `project-specs/keputusan-terbuka.md` bagian "Dari ADR-0001" (H12–H14 ditambahkan di `main` 11 Nov).
Tidak ada butir di sini yang menghentikan task kode yang tergantung T-001: semuanya punya default teknis aman
atau berada di balik adapter/konfigurasi. Kolom "Harus diputuskan sebelum" menunjukkan kapan jawaban mulai mengikat.

| # | Keputusan | Pemilik | Rekomendasi agen | Harus diputuskan sebelum |
|---|---|---|---|---|
| H1 | Setujui stack inti TypeScript/Node + Fastify + PostgreSQL + React PWA (vs Laravel) | Joseph | **Setujui Opsi A** (bagian 2–3). Bila tim lebih nyaman Laravel, putuskan sekarang: biaya ganti naik tajam setelah T-013 | T-012 |
| H2 | Gateway WhatsApp untuk OTP & notifikasi (Meta Cloud API / BSP resmi / tidak resmi), SMS cadangan? | Joseph + Randy | **Jalur resmi** (Meta Cloud API langsung atau BSP resmi); **hindari gateway tidak resmi** (risiko blokir nomor). Verifikasi bisnis Meta butuh data badan usaha (#5) — mulai urus sekarang karena bisa makan waktu. SMS cadangan: opsional, nilai biayanya lewat Finance Tracker. Biaya per percakapan/pesan harus dicek di situs penyedia | T-016 ke production; dev memakai mode `log` |
| H3 | Penyedia hosting & PostgreSQL self-managed vs managed | Joseph (+ Finance) | Pilot: **1 VPS untuk app+worker per lingkungan + PostgreSQL terkelola** bila anggaran memungkinkan (backup/PITR otomatis mengurangi risiko terbesar); alternatif termurah: PostgreSQL di VPS yang sama + backup harian teruji. Kelas biaya keduanya perkiraan kecil–menengah per bulan, wajib dicek di harga penyedia | T-045 |
| H4 | Peran n8n: laporan/tepi saja, atau juga memicu job; lokasi hosting n8n | Joseph | **Tepi saja** (tabel 4.4): baca view read-only tanpa PII, picu aksi hanya lewat endpoint internal idempoten. Host n8n di server staging/ops terpisah dari DB production, atau n8n cloud bila tidak menyimpan PII | T-041 |
| H5 | Saldo bisa ditarik / refund ke metode asal atau tidak; tinjauan hukum (aturan uang elektronik BI) | Randy (+ hukum) | Fase 1: **saldo hanya untuk belanja, tidak bisa dicairkan; refund ke metode bayar asal tidak dibangun di Fase 1** (sama dengan §4.2) — sampai ada pendapat hukum. Sama dengan F-03; perlu selaras S&K §7.1 & §7.3 | Rilis pilot (T-046) |
| H6 | Aturan pembulatan rupiah (termasuk modal per satuan hasil bagi karton), tidak pernah di bawah modal | Efan | Bulatkan **ke atas** ke kelipatan yang dipilih Efan (sama dengan P-02); modal per satuan hasil bagi karton juga dibulatkan ke atas. Kode memakai pembulatan ke atas ke rupiah penuh sampai diputuskan | T-020 selesai review |
| H7 | Kepemilikan akun (GitHub org + paket GitHub untuk gerbang production, Xendit, hosting, domain, Meta Business, secret store), min. 2 admin | Joseph + Randy | Semua akun atas nama **badan usaha**, minimal 2 admin manusia dengan 2FA, kredensial di password manager tim; agen hanya mendapat token terbatas. Cek apakah paket GitHub saat ini mendukung *required reviewers* untuk environment repo privat | T-045 |
| H8 | Error tracking & log: SaaS vs self-host (masking PII) | Joseph | **SaaS dengan paket gratis/kecil** untuk pilot (Sentry atau setara) dengan scrubbing PII aktif + pino redact; self-host hanya bila H12 mewajibkan data di Indonesia. Batas paket gratis perlu dicek | T-045 |
| H9 | Login admin: wajib TOTP atau cukup OTP WA | Joseph | **Wajib TOTP** (aplikasi authenticator) untuk semua peran admin, OTP WA hanya untuk pembeli. Akun admin mengubah harga & saldo, jadi layak dilindungi faktor yang tidak bergantung pada WhatsApp | T-036 |
| H10 | Terima ADR-0001 (merge PR T-001) — membuka semua task kode | Joseph | Merge setelah H1 disetujui; butir lain boleh menyusul | Gelombang 2 |
| H11 | (Fase 5) Deferred deep link iOS: layanan pihak ketiga vs fallback kode manual | Randy + Joseph | Fase 1 PWA cukup: link `/g/:kode` membuka web + ajakan install (sesuai keputusan #3); struktur deferred deep link disiapkan di T-024 (base URL dari konfigurasi, kode grup dibawa lewat path). Untuk native: siapkan fallback kode grup yang bisa diketik + clipboard; nilai layanan pihak ketiga di Fase 5 | Fase 5 |
| H12 | **Baru.** Lokasi penyimpanan data (server di Indonesia atau luar negeri) dan isian "[lokasi]" di kebijakan privasi | Randy + Joseph (+ hukum) | Pilih **region Indonesia** bila tersedia di penyedia H3 dengan biaya wajar; bila memakai region luar negeri, minta tinjauan hukum atas UU PDP & aturan transfer data lintas negara, lalu sebutkan jujur di kebijakan privasi | T-045 / rilis pilot |
| H13 | **Baru.** Cara kurir lokal & drop point menerima data antar: akun kurir di aplikasi (akses terbatas per slot) vs daftar cetak/pesan WhatsApp dari admin | Randy (+ Operations) | Fase 1: **daftar antar per slot yang dibagikan admin** (cetak/PDF), tanpa akun kurir; berisi hanya data minimum (kebijakan privasi §4). Akun kurir dengan akses per slot dipertimbangkan setelah pilot | T-040 |
| H14 | **Baru.** Saat `GudangApiInventory` aktif dan Gudang tidak bisa dihubungi: tetap menjual dengan snapshot stok terakhir (risiko oversell) atau menahan "Ikut grup"/checkout | Joseph + Efan | **Tetap jual dengan snapshot** (reservasi NEKAT di atas snapshot) selama umurnya di bawah batas P-10; lewat batas → **ikut grup baru ditolak** ("Coba lagi sebentar", flow M-03); saat cut-off tanpa konfirmasi stok → grup DITAHAN. Oversell ditangani flow B-09 (alokasi parsial, refund ke saldo) | T-019 |

Butir dari dokumen lain yang bersinggungan dengan arsitektur, tetapi **tidak** diberi ID baru di sini:
F-01/P-04 (harga yang dibayar saat ikut grup — ledger mendukung kedua opsi), F-03 (= H5), F-11 (basis waktu bayar
terlambat — kedua cap waktu disimpan), P-02 (= H6), P-10 (batas usia modal dari Gudang), P-18 (batas COD sebelum/
sesudah saldo).
