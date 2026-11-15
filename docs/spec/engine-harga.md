# Spesifikasi Engine Harga & Pagar Harga — NEKAT Fase 1

| Atribut | Nilai |
|---|---|
| Task | T-003 (spesifikasi), disinkronkan T-047 (`task/T-047-sinkron-keputusan`) |
| Versi | 0.6 — Draf. **v0.6 (15 Nov 2026, T-047): ditulis ulang mengikuti `keputusan.md` §11–§13**: satuan jual 1 pcs/3 pcs/lusin/dus/koli (P-03), level Mitra Grosir (P-05, K-08), harga grup individu = Mitra Grosir (K-09, K-14), modal per satuan jual (K-01), margin persen **atau** harga rupiah (P-01), tanpa pembulatan (H6), margin 0 ditolak (P-16), batas bawah promo dari modal (P-07, K-16), diskon tidak menumpuk (P-15), snapshot saat invoice (K-15), DITAHAN (P-09, P-26), kredit dibatasi (P-23), PPN dari konfigurasi (G-04), ongkir di invoice setelah final (K-10). Tier `SATUAN/G0/G1/G2`, MOQ grup, pembulatan `bulatK`, dan bayar harga satuan di muka (v0.5) **tidak berlaku lagi** |
| Tanggal | 10 Nov 2026 (rev. 15 Nov 2026) |
| Penyusun | Pricing Analyst + Backend Architect (squad Harga & bisnis, pemilik: Efan) |
| Sumber wajib | `CLAUDE.md` (Aturan harga), `project-specs/keputusan.md` (#3, #4, #6–#9, §11–§13), `project-specs/keputusan-terbuka.md` |
| Selaras dengan | `docs/flow/group-order.md` v0.6 (T-002), `docs/spec/T-009-kontrak-inventory-source.md` v0.3, `docs/adr/0001-tech-stack.md` |
| Dipakai oleh | T-004, T-008, T-011, T-020, T-022, T-023, T-025, T-027, T-028, T-031, T-032, T-033, T-037, T-038, T-044 |

Dokumen ini menetapkan **perilaku wajib** engine harga agar T-020 bisa dibangun dan dites.
**Tidak ada angka harga, persentase margin, tarif ongkir, tarif PPN, atau nilai biaya admin di dokumen ini.** Kasus uji memakai nilai **simbolik** (`M`, `H`, `D`, …). Hal yang belum diputuskan ditulis "**menunggu X**" dengan **DEFAULT SEMENTARA** (asumsi kerja yang bisa diganti lewat konfigurasi, bukan keputusan); rangkuman di §11.

---

## 1. Tujuan, cakupan, istilah

### 1.1 Tujuan
1. Satu sumber kebenaran untuk semua harga: katalog, kartu, detail, halaman grup, invoice, cut-off, laporan.
2. Aturan harga `CLAUDE.md` sebagai **invarian yang dites**.
3. Memisahkan **struktur** (dibangun agen) dari **angka** (diisi pemilik lewat panel/CSV, keputusan #6).

### 1.2 Cakupan Fase 1
| Masuk | Disiapkan, tidak dipakai checkout | Di luar dokumen ini |
|---|---|---|
| Level **INDIVIDU** dan **MITRA_GROSIR** per satuan jual; harga grup = Mitra Grosir; harga grosir dengan MOQ per produk; PPN; diskon; gratis ongkir; biaya admin; kredit cut-off | Level **FRANCHISE** (sel, pagar, validasi) | Tarif & rumus ongkir (adapter eksternal, K-05, P-12); ledger (T-021); status grup (T-002) |

### 1.3 Istilah
| Istilah | Definisi |
|---|---|
| **Satuan jual (s)** | Unit yang dijual: `PCS` (1 pcs), `PCS3` (3 pcs), `LUSIN`, `DUS`, `KOLI` (P-03). Tiap produk memilih satuan yang tersedia; `isi` (pcs dasar) dari T-009 `konversiSatuan`. Harga selalu **per satuan jual**. |
| **Modal (M)** | Modal **per satuan jual**, diinput manual / dari Gudang per satuan jual (K-01). Integer Rupiah > 0. Pecahan → tidak tayang + antrean "perlu ditinjau", tanpa pembulatan (K-01). |
| **Level** | `INDIVIDU` ≥ `MITRA_GROSIR` ≥ `FRANCHISE` (pagar CLAUDE.md, K-08). Tingkat "grosir" (P-05) = `MITRA_GROSIR`. |
| **Sel harga** | Kombinasi (satuan jual, level). Isi sel: **persen markup atas modal** atau **harga jual Rupiah** (P-01); kosong secara bawaan. |
| **Harga satuan** | `H(s, INDIVIDU)`. |
| **Harga Mitra Grosir / harga grup** | `H(s, MITRA_GROSIR)`. Dalam grup yang memenuhi syarat, setiap baris mendapat harga ini tanpa MOQ (K-09, K-14). |
| **MOQ grosir** | Qty minimum (dalam satuan jual itu) agar pembelian di luar syarat grup mendapat `H(s, MITRA_GROSIR)` (P-05, F-04). Diisi per produk/satuan jual; kosong = grosir hanya lewat grup. |
| **Jenis harga baris** | `GRUP` (syarat grup terpenuhi), `GROSIR_MOQ` (qty ≥ MOQ grosir), `SATUAN` (lainnya). |
| **Harga dibayar (D)** | Harga per unit yang di-snapshot **saat invoice terbit** (K-15, P-08). Tidak pernah berubah. |
| **Harga final (F)** | Harga per unit yang dikunci saat cut-off (§5.4). `F ≤ D`. |
| **PPN** | Tarif & DPP dari konfigurasi, flag `bebas_ppn` per produk, harga tampil sudah termasuk PPN (G-04). |
| **Faktor PPN (φ)** | Bilangan rasional `φ = φ_pembilang / φ_penyebut` dari konfigurasi (= 1 + tarif × DPP); `φ = 1` untuk produk bebas PPN. Dipakai hanya lewat perkalian silang integer (§3.5). |
| **Batas bawah promo (β)** | Faktor `β = 1 + batas_bawah_promo` dari konfigurasi (K-16): nilai bersih setelah promo/gratis ongkir ≥ modal × β. |
| **Promo** | Diskon atau gratis ongkir dari aturan admin (T-032); selalu tampil **terpisah** dari harga. |
| **Versi harga** | `id_versi_harga`: penanda deterministik atas input yang menghasilkan tabel harga. |
| **Tayang** | Boleh tampil & dibeli (PG-5 + syarat stok T-025 / K-20). |

---

## 2. Input data

### 2.1 Sumber & pemilik data
| Data | Sumber | Pemilik isi | Keterangan |
|---|---|---|---|
| Satuan jual + `isi` | Panel produk / CSV / `InventorySource.konversiSatuan` | Admin | Hanya kode P-03 |
| Modal per satuan jual + `waktu_data` | `InventorySource.getHargaModal` (local: panel/CSV; gudang: API) + timpaan admin (P-25, K-03) | Admin harga / Gudang | Integer > 0; kosong/≤ 0/pecahan → tidak tayang |
| Isi sel (persen / harga Rupiah) | Panel harga / CSV | **Efan (keputusan #6)** | KOSONG secara bawaan; agen tidak mengisi |
| MOQ grosir | Panel / CSV | Efan | Kosong secara bawaan |
| Flag `bebas_ppn` | Panel / CSV | Efan (+ konsultan pajak) | Bawaan `tidak` |
| Konfigurasi (§2.3) | Panel (izin `harga.ubah`, admin login TOTP, H9) | Efan / Joseph | Perubahan dicatat `log_admin` |
| Aturan diskon & gratis ongkir | Panel T-032 | Admin harga | §6 |
| Ongkir | Adapter eksternal (T-031) | — | Engine hanya menerima angka jadi (P-12) |

### 2.2 Matriks sel per satuan jual
`✓` dipakai Fase 1, `○` disiapkan & divalidasi, tidak dipakai checkout.

| Satuan jual \ Level | INDIVIDU | MITRA_GROSIR | FRANCHISE |
|---|---|---|---|
| Setiap satuan yang tersedia (PCS / PCS3 / LUSIN / DUS / KOLI) | ✓ wajib agar satuan itu tayang | ✓ opsional (P-06) | ○ |

Usulan bentuk data (skema final milik T-004):
- `satuan_jual(id, id_produk, kode CHECK IN ('PCS','PCS3','LUSIN','DUS','KOLI'), isi > 0, moq_grosir NULL CHECK (moq_grosir IS NULL OR moq_grosir >= 1), UNIQUE (id_produk, kode))`.
- `sel_harga(id_satuan_jual, level, jenis CHECK IN ('PERSEN','HARGA'), nilai NULL, UNIQUE (id_satuan_jual, level))`, `CHECK (nilai IS NULL OR nilai > 0)` (margin 0 ditolak, P-16).
- `modal_satuan_jual(id_satuan_jual, modal > 0, sumber, waktu_data)`; timpaan di T-009 §7.

### 2.3 Konfigurasi engine
| Kunci | Tipe | Bawaan | Rujukan |
|---|---|---|---|
| `jenis_isi_sel_diizinkan` | himpunan `PERSEN`, `HARGA` | keduanya | P-01 |
| `presisi_persen` | basis poin (bp) | 1 bp = 0,01 % | P-01 |
| `batas_atas_markup_bp` | integer \| kosong | kosong (penangkal salah ketik → peringatan) | — |
| `mode_pagar_level` | `KETAT` | `KETAT` (satu-satunya nilai; tanpa pemeriksaan tambahan) | P-22 |
| `mitra_wajib_untuk_tayang` | boolean | `false` | P-06 |
| `grup.min_akun` | integer | 3 | keputusan #3, K-17 |
| `grup.min_total` | Rupiah | nilai F-30 (Rp100.000) | F-30; dasar hitung menunggu Q-02 |
| `ppn.faktor` | rasional (`pembilang`, `penyebut`) | **kosong** = belum dikonfigurasi → produk yang tidak `bebas_ppn` tidak tayang | G-04 |
| `promo.batas_bawah_bp` | basis poin dari modal | nilai keputusan K-16 | P-07, K-16 |
| `biaya_admin.per_akun_per_grup` | Rupiah \| kosong | kosong (= tidak ditagih) | G-05, K-06 |
| `batas_usia_modal_menit` | integer \| kosong | 15 untuk `gudang`; kosong untuk `local` | P-10 |
| `diskon_menumpuk` | boolean | `false` (tetap) | P-15 |
| `diskon.cakupan` | `TOTAL_INVOICE` \| `PER_BARIS` | `TOTAL_INVOICE` | menunggu K-21 |
| `dasar_minimal_belanja_gratis_ongkir` | `SESUDAH_DISKON` | `SESUDAH_DISKON` (tetap) | P-13 |
| `alokasi_subsidi_ongkir` | `PROPORSIONAL_NILAI` \| `PROPORSIONAL_BERAT` \| `RATA_PER_BARIS` | `PROPORSIONAL_NILAI` | menunggu P-20 |
| `harga_coret` | `HARGA_SATUAN_RIIL` \| `TIDAK_TAMPIL` | `HARGA_SATUAN_RIIL` | menunggu P-17 |
| `kategori_terlarang` | daftar kode kategori | rokok, tembakau & nikotin, bir & minuman beralkohol | keputusan #7, P-24 |

Kunci `pembulatan.mode`, `pembulatan.kelipatan`, `margin_nol`, `promo_langgar_modal_saat_runtime`, `syarat_mitra_min_nilai`, `ambang_margin_menipis_bp` **dihapus** (H6, P-16, P-07, P-05, K-02). Perubahan konfigurasi mengubah `id_versi_harga` produk terdampak. T-020 hanya membangun nilai bawaan untuk kunci pilihan; nilai lain → `KONFIGURASI_BELUM_DIDUKUNG`.

---

## 3. Rumus & representasi

### 3.1 Representasi angka
- **Rupiah**: integer penuh (`bigint`, tipe bermerek `Rupiah`, ADR §5.1). Tidak ada float.
- **Persen**: integer basis poin. "12,5%" → 1250 bp (contoh fiktif format, bukan margin). Presisi lebih halus dari 0,01 % → `FORMAT_PERSEN`.
- Perkalian antara dengan `BigInt`, hasil dicek `Number.isSafeInteger` → `ANGKA_OVERFLOW`.
- **Tanpa pembulatan (H6).** Tidak ada `bulatK`. Hasil yang tidak integer tidak dibulatkan diam-diam: harga sel pecahan → §3.3; potongan/alokasi pecahan → §3.6.

### 3.2 Harga sel
```
PERSEN(bp):  pembilang = M × bp
             pembilang mod 10000 ≠ 0  → HARGA_PECAHAN (sel "perlu ditinjau", tidak dipakai)  [menunggu Q-06]
             H = M + pembilang / 10000
HARGA(h):    H = h
margin = H − M ;  margin < 0 → MARGIN_NEGATIF ;  margin = 0 → MARGIN_NOL (ditolak, P-16)
```
"Persen" = **markup atas modal** (`H = M × (1 + p)`), bukan margin kotor atas harga jual.

### 3.3 Modal per satuan jual (K-01)
- Modal diinput per satuan jual; tidak ada pembagian modal karton di engine.
- Modal dari sumber yang bukan integer > 0 → satuan jual tidak tayang, alasan `MODAL_PECAHAN` (antrean "perlu ditinjau", T-009 §7).
- Antar satuan jual produk yang sama tidak ada pagar wajib; hanya peringatan `HARGA_KEMASAN_TIDAK_WAJAR` bila harga per pcs dasar kemasan besar > kemasan kecil (perbandingan silang `H_besar × isi_kecil > H_kecil × isi_besar`, tanpa pembagian) — **menunggu P-14**.

### 3.4 Urutan perhitungan (deterministik)
1. Kategori (§8.3) → `KATEGORI_DILARANG`.
2. Modal ada, integer, > 0 → `MODAL_KOSONG` / `MODAL_TIDAK_VALID` / `MODAL_PECAHAN`. Umur data dicek saat dibaca (`cekKesegaranModal`).
3. Satuan jual valid (kode P-03, `isi` > 0, unik per produk) → `SATUAN_TIDAK_VALID`.
4. Per sel terisi: format → harga (§3.2).
5. PG-1 per sel, PG-2 per satuan jual.
6. Status tayang (PG-5) & `id_versi_harga`.
Langkah 4–5 mengumpulkan **semua** pelanggaran.

### 3.5 PPN (G-04)
- Harga sel = harga tampil **termasuk PPN**. Total tagihan tidak menambah PPN; rincian PPN hanya ditampilkan di checkout/nota.
- Nilai tanpa PPN dari nilai `X`: `X / φ`. Engine **tidak** menghitung pecahan ini untuk keputusan; semua pagar memakai perkalian silang: `X ≥ Y × φ` ⇔ `X × φ_penyebut ≥ Y × φ_pembilang`.
- Dasar pagar modal: **menunggu Q-06**. DEFAULT SEMENTARA (konservatif): pagar membandingkan **nilai tanpa PPN** dengan modal (produk kena PPN: `H × φ_penyebut ≥ M × φ_pembilang`; bebas PPN: `H ≥ M`). Bila Q-06 memutuskan pagar dibanding harga termasuk PPN, cukup set φ = 1 di pagar.
- Rincian PPN di nota per invoice: `PPN = Σ X_kena − Σ X_kena / φ`; penanganan sub-rupiah untuk angka rincian **menunggu Q-06** (DEFAULT SEMENTARA: angka rincian PPN ditampilkan dengan aturan pajak yang ditetapkan konsultan; tidak mengubah total tagihan).
- `ppn.faktor` kosong → produk kena PPN tidak tayang (`PPN_BELUM_DIKONFIGURASI`).

### 3.6 Pecahan pada potongan & alokasi
- Potongan persen, pembagian diskon total ke baris, potongan untuk unit teralokasi, dan alokasi subsidi ongkir dapat menghasilkan sub-rupiah.
- Pembagian ke baris memakai **metode sisa terbesar** sehingga Σ bagian = total persis (bukan pembulatan total).
- Sub-rupiah pada nilai potongan itu sendiri: **menunggu Q-06**. DEFAULT SEMENTARA: bagian pecahan dibuang (`bagiBawah`) pada potongan dan kredit, sehingga pagar modal tidak pernah terlewati; selisih ≤ Rp1 per baris dicatat di rincian. Ini bertentangan dengan bunyi harfiah H6/P-15 "tanpa pembulatan", karena itu wajib diputuskan sebelum T-032 rilis.

---

## 4. Pagar (invarian)

Notasi: `H(s, L)` harga sel; `M` modal (snapshot invoice: `Mi`; terkini saat cut-off: `Mc`); `q` qty pesan; `a` qty teralokasi; `P` potongan baris; `S` subsidi ongkir baris; `φ` faktor PPN baris; `β` batas bawah promo. `nilai ≥ₚ modal` berarti `nilai × φ_penyebut ≥ modal × φ_pembilang` (§3.5).

### 4.1 Pernyataan formal
| ID | Invarian | Pernyataan |
|---|---|---|
| PG-1 | Tidak ada harga di bawah modal; margin 0 ditolak | `∀ sel terisi: H > M` dan `H ≥ₚ M`; baris invoice: `D ≥ₚ Mi`; `F` (bila tidak null) `≥ₚ Mc` |
| PG-2 | Harga grup individu ≥ Mitra Grosir ≥ Franchise | Per satuan jual: `H(s,INDIVIDU) ≥ H(s,MITRA_GROSIR) ≥ H(s,FRANCHISE)` untuk sel yang terisi (KETAT, P-22). Sama besar diizinkan (K-14). Pelanggaran yang melibatkan FRANCHISE (nonaktif Fase 1) = peringatan `PAGAR_LEVEL_NONAKTIF` |
| PG-3 | Batas bawah promo | Saat invoice: `(D × q − P) ≥ₚ Mi × q × β`. Saat invoice ongkir: `(D × a − P_a − S) ≥ₚ Mc × a × β`. Pelanggaran → promo **dibatasi** sampai batas (P-07) / gratis ongkir tidak memenuhi syarat (P-27) |
| PG-4 | Syarat lolos cut-off (satu-satunya aturan DITAHAN karena modal) | `a = 0 ∨ (D × a − P_a) ≥ₚ Mc × a`; gagal → grup DITAHAN (P-09, P-26). Subsidi ongkir belum ada saat cut-off (K-10), jadi tidak masuk syarat ini |
| PG-5 | Produk tanpa harga lengkap tidak tayang | Satuan jual tayang ⇔ modal valid ∧ kategori diizinkan ∧ tidak menunggu tinjauan ∧ sel (s, INDIVIDU) berharga & valid ∧ PG-1 & PG-2 lolos untuk level aktif ∧ PPN terkonfigurasi bila kena PPN ∧ (`mitra_wajib_untuk_tayang` ⇒ sel MITRA_GROSIR berharga). Sel MITRA_GROSIR yang tidak valid tidak menahan tayang (P-06), tetapi baris itu tidak bisa memakai harga grup (Q-05) |
| PG-6 | Harga kartu = detail = halaman grup; promo terpisah | `tampilanHarga` satu-satunya penghasil harga tampil; hasil identik untuk `id_versi_harga` & konteks sama; `promo` field terpisah, tidak menimpa harga |
| PG-7 | Harga dibayar tidak naik | `F ≤ D` |
| PG-8 | Kredit tidak menembus modal | `T' ≥ₚ Mc × a` bila `a > 0` (P-23) |

### 4.2 Titik penegakan
| ID | Domain | DB (constraint) | Panel (T-037) | CSV (T-038) | Runtime | Kode |
|---|---|---|---|---|---|---|
| PG-1 | `hitungTabelHarga`, `hargaInvoice`, `hitungHargaFinal` | `CHECK (harga > modal AND modal > 0)` pada `harga_terhitung`; `CHECK (harga_dibayar >= modal_snapshot)`; `CHECK (harga_final IS NULL OR harga_final >= modal_cutoff)`; pemeriksaan PPN di domain | Simpan ditolak | Baris ditolak | Modal baru → hitung ulang; cut-off → DITAHAN | `HARGA_DI_BAWAH_MODAL`, `MARGIN_NOL`, `MARGIN_NEGATIF` |
| PG-2 | `validasiPagar` | Domain saja (lintas baris) | Ditolak (level aktif) | Ditolak / peringatan | Tidak tayang | `PAGAR_LEVEL_DILANGGAR`, `PAGAR_LEVEL_NONAKTIF` |
| PG-3 | `validasiAturanPromo`, `hitungRingkasanInvoice`, `hitungInvoiceOngkir` | — | Aturan ditolak bila pasti melanggar (§6.4) | — | Dibatasi / tidak memenuhi syarat | `PROMO_DIBATASI`, `GRATIS_ONGKIR_TIDAK_MEMENUHI_SYARAT` |
| PG-4 | `hitungHargaFinal` | — | — | — | DITAHAN | `DI_BAWAH_MODAL` |
| PG-5 | `statusTayang` | `tayang` hanya ditulis use case harga | Lencana + alasan | Laporan per baris | Tidak tayang otomatis | `TIDAK_TAYANG` + alasan |
| PG-6 | `tampilanHarga` | — | Pratinjau memanggil fungsi sama | — | E2E kartu vs detail vs grup | — |
| PG-7/8 | `hitungHargaFinal` | `CHECK (harga_final IS NULL OR harga_final <= harga_dibayar)` | — | — | Job cut-off | `HARGA_FINAL_MELEBIHI_DIBAYAR` (bug), `SELISIH_DIBATASI_PAGAR` (info) |

### 4.3 Kode error & peringatan
| Kode | Jenis | Arti |
|---|---|---|
| `MODAL_KOSONG` / `MODAL_TIDAK_VALID` / `MODAL_PECAHAN` | error / status | Modal tidak ada / ≤ 0 / bukan integer (K-01) |
| `MODAL_KEDALUWARSA` | error | Umur data > batas (P-10) |
| `SATUAN_TIDAK_VALID` | error | Kode bukan P-03, `isi` ≤ 0, atau ganda |
| `SEL_KOSONG` | status | Sel wajib belum diisi (tidak tayang) |
| `FORMAT_PERSEN` / `FORMAT_HARGA` | error | Format isi sel salah / jenis tidak diizinkan |
| `HARGA_PECAHAN` | status | Persen menghasilkan harga bukan integer; isi harga Rupiah atau ubah persen (Q-06) |
| `MARGIN_NEGATIF` / `MARGIN_NOL` | error | `H < M` / `H = M` (P-16) |
| `MARKUP_DI_ATAS_BATAS` | peringatan | Penangkal salah ketik |
| `HARGA_DI_BAWAH_MODAL` | error | PG-1 (termasuk dasar PPN) |
| `PAGAR_LEVEL_DILANGGAR` / `PAGAR_LEVEL_NONAKTIF` | error / peringatan | PG-2 |
| `HARGA_KEMASAN_TIDAK_WAJAR` | peringatan | P-14 |
| `PPN_BELUM_DIKONFIGURASI` | status | `ppn.faktor` kosong untuk produk kena PPN |
| `GROSIR_TIDAK_TERSEDIA` | info | Sel Mitra Grosir kosong/tidak valid; baris memakai harga satuan (Q-05) |
| `PROMO_DIBATASI` | info | Potongan dikurangi sampai batas bawah PG-3 (P-07) |
| `PROMO_DI_BAWAH_BATAS` | error simpan | Aturan pasti melanggar PG-3 untuk semua SKU terdampak |
| `GRATIS_ONGKIR_TIDAK_MEMENUHI_SYARAT` | info ke pengguna | P-27, membawa `alasan` + `jalanKeluar[]` |
| `SELISIH_DIBATASI_PAGAR` | info | Kredit dikurangi (P-23); bagian yang ditahan berlabel "biaya admin (penyesuaian pagar modal)" |
| `DI_BAWAH_MODAL` | alasan DITAHAN | PG-4 |
| `KATEGORI_DILARANG` / `PERLU_TINJAUAN_KATEGORI` | error / status | §8.3 |
| `HARGA_TIDAK_TERSEDIA` | error runtime | Tabel tidak bisa dihitung |
| `ANGKA_OVERFLOW` | error | Integer aman terlewati |
| `KONFIGURASI_BELUM_DIDUKUNG` | error konfigurasi | §2.3 |

---

## 5. Harga sepanjang siklus grup

Status grup mengikuti T-002 v0.6: DIBUKA, MENUNGGU_PELUNASAN, TERKONFIRMASI, DITAHAN, HARGA_TERKUNCI, DIPROSES, SELESAI, BATAL.

### 5.1 Harga tampil (kartu, detail, halaman grup)
| Konteks | `hargaAktif` (per satuan jual) | `hargaGrup` (info terpisah) | `teksStatus` |
|---|---|---|---|
| Katalog (tanpa grup) | `H(s, INDIVIDU)` | `H(s, MITRA_GROSIR)` bila valid (label "Harga Belanja Bareng") | `null` |
| Grup DIBUKA, syarat grup terpenuhi | `H(s, MITRA_GROSIR)` (fallback `H(s, INDIVIDU)` + `GROSIR_TIDAK_TERSEDIA`) | — | `null` |
| Grup DIBUKA, syarat belum terpenuhi | `H(s, INDIVIDU)` | `H(s, MITRA_GROSIR)` + kekurangan (akun / Rupiah) | `null` |
| MENUNGGU_PELUNASAN / TERKONFIRMASI | `D` (snapshot invoice) | — | `MENUNGGU_PELUNASAN` / `MENUNGGU_CUTOFF` |
| DITAHAN | `null` | — | `DIPERIKSA` |
| HARGA_TERKUNCI / DIPROSES / SELESAI | `F` | — | `HARGA_FINAL_TERKUNCI` / `GRUP_DIPROSES` |
| BATAL | `null` | — | `GRUP_BATAL` |

- **Perbandingan grup vs sendiri (K-18)**: `perbandinganGrupVsSendiri` mengembalikan per baris dan total: harga satuan × qty, harga grup × qty, dan selisihnya. Dipakai di halaman grup dan detail produk; angka berasal dari `TabelHarga` yang sama (PG-6).
- Harga Mitra Grosir untuk drop point tidak tampil sebagai info khusus di kartu/detail (P-28 = B); `hargaGrup` di katalog adalah harga Belanja Bareng yang berlaku untuk semua cara kirim, tampil sama di kartu dan detail.
- `hargaCoret` = `H(s, INDIVIDU)` hanya bila `> hargaAktif` (menunggu P-17).
- Promo tampil di field `promo` terpisah.

### 5.2 Penentuan jenis harga baris
```
syaratGrup = akunBerbarang ≥ grup.min_akun ∧ totalGrup ≥ grup.min_total       // K-17, F-30 (dasar total: Q-02)
jenis(baris) =
  GRUP        bila syaratGrup ∧ sel (s, MITRA_GROSIR) valid                  // K-09, K-14
  GROSIR_MOQ  bila ¬syaratGrup ∧ moq_grosir(s) terisi ∧ q ≥ moq_grosir(s) ∧ sel MITRA_GROSIR valid   // P-05
  SATUAN      selain itu (termasuk syaratGrup tetapi sel Mitra Grosir tidak valid: + GROSIR_TIDAK_TERSEDIA, Q-05)
harga(baris) = H(s, MITRA_GROSIR) untuk GRUP / GROSIR_MOQ ; H(s, INDIVIDU) untuk SATUAN
```
- Cara kirim tidak mengubah jenis harga: drop point = tingkat Mitra (keputusan #4) dengan syarat = MOQ grosir (P-05) atau syarat grup; antar rumah & drop point dalam satu grup (F-12) mendapat aturan yang sama.
- `totalGrup` untuk syarat dihitung dengan DEFAULT SEMENTARA Q-02: `Σ H(s, MITRA_GROSIR atau INDIVIDU bila kosong) × q` semua baris akun berbarang, sebelum diskon, tanpa biaya admin & ongkir.

### 5.3 Harga invoice & snapshot (K-15, P-08)
- Saat invoice barang terbit, per baris disimpan: `harga_dibayar` (D) = `harga(baris)` dari tabel harga terkini (modal ≤ 15 menit, P-10), `modal_snapshot` (Mi), `jenis_harga`, `bebas_ppn` & `φ` snapshot, `id_versi_harga`, `potongan_baris` (P).
- Pagar saat invoice: PG-1 (`D ≥ₚ Mi`), PG-3 (potongan dibatasi).
- Ringkasan invoice per akun: `Σ(D × q) − P_total + biaya_admin`; rincian PPN (§3.5); dipotong saldo bila dipilih (T-021). Mode host (K-17): satu invoice = gabungan ringkasan semua akun, termasuk biaya admin per akun (K-06).
- Ongkir **tidak** ada di invoice barang (K-10).

### 5.4 Harga final saat cut-off
Per baris dengan tabel harga yang dihitung ulang dari **modal terkini** `Mc` (data ≤ 15 menit):
```
H_c   = harga sel untuk jenis harga yang sama dengan snapshot (GRUP/GROSIR_MOQ → MITRA_GROSIR, SATUAN → INDIVIDU)
F     = (a = 0) ? null : min(D, H_c)        // H_c tidak valid → F = D + peringatan admin
```
- `F ≤ D` (PG-7). Bila `H_c > D` (modal/margin naik) tetap `F = D`, tidak ada tagihan tambahan — **menunggu P-19** (DEFAULT SEMENTARA: NEKAT menanggung selama lolos PG-4).
- **Syarat lolos (PG-4)** untuk setiap baris dengan `a > 0`: `(D × a − P_a) ≥ₚ Mc × a`. Gagal satu baris → seluruh grup **DITAHAN** (P-09, P-26). Penyelesaian admin wajib menjalankan ulang `hitungHargaFinal` atas input terkoreksi; tidak ada parameter override di bawah modal.
- Tabel cut-off tidak bisa dihitung sama sekali (modal kosong/kedaluwarsa) → DITAHAN `HARGA_TIDAK_TERSEDIA`.

### 5.5 Kredit cut-off & refund (rumus integer)
```
B    = D × q − P                         // nilai barang bersih yang dibayar
P_a  = bagian P untuk unit teralokasi    // §3.6 (DEFAULT SEMENTARA: bagiBawah(P × a, q))
T    = F × a − P_a                        // kewajiban setelah harga final
L    = nilai integer terkecil yang memenuhi L ≥ₚ Mc × a       // batas pagar modal
T'   = max(T, L)                          // P-23: kredit dibatasi
K    = B − T'                             // kredit ke saldo akun PEMBAYAR (G-06b)
ditahan = T' − T  → bila > 0: info SELISIH_DIBATASI_PAGAR, tampil "biaya admin (penyesuaian pagar modal)" (P-23)
a = 0:  F = null, T' = 0, K = B          // refund stok penuh, tidak pernah DITAHAN
```
- Tanpa promo: `K = (D − F) × a + D × (q − a)`.
- `T' ≤ D × a − P_a` dijamin syarat lolos dan `F ≤ D`, jadi `K ≥ 0`.
- `dana_ditahan` (T-002 B-13): `K` dihitung dan disimpan, `tulisKreditKeLedger = false`.
- Satu entri ledger `selisih:{grup_id}:{anggota_id}` per anggota (jumlah semua barisnya) ke akun pembayar.
- **Refund penuh** (grup BATAL sebelum kunci harga): `hitungRefund = Σ(D × q) − P_total + biaya_admin` (biaya admin ikut kembali: menunggu Q-08, DEFAULT SEMENTARA ya), kunci `refund:{anggota_id}`, ke pembayar.
- Saldo = loyalty point, 1 poin = Rp1, tanpa pembulatan (G-06a); engine hanya menghasilkan Rupiah integer.

### 5.6 Perubahan modal
1. `ModalBerubah` → `hitungTabelHarga` ulang → `id_versi_harga` baru → kartu, detail, halaman grup DIBUKA berubah bersamaan.
2. Invoice yang sudah terbit tidak berubah (K-15).
3. Penurunan modal dari Gudang hanya dicatat di log admin, tanpa ambang tahan (K-02).
4. Timpaan modal (P-25) berlaku sampai dicabut; tanggal kedaluwarsa opsional + pemberitahuan otomatis (K-03, T-009 §7).

---

## 6. Diskon, biaya admin, gratis ongkir

### 6.1 Diskon (saat invoice barang)
1. Kumpulkan aturan diskon yang berlaku (produk / kategori / level / periode / zona / kuota, keputusan #4).
2. **Tidak menumpuk** (P-15): pilih **satu** aturan untuk invoice akun, yaitu yang memberi potongan terbesar setelah pembatasan langkah 4.
3. Cakupan **menunggu K-21**. DEFAULT SEMENTARA (`TOTAL_INVOICE`): potongan dihitung atas total baris yang masuk cakupan aturan, lalu dibagi ke baris proporsional nilai `D × q` (metode sisa terbesar, §3.6).
4. Per baris cek PG-3 `(D × q − P_i) ≥ₚ Mi × q × β`; gagal → `P_i` dikurangi sampai potongan terbesar yang lolos (`PROMO_DIBATASI`, P-07, K-16). Sisa tidak dipindah ke baris lain.
5. Mode host: diskon dihitung per akun (bagian akun dalam invoice gabungan), agar kuota dan pagar per baris tetap sama dengan mode sendiri.
6. Kuota diskon direservasi di transaksi penerbitan invoice; dilepas saat invoice kedaluwarsa/dibatalkan (akun dikeluarkan, K-12).

### 6.2 Biaya admin (G-05, K-06, P-16)
- Flat Rupiah **per akun per grup** dari konfigurasi; kosong = tidak ditagih.
- Baris terpisah di invoice barang; **tidak** dihitung sebagai bagian harga barang dan **tidak** dipakai untuk meloloskan pagar modal (konservatif).
- P-16 "kekurangan dimasukkan sebagai biaya admin": engine menolak margin 0; satu-satunya penyesuaian otomatis berlabel biaya admin adalah bagian kredit yang ditahan P-23 (§5.5). Penambahan biaya lain hanya oleh admin lewat konfigurasi.

### 6.3 Gratis ongkir (di invoice ongkir, setelah final — K-10)
1. Ongkir jadi per pengiriman dari adapter eksternal (K-05, P-12). Drop point = 0.
2. Syarat minimal belanja memakai nilai **sesudah diskon** `Σ(D × a − P_a)` (P-13).
3. Subsidi `S_total` (`PENUH` / `MAKS`) dialokasikan ke baris (**menunggu P-20**; DEFAULT SEMENTARA `PROPORSIONAL_NILAI`, sisa terbesar, `ΣS_i = S_total`).
4. Per baris cek PG-3 `(D × a − P_a − S_i) ≥ₚ Mc × a × β` (K-16). Ada baris gagal → gratis ongkir **tidak memenuhi syarat**, pesanan **tidak dibatalkan** (P-27): hasil membawa `alasan` (baris & pagar yang gagal) dan `jalanKeluar[]` (mis. `AMBIL_DI_DROP_POINT`, `BAYAR_ONGKIR_NORMAL`); ongkir normal ditagih bila pengguna tidak memilih jalan keluar lain.
5. Total invoice ongkir = `ongkir − S_total`, bisa dipotong saldo.

### 6.4 Validasi aturan promo saat disimpan (T-032)
- Untuk tiap satuan jual & level dalam cakupan: hitung potongan per unit terburuk. Bila **semua** SKU terdampak pasti melanggar PG-3 → aturan ditolak `PROMO_DI_BAWAH_BATAS` + daftar SKU (keputusan #4 "menolak dan memberi peringatan"); bila sebagian → disimpan dengan peringatan daftar SKU yang akan dibatasi.
- Gratis ongkir divalidasi per pesanan (§6.3).

---

## 7. Antarmuka modul (`packages/domain/harga`, fungsi murni)

Tanpa I/O, tanpa jam sistem (waktu sebagai argumen), deterministik.

```ts
type Rupiah = number & { readonly __brand: 'Rupiah' };
type BasisPoin = number & { readonly __brand: 'BasisPoin' };
type Level = 'INDIVIDU' | 'MITRA_GROSIR' | 'FRANCHISE';
type KodeSatuan = 'PCS' | 'PCS3' | 'LUSIN' | 'DUS' | 'KOLI';
type IsiSel = { jenis: 'PERSEN'; nilai: BasisPoin } | { jenis: 'HARGA'; nilai: Rupiah };
type Rasional = { pembilang: bigint; penyebut: bigint };        // φ, β
type JenisHarga = 'GRUP' | 'GROSIR_MOQ' | 'SATUAN';

interface InputSatuanJual {
  idSatuanJual: string; kode: KodeSatuan; isi: number; moqGrosir: number | null;
  kodeKategori: string; namaProduk: string; tinjauanKategori: 'TIDAK_PERLU' | 'MENUNGGU' | 'DISETUJUI';
  bebasPpn: boolean;
  modal: { nilai: number | null; waktuData: Date | null };      // number: pecahan dideteksi → MODAL_PECAHAN
  sel: Partial<Record<Level, IsiSel | null>>;
}
interface SelHarga { level: Level; isi: IsiSel | null; harga: Rupiah | null; masalah: Masalah[] }
interface TabelHarga {
  idSatuanJual: string; modal: Rupiah | null; waktuDataModal: Date | null; idVersiHarga: string;
  sel: SelHarga[]; tayang: boolean; alasanTidakTayang: AlasanTidakTayang[]; peringatan: Masalah[];
}
function hitungTabelHarga(x: InputSatuanJual, k: KonfigurasiHarga): TabelHarga;
function validasiPagar(t: TabelHarga, k: KonfigurasiHarga): Masalah[];                 // PG-1, PG-2
function statusTayang(t: TabelHarga, k: KonfigurasiHarga): { tayang: boolean; alasan: AlasanTidakTayang[] };
function cekKesegaranModal(t: TabelHarga, k: KonfigurasiHarga, sekarang: Date): Masalah[];

interface StatusSyaratGrup { akunBerbarang: number; totalGrup: Rupiah; terpenuhi: boolean; kurangAkun: number; kurangRupiah: Rupiah }
function syaratGrup(baris: { akunId: string; t: TabelHarga; q: number }[], k: KonfigurasiHarga): StatusSyaratGrup;
function jenisHargaBaris(t: TabelHarga, q: number, syaratTerpenuhi: boolean): { jenis: JenisHarga; harga: Rupiah; info: Masalah[] };

type KonteksTampil =
  | { jenis: 'KATALOG' }
  | { jenis: 'GRUP'; statusGrup: StatusGrup; syarat: StatusSyaratGrup; hargaSnapshot?: Rupiah; hargaFinal?: Rupiah };
interface TampilanHarga {
  idVersiHarga: string; hargaAktif: Rupiah | null; hargaGrup: Rupiah | null; hargaCoret: Rupiah | null;
  teksStatus: KodeTeksStatus | null;
  promo: { label: string; hargaSetelahPromo: Rupiah; berlakuSampai: Date | null } | null;   // terpisah
}
function tampilanHarga(t: TabelHarga, ktx: KonteksTampil, promo: AturanPromo[], k: KonfigurasiHarga, sekarang: Date): Hasil<TampilanHarga>;
function perbandinganGrupVsSendiri(baris: { t: TabelHarga; q: number }[], k: KonfigurasiHarga):
  { baris: { hargaSendiri: Rupiah; hargaGrup: Rupiah | null }[]; totalSendiri: Rupiah; totalGrup: Rupiah; hemat: Rupiah };   // K-18

interface BarisInvoice { idBaris: string; t: TabelHarga; q: number; kandidatDiskon: AturanDiskon[] }  // diisi server
interface HasilInvoice {
  baris: { idBaris: string; d: Rupiah; modalSnapshot: Rupiah; jenis: JenisHarga; potongan: Rupiah; phi: Rasional }[];
  diskonDipakai: string | null; biayaAdmin: Rupiah; rincianPpn: Rupiah; totalTagihan: Rupiah;
  pesanUntukPengguna: Masalah[]; peringatanAdmin: Masalah[];
}
function hitungRingkasanInvoice(baris: BarisInvoice[], syaratTerpenuhi: boolean, k: KonfigurasiHarga, sekarang: Date): Hasil<HasilInvoice>;

interface InputFinal {
  d: Rupiah; q: number; a: number; potongan: Rupiah; jenis: JenisHarga; phi: Rasional;
  tabelCutoff: TabelHarga; danaDitahan: boolean;
}
type HasilFinal =
  | { status: 'TERKUNCI'; hargaFinal: Rupiah | null; kewajibanBersih: Rupiah; kreditSaldo: Rupiah;
      ditahanPagar: Rupiah; tulisKreditKeLedger: boolean; info: Masalah[] }
  | { status: 'DITAHAN'; alasan: 'DI_BAWAH_MODAL' | 'HARGA_TIDAK_TERSEDIA' };
function hitungHargaFinal(x: InputFinal, k: KonfigurasiHarga, sekarang: Date): HasilFinal;
function hitungRefund(baris: { d: Rupiah; q: number; potongan: Rupiah }[], biayaAdmin: Rupiah): Rupiah;

interface HasilOngkir {
  ongkir: Rupiah; subsidi: Rupiah; total: Rupiah;
  gratisOngkir: 'BERLAKU' | 'TIDAK_BERLAKU' | 'TIDAK_MEMENUHI_SYARAT';
  alasan: Masalah[]; jalanKeluar: ('AMBIL_DI_DROP_POINT' | 'BAYAR_ONGKIR_NORMAL')[];    // P-27
}
function hitungInvoiceOngkir(baris: { d: Rupiah; a: number; potonganA: Rupiah; modalCutoff: Rupiah; phi: Rasional }[],
  ongkir: Rupiah, aturan: AturanGratisOngkir[], k: KonfigurasiHarga, sekarang: Date): HasilOngkir;
function alokasiProporsional(total: Rupiah, bobot: { id: string; w: Rupiah }[]): Map<string, Rupiah>;   // sisa terbesar
function validasiAturanPromo(aturan: AturanDiskon, terdampak: TabelHarga[], k: KonfigurasiHarga): Masalah[];

type StatusGrup = 'DIBUKA' | 'MENUNGGU_PELUNASAN' | 'TERKONFIRMASI' | 'DITAHAN' | 'HARGA_TERKUNCI' | 'DIPROSES' | 'SELESAI' | 'BATAL';
type Hasil<T> = { ok: true; nilai: T; peringatan: Masalah[] } | { ok: false; masalah: Masalah[] };
```

Aturan implementasi:
- `hitungTabelHarga` menjalankan §3.4 lengkap (memanggil `validasiPagar` & `statusTayang`).
- `idVersiHarga` = 16 hex pertama SHA-256 atas JSON kanonik dari: `idSatuanJual`, `kode`, `isi`, `moqGrosir`, `modal.nilai`, `kodeKategori`, `tinjauanKategori`, `bebasPpn`, `sel` (level, jenis, nilai), konfigurasi `jenis_isi_sel_diizinkan`, `batas_atas_markup_bp`, `mitra_wajib_untuk_tayang`, `ppn.faktor`, `levelAktif`, `kategori_terlarang`. Dikecualikan: `sekarang`, `waktuData`, nama produk, konfigurasi promo/ongkir/biaya admin/syarat grup. Kunci objek terurut, integer desimal, `null` eksplisit.
- Harga, modal, potongan, ongkir dari klien diabaikan; server mengisi dari `harga_terhitung` & aturan tersimpan.
- Hasil `hitungTabelHarga` disimpan ke `harga_terhitung` dalam transaksi yang sama dengan perubahan modal/sel; katalog membaca cache.

---

## 8. Validasi panel admin & import CSV

### 8.1 Panel admin harga (T-037)
- Semua sel & MOQ grosir tampil **kosong** untuk produk baru; tidak ada salin otomatis.
- Per sel pilih `%` (maks 2 desimal) atau `Rp` (P-01). Panel menampilkan hasil harga dan markup; `HARGA_PECAHAN` ditampilkan dengan saran "isi harga Rupiah".
- Pratinjau: modal, harga per sel, pelanggaran pagar, status tayang + alasan, kartu & detail (PG-6), perbandingan grup vs sendiri.
- Simpan ditolak bila ada error; peringatan disimpan dengan konfirmasi tercatat di `log_admin`.
- Akses: `owner`/`admin` dengan izin `harga.ubah`, login OTP + TOTP (H9).

### 8.2 Import CSV (T-038)
Satu baris = satu satuan jual. UTF-8, pemisah koma/titik koma (dideteksi). Kolom:

| Kolom | Wajib | Format | Catatan |
|---|---|---|---|
| `sku_sumber` | ya | teks | Kunci ke `InventorySource` |
| `kode_satuan` | ya | `PCS`/`PCS3`/`LUSIN`/`DUS`/`KOLI` | Unik per SKU (P-03) |
| `nama`, `kategori`, `subkategori` | ya | teks | §8.3 |
| `isi` | ya | integer > 0 (pcs dasar) | — |
| `berat_gram` | ya | integer > 0 | Ongkir |
| `modal` | tidak | Rupiah integer > 0 | Per satuan jual (K-01). Mode `gudang`: diperlakukan sebagai **timpaan** (P-25) dan wajib `alasan_timpaan`; `kedaluwarsa_timpaan` opsional (K-03) |
| `alasan_timpaan`, `kedaluwarsa_timpaan` | kondisional | teks / tanggal | T-009 §7 |
| `harga_individu` | tidak | `12,5%` atau `Rp1.500` (contoh fiktif format) | Kosong = sel kosong |
| `harga_mitra_grosir` | tidak | sama | Boleh kosong (P-06) |
| `moq_grosir` | tidak | integer ≥ 1 | P-05 |
| `harga_franchise` | tidak | sama | Disiapkan |
| `bebas_ppn` | tidak | `ya`/`tidak` | G-04 |
| `aktif` | tidak | `ya`/`tidak` | `tidak` → `NONAKTIF_ADMIN` |

Format sel harga: diakhiri `%` = persen (desimal koma/titik, maks 2 desimal); diawali `Rp` = Rupiah (pemisah ribuan titik opsional, koma ditolak); angka polos → `FORMAT_HARGA`; minus → `MARGIN_NEGATIF`; hasil = modal → `MARGIN_NOL`.
Sel kosong pada produk **baru** = kosong; pada produk **lama** = nilai tersimpan **tidak berubah** (P-11); token `HAPUS` = mengosongkan.

Proses: validasi header → validasi per baris independen (status `DIIMPOR` / `DIIMPOR_TIDAK_TAYANG` / `DITOLAK` + kode) → mode `pratinjau` (bawaan, tanpa tulis) / `terapkan` (satu transaksi + `log_admin` dengan hash file) → duplikat (`sku_sumber`, `kode_satuan`) ditolak semua → template contoh tanpa angka modal/harga dan tanpa rokok/bir → ekspor/laporan menetralkan sel diawali `=`, `+`, `-`, `@`, tab, CR (CWE-1236).

### 8.3 Kategori terlarang (keputusan #7)
- Kode kategori di `kategori_terlarang` → `KATEGORI_DILARANG`, baris ditolak, panel menolak.
- Nama produk di kategori lain dicek dengan `kata_kunci_terlarang` (mis. rokok, kretek, cerutu, tembakau, vape, bir, beer, alkohol) dan `frasa_pengecualian` (mis. "bir pletok", "root beer"): nama dinormalisasi, pengecualian dihapus dulu, kata kunci dicocokkan sebagai **kata utuh**.
- Ada kecocokan → **ditahan untuk ditinjau** (`PERLU_TINJAUAN_KATEGORI`), bukan ditolak; admin memindah kategori atau menandai "bukan produk terlarang" (tercatat). Tanda hilang bila nama diubah.
- Cakupan persis **menunggu P-24**. Barang ber-rating usia tidak boleh masuk grup bersama akun yang tidak memenuhi syarat (catatan §13, Fase 3).

---

## 9. Matriks kasus uji (unit/properti T-020, skenario API T-044)

Konvensi: semua nilai **simbolik**. `M` modal satuan jual; `Hi = H(s,INDIVIDU)`; `Hg = H(s,MITRA_GROSIR)`; `Hf = H(s,FRANCHISE)`; `p` persen; `β`, `φ` dari konfigurasi uji; `Mc` modal cut-off. Fixture memakai angka fiktif yang diberi label "contoh fiktif" di T-011.

| ID | Input | Hasil diharapkan |
|---|---|---|
| TC-HE-01 | Modal kosong / ≤ 0 / pecahan | Tidak tayang `MODAL_KOSONG` / `MODAL_TIDAK_VALID` / `MODAL_PECAHAN`; tidak ada harga 0; tidak dibulatkan |
| TC-HE-02 | Satuan jual kode di luar P-03 / `isi` 0 / kode ganda | `SATUAN_TIDAK_VALID` |
| TC-HE-03 | Sel PERSEN dengan `M × p` habis dibagi 10000 | `H = M + M × p / 10000` persis |
| TC-HE-04 | Sel PERSEN dengan `M × p` tidak habis dibagi 10000 | `HARGA_PECAHAN`; sel tidak dipakai; tidak ada pembulatan (H6) |
| TC-HE-05 | Sel HARGA `H = M` | Ditolak `MARGIN_NOL` (P-16) |
| TC-HE-06 | Sel HARGA `H < M` / persen negatif | `MARGIN_NEGATIF` |
| TC-HE-07 | Sel (s, INDIVIDU) kosong | Satuan itu tidak tayang `SEL_KOSONG`; satuan lain produk sama tetap dinilai sendiri |
| TC-HE-08 | `Hg > Hi` | `PAGAR_LEVEL_DILANGGAR`, tidak tayang |
| TC-HE-09 | `Hg = Hi` | Lolos (K-14 mengizinkan sama) |
| TC-HE-10 | `Hf > Hg`, FRANCHISE nonaktif | Peringatan `PAGAR_LEVEL_NONAKTIF`, tetap tayang |
| TC-HE-11 | Sel MITRA_GROSIR kosong, `mitra_wajib_untuk_tayang = false` | Tayang; dalam grup baris memakai `Hi` + `GROSIR_TIDAK_TERSEDIA` (Q-05) |
| TC-HE-12 | Produk kena PPN, `H × φ_penyebut < M × φ_pembilang` (default Q-06) | `HARGA_DI_BAWAH_MODAL`, tidak tayang |
| TC-HE-13 | `ppn.faktor` kosong, produk kena PPN / bebas PPN | Tidak tayang `PPN_BELUM_DIKONFIGURASI` / tayang |
| TC-HE-14 | Kartu, detail, halaman grup untuk konteks sama | `idVersiHarga`, `hargaAktif`, `hargaGrup`, `hargaCoret` identik; promo terpisah |
| TC-HE-15 | Katalog | `hargaAktif = Hi`, `hargaGrup = Hg` |
| TC-HE-16 | Grup DIBUKA, syarat terpenuhi | `hargaAktif = Hg` |
| TC-HE-17 | Grup 3 akun, total < `grup.min_total` | `hargaAktif = Hi`; `perbandinganGrupVsSendiri` menampilkan `Hi × q`, `Hg × q`, selisih (K-18) |
| TC-HE-18 | Grup 2 akun berbarang, total ≥ `grup.min_total` | `syarat.terpenuhi = false`, `kurangAkun = 1` (K-17) |
| TC-HE-19 | Satu baris q ≥ `moq_grosir`, syarat grup tidak terpenuhi | `jenis = GROSIR_MOQ`, harga `Hg` (P-05) |
| TC-HE-20 | Syarat grup terpenuhi, baris 1 pcs | `jenis = GRUP`, harga `Hg` (K-09) |
| TC-HE-21 | Invoice: modal & sel diubah setelah invoice terbit | Snapshot `D`, `Mi` tidak berubah (K-15) |
| TC-HE-22 | Dua aturan diskon berlaku | Hanya satu (potongan terbesar setelah pembatasan) (P-15) |
| TC-HE-23 | Diskon membuat `(D × q − P) <ₚ Mi × q × β` | `P` dikurangi sampai batas; `PROMO_DIBATASI` (P-07, K-16) |
| TC-HE-24 | Diskon total dibagi ke 3 baris bobot sama | Σ bagian = total persis (sisa terbesar, seri → id baris) |
| TC-HE-25 | Biaya admin konfigurasi kosong / terisi `Ba`, mode host 4 akun | 0 / `4 × Ba` di invoice gabungan (K-06) |
| TC-HE-26 | Cut-off `Hc < D`, `a = q`, tanpa promo | `F = Hc`, `K = (D − Hc) × a` |
| TC-HE-27 | Cut-off `Hc > D` | `F = D`, `K = 0` bila `a = q`; tidak ada tagihan (P-19 default) |
| TC-HE-28 | Cut-off `D <ₚ Mc` | `DITAHAN` `DI_BAWAH_MODAL` (P-09) |
| TC-HE-29 | Cut-off `D ≥ₚ Mc` tetapi `(D × a − P_a) <ₚ Mc × a` | `DITAHAN` (P-26) |
| TC-HE-30 | Cut-off dengan promo, `T <ₚ Mc × a`, syarat lolos terpenuhi | `T' = L`, `K = B − L`, `ditahanPagar = L − T` berlabel biaya admin (P-23) |
| TC-HE-31 | Alokasi parsial `0 < a < q` | `K = B − T'` mencakup refund unit tak teralokasi |
| TC-HE-32 | `a = 0` dengan `D <ₚ Mc` | `TERKUNCI`, `hargaFinal = null`, `K = B`; tidak DITAHAN |
| TC-HE-33 | `danaDitahan = true` | `K` dihitung, `tulisKreditKeLedger = false` |
| TC-HE-34 | Refund grup BATAL | `Σ(D × q) − P_total + biaya admin` (Q-08 default) |
| TC-HE-35 | Invoice ongkir: minimal belanja vs nilai sesudah diskon | Sesuai nilai sesudah diskon (P-13) |
| TC-HE-36 | Gratis ongkir, satu baris gagal `≥ₚ Mc × a × β` | `TIDAK_MEMENUHI_SYARAT` + `alasan` + `jalanKeluar` berisi `AMBIL_DI_DROP_POINT`; pesanan tidak dibatalkan (P-27) |
| TC-HE-37 | Alokasi subsidi `S_total` ke baris | `ΣS_i = S_total` (P-20 default) |
| TC-HE-38 | `tampilanHarga` status DITAHAN / BATAL / HARGA_TERKUNCI tanpa `hargaFinal` | `hargaAktif = null` + teks / teks / `HARGA_TIDAK_TERSEDIA` |
| TC-HE-39 | Modal kedaluwarsa (> batas P-10) saat `tampilanHarga` / invoice / cut-off | `MODAL_KEDALUWARSA` / invoice ditolak / DITAHAN `HARGA_TIDAK_TERSEDIA` |
| TC-HE-40 | CSV format `12.5` / `12,5%` / `12,345%` / `Rp1.500` / `Rp1,5` (contoh fiktif format) | `FORMAT_HARGA` / 1250 bp / `FORMAT_PERSEN` / 1500 / `FORMAT_HARGA` |
| TC-HE-41 | CSV produk lama sel kosong / `HAPUS` | Tidak berubah (P-11) / dikosongkan |
| TC-HE-42 | CSV `modal` terisi saat mode `gudang` tanpa `alasan_timpaan` / dengan alasan | Ditolak / timpaan tersimpan (P-25) |
| TC-HE-43 | CSV kategori rokok / nama "Kretek Mild" di kategori lain / "Bir Pletok" | `DITOLAK` / `PERLU_TINJAUAN_KATEGORI` / normal |
| TC-HE-44 | CSV `pratinjau` lalu `terapkan`, 1 dari 10 baris rusak | Pratinjau tanpa tulis; 9 baris dalam satu transaksi |
| TC-HE-45 | Modal mendekati `Number.MAX_SAFE_INTEGER` | `ANGKA_OVERFLOW`, bukan hasil salah |
| TC-HE-46 | `hitungTabelHarga` dua kali input sama; ubah `waktuData`/nama; ubah satu sel | Identik; identik; `idVersiHarga` berubah |
| TC-HE-47 | Properti (acak) | Selalu PG-1, PG-2, PG-7, PG-8, `K ≥ 0`, Σ alokasi = total, tidak ada nilai non-integer di output Rupiah |

---

## 10. Keselarasan dengan dokumen lain & catatan untuk T-020

| # | Keselarasan | Dokumen | Tindakan |
|---|---|---|---|
| S-01 | Status grup & istilah anggota/pembayar | T-002 v0.6 | `StatusGrup` = enum T-002 apa adanya |
| S-02 | Snapshot modal saat invoice (K-15) menggantikan `modal_snapshot_grup` saat grup dibuka | T-009 v0.3 §7 | Selaras |
| S-03 | Kunci ledger `selisih:{grup_id}:{anggota_id}`, `refund:{anggota_id}` | T-002 v0.6, ADR §5.2 | ADR memakai nama lama `peserta_id`; disamakan saat T-004 |
| S-04 | ADR §5.1 masih menulis pembulatan ke atas (sebelum H6) | ADR-0001 | Di luar cakupan T-047; dokumen ini mengikuti H6 |
| S-05 | S&K §4.5 belum menyebut grup DITAHAN & kredit dibatasi | S&K | Disesuaikan manusia (#5) |
| S-06 | `keputusan.md` §4 "Pagar: diskon + gratis ongkir tidak di bawah modal" diperketat K-16 (≥ modal × β) | keputusan | PG-3 memakai β |

Catatan T-020: tidak ada angka modal/harga nyata di fixture; tes integrasi DB memastikan setiap `CHECK` §4.2 menolak; tes properti wajib (ADR §5.3).

---

## 11. Keputusan

### 11.1 Sudah diputuskan & penerapannya
| ID | Keputusan | Diterapkan di |
|---|---|---|
| P-01 | Margin persen per produk **atau** harga jual Rupiah manual | §2.2, §3.2, §8 |
| H6 / P-02 | Tanpa pembulatan | §3.1, §3.2 (pecahan → Q-06) |
| P-03 / F-04 | Satuan 1 pcs/3 pcs/lusin/dus/koli; MOQ Mitra per barang | §1.3, §2.2 |
| P-05 / K-08 | Tingkat terbawah "grosir" = Mitra Grosir, syarat qty per produk | §5.2 |
| K-09 / K-14 | Grup memenuhi syarat → setiap baris harga Mitra Grosir walau 1 pcs | §5.2 |
| K-17 / F-30 | Min 3 akun berbarang & total grup Rp100.000 | §5.2 (`syaratGrup`) |
| K-18 | Grup < Rp100.000 → harga satuan + perbandingan grup vs sendiri | §5.1, §7 |
| K-01 | Modal per satuan jual; pecahan → tidak tayang + tinjau | §3.3 |
| K-02 / K-03 / P-25 | Penurunan modal dicatat; timpaan sampai dicabut + kedaluwarsa opsional | §5.6, T-009 §7 |
| K-15 / P-08 | Snapshot harga & modal saat invoice | §5.3 |
| P-06 | Mitra tidak wajib untuk tayang | §2.3 |
| P-07 / K-16 | Promo dibatasi batas bawah dari modal (β di konfigurasi), juga gratis ongkir | PG-3, §6 |
| P-09 / P-26 | DITAHAN untuk admin, tidak pernah di bawah modal | PG-4, §5.4 |
| P-10 | Data modal maks 15 menit | §2.3 |
| P-11 | Sel CSV kosong = tidak berubah | §8.2 |
| P-12 / K-05 | Ongkir jadi dari aplikasi eksternal | §6.3 |
| P-13 | Minimal belanja gratis ongkir sesudah diskon | §6.3 |
| P-15 | Diskon tidak menumpuk | §6.1 |
| P-16 | Margin 0 ditolak | §3.2, PG-1 |
| P-22 | Pagar KETAT saja | PG-2 |
| P-23 | Kredit dibatasi, keterangan biaya admin | §5.5 |
| P-27 | Gratis ongkir gagal → tampilkan alasan + jalan keluar, tidak dibatalkan | §6.3 |
| P-28 | Harga Mitra drop point hanya di checkout | §5.1 |
| G-04 | PPN dari konfigurasi, harga tampil termasuk PPN | §3.5 |
| G-05 / K-06 | Biaya admin flat per akun per grup, nilai kosong | §6.2 |
| K-10 | Ongkir di invoice setelah final | §5.3, §6.3 |
| K-13 / G-06 | Satu ledger, 1 poin = Rp1, ke akun pembayar | §5.5 |

### 11.2 Masih terbuka
| ID | Topik | Rekomendasi agen | DEFAULT SEMENTARA | Pemilik |
|---|---|---|---|---|
| K-21 | Arti "diskon dihitung secara keseluruhan" | Satu diskon atas total pesanan, dibagi proporsional ke baris untuk pagar | `diskon.cakupan = TOTAL_INVOICE` | Efan |
| K-20 | Produk stok habis tampil/sembunyi | Tampil berlabel, tombol nonaktif | Sama (T-025) | Efan + Randy |
| P-19 | Harga cut-off > D tetapi ≥ modal | NEKAT menanggung | `F = min(D, Hc)` | Efan + Randy |
| P-20 | Alokasi subsidi gratis ongkir ke baris | Proporsional nilai bersih | `PROPORSIONAL_NILAI` | Efan + Joseph |
| P-21 | Tier grup opsional per produk | Tidak perlu lagi: K-14 menetapkan harga grup = Mitra Grosir; tier grup tambahan harus ≥ Mitra Grosir (pagar), jadi tidak memberi harga lebih murah | Tidak ada tier grup terpisah | Efan |
| P-14 | Pagar antar kemasan | Peringatan dulu | `HARGA_KEMASAN_TIDAK_WAJAR` | Efan |
| P-17 | Harga coret = harga satuan riil | Riil | `HARGA_SATUAN_RIIL` | Randy + Efan |
| P-18 | Batas COD sebelum/sesudah saldo | Sebelum saldo | Tidak relevan untuk grup (COD tidak di grup, T-002 A-03) | Randy + Joseph |
| P-24 | Cakupan kategori terlarang | Semua tembakau/nikotin & alkohol | Daftar §2.3 | Randy |
| **Q-05** (baru) | Harga Mitra Grosir diisi per satuan jual? Satuan tanpa sel Mitra Grosir di grup yang memenuhi syarat memakai harga apa? | Sel Mitra Grosir diisi per satuan jual (tanpa pembagian); kosong → harga satuan + label "tidak dapat harga grup" | Sama dengan rekomendasi | Efan |
| **Q-06** (baru) | PPN & pecahan rupiah: (a) pagar modal & batas promo dibanding harga **tanpa** PPN atau termasuk PPN? (b) H6 "tanpa pembulatan" vs hasil pecahan dari markup persen, diskon persen, pembagian diskon/subsidi, rincian PPN (Xendit hanya integer) | (a) tanpa PPN (nilai yang diterima NEKAT); (b) markup persen pecahan → "perlu ditinjau" (pola K-01); potongan & kredit pecahan dibuang ke arah yang tidak menembus pagar modal; rincian PPN mengikuti aturan konsultan pajak | (a) tanpa PPN; (b) seperti rekomendasi (§3.5, §3.6) | Efan (+ konsultan pajak) + Joseph |

Butir flow terkait: Q-01–Q-04, Q-07, Q-08 di `docs/flow/group-order.md` §12.2.

---

## 12. Catatan revisi

| Versi | Ringkasan |
|---|---|
| 0.3–0.5 | Model tier SATUAN/G0/G1/G2, pembulatan `bulatK`, bayar harga satuan di muka, sesi QA 11 Nov (riwayat di git) |
| 0.6 | Sinkron keputusan 12–14 Nov (T-047): model satuan jual × level, harga grup = Mitra Grosir, snapshot invoice, PPN, biaya admin, invoice ongkir; kasus uji simbolik |

## 13. Catatan Fase 3
Barang ber-rating usia (rokok/bir, keputusan #7) tidak boleh masuk grup bersama akun yang tidak memenuhi syarat usia (catatan §13 `keputusan.md`, bukan jawaban P-21).
