# Spesifikasi Engine Harga & Pagar Harga — NEKAT Fase 1

| Atribut | Nilai |
|---|---|
| Task | T-003 (`task/T-003-spec-engine-harga`) |
| Versi | 0.2 — Draf (putaran perbaikan 1: G0, PG-4, kata kunci terlarang, Franchise, selaras T-002 v0.2) |
| Tanggal | 10 Nov 2026 |
| Penyusun | Pricing Analyst + Backend Architect (squad Harga & bisnis, pemilik: Efan) |
| Sumber wajib | `CLAUDE.md` (Aturan harga), `project-specs/keputusan.md` (#3, #4, #6, #7, #8, #9), `project-specs/fase-1-mvp.md`, `project-specs/backlog.md` (T-003, T-020, T-031, T-032, T-037, T-038), `docs/legal/syarat-ketentuan.md` §3–§4 |
| Selaras dengan (draf) | `docs/flow/group-order.md` (T-002), `docs/adr/0001-tech-stack.md` (T-001) |
| Dipakai oleh | T-004, T-008, T-011, T-020, T-022, T-023, T-025, T-027, T-031, T-032, T-033, T-037, T-038, T-044 |

Dokumen ini menetapkan **perilaku wajib** engine harga sehingga T-020 bisa langsung dibangun dan diuji.
**Tidak ada angka harga, persentase margin, atau tarif ongkir nyata di dokumen ini.** Semua angka di contoh dan
kasus uji adalah **ilustrasi, bukan harga**. Hal bisnis yang belum diputuskan ditandai `[P-xx]` / `[F-xx]` / `[H-x]`
dan dirangkum di §11 dengan **DEFAULT SEMENTARA** (asumsi kerja yang bisa diganti lewat konfigurasi, bukan keputusan).

---

## 1. Tujuan, cakupan, istilah

### 1.1 Tujuan
1. Satu sumber kebenaran untuk semua harga jual: katalog, kartu, detail, halaman grup, checkout, cut-off, laporan.
2. Menegakkan aturan harga `CLAUDE.md` sebagai **invarian yang dites**, bukan sekadar konvensi.
3. Memisahkan **struktur** (dibangun agen sekarang) dari **angka** (diisi pemilik lewat panel/CSV, keputusan #6).

### 1.2 Cakupan Fase 1
| Masuk | Disiapkan strukturnya, tidak dipakai checkout | Di luar dokumen ini |
|---|---|---|
| Level **INDIVIDU** dengan tier `SATUAN` (1 pcs), tier grup `G1` (label "6+"), `G2` (label "12+"), tier opsional `G0` (grup dasar [F-04]) | Level **FRANCHISE** (kolom margin, pagar, validasi) | Rumus tarif ongkir & pemilihan armada (T-006/T-031); engine hanya menerima nilai ongkir |
| Level **MITRA** khusus pesanan **ambil di drop point** (keputusan #4) | Mitra Grosir sebagai akun/pelanggan sendiri, tempo, multi-gudang | Ledger saldo (T-021), mesin status grup (T-002/T-022) |
| Pagar modal, pagar tier, pagar level, pagar promo + gratis ongkir, aturan tayang, harga kartu = detail | Harga per zona (S&K §3.2); Fase 1 satu zona, dimensi `id_zona` disiapkan di model data | Kelayakan & batas COD (T-034), kecuali perbandingan P-18 |

### 1.3 Istilah
| Istilah | Definisi |
|---|---|
| **SKU sumber** | Barang sebagaimana dikenal `InventorySource` (mis. karton isi N). Membawa **modal sumber** (rupiah integer) + `waktu_data`. |
| **Satuan jual** | Unit yang dijual ke pengguna (pcs, renceng, dus). Satu SKU sumber bisa punya beberapa satuan jual. Harga selalu dihitung **per satuan jual**. |
| **Konversi** | Pasangan integer `(isi_jual, isi_sumber)` dalam satuan dasar terkecil: satuan jual berisi `isi_jual` unit dasar, SKU sumber berisi `isi_sumber` unit dasar. |
| **Modal** | Modal per satuan jual hasil konversi (§3.3). Selalu > 0. |
| **Level** | Tingkat pembeli: `INDIVIDU` (urutan 1) ≥ `MITRA` (urutan 2) ≥ `FRANCHISE` (urutan 3). "Mitra" = "Mitra Grosir" di `CLAUDE.md`. |
| **Tier** | Tingkat kuantitas dalam satu level, dengan **peringkat tetap** `SATUAN < G0 < G1 < G2`: `SATUAN` (MOQ = 1, wajib); `G0` (grup dasar, opsional, **tanpa MOQ**, aktif hanya lewat penanda `g0_aktif`; berlaku saat grup aktif dan qty < MOQ tier ber-MOQ terendah yang aktif, atau selama grup aktif bila G1/G2 tidak aktif [F-04]); `G1`, `G2` (MOQ dari admin, opsional per produk [P-21]). |
| **MOQ** | Ambang kuantitas tier, diisi admin per satuan jual; satuan hitung [P-03 = F-04]. Di-snapshot per grup saat grup dibuka (T-002 B-14). |
| **Sel harga** | Satu kombinasi (satuan jual, level, tier). Setiap sel punya margin (boleh kosong) dan hasil harga. |
| **Margin** | Tambahan rupiah di atas modal: `harga = modal + margin` (`CLAUDE.md`). Bisa ditulis **persen dari modal** (basis poin) atau **nominal** [P-01]. Catatan: ini *markup atas modal*, bukan margin kotor atas harga jual. |
| **Basis poin (bp)** | Integer, 1 bp = 0,01 %. 10.000 bp = 100 %. Tidak ada float (ADR §5.1). |
| **Harga satuan** | Harga sel (INDIVIDU, SATUAN). Dasar pembayaran di muka [F-01/P-04]. |
| **Harga grup individu** | Harga sel (INDIVIDU, G0/G1/G2). |
| **Harga Mitra** | Harga sel (MITRA, SATUAN) di Fase 1 (Mitra hanya punya satu tier di Fase 1). |
| **Harga aktif** | Harga per unit yang berlaku untuk pengguna saat ini menurut status grup (§5.1). |
| **Harga coret** | Harga pembanding di kartu [P-17]. |
| **Promo** | Diskon atau gratis ongkir dari aturan admin (T-032). Selalu ditampilkan **terpisah** dari harga aktif. |
| **Harga dibayar (D)** | Harga bruto per unit yang dicatat saat checkout (sebelum promo). Tidak pernah berubah (T-002 §1). |
| **Harga final (F)** | Harga bruto per unit yang dikunci saat cut-off (§5.3). |
| **Versi harga** | `id_versi_harga`: penanda deterministik atas input (modal, margin, tier, konfigurasi) yang menghasilkan sebuah tabel harga. |
| **Tayang** | Produk boleh muncul di katalog & bisa dibeli. Syarat harga di §4 (P-05 di §4.1); syarat stok di T-025. |

---

## 2. Input data

### 2.1 Sumber & pemilik data
| Data | Sumber | Pemilik isi | Keterangan |
|---|---|---|---|
| Modal sumber + `waktu_data` | `InventorySource.getHargaModal` (`LocalInventory`: panel/CSV; `GudangApiInventory`: Gudang) | Admin harga / Gudang | Integer rupiah. Kosong atau ≤ 0 → produk tidak tayang (ADR §4.1), **bukan** harga nol |
| Konversi `(isi_jual, isi_sumber)` | Panel produk / CSV | Admin | Integer > 0 |
| Kategori | Panel / CSV | Admin | Diperiksa daftar terlarang (§8.3) |
| Definisi tier (`kode`, `moq`, `aktif`) | Panel harga / CSV | Admin harga | G1/G2: MOQ **kosong** sampai diisi (kosong = tier tidak aktif). G0: tanpa MOQ, aktif lewat penanda `g0_aktif` (bawaan `tidak`) |
| Margin per sel | Panel harga / CSV | **Efan (keputusan #6)** | Field **KOSONG** secara bawaan; agen tidak mengisi |
| Konfigurasi engine (§2.3) | Konfigurasi admin (`admin_harga`) | Efan / Joseph | Nilai bawaan = DEFAULT SEMENTARA §11 |
| Aturan diskon & gratis ongkir | Panel T-032 | Admin harga | §6 |
| Ongkir pesanan | Kalkulator T-031 | — | Engine harga hanya menerima angka hasil |

### 2.2 Matriks sel harga per satuan jual
`✓` = dipakai di Fase 1, `○` = disiapkan & divalidasi, tidak dipakai checkout, `—` = tidak ada.

| Level \ Tier | SATUAN | G0 (opsional) | G1 "6+" | G2 "12+" |
|---|---|---|---|---|
| INDIVIDU | ✓ wajib | ✓ opsional | ✓ opsional [P-21] | ✓ opsional [P-21] |
| MITRA | ✓ (drop point) [P-06] | — | — (Fase 2+) | — (Fase 2+) |
| FRANCHISE | ○ | — | — | — |

Model data (T-004) wajib menyimpan matriks sebagai baris generik `(id_satuan_jual, level, kode_tier)` sehingga
tier Mitra/Franchise bisa ditambah tanpa migrasi skema. Label tier ("6+", "12+") dibentuk dari `moq`, tidak ditulis tetap.

### 2.3 Konfigurasi engine (semua bisa diubah admin; bawaan = asumsi)
| Kunci | Tipe | Bawaan sementara | Rujukan |
|---|---|---|---|
| `pembulatan.mode` | `ATAS` \| `TERDEKAT` \| `BAWAH` | `ATAS` | P-02 = H6 |
| `pembulatan.kelipatan` | Rupiah integer ≥ 1 | `1` | P-02 = H6 |
| `jenis_margin_diizinkan` | himpunan `BP`, `NOMINAL` | keduanya | P-01 |
| `margin_nol` | `IZINKAN_DENGAN_PERINGATAN` \| `TOLAK` | `IZINKAN_DENGAN_PERINGATAN` | P-16 |
| `batas_atas_margin_bp` | integer \| kosong | kosong (tanpa batas; hanya penangkal salah ketik → peringatan) | — |
| `mode_pagar_level` | `KETAT` \| `PER_TIER` | `KETAT` | P-22 |
| `mitra_wajib_untuk_tayang` | boolean | `false` | P-06 |
| `syarat_mitra_min_nilai` | Rupiah \| kosong | kosong (= harga Mitra tidak pernah berlaku) | P-05 |
| `batas_usia_modal_detik` | integer \| kosong | kosong (`LocalInventory`); wajib diisi sebelum `gudang` di production | P-10 |
| `ambang_margin_menipis_bp` | integer \| kosong | kosong (tanpa alert) | P-08 |
| `promo_langgar_modal_saat_runtime` | `TIDAK_DITERAPKAN` \| `DIBATASI_SAMPAI_MODAL` | `TIDAK_DITERAPKAN` | P-07 |
| `diskon_menumpuk` | boolean | `false` | P-15 |
| `pembulatan_diskon` | `BAWAH` \| `ATAS` | `BAWAH` (potongan dibulatkan ke bawah) | P-15 |
| `dasar_minimal_belanja_gratis_ongkir` | `SEBELUM_DISKON` \| `SESUDAH_DISKON` | `SESUDAH_DISKON` | P-13 |
| `alokasi_subsidi_ongkir` | `PROPORSIONAL_NILAI` \| `PROPORSIONAL_BERAT` \| `RATA_PER_BARIS` | `PROPORSIONAL_NILAI` | P-20 |
| `harga_coret` | `HARGA_SATUAN_RIIL` \| `TIDAK_TAMPIL` | `HARGA_SATUAN_RIIL` | P-17 |
| `kategori_terlarang` | daftar kode kategori | rokok, tembakau & nikotin, bir & minuman beralkohol | P-24, keputusan #7 |

Setiap perubahan konfigurasi menaikkan `id_versi_harga` semua produk terdampak dan dicatat di `log_admin` (ADR §7).

---

## 3. Rumus & representasi

### 3.1 Representasi angka
- **Rupiah**: integer rupiah penuh, `bigint` di PostgreSQL, tipe bermerek `Rupiah` di TypeScript (ADR §5.1). Tidak ada float/`numeric` berpecahan.
- **Persen**: integer basis poin `BasisPoin` (≥ 0). Input "12,5%" → `1250`. Presisi lebih halus dari 0,01 % ditolak (`MARGIN_FORMAT`) [P-01].
- **Perkalian antara** (modal × bp, nilai × qty, modal × isi) dihitung dengan `BigInt`, lalu hasil akhir dicek `Number.isSafeInteger`; gagal → `ANGKA_OVERFLOW`.
- Helper pembagian (semua argumen ≥ 0, penyebut > 0):
  - `bagiAtas(a, b) = (a + b − 1) div b`
  - `bagiBawah(a, b) = a div b`
  - `bulatK(x, K, mode)`: `ATAS` → `bagiAtas(x, K) × K`; `BAWAH` → `bagiBawah(x, K) × K`; `TERDEKAT` → `bagiBawah(2x + K, 2K) × K` (setengah ke atas).

### 3.2 Rumus inti
```
modal              = bagiAtas(modal_sumber × isi_jual, isi_sumber)                 (§3.3)
margin_rp(sel)     = NOMINAL: nilai
                     BP:      bagiAtas(modal × nilai_bp, 10000)
harga_mentah(sel)  = modal + margin_rp(sel)
harga(sel)         = bulatK(harga_mentah, K, mode)
                     jika harga < modal → harga = bulatK(harga_mentah, K, ATAS) + peringatan PEMBULATAN_DINAIKKAN
```
Karena `margin_rp ≥ 0` dan `bulatK(·, ATAS)` tidak pernah turun, `harga(sel) ≥ modal` selalu benar setelah langkah terakhir;
pengecekan eksplisit tetap dijalankan (pagar PG-1) sebagai pertahanan berlapis.

### 3.3 Modal per satuan hasil bagi karton
- `modal = bagiAtas(modal_sumber × isi_jual, isi_sumber)`. Contoh ilustrasi (bukan harga): karton isi 12 bermodal 12.001 dijual per pcs → `bagiAtas(12.001 × 1, 12) = 1.001`.
- Pembulatan **ke atas** selama H6/P-02 belum diputuskan (ADR §5.1): menjual 12 pcs × modal per pcs tidak pernah kurang dari modal karton.
- Satuan jual lebih besar dari SKU sumber (mis. paket 2 karton) memakai rumus sama (`isi_jual > isi_sumber`).
- `isi_jual` atau `isi_sumber` ≤ 0 / bukan integer → `KONVERSI_TIDAK_VALID`, satuan jual tidak tayang.
- Antar satuan jual dari SKU yang sama tidak ada pagar wajib di Fase 1 (dus vs pcs); hanya peringatan `HARGA_KEMASAN_TIDAK_WAJAR` bila harga per unit dasar kemasan besar > kemasan kecil [P-14].

### 3.4 Urutan perhitungan (wajib, deterministik)
1. Validasi kategori (§8.3) → gagal: `KATEGORI_DILARANG`, berhenti.
2. Validasi modal sumber: ada, > 0, umur ≤ `batas_usia_modal_detik` bila diisi → gagal: `MODAL_KOSONG` / `MODAL_TIDAK_VALID` / `MODAL_KEDALUWARSA`.
3. Validasi konversi → hitung `modal` (§3.3).
4. Validasi definisi tier: `SATUAN.moq = 1`; `G1`/`G2` yang aktif wajib punya MOQ integer ≥ 2 dan, bila keduanya aktif, `moq(G1) < moq(G2)` → gagal: `MOQ_TIDAK_VALID`. **`G0` dikecualikan** dari aturan MOQ: `moq(G0)` selalu `null`, aktif bila `g0_aktif = true` (MOQ yang diisi untuk G0 → `MOQ_TIDAK_VALID`).
5. Untuk setiap sel aktif: validasi margin (kosong / negatif / format / di atas `batas_atas_margin_bp`) → hitung `harga(sel)` (§3.2).
6. Pagar PG-1 (≥ modal) per sel.
7. Pagar PG-3 (monoton tier) per level.
8. Pagar PG-2 (antar level).
9. Tentukan status tayang (PG-5) dan `id_versi_harga`.

Langkah 5–8 mengumpulkan **semua** pelanggaran (tidak berhenti di yang pertama) agar panel admin & laporan CSV bisa menampilkan daftar lengkap.

---

## 4. Pagar (invarian)

Notasi: `H(L, t)` = harga sel level `L` tier `t`; `M` = modal; `T(L)` = himpunan tier aktif berharga di level `L`;
`r(t)` = peringkat tetap tier (`SATUAN` = 0, `G0` = 1, `G1` = 2, `G2` = 3; **bukan** MOQ, karena G0 tanpa MOQ);
`≺` = urutan level (INDIVIDU ≺ MITRA ≺ FRANCHISE); `D` = harga dibayar per unit, `q` = qty, `P` = potongan baris, `S` = subsidi ongkir baris.

### 4.1 Pernyataan formal
| ID | Invarian | Pernyataan formal |
|---|---|---|
| PG-1 | Tidak ada harga di bawah modal | `∀ sel: H(sel) ≥ M`; dan pada setiap baris pesanan: `harga_dibayar ≥ modal_snapshot`, `harga_final ≥ modal_cutoff` |
| PG-2 | Harga grup individu ≥ Mitra ≥ Franchise | Mode `KETAT` (bawaan [P-22]): `∀ L1 ≺ L2: min_{t∈T(L1)} H(L1,t) ≥ max_{t∈T(L2)} H(L2,t)`. Mode `PER_TIER`: `∀ L1 ≺ L2, ∀ t ∈ T(L1) ∩ T(L2): H(L1,t) ≥ H(L2,t)`. Hanya membandingkan level yang selnya terisi. Pelanggaran yang melibatkan level **di luar** `levelAktif` (Fase 1: FRANCHISE) = **peringatan** `PAGAR_LEVEL_NONAKTIF`, tidak menahan tayang; berubah menjadi error `PAGAR_LEVEL_DILANGGAR` begitu level itu diaktifkan *(asumsi, lihat P-22)* |
| PG-3 | Tier lebih tinggi tidak lebih mahal | `∀ L, ∀ t1, t2 ∈ T(L): r(t1) < r(t2) ⇒ H(L,t1) ≥ H(L,t2)`. Urutan memakai peringkat `r`, bukan MOQ. Sama besar diizinkan + peringatan `TIER_TANPA_MANFAAT` |
| PG-4 | Promo + gratis ongkir tidak membuat harga akhir < modal | Per baris pesanan (sama dengan §6.1 langkah 8): `D × q − P − S ≥ M × q`. Pelanggaran → tolak + peringatan |
| PG-5 | Produk tanpa harga lengkap tidak tayang | `tayang ⇔` modal valid ∧ kategori diizinkan ∧ tidak menunggu tinjauan kategori ∧ sel (INDIVIDU, SATUAN) berharga ∧ setiap tier aktif berharga ∧ PG-1..PG-3 lolos untuk level di `levelAktif` ∧ (`mitra_wajib_untuk_tayang` ⇒ sel MITRA berharga) |
| PG-6 | Harga kartu = harga detail; promo terpisah | `tampilanHarga(produk, konteks)` adalah **satu-satunya** fungsi penghasil harga untuk kartu, detail, halaman grup, dan ringkasan checkout; untuk `id_versi_harga` dan konteks yang sama hasilnya identik. Respons memuat `harga_aktif` dan `promo` sebagai field terpisah; `promo` tidak pernah menimpa `harga_aktif` |
| PG-7 | Harga dibayar tidak naik setelah dicatat | `harga_final ≤ harga_dibayar` untuk setiap peserta (T-002, F-01/P-19) |

### 4.2 Titik penegakan & kode error
| ID | Domain (`packages/domain`) | DB (constraint) | Panel admin (T-037) | Import CSV (T-038) | Sinkron Gudang / runtime | Kode error |
|---|---|---|---|---|---|---|
| PG-1 | `hitungTabelHarga`, `hitungHargaFinal` | `CHECK (harga >= modal AND modal > 0)` pada `harga_terhitung`; `CHECK (harga_dibayar >= modal_snapshot)` & `CHECK (harga_final IS NULL OR harga_final >= modal_cutoff)` pada baris pesanan; `CHECK (nilai_margin >= 0)` | Simpan ditolak, sel merah | Baris ditolak | Modal baru → hitung ulang; sel gagal → produk tidak tayang; saat cut-off → grup DITAHAN | `HARGA_DI_BAWAH_MODAL`, `MARGIN_NEGATIF` |
| PG-2 | `validasiPagar` | Tidak bisa sebagai `CHECK` lintas baris; trigger validasi di akhir transaksi tulis harga (opsional, T-020 memutuskan) | Simpan ditolak (level aktif) / peringatan dengan konfirmasi (level nonaktif); tampilkan sel yang bentrok | Baris ditolak (level aktif) / diimpor + peringatan (level nonaktif) | Hitung ulang → tidak tayang (level aktif saja) | `PAGAR_LEVEL_DILANGGAR`, `PAGAR_LEVEL_NONAKTIF` |
| PG-3 | `validasiPagar` | `CHECK (moq >= 2)` untuk `G1`/`G2`; `CHECK (moq IS NULL)` untuk `G0`; `UNIQUE (id_satuan_jual, level, kode_tier)` | Simpan ditolak | Baris ditolak | Hitung ulang → tidak tayang | `PAGAR_TIER_DILANGGAR`, `MOQ_TIDAK_VALID` |
| PG-4 | `validasiAturanPromo` (saat simpan), `hitungRingkasanCheckout` (runtime) | `CHECK` pada baris pesanan: `nilai_bersih_barang >= modal_snapshot × qty` | Simpan aturan ditolak + daftar SKU terdampak | — (aturan promo tidak lewat CSV di Fase 1) | Promo tidak diterapkan + peringatan [P-07] | `PROMO_DI_BAWAH_MODAL`, `GRATIS_ONGKIR_DI_BAWAH_MODAL` |
| PG-5 | `statusTayang` | Kolom `tayang` hanya ditulis oleh use case harga; query katalog `WHERE tayang AND stok > 0` (T-025) | Lencana "Tidak tayang" + daftar alasan | Laporan per baris: "diimpor, tidak tayang: …" | Modal kosong/kedaluwarsa → tidak tayang otomatis | `TIDAK_TAYANG` + `AlasanTidakTayang[]` |
| PG-6 | `tampilanHarga` | — | Pratinjau kartu & detail di panel memanggil fungsi yang sama | — | PWA tidak menghitung harga (ADR §3); E2E membandingkan kartu vs detail | — |
| PG-7 | `hitungHargaFinal` | `CHECK (harga_final IS NULL OR harga_final <= harga_dibayar)` | — | — | Job cut-off | `HARGA_FINAL_MELEBIHI_DIBAYAR` (bug, alert) |

### 4.3 Daftar kode error & peringatan
| Kode | Jenis | Arti |
|---|---|---|
| `MODAL_KOSONG` | error | Modal sumber tidak ada |
| `MODAL_TIDAK_VALID` | error | Modal ≤ 0 atau bukan integer |
| `MODAL_KEDALUWARSA` | error | Umur data modal > `batas_usia_modal_detik` [P-10] |
| `MODAL_DIKELOLA_GUDANG` | error | Kolom modal diisi di CSV/panel saat `INVENTORY_SOURCE=gudang` [P-25] |
| `KONVERSI_TIDAK_VALID` | error | `isi_jual`/`isi_sumber` tidak valid |
| `MOQ_TIDAK_VALID` | error | MOQ G1/G2 aktif kosong, < 2, atau tidak naik tegas; atau MOQ diisi untuk G0 |
| `MARGIN_KOSONG` | status | Sel wajib belum diisi (bukan error simpan; produk tidak tayang) |
| `MARGIN_TIDAK_VALID` | status (alasan tidak tayang) | Ringkasan untuk margin tersimpan yang kini tidak lolos validasi (mis. jenis tidak lagi diizinkan, margin nol setelah `margin_nol = TOLAK`); rincian di `MARGIN_FORMAT` / `MARGIN_NEGATIF` / `MARGIN_NOL` |
| `MITRA_WAJIB_KOSONG` | status (alasan tidak tayang) | `mitra_wajib_untuk_tayang = true` tetapi sel (MITRA, SATUAN) kosong [P-06] |
| `MARGIN_NEGATIF` | error | Margin < 0 |
| `MARGIN_FORMAT` | error | Format tidak dikenali / presisi < 0,01 % / jenis tidak diizinkan |
| `MARGIN_NOL` | peringatan / error | Margin = 0; perilaku sesuai `margin_nol` [P-16] |
| `MARGIN_DI_ATAS_BATAS` | peringatan | Melebihi `batas_atas_margin_bp` (penangkal salah ketik) |
| `HARGA_DI_BAWAH_MODAL` | error | PG-1 |
| `PAGAR_LEVEL_DILANGGAR` | error | PG-2 antar level aktif |
| `PAGAR_LEVEL_NONAKTIF` | peringatan | PG-2 melibatkan level di luar `levelAktif` (Fase 1: FRANCHISE); tidak menahan tayang *(asumsi)* |
| `PAGAR_TIER_DILANGGAR` | error | PG-3 |
| `TIER_TANPA_MANFAAT` | peringatan | Dua tier berurutan berharga sama |
| `PEMBULATAN_DINAIKKAN` | peringatan | Mode pembulatan dipaksa `ATAS` untuk sel ini agar ≥ modal |
| `HARGA_KEMASAN_TIDAK_WAJAR` | peringatan | [P-14] |
| `PROMO_DI_BAWAH_MODAL` | error | PG-4 untuk diskon |
| `GRATIS_ONGKIR_DI_BAWAH_MODAL` | error / info ke pengguna | PG-4 untuk gratis ongkir |
| `SELISIH_DIBATASI_PAGAR` | info | Kredit selisih dikurangi agar bersih ≥ modal (§5.4) [P-23] |
| `MARGIN_MENIPIS` | peringatan | `harga_dibayar − modal_baru < ambang` [P-08] |
| `KATEGORI_DILARANG` | error | Kategori dalam `kategori_terlarang` |
| `PERLU_TINJAUAN_KATEGORI` | status (alasan tidak tayang) | Nama produk mengandung kata kunci terlarang sebagai kata utuh dan tidak ada di daftar pengecualian (§8.3); baris tetap disimpan, ditahan sampai ditinjau admin |
| `MITRA_TIDAK_TERSEDIA` | info | Drop point tetapi harga Mitra kosong / syarat tidak terpenuhi |
| `HARGA_TIDAK_TERSEDIA` | error runtime | Tabel harga tidak bisa dihitung (dipakai T-002 M-08) |
| `ANGKA_OVERFLOW` | error | Hasil melewati batas integer aman |

---

## 5. Harga grup sepanjang siklus

Istilah status mengikuti T-002 v0.2 (DIBUKA, BELUM_AKTIF, AKTIF, CUT_OFF, HARGA_TERKUNCI, GAGAL_LANJUT_SATUAN, DITAHAN, GAGAL).
Semua harga diambil dari tabel harga **live** (modal terkini) kecuali ditulis lain [F-08/P-08].

### 5.1 Harga tampil (kartu, detail, halaman grup)
| Status grup untuk kunci (produk × zona × slot) | `harga_aktif` | Info tier berikut |
|---|---|---|
| Belum ada grup / DIBUKA / BELUM_AKTIF | `H(INDIVIDU, SATUAN)` | "harga bila grup aktif": tier grup terendah yang aktif |
| AKTIF, qty terhitung < MOQ tier ber-MOQ terendah (atau G1/G2 tidak aktif) | `H(INDIVIDU, G0)` bila `g0_aktif`, selain itu `H(INDIVIDU, SATUAN)` [F-04] | "Z lagi → Rp{H(tier berikut)}" |
| AKTIF, tier `t` ∈ {G1, G2} tercapai | `H(INDIVIDU, t)` | tier berikut bila ada |
| ≥ CUT_OFF | HARGA_TERKUNCI: harga final grup; GAGAL_LANJUT_SATUAN: harga satuan terkunci; lainnya: teks status T-002 §9.1 | — |

- `harga_coret` = `H(INDIVIDU, SATUAN)` hanya bila `> harga_aktif`; tidak pernah harga referensi buatan [P-17].
- Harga Mitra **tidak** ditampilkan di kartu (bergantung pilihan drop point di checkout); detail produk boleh menampilkan "Ambil di drop point: Rp{H(MITRA,SATUAN)} bila syarat terpenuhi" melalui `tampilanHarga` yang sama.
- `progress` ("X/Y di zona kamu · Z lagi → harga") memakai `qty_terhitung` dari engine grup dan MOQ dari `snapshot_moq` grup.

### 5.2 Harga dibayar di muka (checkout) — DEFAULT SEMENTARA F-01/P-04 = A
| Cara kirim | `harga_dibayar` (D) | `jenis_harga` |
|---|---|---|
| Antar rumah | `H(INDIVIDU, SATUAN)` saat checkout | `SATUAN` (berubah ke `GRUP` saat cut-off bila tier berlaku) |
| Drop point, syarat Mitra terpenuhi [P-05] dan sel Mitra berharga | `H(MITRA, SATUAN)` | `MITRA` |
| Drop point, syarat tidak terpenuhi / Mitra kosong | `H(INDIVIDU, SATUAN)` + info `MITRA_TIDAK_TERSEDIA` | `SATUAN` |

- Syarat Mitra dinilai per **pesanan** drop point: `Σ H(INDIVIDU, SATUAN) × qty` seluruh baris pesanan (sebelum promo, tanpa ongkir) `≥ syarat_mitra_min_nilai`. Kosong = tidak pernah terpenuhi [P-05].
- Checkout menampilkan **"Bayar sekarang"** dan **"Perkiraan kembali ke saldo"** = `(D − harga_aktif_grup_saat_ini) × qty` bila grup AKTIF; bila belum aktif: "bila grup aktif & mencapai {tier}: ± Rp…" (perkiraan, bukan janji; S&K §4.4–4.5).
- Snapshot per baris pesanan: `modal_snapshot`, `harga_dibayar`, `kode_tier`, `level`, `id_versi_harga`, `potongan_baris`, `subsidi_ongkir_baris` (ADR §5.3).

### 5.3 Harga final saat cut-off (T-002 §6 langkah 7–8)
Dihitung per peserta dengan tabel harga yang dihitung ulang dari **modal saat cut-off** (`Mc`), tier dari `snapshot_moq` dan qty terhitung **sebelum** alokasi [F-09]:
```
kandidat = { D }
akun < 3, peserta LANJUT_SATUAN (calon GAGAL_LANJUT_SATUAN) → kandidat += H_c(INDIVIDU, SATUAN)   // harga grup tidak berlaku
akun ≥ 3 (calon HARGA_TERKUNCI) → kandidat += H_c(INDIVIDU, tier_tercapai)   (G0 bila g0_aktif, selain itu SATUAN, bila belum ada G1/G2)
jenis_harga = MITRA ∧ syarat Mitra masih terpenuhi saat cut-off → kandidat += H_c(MITRA, SATUAN)
F = min(kandidat)
```
- PG-7: `F ≤ D` otomatis. Bila semua harga live > D (modal naik), `F = D` dan peserta **tidak** ditagih tambahan [P-19].
- PG-1 saat cut-off berlaku sama untuk HARGA_TERKUNCI **dan** GAGAL_LANJUT_SATUAN (peserta lanjut harga satuan tetap lewat engine harga + pagar ≥ modal): `D ≥ Mc` wajib untuk setiap peserta yang akan dikirim; bila gagal → grup **DITAHAN** (T-002 G10) [P-09]. Tidak ada kredit, refund, atau picking sebelum admin menyelesaikan (G11 → HARGA_TERKUNCI, G11b → GAGAL_LANJUT_SATUAN).
- Sel live yang gagal pagar saat cut-off (mis. margin kosong setelah diedit) tidak masuk `kandidat`; bila tier tercapai tak punya harga valid → DITAHAN dengan `HARGA_TIDAK_TERSEDIA`.
- Pembatalan baris yang membuat pesanan drop point turun di bawah syarat Mitra → kandidat Mitra hilang, tetapi `F ≤ D` tetap berlaku (tidak ditagih tambahan) [F-12].

### 5.4 Selisih → saldo (rumus integer)
Per baris peserta. `q` = qty_pesan, `a` = qty_teralokasi, `P` = potongan_baris (diskon, §6), `S` = subsidi_ongkir_baris, `Mc` = modal cut-off.
```
B   = D × q − P                                   // nilai barang bersih yang sudah dibayar
P_a = bagiBawah(P × a, q)                          // bagian potongan untuk unit teralokasi
S_a = (a > 0) ? S : 0                              // ongkir tidak dihitung ulang [F-20]
T   = F × a − P_a                                  // kewajiban barang bersih setelah harga final
T'  = max(T, Mc × a + S_a)                         // pagar PG-4 saat cut-off [P-23]
jika T' > D × a − P_a  → grup DITAHAN (DI_BAWAH_MODAL)  [P-09]
Kredit saldo K = B − T'                            // ≥ 0; satu entri ledger kunci `selisih:{grup_id}:{peserta_id}`
jika T' > T → info SELISIH_DIBATASI_PAGAR
```
- Tanpa promo (`P = S = 0`): `K = (D − F) × a + D × (q − a)` — identik dengan rumus T-002 §1 (selisih + refund unit tak teralokasi).
- Peserta COD: tidak ada dana di muka → tidak ada kredit; tagih saat antar = `T' + ongkir_ditagih`.
- Peserta dengan `dana_ditahan = true` (akun dibekukan, T-002 F-10): engine tetap menghitung `K`, tetapi job cut-off **tidak** menulis kredit ke ledger; nilai `K` disimpan pada peserta untuk diselesaikan admin.
- `P_a` dibulatkan ke bawah: kewajiban `T` bisa lebih besar ≤ Rp1 dan kredit lebih kecil ≤ Rp1 per baris (melindungi pagar modal). Dicatat sebagai asumsi di P-15.
- Contoh ilustrasi (bukan harga): lihat TC-HE-35 s.d. TC-HE-39.

### 5.5 Perubahan modal saat grup berjalan (selaras T-002 B-14) — DEFAULT SEMENTARA F-08/P-08 = LIVE
1. `ModalBerubah` dari `InventorySource` → `hitungTabelHarga` ulang → `id_versi_harga` baru → kartu & detail berubah bersamaan (PG-6).
2. Peserta baru membayar harga live terbaru; `harga_dibayar` peserta lama tidak berubah.
3. Bila tabel baru gagal pagar → produk tidak tayang untuk peserta **baru**; grup yang berjalan tetap sampai cut-off dan dievaluasi di §5.3.
4. `MARGIN_MENIPIS` dikirim ke admin bila `(D_min_grup − modal_baru) × 10000 < ambang_margin_menipis_bp × D_min_grup` (kosong = tidak ada alert).
5. Simulasi untuk admin: `simulasiPerubahanModal` (§7) menampilkan dampak modal −20 %, −10 %, +10 %, +20 % terhadap jumlah produk tidak tayang & grup berisiko DITAHAN, tanpa mengubah data.

---

## 6. Diskon & gratis ongkir

### 6.1 Urutan penerapan per pesanan (checkout dan cut-off memakai urutan sama)
1. Harga dibayar per baris dari §5.2 → `nilai_bruto_baris = D × q`.
2. Pilih diskon yang **berlaku** per baris (produk / kategori / level / periode / zona / kuota). Tidak menumpuk: pilih satu dengan potongan terbesar yang lolos PG-4 [P-15].
3. Hitung `P` (potongan baris): persen → `bulat(D × bp / 10000) × q` dengan pembulatan `pembulatan_diskon` (bawaan ke bawah); nominal per unit → `nilai × q`; nominal per baris → `nilai`. `P ≤ nilai_bruto_baris`.
4. Cek PG-4 tanpa ongkir: `D × q − P ≥ M × q`. Gagal → diskon baris itu tidak diterapkan (runtime) [P-07]; peringatan ke admin.
5. Ongkir pesanan dari T-031 (`ongkir`). Drop point → 0.
6. Evaluasi gratis ongkir: syarat minimal belanja memakai `Σ(D × q − P)` (bawaan `SESUDAH_DISKON` [P-13]), zona, periode, level.
7. Subsidi `S_total` = ongkir yang digratiskan (penuh atau sebagian sesuai aturan). Alokasikan ke baris (§6.2).
8. Cek PG-4 lengkap per baris: `D × q − P − S ≥ M × q`. Ada baris gagal → **gratis ongkir tidak diterapkan** untuk pesanan ini, pengguna melihat "Gratis ongkir tidak berlaku untuk pesanan ini", ongkir normal ditagih; peringatan `GRATIS_ONGKIR_DI_BAWAH_MODAL` ke admin.
9. Total tagihan = `Σ(D × q − P) + ongkir − S_total`; pemakaian saldo setelahnya (T-005). Batas COD dibandingkan sesuai P-18.

### 6.2 Alokasi subsidi ongkir ke baris (bawaan `PROPORSIONAL_NILAI`) [P-20]
- Bobot baris `w_i = D_i × q_i − P_i`. `S_i = bagiBawah(S_total × w_i, Σw)`; sisa `S_total − ΣS_i` dibagikan Rp1 per baris ke baris dengan sisa pecahan terbesar (metode sisa terbesar; seri → urutan id baris).
- `ΣS_i = S_total` selalu (diuji). Bila `Σw = 0` → gratis ongkir tidak diterapkan.

### 6.3 Validasi aturan promo saat disimpan admin (T-032)
- Untuk setiap satuan jual dalam cakupan aturan dan setiap level/tier yang bisa terkena: hitung potongan **terburuk** (harga sel terendah, qty minimum aturan). Ada yang melanggar `H − potongan_unit ≥ M` → aturan **ditolak** dengan `PROMO_DI_BAWAH_MODAL` + daftar SKU terdampak (keputusan #4: "menolak dan memberi peringatan").
- Gratis ongkir tidak bisa divalidasi penuh saat simpan (ongkir bergantung jarak/berat); panel menampilkan peringatan "akan dicek per pesanan" dan PG-4 ditegakkan di langkah 8 §6.1.
- Aturan yang lolos saat simpan tetapi kemudian melanggar karena modal naik → runtime langkah 4/8 + entri di laporan admin harian.
- Kuota diskon dikurangi hanya ketika pesanan menjadi LUNAS/COD_TERKONFIRMASI, dalam transaksi dengan kunci baris (ADR §3.2); pengembalian kuota saat batal mengikuti T-032.

---

## 7. Antarmuka modul (`packages/domain/harga`, fungsi murni)

Semua fungsi **murni**: tanpa I/O, tanpa jam sistem (waktu masuk sebagai argumen), deterministik. Adapter DB/`InventorySource` memanggilnya.

```ts
type Rupiah = number & { readonly __brand: 'Rupiah' };       // integer aman, ≥ 0 kecuali disebut lain
type BasisPoin = number & { readonly __brand: 'BasisPoin' }; // integer ≥ 0
type Level = 'INDIVIDU' | 'MITRA' | 'FRANCHISE';
type KodeTier = 'SATUAN' | 'G0' | 'G1' | 'G2';
type MarginSpec = { jenis: 'BP'; nilai: BasisPoin } | { jenis: 'NOMINAL'; nilai: Rupiah };
type Pembulatan = { mode: 'ATAS' | 'TERDEKAT' | 'BAWAH'; kelipatan: Rupiah };

interface DefinisiTier { kode: KodeTier; aktif: boolean; moq: number | null }   // SATUAN: moq = 1; G0: moq = null, aktif = g0_aktif
interface InputHargaSatuanJual {
  idSatuanJual: string;
  kodeKategori: string;
  namaProduk: string;
  modalSumber: { nilai: Rupiah | null; waktuData: Date | null };
  konversi: { isiJual: number; isiSumber: number };
  tier: DefinisiTier[];
  margin: Partial<Record<Level, Partial<Record<KodeTier, MarginSpec | null>>>>;
}
interface KonfigurasiHarga { /* kunci §2.3, termasuk levelAktif: Level[] (Fase 1: INDIVIDU, MITRA) */ }

type KodeError = /* §4.3 */ string;
interface Masalah { kode: KodeError; level?: Level; tier?: KodeTier; detail?: Record<string, unknown> }
type AlasanTidakTayang =
  | 'KATEGORI_DILARANG' | 'MODAL_KOSONG' | 'MODAL_TIDAK_VALID' | 'MODAL_KEDALUWARSA'
  | 'KONVERSI_TIDAK_VALID' | 'MOQ_TIDAK_VALID' | 'MARGIN_KOSONG' | 'MARGIN_TIDAK_VALID'
  | 'HARGA_DI_BAWAH_MODAL' | 'PAGAR_TIER_DILANGGAR' | 'PAGAR_LEVEL_DILANGGAR'
  | 'MITRA_WAJIB_KOSONG' | 'PERLU_TINJAUAN_KATEGORI' | 'NONAKTIF_ADMIN';

interface SelHarga {
  level: Level; tier: KodeTier; moq: number | null;
  margin: MarginSpec | null; marginRp: Rupiah | null; harga: Rupiah | null;
  masalah: Masalah[];
}
interface TabelHarga {
  idSatuanJual: string; modal: Rupiah | null; idVersiHarga: string;
  sel: SelHarga[]; tayang: boolean; alasanTidakTayang: AlasanTidakTayang[];
  peringatan: Masalah[];
}

function modalPerSatuanJual(modalSumber: Rupiah, isiJual: number, isiSumber: number): Hasil<Rupiah>;
function hitungHargaSel(modal: Rupiah, margin: MarginSpec, p: Pembulatan): Hasil<Rupiah>;
function hitungTabelHarga(input: InputHargaSatuanJual, k: KonfigurasiHarga, sekarang: Date): TabelHarga;
function validasiPagar(t: TabelHarga, k: KonfigurasiHarga): Masalah[];           // PG-1..PG-3
function statusTayang(t: TabelHarga, k: KonfigurasiHarga): { tayang: boolean; alasan: AlasanTidakTayang[] };

interface KonteksTampil {
  statusGrup: 'TIDAK_ADA' | 'DIBUKA' | 'BELUM_AKTIF' | 'AKTIF' | 'TERKUNCI';
  qtyTerhitung: number; snapshotMoq?: Partial<Record<KodeTier, number>>; hargaFinalGrup?: Rupiah;
  promoBerlaku?: AturanPromo[];
}
interface TampilanHarga {
  idVersiHarga: string; hargaAktif: Rupiah; hargaCoret: Rupiah | null; tierAktif: KodeTier;
  tierBerikut: { tier: KodeTier; harga: Rupiah; kurangQty: number } | null;
  hargaMitraDropPoint: Rupiah | null;
  promo: { label: string; hargaSetelahPromo: Rupiah; berlakuSampai: Date | null } | null; // terpisah
}
function tampilanHarga(t: TabelHarga, ktx: KonteksTampil, k: KonfigurasiHarga): Hasil<TampilanHarga>;

function hargaDibayar(t: TabelHarga, caraKirim: 'ANTAR' | 'DROP_POINT', syaratMitraTerpenuhi: boolean)
  : Hasil<{ harga: Rupiah; jenis: 'SATUAN' | 'MITRA'; info: Masalah[] }>;
function syaratMitraTerpenuhi(baris: { hargaSatuan: Rupiah; qty: number }[], k: KonfigurasiHarga): boolean;

interface BarisCheckout { idBaris: string; d: Rupiah; qty: number; modal: Rupiah; beratGram: number; kandidatDiskon: AturanDiskon[] }
interface HasilCheckoutHarga {
  baris: { idBaris: string; potongan: Rupiah; subsidiOngkir: Rupiah; diskonDipakai: string | null }[];
  ongkir: Rupiah; subsidiOngkirTotal: Rupiah; totalTagihan: Rupiah;
  pesanUntukPengguna: Masalah[]; peringatanAdmin: Masalah[];
}
function hitungRingkasanCheckout(baris: BarisCheckout[], ongkir: Rupiah,
  gratisOngkir: AturanGratisOngkir[], k: KonfigurasiHarga, sekarang: Date): HasilCheckoutHarga;
function alokasiSubsidi(sTotal: Rupiah, bobot: { idBaris: string; w: Rupiah }[]): Map<string, Rupiah>;
function validasiAturanPromo(aturan: AturanDiskon, terdampak: TabelHarga[], k: KonfigurasiHarga): Masalah[];

interface InputFinal {
  d: Rupiah; q: number; a: number; potongan: Rupiah; subsidi: Rupiah; modalCutoff: Rupiah;
  hasilGrup: 'HARGA_TERKUNCI' | 'GAGAL_LANJUT_SATUAN'; tierTercapai: KodeTier | null;
  jenisHarga: 'SATUAN' | 'MITRA' | 'GRUP'; syaratMitraMasihTerpenuhi: boolean; tabelCutoff: TabelHarga;
  danaDitahan: boolean;
}
type HasilFinal =
  | { status: 'TERKUNCI'; hargaFinal: Rupiah; kewajibanBersih: Rupiah; kreditSaldo: Rupiah;
      tulisKreditKeLedger: boolean /* false bila danaDitahan */; info: Masalah[] }
  | { status: 'DITAHAN'; alasan: 'DI_BAWAH_MODAL' | 'HARGA_TIDAK_TERSEDIA' };
function hitungHargaFinal(x: InputFinal): HasilFinal;

function simulasiPerubahanModal(tabel: InputHargaSatuanJual[], deltaBp: number[], k: KonfigurasiHarga, sekarang: Date)
  : { deltaBp: number; tidakTayang: number; peringatan: number }[];

type Hasil<T> = { ok: true; nilai: T; peringatan: Masalah[] } | { ok: false; masalah: Masalah[] };
```

Aturan implementasi:
- `idVersiHarga` = hash stabil (mis. SHA-256 terpotong) atas input + konfigurasi yang relevan; input sama → id sama (dites).
- Adapter menyimpan hasil `hitungTabelHarga` ke tabel `harga_terhitung` (cache materialisasi) dalam transaksi yang sama dengan perubahan modal/margin; katalog membaca cache, bukan menghitung per request.
- API kartu (`T-025`) dan detail (`T-028`) **wajib** memanggil `tampilanHarga` dengan `TabelHarga` dari cache yang sama; tidak ada endpoint lain yang membentuk harga.
- `HasilFinal` dipakai job cut-off T-023; seluruh penulisan hasil dalam satu transaksi (T-002 §6 langkah 9).

---

## 8. Validasi panel admin & import CSV

### 8.1 Panel admin harga (T-037)
- Semua field margin & MOQ tampil **kosong** untuk produk baru; tidak ada nilai bawaan, tidak ada "salin dari produk lain" otomatis.
- Input margin: pilih jenis (`%` atau `Rp`) sesuai `jenis_margin_diizinkan`; persen maksimal 2 desimal.
- Tier: sakelar "Aktifkan harga grup dasar (G0)" (= `g0_aktif`, bawaan mati, tanpa field MOQ); field MOQ hanya untuk G1/G2.
- Pratinjau langsung (memanggil `hitungTabelHarga` di server): modal per satuan, harga per sel, pelanggaran pagar, status tayang + alasan, pratinjau kartu & detail (PG-6).
- Simpan **ditolak** bila ada error (§4.3 jenis error); peringatan boleh disimpan dengan konfirmasi eksplisit yang dicatat di `log_admin`.
- Mengosongkan margin sel wajib diizinkan (produk menjadi tidak tayang) dengan konfirmasi "Produk akan berhenti tayang; grup berjalan dievaluasi saat cut-off".
- Hak akses: hanya peran `owner` dan `admin_harga` (ADR §7).

### 8.2 Import CSV (T-038)
Satu baris = satu satuan jual. Encoding UTF-8, pemisah koma atau titik koma (dideteksi dari header). Kolom:

| Kolom | Wajib | Format | Catatan |
|---|---|---|---|
| `sku_sumber` | ya | teks | Kunci ke `InventorySource` |
| `kode_satuan_jual` | ya | teks unik per SKU | Kunci upsert |
| `nama`, `kategori`, `subkategori` | ya | teks | Kategori dicek §8.3 |
| `isi_jual`, `isi_sumber` | ya | integer > 0 | §3.3 |
| `berat_gram` | ya | integer > 0 | Untuk ongkir (T-031) |
| `modal_sumber` | tidak | Rupiah | Hanya `LocalInventory`; diisi saat `gudang` → `MODAL_DIKELOLA_GUDANG` [P-25] |
| `g0_aktif` | tidak | `ya`/`tidak` | Kosong pada produk baru = `tidak`; G0 tidak punya kolom MOQ |
| `moq_g1`, `moq_g2` | tidak | integer ≥ 2 | Kosong = tier tidak aktif |
| `margin_individu_satuan`, `margin_individu_g0`, `margin_individu_g1`, `margin_individu_g2` | tidak | lihat bawah | **Boleh kosong** |
| `margin_mitra_satuan` | tidak | lihat bawah | Boleh kosong [P-06] |
| `margin_franchise_satuan` | tidak | lihat bawah | Disiapkan; divalidasi, tidak dipakai Fase 1; pelanggaran pagar = peringatan `PAGAR_LEVEL_NONAKTIF` |
| `aktif` | tidak | `ya`/`tidak` | `tidak` → `NONAKTIF_ADMIN` |

Format sel margin (tanpa tebak-tebakan):
- Persen: angka diakhiri `%`, desimal koma atau titik, maksimal 2 desimal → basis poin (`12,5%` → 1250).
- Nominal: diawali `Rp`, digit dengan pemisah ribuan titik opsional dalam kelompok 3 (`Rp1.500` → 1500); koma ditolak.
- Angka polos tanpa `%`/`Rp` → `MARGIN_FORMAT`. Tanda minus → `MARGIN_NEGATIF`.
- Sel kosong pada produk **baru** = margin kosong. Pada produk **lama** = tidak mengubah nilai tersimpan; token `HAPUS` = mengosongkan [P-11].

Proses:
1. Validasi header (kolom tak dikenal → error file; kolom hilang → error file).
2. Validasi per baris secara independen; laporan per baris: nomor baris, `kode_satuan_jual`, status (`DIIMPOR` / `DIIMPOR_TIDAK_TAYANG` / `DITOLAK`), daftar kode §4.3, alasan tidak tayang.
3. Mode `pratinjau` (default) tidak menulis apa pun; mode `terapkan` menulis semua baris lolos dalam **satu transaksi** + `log_admin` (ringkasan + file hash). Baris `DITOLAK` tidak ditulis.
4. Duplikat `kode_satuan_jual` dalam satu file → semua baris duplikat ditolak.
5. Batas ukuran file & jumlah baris = konfigurasi teknis T-038.
6. Template CSV contoh di repo **tanpa** angka modal/margin (sel kosong) dan tanpa baris rokok/bir (backlog aturan).

### 8.3 Kategori terlarang (keputusan #7)
- Kode kategori dalam `kategori_terlarang` → `KATEGORI_DILARANG`; baris ditolak, tidak tersimpan sama sekali. Panel menolak pembuatan kategori/produk tersebut.
- Pemeriksaan nama produk di kategori lain memakai dua daftar konfigurasi:
  - `kata_kunci_terlarang` (mis. rokok, kretek, cerutu, tembakau, vape, bir, beer, alkohol, filter);
  - `frasa_pengecualian` (mis. "bir pletok", "kopi filter", "filter air", "root beer").
- Pencocokan: nama dinormalisasi (huruf kecil, tanda baca → spasi, spasi ganda dirapatkan), frasa pengecualian dihapus lebih dulu, lalu kata kunci dicocokkan sebagai **kata utuh** (batas kata, bukan potongan: "Birthday" tidak cocok dengan "bir").
- Ada kecocokan → **tahan untuk ditinjau, bukan tolak otomatis**: baris tetap disimpan (laporan `DIIMPOR_TIDAK_TAYANG`), alasan `PERLU_TINJAUAN_KATEGORI`, produk tidak tayang sampai admin `owner`/`admin_harga` memindahkan kategori atau menandai "bukan produk terlarang" (dicatat di `log_admin` dengan alasan). Tanda tinjauan hilang bila nama diubah.
- Cakupan persis daftar (minuman beralkohol lain, rokok elektrik) [P-24].
- Seed (T-013) tidak memuat kategori terlarang; tes memastikan.

---

## 9. Matriks kasus uji (unit/properti T-020, skenario API T-044)

Konvensi: **semua angka adalah ilustrasi, bukan harga**. `M` = modal per satuan jual. Kecuali ditulis lain: pembulatan `ATAS`, `K = 1`, `mode_pagar_level = KETAT`, konfigurasi lain = bawaan §2.3.

| ID | Input (ilustrasi) | Hasil diharapkan |
|---|---|---|
| TC-HE-01 | Modal sumber 12.001, `isi_sumber` 12, `isi_jual` 1 | `M = 1.001` (dibulatkan ke atas) |
| TC-HE-02 | Modal sumber 1.000, `isi_jual` 24, `isi_sumber` 12 (paket 2 karton) | `M = 2.000` |
| TC-HE-03 | `isi_sumber = 0` | `KONVERSI_TIDAK_VALID`; tidak tayang |
| TC-HE-04 | `M = 1.000`, margin BP 1.234 | `margin_rp = 124` (123,4 → atas); harga 1.124 |
| TC-HE-05 | Sama dengan TC-HE-04, `K = 100`, `ATAS` | Harga 1.200 |
| TC-HE-06 | `M = 1.010`, margin nominal 40, `K = 100`, `BAWAH` | Mentah 1.050 → 1.000 < M → 1.100 + `PEMBULATAN_DINAIKKAN` |
| TC-HE-07 | `K = 100`, `TERDEKAT`, mentah 1.150 / 1.149 | 1.200 / 1.100 (keduanya ≥ M bila M ≤ 1.100) |
| TC-HE-08 | Modal kosong | Tidak tayang `MODAL_KOSONG`; tidak ada harga 0 |
| TC-HE-09 | Modal 0 dari Gudang | Tidak tayang `MODAL_TIDAK_VALID` |
| TC-HE-10 | `waktuData` lebih tua dari `batas_usia_modal_detik` | Tidak tayang `MODAL_KEDALUWARSA` |
| TC-HE-11 | Sel (INDIVIDU, SATUAN) kosong, sel lain terisi | Tidak tayang `MARGIN_KOSONG` |
| TC-HE-12 | G1 aktif dengan MOQ terisi tetapi margin G1 kosong | Tidak tayang `MARGIN_KOSONG` (tier=G1) |
| TC-HE-13 | Margin −1 di panel | Simpan ditolak `MARGIN_NEGATIF` |
| TC-HE-14 | Margin 0 | Harga = M; peringatan `MARGIN_NOL`; dengan `margin_nol = TOLAK` → ditolak |
| TC-HE-15 | Harga SATUAN 1.150, G1 1.200 (`M = 1.000`) | `PAGAR_TIER_DILANGGAR`; tidak tayang |
| TC-HE-16 | SATUAN 1.200, G1 1.200, G2 1.100 | Lolos + `TIER_TANPA_MANFAAT` (SATUAN–G1) |
| TC-HE-17 | MOQ G1 = 6, G2 = 6 / G1 = 1 | `MOQ_TIDAK_VALID` |
| TC-HE-18 | INDIVIDU: SATUAN 1.300, G2 1.100; MITRA 1.150; `KETAT` | `PAGAR_LEVEL_DILANGGAR` (1.150 > min individu 1.100) |
| TC-HE-19 | Data TC-HE-18 dengan `PER_TIER` | Lolos (MITRA SATUAN 1.150 ≤ INDIVIDU SATUAN 1.300) |
| TC-HE-20 | Franchise 1.200 > Mitra 1.100; `levelAktif = {INDIVIDU, MITRA}` | Peringatan `PAGAR_LEVEL_NONAKTIF`; produk **tetap tayang**. Dengan FRANCHISE ditambahkan ke `levelAktif` → `PAGAR_LEVEL_DILANGGAR`, tidak tayang |
| TC-HE-21 | Mitra kosong, `mitra_wajib_untuk_tayang = false` | Tayang; drop point → harga satuan + `MITRA_TIDAK_TERSEDIA` |
| TC-HE-22 | Margin 15% (BP) & nominal pada sel berbeda produk sama | Keduanya dihitung benar; `jenis_margin_diizinkan = {BP}` → sel nominal `MARGIN_FORMAT` |
| TC-HE-23 | Kartu & detail untuk konteks grup sama | `idVersiHarga`, `hargaAktif`, `hargaCoret` identik |
| TC-HE-24 | Promo aktif pada produk | `hargaAktif` tidak berubah; `promo.hargaSetelahPromo` di field terpisah |
| TC-HE-25 | Grup BELUM_AKTIF | `hargaAktif = H(INDIVIDU,SATUAN)`, `hargaCoret = null` |
| TC-HE-26 | Grup AKTIF, tier G1 tercapai, `snapshotMoq.G2 = 12`, qty 8 | `hargaAktif = H(G1)`, `hargaCoret = H(SATUAN)`, `tierBerikut = G2, kurangQty 4` |
| TC-HE-27 | Diskon 10% (1.000 BP) pada `D = 1.199`, q = 1 | `P = 119` (119,9 → bawah) |
| TC-HE-28 | Simpan aturan diskon nominal 300/unit; satu SKU dalam cakupan punya H 1.200, M 1.000 | Ditolak `PROMO_DI_BAWAH_MODAL` + daftar SKU |
| TC-HE-29 | Aturan lolos saat simpan, modal naik sebelum checkout | Diskon tidak diterapkan di baris itu; peringatan admin |
| TC-HE-30 | Dua aturan diskon berlaku, `diskon_menumpuk = false` | Hanya potongan terbesar yang lolos PG-4 |
| TC-HE-31 | Gratis ongkir, ongkir 900, dua baris bobot 2.000 & 1.000 | `S = 600` & `300`; Σ = 900 |
| TC-HE-32 | Ongkir 100, tiga baris bobot sama | Alokasi 34, 33, 33 (sisa terbesar, seri → id baris) |
| TC-HE-33 | Gratis ongkir; satu baris `D×q − P − S < M×q` | Gratis ongkir batal untuk pesanan; ongkir normal ditagih; pesan ke pengguna + `GRATIS_ONGKIR_DI_BAWAH_MODAL` |
| TC-HE-34 | Minimal belanja 5.000; bruto 5.200, diskon 300 | Bawaan `SESUDAH_DISKON` → 4.900, gratis ongkir tidak berlaku |
| TC-HE-35 | Cut-off: D 1.200, F 1.100, q = a = 6, P = S = 0, Mc 1.000 | K = 600; WA-07 menampilkan 600 |
| TC-HE-36 | D 1.200, F 1.100, q 4, a 3, P = S = 0, Mc 1.000 | T' = 3.300; K = 4.800 − 3.300 = 1.500 (= 100×3 + 1.200×1) |
| TC-HE-37 | D 1.200, q = a = 6, P 600, S 0, F 1.050, Mc 1.000 | T = 5.700 → T' = 6.000; K = 600 (bukan 900) + `SELISIH_DIBATASI_PAGAR` |
| TC-HE-38 | Mc 1.250 > D 1.200 saat cut-off | `DITAHAN` (`DI_BAWAH_MODAL`); tidak ada kredit |
| TC-HE-39 | Modal naik, H_c(tier) 1.250 > D 1.200, Mc 1.100 | F = D = 1.200; K = 0; tidak ditagih tambahan |
| TC-HE-40 | Akun 2 < 3, peserta LANJUT_SATUAN: D 1.200, H_c(SATUAN) 1.150, q = a = 2, P = S = 0, Mc 1.000 | Grup GAGAL_LANJUT_SATUAN; F = 1.150; K = 100. Varian Mc 1.250 → DITAHAN |
| TC-HE-41 | Grup AKTIF, qty terhitung 4 < MOQ G1 6, `g0_aktif = tidak`; D 1.200, H_c(SATUAN) 1.200, q = a = 2, P = S = 0, Mc 1.000 | F = 1.200; K = 0; `tierTercapai = SATUAN` |
| TC-HE-41b | Sama dengan TC-HE-41 tetapi `g0_aktif = ya`, H_c(G0) 1.150 | F = 1.150; K = 100 |
| TC-HE-42 | Drop point, syarat Mitra terpenuhi, D = H(MITRA) 1.050, tier grup 1.100 | F = 1.050; pagar KETAT terjaga |
| TC-HE-43 | Drop point, baris lain batal → syarat Mitra gagal di cut-off | Kandidat Mitra hilang; F = min(D, tier) ≤ D; tidak ditagih tambahan |
| TC-HE-44 | Peserta COD: D 1.200, F 1.100, q = a = 3, P = S = 0, Mc 1.000, ongkir 500 | Tidak ada kredit; T' = 3.300; tagih saat antar = 3.300 + 500 = 3.800 |
| TC-HE-45 | `syarat_mitra_min_nilai` kosong | Harga Mitra tidak pernah berlaku; semua drop point bayar harga satuan |
| TC-HE-46 | CSV baris kategori rokok / bir | `DITOLAK` `KATEGORI_DILARANG`; tidak tersimpan |
| TC-HE-47 | CSV nama "Kretek Mild" di kategori Makanan | `DIIMPOR_TIDAK_TAYANG`, alasan `PERLU_TINJAUAN_KATEGORI`; tayang hanya setelah admin menandai |
| TC-HE-47b | CSV nama "Bir Pletok 250 ml", "Kopi Filter 200 g", "Kue Birthday" | Tidak ada hit (pengecualian / bukan kata utuh); status normal |
| TC-HE-48 | CSV margin `12.5` / `12,5%` / `12,345%` / `Rp1.500` / `Rp1,5` | `MARGIN_FORMAT` / 1250 BP / `MARGIN_FORMAT` / 1500 / `MARGIN_FORMAT` |
| TC-HE-49 | CSV produk lama, sel margin kosong / `HAPUS` | Nilai lama tetap / sel dikosongkan → tidak tayang |
| TC-HE-50 | CSV `modal_sumber` terisi saat `INVENTORY_SOURCE=gudang` | `MODAL_DIKELOLA_GUDANG` untuk baris itu |
| TC-HE-51 | CSV `pratinjau` lalu `terapkan` dengan 1 baris rusak dari 10 | Pratinjau tanpa tulis; terapkan menulis 9 baris dalam satu transaksi |
| TC-HE-52 | Modal sumber mendekati batas integer aman, BP besar | `ANGKA_OVERFLOW`, bukan hasil salah |
| TC-HE-53 | Properti (acak ribuan input valid) | Selalu: PG-1, PG-3, PG-7, `ΣS_i = S_total`, `K ≥ 0`, `T' ≥ Mc × a` |
| TC-HE-54 | `hitungTabelHarga` dipanggil dua kali dengan input sama | Hasil & `idVersiHarga` identik (fungsi murni) |
| TC-HE-55 | `simulasiPerubahanModal` ±10 %, ±20 % | Mengembalikan 4 baris ringkasan; data tidak berubah |
| TC-HE-56 | CSV `g0_aktif = ya`, `margin_individu_g0` kosong | `DIIMPOR_TIDAK_TAYANG`, `MARGIN_KOSONG` (tier=G0) |
| TC-HE-57 | G0 aktif: SATUAN 1.200, G0 1.250, G1 1.100 | `PAGAR_TIER_DILANGGAR` (r(SATUAN) < r(G0) tetapi lebih murah) |
| TC-HE-58 | MOQ diisi untuk G0 lewat panel/API | `MOQ_TIDAK_VALID` |
| TC-HE-59 | Peserta `dana_ditahan`, kasus TC-HE-35 | `kreditSaldo = 600`, `tulisKreditKeLedger = false`; tidak ada entri ledger |

---

## 10. Keselarasan dengan dokumen lain & catatan untuk T-020

| # | Temuan / keselarasan | Dokumen | Tindakan |
|---|---|---|---|
| S-01 | T-002 §1 "Selisih" memakai `harga dibayar × qty tidak teralokasi`; dengan promo, refund harus dari nilai **bersih** yang benar-benar dibayar | T-002 | §5.4 memakai `B = D×q − P`; tanpa promo hasil sama persis. Usul T-002 merujuk §5.4 |
| S-02 | T-002 B-15 & F-12 menyebut `min(dibayar, tier, Mitra)`; pagar level KETAT membuat Mitra selalu ≤ tier grup individu | T-002 | Konsisten; mode `PER_TIER` [P-22] membuat `min` tetap benar |
| S-03 | ADR §3.3 menulis status grup `TERBUKA → DITUTUP`; T-002 memakai `DIBUKA … CUT_OFF` | ADR / T-002 | Dokumen ini memakai istilah T-002 |
| S-04 | Kunci ledger selisih | ADR §5.2 / T-002 v0.2 | Selaras: ketiga dokumen memakai `selisih:{grup_id}:{peserta_id}` |
| S-07 | T-002 v0.2 menambah status GAGAL_LANJUT_SATUAN dan flag `dana_ditahan` | T-002 | §5.3, §5.4, §7 (`InputFinal.hasilGrup`, `danaDitahan`) disesuaikan |
| S-05 | S&K §4.5 "dikirim dengan harga yang sudah Anda bayar" belum menyebut grup ditahan bila modal melewati harga dibayar | S&K | Terkait P-09; teks S&K disesuaikan setelah keputusan (#5) |
| S-06 | `keputusan.md` #4 "tingkat Mitra bila total memenuhi syarat" tanpa definisi syarat | keputusan | P-05; bawaan aman: syarat kosong = Mitra tidak berlaku |

Catatan T-020: tes properti wajib (ADR §5.3); tes integrasi DB memastikan setiap `CHECK` §4.2 benar-benar menolak; tidak ada angka modal/margin nyata di fixture (pakai angka ilustrasi seperti §9).

---

## 11. Keputusan terbuka untuk manusia

Semua **DEFAULT SEMENTARA** adalah **asumsi kerja agar T-020/T-032/T-037/T-038 bisa dibangun dan dites, bukan keputusan**.
Semua dibuat sebagai konfigurasi (§2.3) atau cabang kode yang bisa diganti tanpa migrasi. Keputusan final ditulis manusia di `project-specs/keputusan.md`.

### 11.1 Butir lama (ID sudah ada di `keputusan-terbuka.md`)
| ID | Topik | Opsi | Rekomendasi agen | DEFAULT SEMENTARA (asumsi) | Pemilik |
|---|---|---|---|---|---|
| P-01 | Margin persen atau nominal; per produk atau per level; presisi | A) persen saja; B) nominal saja; C) keduanya per sel. Presisi 0,01 % / 0,1 % / 1 % | C dengan presisi 0,01 %. **Penting:** "persen" di sini = markup atas modal (`harga = modal × (1 + p)`), bukan margin kotor atas harga jual; markup 25 % ≈ margin kotor 20 %. Efan perlu memastikan angka yang diisi memakai definisi ini | C; BP integer (0,01 %); margin diisi per sel (satuan jual × level × tier) | Efan |
| P-02 | Mode pembulatan & kelipatan K (= H6) | ATAS / TERDEKAT / BAWAH; K = 1, 50, 100, 500 … | ATAS ke kelipatan yang dipilih Efan (tidak pernah di bawah modal, tidak menggerus margin) | `ATAS`, `K = 1`; modal per satuan dibulatkan ke atas | Efan |
| P-03 | Tier dihitung per unit atau per akun; pembeli 1 pcs dihitung (= F-04) | A) total pcs semua peserta terhitung; B) pcs per akun | A (sesuai konsep beli bersama) | A; pembeli 1 pcs ikut dihitung; G0 opsional lewat `g0_aktif` | Efan + Randy |
| P-04 | Harga dibayar saat ikut grup (= F-01) | A) harga satuan, selisih ke saldo; B) harga tier saat ini, NEKAT menanggung; C) tier saat ini, tagih kekurangan | A untuk pilot (tidak pernah menagih tambahan); uji konversi bersama UX Researcher | A (§5.2) | Efan + Joseph |
| P-05 | Syarat "total memenuhi syarat" untuk harga Mitra di drop point — **WAJIB DIISI SEBELUM PILOT** (tanpa nilai ini drop point tidak pernah mendapat harga Mitra, sehingga keputusan #4 tidak berjalan) | A) minimal nilai pesanan; B) minimal qty per produk; C) minimal total drop point per slot | A: mudah dijelaskan & dihitung per pesanan | A dengan `syarat_mitra_min_nilai` **kosong = Mitra tidak berlaku** (aman, tetapi bukan perilaku akhir) | Efan + Operations |
| P-06 | Margin Mitra wajib agar produk tayang? | Wajib / tidak | Tidak wajib di Fase 1 (drop point tetap bisa dengan harga satuan) | `mitra_wajib_untuk_tayang = false` | Efan |
| P-07 | Promo yang melanggar modal saat runtime | A) tidak diterapkan; B) dibatasi sampai modal | A: mudah dijelaskan, tidak ada potongan "aneh" | Saat simpan: **tolak** (keputusan #4); runtime: A + peringatan | Efan |
| P-08 | Harga grup LIVE atau DIBEKUKAN; ambang margin menipis (= F-08) | LIVE / beku sejak grup dibuka / grup ditahan | LIVE + alert margin menipis | LIVE; `ambang_margin_menipis_bp` kosong | Efan |
| P-09 | Tindakan bila modal saat cut-off melewati harga dibayar peserta | A) grup DITAHAN untuk keputusan admin; B) NEKAT menanggung rugi; C) batal + refund ke saldo | A: tidak pernah jual di bawah modal tanpa keputusan manusia | A (DITAHAN, T-002 G10; berlaku juga untuk GAGAL_LANJUT_SATUAN) | Efan + Randy |
| P-10 | Batas usia data modal dari Gudang | Angka detik/jam | Diisi sesuai frekuensi sinkron Gudang | Kosong untuk `local`; wajib diisi sebelum `gudang` dipakai production | Joseph + Efan |
| P-11 | Sel CSV kosong pada produk lama | Biarkan / hapus | Biarkan; hapus hanya dengan token eksplisit | Kosong = tidak berubah; `HAPUS` = kosongkan | Efan + Joseph |
| P-12 | Pembulatan berat/jarak ongkir; tarif per kg global atau per armada | — | Domain T-031; hitung dalam gram & meter integer, bulatkan rupiah ke atas sekali di akhir | Engine harga hanya menerima ongkir jadi; detail di T-006/T-031 | Efan + Operations |
| P-13 | Minimal belanja gratis ongkir sebelum/sesudah diskon | Sebelum / sesudah | Sesudah (melindungi margin) | `SESUDAH_DISKON` | Efan |
| P-14 | Pagar antar kemasan (dus vs pcs) | Pagar keras / peringatan / tidak ada | Peringatan dulu, lihat data pilot | Peringatan `HARGA_KEMASAN_TIDAK_WAJAR` | Efan |
| P-15 | Pembulatan diskon persen; diskon menumpuk | Bawah/atas; menumpuk ya/tidak | Bawah, tidak menumpuk | Potongan ke bawah; satu diskon per baris (terbesar yang lolos); `P_a` ke bawah (§5.4) | Efan |
| P-16 | Margin nol diizinkan | Izinkan / izinkan dengan peringatan / tolak | Tolak untuk (INDIVIDU, SATUAN); izinkan dengan peringatan di tier grup & Mitra | `IZINKAN_DENGAN_PERINGATAN` untuk semua sel | Efan |
| P-17 | Harga coret = harga 1 pcs riil | Riil / referensi lain / tidak tampil | Riil (harga coret harus harga yang benar-benar berlaku, menghindari klaim harga menyesatkan) | `HARGA_SATUAN_RIIL`, tampil hanya bila > harga aktif | Randy + Efan |
| P-18 | Batas COD dibandingkan total sebelum/sesudah saldo | Sebelum / sesudah | Sebelum saldo (sesuai teks "per pesanan", lebih konservatif) | Sebelum saldo, sesudah diskon, termasuk ongkir | Randy + Joseph |
| P-19 | Siapa menanggung bila harga final > dibayar tetapi ≥ modal | NEKAT / pengguna ditagih | NEKAT (sesuai S&K §4.5) | `F = min(...) ≤ D`; tidak ada tagihan tambahan | Efan + Randy |
| P-20 | Cara alokasi subsidi gratis ongkir ke baris pesanan untuk pagar modal | Proporsional nilai bersih / proporsional berat / rata per baris | Proporsional nilai bersih | `PROPORSIONAL_NILAI`, metode sisa terbesar | Efan + Joseph |
| P-21 | Tier grup opsional per produk | Wajib semua / opsional | Opsional (produk murah mungkin tak layak 12+) | SATUAN wajib; G0 (`g0_aktif`), G1, G2 opsional | Efan |

### 11.2 Butir baru (tercatat di `keputusan-terbuka.md` bagian T-003)
| ID | Topik | Opsi | Rekomendasi agen | DEFAULT SEMENTARA (asumsi) | Pemilik usulan |
|---|---|---|---|---|---|
| P-22 | Cakupan pagar "harga grup individu ≥ Mitra ≥ Franchise" | A) `KETAT`: harga Mitra mana pun ≤ harga individu termurah (termasuk 12+); B) `PER_TIER`: dibandingkan per tier yang sama | A selama Mitra hanya satu tier (Fase 1); tinjau ulang di Fase 2 saat Mitra punya tier sendiri | `KETAT`; pelanggaran yang melibatkan level nonaktif (FRANCHISE di Fase 1) hanya peringatan `PAGAR_LEVEL_NONAKTIF`, menjadi error saat level diaktifkan | Efan |
| P-23 | Promo/gratis ongkir saat checkout lalu harga turun di cut-off | A) kredit selisih dibatasi agar bersih ≥ modal; B) promo dicabut proporsional; C) selisih penuh (bisa di bawah modal — melanggar aturan) | A (§5.4) | A + info `SELISIH_DIBATASI_PAGAR` | Efan + Randy |
| P-24 | Cakupan kategori terlarang Fase 1 (keputusan #7 menyebut rokok & bir) | A) hanya rokok & bir; B) semua produk tembakau/nikotin (termasuk rokok elektrik) & semua minuman beralkohol | B (risiko izin & usia sama) | B; nama dengan kata kunci (kata utuh, di luar frasa pengecualian) ditahan untuk tinjauan admin, bukan ditolak otomatis | Randy |
| P-25 | Sumber modal saat `INVENTORY_SOURCE=gudang`: boleh ditimpa dari panel/CSV? | A) Gudang selalu menang, isian lokal ditolak; B) boleh override lokal dengan alasan | A (satu sumber kebenaran modal) | A (`MODAL_DIKELOLA_GUDANG`) | Joseph + Efan |

Butir terkait yang dipakai tetapi tidak diberi ID baru: F-01 (= P-04), F-04 (= P-03), F-08 (= P-08), F-09 (tier dari qty sebelum alokasi), F-12 (drop point satu grup), F-20 (ongkir tidak dihitung ulang), H6 (= P-02), keputusan-terbuka #1 (angka margin & harga) dan #4 (tarif ongkir).
