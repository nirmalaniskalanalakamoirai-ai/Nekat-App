# ADR-0001: Tech stack NEKAT Fase 1

## Status

**Diterima** — 11 Nov 2026 (H1 & H10, `keputusan.md` §10): PR #1 (T-001) di-merge pemilik squad Build & QA.
Diusulkan 10 Nov 2026 oleh agen Software Architect. Task kode yang tergantung T-001 boleh dikerjakan.
Semua butir H1–H15 di bagian 9 sudah **DIPUTUSKAN**; revisi sesudahnya hanya menyelaraskan ADR dengan `keputusan.md`.

Revisi: **v0.4** (11 Nov 2026, sesi QA) — penyelarasan nama kolom `akun_id`, label default sementara H14 & F-11,
aturan webhook/OTP/IDOR/sesi, baris ongkir & diskon di §5.3. **v0.5** (putaran 2): peta kunci batal seluruh pesanan /
batalkan grup, izin aksi `harga.ubah` di §7, istilah `waktu_bayar` (= `paid_at` dari gateway). v0.3 = revisi setelah Evidence Collector & Code Reviewer.
**v0.6** (19 Nov 2026, T-048) — penyelarasan dengan `keputusan.md`: tanpa pembulatan (H6, §5.1 & §9), Gudang tidak bisa
dihubungi → tahan checkout (H14, §4.1 & §9), pencairan saldo diputuskan boleh setelah pendapat hukum (H5/G-06d/K-34,
§4.2 & §9), data di region Indonesia (H12, §3 & §7 & §9), belum ada server staging (K-19, §3 & §3.4), tagihan grup hanya
QRIS/VA dulu, metode lain tetap `keputusan.md` §9 (K-36, §1.1 & §4.2); cek modal memakai harga tanpa PPN (K-28, §5.1);
H8 error tracking SaaS vs H12 dirujuk ke K-43 (§9). Default sementara agen yang digantikan ditandai "tidak berlaku".
**v0.7** (28 Nov 2026, T-049) — status Diterima; H1–H4, H7, H8, H11, H13, H15 ditandai DIPUTUSKAN (§3, §4.3, §4.4,
§9); harga final = harga di tagihan, bukan dikunci saat cut-off (P-19/K-22/K-15, §1.1, §3.3, §5.2, §5.3, §8.2);
tagihan gabungan host (K-17/K-37) & ongkir satu tagihan (K-25) di §4.2; tidak bisa batal setelah bayar (K-40, §4.2);
stok habis tetap tampil (K-20) dan COD bukan untuk grup (K-31) di §5.3; istilah level **Mitra Grosir** (K-08/K-14/K-38);
log SaaS dengan PII disamarkan boleh di luar negeri (K-43, §3, §7). §3.2 tidak diubah di revisi ini.

**Rujukan silang:** ID flow (A-xx, B-xx, M-xx, P-xx, R-xx, §6) merujuk `docs/flow/group-order.md` (T-002); aturan
harga merujuk `docs/spec/engine-harga.md` (T-003); keduanya sudah di `main`. Bila dokumen itu masih memuat
"DEFAULT SEMENTARA" yang sudah diputuskan, yang berlaku adalah `keputusan.md`.

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
- **Uang nyata sejak hari pertama:** pembayaran Xendit (QRIS, VA, e-wallet; tagihan grup QRIS & VA dulu, e-wallet menyusul, K-36), saldo pengguna (= loyalty point, K-13), refund & selisih ke saldo (F-03),
  COD bersyarat (maks. Rp500.000 per pesanan) **hanya untuk pesanan retail/individu, tidak untuk grup** (K-31).
- **Integrasi:** Gudang (`InventorySource`), Xendit, gateway WhatsApp (OTP & notifikasi), n8n (otomasi tepi).
- **Job terjadwal penting bisnis:** batas pelunasan tagihan 60 menit & penerbitan tagihan otomatis (K-07, K-12, K-39),
  cut-off per slot kirim (cek stok & pagar modal; harga sudah final sejak tagihan terbit, P-19/K-15), daftar picking, daftar antar per slot,
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

## 3. Keputusan (diterima, H1/H10)

| Area | Pilihan | Catatan |
|---|---|---|
| Bahasa | **TypeScript** mode `strict`, ESM | `noUncheckedIndexedAccess`, larang `any` lewat ESLint |
| Runtime | **Node.js 22** sekarang, naik ke Active LTS di T-045 sebelum pilot (H15, diputuskan 12 Nov); dipin di `.nvmrc` & `engines` | Sama di dev, CI, staging, production |
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
| Log & error tracking | **pino** (JSON) dengan `redact` untuk PII & rahasia; error tracking **SaaS** dengan penyamaran PII (H8) | SaaS di luar negeri boleh selama penyamaran aktif (K-43); lihat bagian 7 |
| Unit & integrasi | **Vitest**; tes integrasi memakai PostgreSQL nyata (service container CI) | Tidak memakai mock DB untuk logika uang |
| E2E | **Playwright** (Chromium + WebKit, viewport ponsel) | Xendit sandbox / adapter palsu, WhatsApp mode `log` |
| Mock vendor | **MSW** atau server mock Fastify kecil | Mock Gudang (T-019), Xendit, WhatsApp |
| Lint & format | ESLint (typescript-eslint) + Prettier | Aturan batas modul (`eslint-plugin-boundaries` atau setara) |
| CI | **GitHub Actions** | Rincian di 3.4 |
| Hosting | Container Docker; pilot di 1 VPS + PostgreSQL terkelola (H3, diputuskan 12 Nov) di **region Indonesia** (H12, diputuskan 19 Nov); akun atas nama badan usaha, min. 2 admin dengan 2FA (H7) | Staging & production terpisah total bila staging dibuat; saat ini belum ada server staging (K-19, §3.4) |

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
| Batas pelunasan tagihan & penerbitan otomatis | Cron tiap menit: tagihan lewat 60 menit sejak terbit → akun dikeluarkan, grup batal bila lunas < 3 (K-07, K-12); host tidak menerbitkan → peringatan 5 menit, anggota belum "Siap" dikeluarkan 60 menit sebelum grup tutup, lalu tagihan terbit otomatis atau grup batal (K-39, K-11) | `ttl:{invoice_id}`; kunci K-39 per grup ditetapkan T-010/T-022 |
| Cut-off slot (prosedur `docs/flow/group-order.md` §6): konfirmasi stok, cek ulang pagar modal, alokasi. **Harga tidak dikunci di sini**: harga & modal sudah final di tagihan (P-19, K-15, K-22) | **Satu cron tiap menit** memproses setiap slot dengan `cut_off ≤ sekarang` yang `job_run`-nya belum `SELESAI` (sekaligus menggantikan watchdog M-01) | `cutoff:{slot_id}`; per grup status lewat update bersyarat `DIBUKA`/`BELUM_AKTIF`/`AKTIF` → `CUT_OFF` → `HARGA_TERKUNCI` / `GAGAL_LANJUT_SATUAN` / `GAGAL` / `DITAHAN` → `DIPROSES` …; **sejak `CUT_OFF` status hanya maju** dan menjadi checkpoint bila job diulang (M-02) |
| Daftar antar per slot | Setelah job cut-off slot selesai | `antar:{slot_id}` |
| Laporan harian owner | Cron WIB (jam ditentukan T-010) | `laporan:{tanggal_WIB}` |
| Evaluasi KPI COD mingguan | Cron WIB mingguan (hari/jam ditentukan T-010) | `kpi-cod:{tahun-minggu_ISO_WIB}` per pengguna |
| Kirim WhatsApp | Outbox | `wa:{template}:{ref_jenis}:{ref_id}:{akun_id}[:{periode_WIB}]` (periode untuk pesan berulang, mis. pengingat) |
| Permintaan picking (lokal atau ke Gudang) | Outbox **per grup**, ditulis dalam transaksi cut-off (flow §6) **setelah stok dialokasikan & pagar modal lolos**: grup `HARGA_TERKUNCI` dan `GAGAL_LANJUT_SATUAN`. Tidak dikirim saat pesanan lunas | `picking:{grup_id}` |
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
  di staging (setelah staging ada, K-19).
- **Staging**: **untuk saat ini tanpa server staging** (K-19, diputuskan 19 Nov); preview dibuat di Claude dulu,
  penyedia server menyusul. Rancangan saat staging dibuat: deploy otomatis dari `main` (T-045), data uji tanpa harga
  asli, Xendit mode test, WhatsApp mode `sandbox`, domain sementara (#6).
- **Production**: deploy manual dari tag rilis, hanya setelah Reality Checker lulus dan persetujuan pemilik squad
  (`CLAUDE.md` aturan 3). Gerbang ini memakai *environment protection* GitHub; ketersediaannya untuk repo privat
  bergantung pada paket GitHub (akun atas nama badan usaha sudah diputuskan, H7; dukungan paket dicek di T-045).
- **Backup**: dump PostgreSQL harian terenkripsi ke object storage di lokasi berbeda (tetap region Indonesia, H12) + uji pemulihan berkala
  (minimal sebulan sekali, dicatat). Bila memakai PostgreSQL terkelola, aktifkan point-in-time recovery bila tersedia.
- **Observabilitas minimum**: endpoint `/health` & `/ready`, pemantau uptime eksternal, log JSON terpusat,
  error tracking SaaS dengan penyamaran PII (H8, K-43), metrik antrean (job tertunda/gagal).

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
  permintaan picking setelah cut-off lolos. *Masukan untuk T-009:* kontrak `InventorySource` memuat `konfirmasiStok`
  dan permintaan picking per grup; reservasi tetap di modul `inventori` NEKAT untuk kedua implementasi.
- **`LocalInventory`** (default): data dari tabel NEKAT sendiri, dikelola lewat panel admin / import CSV.
  `kirimPermintaanPicking` menghasilkan daftar picking internal (PDF/tampilan admin).
- **`GudangApiInventory`**: memanggil API Gudang-Repo. Berperan sebagai **anti-corruption layer**: memetakan SKU,
  satuan, dan format angka Gudang ke model NEKAT; data Gudang tidak pernah dipakai mentah oleh modul lain.
- **Toggle konfigurasi**: `INVENTORY_SOURCE=local|gudang` (dibaca saat start, divalidasi). Tidak dipilih per request.
- **Sinkron**: tarikan berkala (job) + tarikan on-demand saat checkout untuk stok; hasil disimpan sebagai *snapshot*
  lokal dengan kolom `disinkron_pada`. Katalog dan engine harga **selalu** membaca snapshot lokal, sehingga
  gangguan Gudang tidak menjatuhkan aplikasi. Batas usia data mengikuti P-10 (modal: 15 menit). Saat Gudang tidak bisa
  dihubungi: **tahan checkout** (H14, diputuskan 12 Nov) — ikut grup/checkout baru ditolak ("Coba lagi sebentar", flow
  M-03) sampai stok bisa dikonfirmasi lagi; snapshot lama tidak dipakai untuk menerima pesanan (katalog tetap tampil
  dari snapshot); saat cut-off tanpa konfirmasi stok → grup `DITAHAN`. (Default sementara "tetap jual dengan snapshot"
  tidak berlaku.)
- **Harga modal masuk dari Gudang lalu divalidasi**: modal ≤ 0 atau kosong → produk otomatis tidak tayang
  (bukan harga nol).
- **Arah balik**: **per grup, setelah cut-off lolos & stok dialokasikan** (status `HARGA_TERKUNCI` atau
  `GAGAL_LANJUT_SATUAN`) → baris outbox `picking:{grup_id}` berisi daftar (peserta,
  qty teralokasi, cara kirim) → worker mengirim dengan kunci idempotensi, timeout pendek, retry + backoff, dan
  status terlihat di panel admin. Konfirmasi Gudang memindahkan grup ke `DIPROSES`. Grup `DITAHAN` tidak dikirim.
- Mock server Gudang untuk tes disediakan di T-019; tes kontrak yang sama dijalankan terhadap kedua implementasi.

### 4.2 Xendit (keputusan #2 dan #9)

- Adapter `PaymentGateway` dengan implementasi `XenditGateway` dan `FakeGateway` (tes/E2E). Pemakaian SDK resmi
  atau HTTP langsung diputuskan di T-029; keduanya berada di balik port yang sama.
- Metode: **tagihan grup hanya QRIS dan Virtual Account dulu** (K-36); e-wallet menyusul bila kerja sama memungkinkan,
  sebagai task baru di balik port yang sama. Metode untuk pesanan individu/retail mengikuti `keputusan.md` §9 (QRIS, VA,
  e-wallet) kecuali diputuskan lain. Mode test di lingkungan non-production (staging setelah ada, K-19), mode live hanya di production; kunci dipilih
  dari environment variable, tidak pernah dari kode atau DB.
- **Membuat pembayaran**: `external_id` = ID pembayaran NEKAT (Fase 1: **satu pembayaran per tagihan/invoice**, sehingga
  kunci idempotensi Xendit setara dengan ID tagihan seperti di flow M-06); header idempotensi dikirim bila didukung endpoint
  terkait; nominal dalam rupiah integer yang dihitung server.
- **Isi & bentuk tagihan grup**: tagihan terbit lewat "Terbitkan tagihan" host atau otomatis (K-22, K-39), sudah memuat
  harga final + biaya admin (total saja, K-26) + **ongkir dalam tagihan yang sama** (K-25; bayar sendiri → ongkir dibagi
  rata, sisa pembagian menunggu K-44). Grup wajib bayar lewat aplikasi (F-05); COD tidak tersedia untuk grup (K-31).
  Bayar sendiri → satu tagihan per akun. **Host bayar semua** → satu **tagihan gabungan** berisi total semua anggota,
  QR ke host (K-17); batas waktunya **ikut tagihan anggota paling awal**, tidak mulai ulang 60 menit (K-37); tagihan
  anggota yang digabung tidak bisa dibayar lagi (status `DIGANTI` di skema).
- **Batas bayar**: 60 menit sejak tagihan terbit (F-26, K-07); kedaluwarsa invoice Xendit diset sama dengan batas itu.
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
- **Basis waktu bayar terlambat**: `waktu_bayar` = `paid_at` dari Xendit (F-11, diputuskan 12 Nov); waktu webhook
  diterima tetap disimpan.
- **Tidak bisa batal setelah bayar** (F-07, K-40 menggantikan K-30): tidak ada endpoint batal mandiri untuk tagihan
  LUNAS. Dana kembali ke saldo hanya bila grup batal (K-11) atau stok habis setelah tagihan terbit (baris itu saja, K-29);
  tagihan LUNAS tetap `LUNAS` sebagai bukti bayar, pengembalian lewat ledger REFUND (K-45).
- **Refund & selisih → saldo**: sesuai keputusan #9, selisih harga dan refund dikreditkan ke ledger saldo.
  Refund ke metode bayar asal **tidak dibangun**: semua refund & selisih masuk saldo (= loyalty point, F-03, K-13).
  **Pencairan saldo** ke rekening bank, virtual account, atau e-wallet **diputuskan boleh** (G-06d) dengan aturan K-34
  (OTP ulang, tujuan atas nama pemilik akun, jeda, saldo baru ditahan, limit harian; angka diisi pemilik), tetapi
  fiturnya baru dibuka **setelah ada pendapat hukum** (H5, aturan uang elektronik BI). Dibangun sebagai task terpisah.
- **Rekonsiliasi harian**: bandingkan transaksi Xendit dengan pembayaran & ledger NEKAT; selisih dilaporkan ke owner.
- Biaya transaksi per metode tidak dicantumkan di sini; Finance Tracker mengambilnya dari kontrak/dashboard Xendit.

### 4.3 Gateway WhatsApp

- Port `WhatsAppGateway { kirimOtp, kirimTemplate }` dengan implementasi:
  - `LogGateway` (dev & tes): pesan ditulis ke log dan tabel `pesan_keluar`; OTP terlihat di halaman dev **hanya**
    bila `WA_MODE=log` (bukan bergantung `NODE_ENV`); penjaga start di bawah menjamin mode ini mustahil di production.
  - `SandboxGateway` (non-production; staging setelah ada, K-19): ke nomor uji yang di-whitelist saja.
  - Implementasi produksi: **jalur resmi Meta** (Cloud API langsung atau BSP resmi; H2, diputuskan 12 Nov). Pilihan
    penyedia di T-016; pengiriman nomor HP ke Meta/BSP di luar negeri menunggu N-03.
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

Peran (H4, diputuskan 12 Nov): **otomasi tepi tanpa PII, bukan sumber kebenaran**; host n8n terpisah dari DB production.

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
  persen yang menolak hasil pecahan, kecuali potongan diskon yang bagian pecahannya dibuang, K-28).
- Persentase (margin, diskon) disimpan sebagai integer **basis poin** atau pecahan rasional, bukan float. Nilainya
  KOSONG sampai diisi pemilik (`keputusan.md` #6).
- **Tanpa pembulatan** (H6/P-02, diputuskan 12 Nov; rincian K-01 & K-28): helper uang tidak membulatkan harga atau modal.
  Harga pecahan dari margin % → produk tidak tayang + antrean "perlu ditinjau"; modal pecahan → SKU tidak tayang +
  "perlu ditinjau" (K-01); potongan diskon pecahan dibuang (K-28). Harga jual tetap tidak pernah di bawah modal (dibandingkan dengan harga tanpa PPN, K-28).
  (Default sementara "bulatkan ke atas" tidak berlaku.)
- Format tampilan (contoh format: `Rp{nominal}` dengan pemisah ribuan titik) hanya di lapisan UI dengan `Intl.NumberFormat('id-ID')`.

### 5.2 Ledger saldo (append-only)

- Tabel `ledger_saldo`: `id`, `akun_id`, `jumlah` (bigint bertanda: + kredit, − debit), `jenis`
  (selisih_harga, refund, pakai_checkout, koreksi_admin, pencairan — fitur dibuka setelah H5, ...), `referensi_jenis`, `referensi_id`,
  `kunci_idempotensi UNIQUE`, `dibuat_oleh`, `dibuat_pada`.
- **Tidak ada UPDATE/DELETE**: dicabut hak aksesnya untuk peran DB aplikasi dan dijaga trigger. Koreksi = baris
  pembalik baru dengan alasan.
- Saldo berjalan disimpan di `akun_saldo` (dikunci `FOR UPDATE` saat debit) dengan `CHECK (saldo >= 0)`; tes
  integrasi memastikan `akun_saldo.saldo = SUM(ledger_saldo.jumlah)` dan job harian memverifikasinya.
- Kredit dari job cut-off (refund baris stok habis K-29, kredit yang dibatasi pagar modal P-23): satu baris per peserta
  per grup, kunci `selisih:{grup_id}:{peserta_id}`, sehingga job cut-off yang terulang tidak menggandakan saldo.
  Cut-off **tidak** menaikkan harga tagihan (P-19); apakah harga bisa turun (selisih ke saldo) setelah tagihan terbit belum dinyatakan eksplisit; skema mengizinkan `harga_final ≤ harga_dibayar`.
- Bentuk akuntansi lengkap (double-entry dengan akun kas/kewajiban) tidak dibuat di Fase 1; skema disiapkan agar bisa
  dipetakan kemudian bila dibutuhkan Finance Tracker.

### 5.3 Aturan harga di kode (`CLAUDE.md`)

| Aturan | Penegakan |
|---|---|
| Harga = modal + margin per level; tidak ada harga di bawah modal | Fungsi murni `hitungHarga` di `packages/domain`; validasi saat simpan di admin/CSV; margin 0 ditolak (P-16), harga dasar cukup > modal tanpa batas 5% (K-41): `CHECK (harga > modal)` pada snapshot harga |
| Pagar: harga grup individu ≥ **Mitra Grosir** ≥ Franchise | Level di kode: `SATUAN`, `MITRA_GROSIR`, `FRANCHISE`. Tingkat "grosir" = Mitra Grosir (P-05, K-08); harga grup individu **=** harga Mitra Grosir (K-14), jadi pagar terpenuhi dengan sama. Pagar ketat saja (P-22) + pagar antar kemasan (P-14); dilanggar → **tahan kedua harga** & lapor admin (K-42). Validator domain di setiap jalur tulis (panel, CSV, sinkron Gudang); tes properti |
| Diskon + gratis ongkir tidak membuat harga akhir < modal | Harga setelah promo & subsidi ongkir ≥ modal × (1 + batas bawah dari konfigurasi, 5%) (P-07, K-16); satu diskon atas total, tidak menumpuk (P-15, K-21); minimal gratis ongkir dihitung sesudah diskon (P-13); gagal pagar → "tidak memenuhi syarat" + alasan & jalan keluar, pesanan tidak langsung batal (P-27) |
| Ongkir (`keputusan.md` #4) | Rumus #4 tetap; angka tarif dari adapter aplikasi eksternal (#4, K-05), engine harga hanya menerima ongkir jadi (P-12); **tidak ada konstanta tarif di kode**; tarif tidak tersedia → opsi "kirim ke rumah" tidak tersedia (ambil di drop point tetap bisa). Aturan gratis ongkir & diskon dari konfigurasi admin |
| Harga & potongan dihitung server | Request klien tidak pernah membawa harga/diskon yang dipercaya; server menghitung ulang dari data tersimpan |
| Harga final grup = harga di **tagihan** (P-19, K-22, K-15). Teks `CLAUDE.md` "dikunci saat cut-off" belum diselaraskan (dilaporkan T-049) | Harga & modal di-snapshot saat tagihan terbit, dalam transaksi penerbitan; tagihan tidak berubah dan pembeli **tidak pernah ditagih tambahan**. Job cut-off: konfirmasi stok, cek ulang pagar modal terkini → `DITAHAN` bila gagal (P-09, P-26), refund baris stok habis ke saldo (K-29), status grup + ledger + outbox dalam satu transaksi |
| Harga kartu = harga detail; promo terpisah | Satu endpoint/fungsi harga dipakai keduanya; PWA tidak menghitung harga; respons memisahkan `harga_aktif` dan `promo`. Label kartu & detail "Harga Belanja Bareng"; kata "Mitra" & info drop point hanya di checkout (K-38, P-28) |
| Produk tanpa harga tidak tayang | Query katalog hanya mengambil produk dengan harga valid (selama PPN belum diisi: hanya produk bebas PPN, K-46). **Stok habis tetap tampil** dengan label "Stok habis, segera distok", tombol beli nonaktif; API keranjang/grup menolak SKU stok habis (K-20). Tes E2E memastikan |
| Halaman grup dari link `/g/:kode` | Halaman grup **tetap tampil** walau stok habis, tagihan sudah terbit, atau lewat cut-off: bila `pendaftaran_ditutup = true` (stok habis), tagihan terbit (K-22: tidak bisa tambah anggota/barang), **atau** status ≥ `CUT_OFF` → tombol "Ikut grup" nonaktif / diarahkan ke slot berikutnya (flow B-02) |
| Level Mitra Grosir wajib ada di engine Fase 1 | `hitungHarga` menerima `SATUAN` dan `MITRA_GROSIR` sejak Fase 1 (`FRANCHISE` disiapkan di skema & pagar, tidak dipakai). Grup ≥ Rp100.000 (basis K-23) → setiap barang harga Mitra Grosir (K-09, K-14); < Rp100.000 → harga satuan (K-18); satuan jual tanpa harga Mitra Grosir → harga satuan + tanda di panel (K-27). Drop point = pesanan tingkat Mitra Grosir (`keputusan.md` #4) |
| COD hanya untuk pengguna lolos KPI 3 minggu berturut-turut, maks. Rp500.000 per pesanan, **hanya pesanan retail/individu** (K-31) | Konstanta yang sudah DIPUTUSKAN (3 minggu berturut-turut, Rp500.000) di satu tempat di `packages/domain`, dites; ambang KPI dari **konfigurasi admin** dengan nilai awal = usulan `keputusan.md` #2 (final, §14 butir 2); opsi COD **tidak pernah** dikirim untuk tagihan grup, dan untuk pesanan individu tidak dikirim bila tidak layak atau total sebelum saldo melebihi batas (P-18); admin bisa mencabut COD manual dengan **alasan wajib** tercatat di `log_admin` |

Setiap baris item pesanan menyimpan **snapshot** yang diambil saat tagihan terbit (K-15): modal, harga per satuan, tier, dan versi aturan,
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
  string nomor HP tidak muncul di log). Error tracking/log SaaS di luar negeri **boleh** selama penyamaran ini aktif
  (H8, K-43).
- Halaman grup hanya mengembalikan **jumlah** peserta dan nama panggilan tersamar ("Bu S***, RW 05"); API tidak
  pernah mengirim nomor HP/alamat peserta lain. Anggota tidak melihat isi barang anggota lain; host melihat rincian
  (nama samaran, tanpa alamat/HP) hanya saat memilih bayar semua (K-32). Ini dites di API test (T-044).
- Data untuk kurir/drop point dibatasi: nama, nomor HP, alamat, isi pesanan untuk slot yang dia antar, lewat daftar
  antar per slot yang dibagikan admin, tanpa akun kurir di Fase 1 (H13, diputuskan 18 Nov).
- Enkripsi saat transit (TLS di semua endpoint, termasuk koneksi DB lintas jaringan) dan enkripsi disk/at-rest dari
  penyedia. Enkripsi per kolom untuk nomor HP **tidak** diusulkan di Fase 1 (menyulitkan keunikan & pencarian);
  dapat ditambah kemudian dengan *blind index*.
- Retensi data mengikuti kebijakan privasi; fitur hapus/anonimkan akun disiapkan di model data (T-004).
- Lokasi penyimpanan data: **region Indonesia** (H12, diputuskan 19 Nov) untuk DB, backup, data transaksi, dan data
  pribadi; pengecualian hanya log & error tracking SaaS dengan PII disamarkan (K-43). Isian "[lokasi]" di kebijakan
  privasi diisi sesuai penyedia yang dipilih.
- Data KTP/verifikasi usia **tidak** ada di Fase 1 (rokok & bir di luar Fase 1, `keputusan.md` #7).

**Akses & peran admin (RBAC).**

Fase 1 hanya dua peran: `owner` (semua, termasuk kelola admin & laporan keuangan) dan `admin` (produk, harga,
stok, grup, pesanan, ongkir, COD; tidak bisa kelola admin). Skema memakai tabel izin per aksi sehingga nanti bisa
dipecah (mis. `admin_harga`, `admin_operasional`, `cs`) tanpa migrasi besar. Nama izin aksi memakai pola
`<domain>.<aksi>`; contoh yang sudah dirujuk dokumen lain: `harga.ubah` (ubah modal/margin/tier & aturan promo,
`docs/spec/engine-harga.md` §8). Fase 1: `owner` dan `admin` sama-sama punya `harga.ubah`; daftar lengkap di T-004.

- Setiap aksi admin yang mengubah data (harga, stok, COD, koreksi saldo, status pesanan) ditulis ke `log_admin`
  (append-only: siapa, kapan, sebelum/sesudah, alasan).
- Login admin: H9 — **DIPUTUSKAN 12 Nov (`keputusan.md` §11): tidak hanya OTP WA; admin wajib faktor kedua TOTP** (aplikasi authenticator) untuk semua peran admin, berlaku sebelum panel admin ke production. Sesi admin
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
  push terbatas, tanpa deferred deep link; deferred deep link iOS ditunda ke Fase 5, H11) → WhatsApp kanal notifikasi utama.

### 8.2 Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kode AI salah di logika uang (pembulatan, race condition) | Kerugian uang, saldo ganda | Fungsi murni + tes properti, constraint DB, kunci idempotensi, tes integrasi konkurensi, review wajib Payments Engineer |
| Job cut-off / batas pelunasan terlewat atau ganda | Pagar modal & stok tidak dicek ulang, refund tidak terkredit, akun tak lunas tidak dikeluarkan | Cron tiap menit + `job_run` dengan lease (ambil alih bila mati), status grup hanya maju, kunci ledger unik, guard waktu di API, alert, tes dengan `Clock` palsu |
| Webhook palsu / duplikat | Pesanan tertandai lunas tanpa bayar | Token + konfirmasi GET status ke Xendit, cek nominal, dedup dalam satu transaksi, rekonsiliasi harian |
| Akun WhatsApp diblokir (terutama bila gateway tidak resmi) | OTP mati → tidak ada yang bisa checkout | Jalur resmi Meta (H2, diputuskan); cadangan OTP lewat SMS belum diputuskan (opsional, biaya dinilai Finance Tracker) |
| Gudang API lambat/mati | Katalog/stok salah | Snapshot lokal, batas usia data (P-10), perilaku H14 (tahan checkout), mode `local` sebagai fallback |
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
| Seluruh stack (mis. pindah ke Laravel) | Hanya masuk akal sebelum T-013 (skema & migrasi) selesai; setelahnya biaya naik tajam | Tinggi — karena itu H1 diputuskan lebih awal (11 Nov) |

ADR ini ditinjau ulang paling lambat di awal Fase 5 (native, SRE) atau bila pilot melampaui 1 zona.

---

## 9. Keputusan manusia (semua DIPUTUSKAN)

ID H1–H15 sama dengan `project-specs/keputusan-terbuka.md` bagian "Dari ADR-0001"; sumber resmi `keputusan.md` §10–§15.
Kolom "Rekomendasi agen" dipertahankan sebagai riwayat; yang mengikat adalah teks **DIPUTUSKAN**.
Kolom "Harus diputuskan sebelum" kini berarti task tempat keputusan itu mulai diterapkan.

| # | Keputusan | Pemilik | Status / rekomendasi agen | Diterapkan di |
|---|---|---|---|---|
| H1 | Setujui stack inti TypeScript/Node + Fastify + PostgreSQL + React PWA (vs Laravel) | Joseph | **DIPUTUSKAN 11 Nov (`keputusan.md` §10): Opsi A**, Laravel tidak dipakai (bagian 2–3) | T-012 |
| H2 | Gateway WhatsApp untuk OTP & notifikasi (Meta Cloud API / BSP resmi / tidak resmi), SMS cadangan? | Joseph + Randy | **DIPUTUSKAN 12 Nov (§11): jalur resmi Meta (Cloud API/BSP resmi).** Verifikasi bisnis Meta butuh data badan usaha (#5). SMS cadangan tidak diputuskan (opsional, biaya lewat Finance Tracker). Data ke Meta/BSP luar negeri → N-03 | T-016 ke production; dev memakai mode `log` |
| H3 | Penyedia hosting & PostgreSQL self-managed vs managed | Joseph (+ Finance) | **DIPUTUSKAN 12 Nov (§11): 1 VPS + PostgreSQL terkelola**, region Indonesia (H12). Penyedia belum dipilih; staging belum ada (K-19) | T-045 |
| H4 | Peran n8n: laporan/tepi saja, atau juga memicu job; lokasi hosting n8n | Joseph | **DIPUTUSKAN 12 Nov (§11): n8n hanya di tepi (tanpa PII), host terpisah dari DB production** (tabel 4.4) | T-041 |
| H5 | Saldo bisa ditarik / refund ke metode asal atau tidak; tinjauan hukum (aturan uang elektronik BI) | Randy (+ hukum) | **DIPUTUSKAN 18 Nov (`keputusan.md` §14): minta pendapat hukum (aturan uang elektronik BI) sebelum fitur pencairan dibuka.** Saldo (= loyalty point) **bisa dicairkan** ke rekening bank, VA, atau e-wallet (G-06d, §12) dengan aturan K-34; semua refund & selisih masuk saldo, refund ke metode asal tidak dibangun (F-03). Lihat §4.2; perlu selaras S&K §7.1 & §7.3. (Usulan awal agen "saldo tidak bisa dicairkan" tidak berlaku.) | Rilis pilot (T-046) |
| H6 | Aturan pembulatan rupiah (termasuk modal per satuan hasil bagi karton), tidak pernah di bawah modal | Efan | **DIPUTUSKAN 12 Nov (`keputusan.md` §11): tidak ada pembulatan rupiah** (= P-02). Rincian: modal diinput per satuan jual, modal pecahan → SKU tidak tayang (K-01); harga pecahan dari margin % → tidak tayang + "perlu ditinjau", potongan diskon pecahan dibuang (K-28). Lihat §5.1. (Usulan awal agen "bulatkan ke atas" tidak berlaku.) | T-020 selesai review |
| H7 | Kepemilikan akun (GitHub org + paket GitHub untuk gerbang production, Xendit, hosting, domain, Meta Business, secret store), min. 2 admin | Joseph + Randy | **DIPUTUSKAN 12 Nov (§11): semua akun atas nama badan usaha, min. 2 admin dengan 2FA.** Rekomendasi teknis tetap: kredensial di password manager tim, agen hanya token terbatas; cek dukungan *required reviewers* paket GitHub di T-045 | T-045 |
| H8 | Error tracking & log: SaaS vs self-host (masking PII) | Joseph | **DIPUTUSKAN 12 Nov (§11): SaaS dengan penyamaran data pribadi**; SaaS luar negeri boleh selama penyamaran aktif, data transaksi & PII tetap di region Indonesia (**K-43**, 24 Nov). Batas paket gratis perlu dicek | T-045 |
| H9 | Login admin: wajib TOTP atau cukup OTP WA | Joseph | **DIPUTUSKAN 12 Nov malam (`keputusan.md` §11, menggantikan jawaban awal "cukup OTP WA" setelah temuan K-04): admin wajib faktor kedua TOTP** (aplikasi authenticator) selain OTP WA, untuk semua peran admin; OTP WA saja hanya untuk pembeli. Akun admin mengubah harga & saldo, jadi dilindungi faktor yang tidak bergantung pada WhatsApp | T-036 |
| H10 | Terima ADR-0001 (merge PR T-001) — membuka semua task kode | Joseph | **DIPUTUSKAN 11 Nov (§10): diterima, PR #1 di-merge** | Gelombang 2 |
| H11 | (Fase 5) Deferred deep link iOS: layanan pihak ketiga vs fallback kode manual | Randy + Joseph | **DIPUTUSKAN 18 Nov (§14): ditunda ke Fase 5**, sesuai rekomendasi. Fase 1 PWA cukup: link `/g/:kode` membuka web + ajakan install (sesuai keputusan #3); struktur deferred deep link disiapkan di T-024 (base URL dari konfigurasi, kode grup dibawa lewat path). Untuk native: siapkan fallback kode grup yang bisa diketik + clipboard; nilai layanan pihak ketiga di Fase 5 | Fase 5 |
| H12 | Lokasi penyimpanan data (server di Indonesia atau luar negeri) dan isian "[lokasi]" di kebijakan privasi | Randy + Joseph (+ hukum) | **DIPUTUSKAN 19 Nov (Joseph, issue #7): region Indonesia.** Penyedia H3 dipilih yang punya region Indonesia; isian "[lokasi]" kebijakan privasi diisi sesuai penyedia (§7) | T-045 / rilis pilot |
| H13 | Cara kurir lokal & drop point menerima data antar: akun kurir di aplikasi (akses terbatas per slot) vs daftar cetak/pesan WhatsApp dari admin | Randy (+ Operations) | **DIPUTUSKAN 18 Nov (§14): Fase 1 daftar antar per slot dibagikan admin, tanpa akun kurir**; berisi hanya data minimum (kebijakan privasi §4). Akun kurir nanti lewat integrasi pihak ketiga | T-040 |
| H14 | Saat `GudangApiInventory` aktif dan Gudang tidak bisa dihubungi: tetap menjual dengan snapshot stok terakhir (risiko oversell) atau menahan "Ikut grup"/checkout | Joseph + Efan | **DIPUTUSKAN 12 Nov (`keputusan.md` §11): tahan checkout.** Gudang tidak bisa dihubungi → ikut grup/checkout baru ditolak ("Coba lagi sebentar", flow M-03); saat cut-off tanpa konfirmasi stok → grup DITAHAN (§4.1). (Usulan awal agen "tetap jual dengan snapshot" tidak berlaku.) | T-019 |
| H15 | Versi Node: Active LTS terbaru vs Node 22 yang dipin scaffold T-012 | Joseph | **DIPUTUSKAN 12 Nov (§11): Node 22 sekarang, naik ke Active LTS di T-045 sebelum pilot** (§3) | T-045 |

Butir dari dokumen lain yang bersinggungan dengan arsitektur, tanpa ID baru di sini (semua sudah diputuskan):
F-01/P-04 (masuk grup tanpa bayar, tagihan dilunasi di awal lewat VA/QRIS), F-03 (= H5, semua refund ke saldo),
F-11 (`paid_at` Xendit, kedua cap waktu disimpan), P-02 (= H6), P-10 (usia modal maks. 15 menit), P-18 (batas COD
dibandingkan dengan total sebelum saldo). Masih terbuka dan menyentuh ADR: **K-44** (sisa pembagian ongkir, Randy),
**N-03** (data ke Meta/BSP luar negeri, Joseph).
