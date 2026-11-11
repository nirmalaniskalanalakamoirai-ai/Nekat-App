# Backlog Fase 1 — MVP pilot individu

Sumber: `fase-1-mvp.md`, `keputusan.md` (wajib diikuti), `keputusan-terbuka.md`, `jadwal-otomatis.md`.
Disusun oleh Project Manager Senior, 10 Nov 2026. Satu task = satu branch = satu PR.

## Legenda status

| Status | Arti |
|---|---|
| `todo` | Siap dikerjakan bila semua task di kolom Tergantung sudah `done` |
| `in-progress` | Sedang dikerjakan agen |
| `review` | PR terbuka, menunggu Evidence Collector / Code Reviewer / persetujuan manusia |
| `done` | PR sudah di-merge |
| `blocked: alasan` | Gagal setelah 3 putaran perbaikan, atau terhalang hal teknis; alasan wajib ditulis |
| `menunggu keputusan #N` | Tidak bisa jalan sama sekali tanpa keputusan #N di `keputusan-terbuka.md` |

## Aturan backlog

- Semua task Jenis **kode** tergantung **T-001** (ADR tech stack sudah di-merge).
- Kolom Tergantung yang berisi `#N` artinya task menyentuh keputusan terbuka #N. Task tetap `todo` bila bisa dikerjakan dengan **field kosong / nilai konfigurasi** (misalnya harga & margin kosong, tarif ongkir kosong, koordinat dan domain dari konfigurasi). Agen **tidak boleh** mengisi harga, persentase margin, atau tarif.
- Produk tanpa harga tidak boleh tayang. Tidak ada harga di bawah modal. Pagar: harga grup individu ≥ Mitra Grosir ≥ Franchise.
- Rokok dan bir **tidak** masuk Fase 1: tidak ada kategori, seed, atau baris CSV untuk keduanya (import menolaknya).
- Mitra Grosir, Franchise, tempo, multi-gudang, dan aplikasi native berada di luar Fase 1. Pengecualian: pesanan dari drop point dihitung sebagai tingkat Mitra (`keputusan.md` #4), jadi tier harga Mitra tetap perlu ada di engine harga.
- Kunci API dan password hanya lewat environment variable.

## Tabel task

| ID | Judul | Squad | Agen | Jenis | Tergantung | Status |
|---|---|---|---|---|---|---|
| T-001 | ADR tech stack `docs/adr/0001-tech-stack.md`: bahasa/framework backend, PWA frontend, database, antrean job, hosting; mempertimbangkan integrasi Gudang (`InventorySource`), Xendit, gateway WhatsApp, n8n | Build & QA | Software Architect | non-kode | — | review (PR #1; QA 11 Nov: lulus review agen, menunggu persetujuan manusia) |
| T-002 | Peta flow group order lengkap: grup dibuka, belum aktif (<3 akun), aktif, tier MOQ tercapai, cut-off, kunci harga, selisih → saldo, grup gagal, refund, stok habis sebelum/sesudah cut-off, pembatalan | Produk & flow | Workflow Architect | non-kode | — | review (PR #2; QA 11 Nov: lulus review agen, menunggu persetujuan manusia) |
| T-003 | Spesifikasi engine harga & pagar harga: rumus modal + margin per level, tier grup (1 pcs / 6+ / 12+), pagar antar level, pagar diskon + gratis ongkir ≥ modal, aturan "produk tanpa harga tidak tayang", harga kartu = harga detail. TANPA angka harga/margin | Harga & bisnis | Pricing Analyst + Backend Architect | non-kode | T-002 | review (PR #3; QA 11 Nov: lulus review agen, menunggu persetujuan manusia) |
| T-004 | Model data & ERD: pengguna (unik per HP), persetujuan legal, zona, drop point, produk/SKU/satuan jual, tier harga, grup, peserta, pesanan, pembayaran, saldo (ledger), armada, tarif, aturan diskon, KPI COD, log admin | Build & QA | Backend Architect | non-kode | T-001, T-002, T-003 | todo |
| T-005 | Peta flow pembayaran: Xendit (QRIS / VA / e-wallet), webhook, kedaluwarsa, refund & selisih → saldo, pemakaian saldo; flow COD: kelayakan 3 minggu berturut-turut, batas Rp500.000, cabut otomatis/manual | Produk & flow | Workflow Architect + Payments & Billing Engineer | non-kode | T-002 | todo |
| T-006 | Flow ongkir, armada & slot kirim: rumus ongkir, pemilihan armada terkecil yang cukup (motor/tossa/pickup), slot harian, ambil di drop point = tingkat Mitra, kapasitas per slot. Tarif tidak diisi | Harga & bisnis | Operations Manager | non-kode | T-002, #4 | todo |
| T-007 | Spesifikasi UX halaman: pilih zona, katalog, detail, grup (dari link), login OTP, checkout, status pesanan, saldo, panel admin; design token & fondasi CSS mobile first | Produk & flow | UX Architect | non-kode | T-002 | todo |
| T-008 | Spesifikasi komponen UI: kartu produk (harga coret + aktif, progress "X/Y di zona kamu · Z lagi → harga"), pemilih satuan jual, pemilih slot kirim, tombol "Ajak tetangga via WhatsApp", banner "Tambah ke layar utama" | Produk & flow | UI Designer | non-kode | T-003, T-007 | todo |
| T-009 | Kontrak `InventorySource`: method, tipe data (SKU, stok tersedia, harga modal), arah balik permintaan picking, error & retry, toggle konfigurasi, perilaku `LocalInventory` vs `GudangApiInventory` | Build & QA | Software Architect | non-kode | T-001 | todo |
| T-010 | Spesifikasi notifikasi WhatsApp & job otomatis: template (OTP, konfirmasi, pengingat cut-off, "kurang X orang", dikirim, diterima), pemicu, batas frekuensi; job cut-off, picking list, daftar antar, laporan harian, evaluasi KPI COD mingguan (jadwal WIB, idempotensi, log) | Build & QA | Automation Governance Architect | non-kode | T-002, T-005, T-006 | todo |
| T-011 | Rencana tes: skenario E2E Playwright, uji API, matriks skenario harga (pagar, tier, selisih → saldo, grup <3 akun, diskon di bawah modal ditolak), data uji tanpa harga asli | Build & QA | Test Automation Engineer + API Tester | non-kode | T-002, T-003, T-005, T-006 | todo |
| T-012 | Scaffold repo sesuai ADR + CI dasar (lint, unit test, build di setiap PR), `.env.example` tanpa rahasia | Build & QA | DevOps Automator | kode | T-001 | todo |
| T-013 | Skema database & migrasi awal sesuai model data; seed kategori/subkategori contoh (tanpa rokok/bir, tanpa harga) | Build & QA | Backend Architect | kode | T-001, T-004, T-012 | todo |
| T-014 | Fondasi PWA: layout mobile first, design token, routing, manifest + service worker, Bahasa Indonesia | Build & QA | Frontend Developer | kode | T-001, T-007, T-012 | todo |
| T-015 | Zona: baca `config/lokasi.json` (gudang & drop point), cek radius 2–3 km dari drop point, halaman pilih lokasi tanpa login (izin lokasi / pilih manual), pesan "di luar zona" | Build & QA | Backend Architect + Frontend Developer | kode | T-001, T-013, T-014, #3 | todo |
| T-016 | Adapter gateway WhatsApp (interface, mode log/sandbox untuk dev) + login OTP WhatsApp: 1 akun per nomor HP terverifikasi, rate limit, kedaluwarsa OTP | Build & QA | Backend Architect | kode | T-001, T-010, T-013 | todo |
| T-017 | Persetujuan S&K & Kebijakan Privasi: tampilkan `docs/legal/`, catat versi + waktu persetujuan per akun, wajib sebelum ikut grup | Build & QA | Frontend Developer + Backend Architect | kode | T-001, T-016, #5 | todo |
| T-018 | Modul `InventorySource`: interface + `LocalInventory` (default) + toggle konfigurasi, dipakai katalog & stok | Build & QA | Backend Architect | kode | T-001, T-009, T-013 | todo |
| T-019 | `GudangApiInventory`: sinkron SKU, stok, harga modal dari Gudang; kirim permintaan picking untuk pesanan terkonfirmasi; mock server Gudang untuk tes | Build & QA | Backend Architect | kode | T-001, T-018 | todo |
| T-020 | Engine harga: harga per level/tier = modal + margin, pagar antar level, tolak harga di bawah modal, produk tanpa harga tidak tayang; unit test sesuai T-003 (field margin kosong) | Build & QA | Backend Architect | kode | T-001, T-003, T-013, #1 | todo |
| T-021 | Ledger saldo pengguna: kredit (selisih harga, refund), debit (pemakaian di checkout), riwayat saldo; tidak bisa negatif | Build & QA | Payments & Billing Engineer | kode | T-001, T-005, T-013 | todo |
| T-022 | Engine group order: grup = produk × zona × slot kirim, aktif bila ≥3 akun OTP berbeda, MOQ per tier dari admin, progress & "Z lagi → harga", cek stok via `InventorySource` | Build & QA | Backend Architect | kode | T-001, T-002, T-015, T-016, T-018, T-020 | todo |
| T-023 | Cut-off grup: kunci harga final, grup gagal (<3 akun) → harga non-grup/refund sesuai flow, tier lebih murah tercapai → selisih ke saldo, stok habis → refund parsial ke saldo | Build & QA | Backend Architect | kode | T-001, T-021, T-022 | todo |
| T-024 | Link unik grup (`/g/XXXXXX`) + deep link: buka halaman grup langsung; PWA: buka web + ajakan "Tambah ke layar utama"; struktur deferred deep link disiapkan untuk app native; base URL dari konfigurasi | Build & QA | Frontend Developer + Backend Architect | kode | T-001, T-022, #6 | todo |
| T-025 | API katalog: kategori + subkategori dengan jumlah produk, pencarian, hanya produk berharga & berstok, harga dari engine harga | Build & QA | Backend Architect | kode | T-001, T-013, T-018, T-020 | todo |
| T-026 | UI katalog: tab kategori/subkategori dengan jumlah, pencarian, tombol + cepat, keranjang | Build & QA | Frontend Developer | kode | T-001, T-008, T-014, T-025 | todo |
| T-027 | Komponen kartu produk: harga coret + harga aktif, progress grup "X/Y di zona kamu · Z lagi → harga", promo terpisah; harga sama dengan halaman detail | Build & QA | Frontend Developer | kode | T-001, T-008, T-022, T-026 | todo |
| T-028 | Halaman detail produk: pilih satuan jual (1 pcs, grup 6+, grup 12+), progress grup, tombol "Ikut grup" (cek S&K), tombol "Ajak tetangga via WhatsApp" berisi link grup | Build & QA | Frontend Developer | kode | T-001, T-017, T-024, T-027 | todo |
| T-029 | Integrasi Xendit: buat pembayaran QRIS / VA / e-wallet (mode sandbox), kunci via env, halaman instruksi bayar & kedaluwarsa | Build & QA | Payments & Billing Engineer | kode | T-001, T-005, T-013 | todo |
| T-030 | Webhook Xendit: verifikasi callback token, idempoten, update status pesanan, refund & selisih → saldo | Build & QA | Payments & Billing Engineer | kode | T-001, T-021, T-029 | todo |
| T-031 | Kalkulator ongkir & pemilihan armada (tarif dasar + kg × tarif/kg + km × tarif/km, armada terkecil yang cukup), ambil di drop point = ongkir 0 + tingkat Mitra; panel admin tarif & armada (field kosong) | Build & QA | Backend Architect | kode | T-001, T-006, T-013, T-020, #4 | todo |
| T-032 | Aturan diskon & gratis ongkir (% / nominal, produk/kategori/level/periode/zona, kuota, minimal belanja) + pagar "harga akhir ≥ modal" dengan peringatan; panel admin aturan | Build & QA | Backend Architect | kode | T-001, T-020, T-031 | todo |
| T-033 | Checkout: login OTP bila belum, pilih slot kirim (antar rumah / ambil di drop point), ringkasan ongkir & diskon, pakai saldo, pilih metode bayar Xendit | Build & QA | Frontend Developer | kode | T-001, T-016, T-017, T-028, T-029, T-031, T-032 | todo |
| T-034 | COD: status kelayakan per pengguna, tampil hanya bila lolos 3 minggu berturut-turut, batas Rp500.000 per pesanan, cabut manual dengan alasan tercatat; panel admin nilai KPI (default = usulan, bisa diubah) | Build & QA | Payments & Billing Engineer | kode | T-001, T-005, T-033, #2 | todo |
| T-035 | Status pesanan + notifikasi WhatsApp: konfirmasi, pengingat cut-off, "kurang X orang", dikirim, diterima; halaman status pesanan | Build & QA | Automation Governance Architect + Backend Architect | kode | T-001, T-010, T-016, T-023, T-030 | todo |
| T-036 | Panel admin dasar: login & peran admin, CRUD produk/SKU/satuan jual, stok (lokal atau dari Gudang), log perubahan | Build & QA | Frontend Developer + Backend Architect | kode | T-001, T-013, T-014, T-018 | todo |
| T-037 | Panel admin harga & margin per tier: field KOSONG, validasi pagar & ≥ modal, produk tanpa harga ditandai "tidak tayang" | Build & QA | Frontend Developer + Backend Architect | kode | T-001, T-020, T-036, #1 | todo |
| T-038 | Bulk import CSV produk: template kolom (harga/margin boleh kosong), validasi per baris, laporan error, tolak kategori rokok/bir | Build & QA | Backend Architect | kode | T-001, T-036, T-037, #1 | todo |
| T-039 | Panel admin grup aktif & pesanan: daftar grup per zona/slot dengan progress, detail pesanan, ubah status kirim | Build & QA | Frontend Developer | kode | T-001, T-022, T-033, T-036 | todo |
| T-040 | Job pasca cut-off: daftar picking gudang (lokal atau kirim ke Gudang via `InventorySource`) dan daftar antar per slot & armada | Build & QA | Automation Governance Architect | kode | T-001, T-010, T-019, T-023, T-031 | todo |
| T-041 | Job laporan harian ke owner: grup tercapai, jumlah pesanan, repeat rate, biaya kirim per order | Harga & bisnis | Analytics Reporter + Automation Governance Architect | kode | T-001, T-035, T-040 | todo |
| T-042 | Job mingguan evaluasi KPI COD: hitung KPI, naikkan hitungan minggu berturut-turut, gagal 1 minggu → cabut COD & reset, notifikasi pengguna | Build & QA | Automation Governance Architect | kode | T-001, T-010, T-034, #2 | todo |
| T-043 | Tes E2E Playwright alur utama: pilih zona → katalog → ikut grup → checkout (Xendit sandbox) → cut-off → selisih ke saldo; plus grup gagal <3 akun | Build & QA | Test Automation Engineer | kode | T-001, T-011, T-023, T-030, T-033 | todo |
| T-044 | Tes API & skenario harga: pagar harga, tier, diskon/gratis ongkir di bawah modal ditolak, ongkir & armada, webhook idempoten | Build & QA | API Tester | kode | T-001, T-011, T-020, T-023, T-030, T-032 | todo |
| T-045 | CI/CD lengkap + lingkungan staging (deploy otomatis dari `main`), backup database harian, rahasia via env/secret store | Build & QA | DevOps Automator | kode | T-001, T-012, #6 | todo |
| T-046 | Gerbang rilis pilot: audit keamanan (rahasia bocor, akses data, celah) lalu Reality Checker di staging; production hanya setelah disetujui pemilik squad | Build & QA | AI-Generated Code Auditor + Reality Checker | non-kode | T-043, T-044, T-045 | todo |

Jumlah: 46 task (12 non-kode, 34 kode).

## Urutan kerja yang disarankan

Mengikuti `jadwal-otomatis.md`: maks. 3 task per sesi Build (01.13, 05.13, 17.13). PR disetujui tim pada jam cek 13.00–14.00, lalu di-merge pada sesi 14.17.

1. **Gelombang 0 — fondasi keputusan (non-kode):** T-001, T-002, T-003. T-002 tidak menunggu T-001, jadi ketiganya bisa jalan di sesi Build pertama. Semua task kode menunggu ADR T-001 di-merge.
2. **Gelombang 1 — spesifikasi (non-kode):** T-004, T-005, T-006, lalu T-007, T-008, T-009, lalu T-010, T-011.
3. **Gelombang 2 — kerangka kode:** T-012 → T-013, T-014 → T-018, T-020, T-021.
4. **Gelombang 3 — inti group order:** T-015, T-016 → T-017, T-022 → T-023, T-024. Paralel: T-019 (Gudang API).
5. **Gelombang 4 — belanja:** T-025 → T-026 → T-027 → T-028; T-029 → T-030; T-031 → T-032 → T-033.
6. **Gelombang 5 — admin, COD, notifikasi:** T-036 → T-037 → T-038, T-039; T-034, T-035.
7. **Gelombang 6 — job otomatis:** T-040 → T-041; T-042.
8. **Gelombang 7 — tes & rilis:** T-043, T-044, T-045 → T-046.

Jalur kritis: T-001 → T-004 → T-013 → T-020 → T-022 → T-023 → T-033 → T-043 → T-046.

Catatan keputusan terbuka (tidak menghentikan pekerjaan agen, tetapi wajib terisi sebelum production):
- #1 margin & harga: produk tanpa harga tidak tayang, jadi pilot tidak bisa jualan sebelum Efan mengisi.
- #3 koordinat gudang & drop point: zona memakai nilai di `config/lokasi.json`; staging boleh memakai koordinat uji.
- #4 tarif ongkir: field kosong di panel admin; checkout antar rumah belum bisa dipakai sebelum diisi.
- #2 nilai KPI COD: pakai usulan di `keputusan.md` #2 sebagai default yang bisa diubah admin.
- #5 data badan usaha di `docs/legal/`: mekanisme persetujuan berversi; teks final menyusul.
- #6 domain: base URL dari konfigurasi; staging memakai domain sementara.
