# Flow Ongkir, Armada & Slot Kirim — NEKAT Fase 1

| Atribut | Nilai |
|---|---|
| Task | T-006 (non-kode) |
| Versi | 0.1 — Draf, 27 Nov 2026 |
| Penyusun | Operations Manager (squad Harga & bisnis, pemilik: Efan) |
| Sumber wajib | `project-specs/keputusan.md` §4, §5, §11 (#4, F-12, F-20, H6, P-12), §12 (K-05, K-16), §13 (P-13, P-27), §14 (K-25, K-28, K-38, H13, P-19, P-20), §15 (F-13, F-21, F-25, F-28); `project-specs/keputusan-terbuka.md` (K-44, Z-02, Z-03, U-06) |
| Diselaraskan dengan | `docs/flow/group-order.md` (B-05, B-07, B-08, §6–§8), `docs/flow/pembayaran.md` (§5.6, §8.2, §15 T-1), `docs/spec/engine-harga.md` (§4, §6.3), `docs/spec/T-004-model-data.md` §3.4, §3.12, §3.13, skema `packages/db/src/skema/{lokasi,ongkir-promo-cod,grup,invoice}.ts`, `config/lokasi.example.json`, `packages/domain/src/zona.ts` |
| Dipakai oleh | T-031 (kalkulator ongkir & armada), T-033 (checkout), T-040 (picking & daftar antar), T-032, T-010, T-011, T-041 |

**Tidak ada angka tarif, harga, margin, kapasitas, jam slot, atau horizon di dokumen ini.** Semua parameter dibaca dari konfigurasi/adapter dan **kosong bawaan**. Kasus uji memakai simbol (`T0`, `Tkg`, `Tkm`, `K`, `B`, `J`). Hal yang belum diputuskan: "**menunggu X**" + **DEFAULT SEMENTARA** (asumsi kerja, bukan keputusan).

---

## 1. Cakupan

| Masuk | Tidak masuk |
|---|---|
| Rumus ongkir antar rumah & sumber tarif (adapter eksternal + fallback admin) | Angka tarif (#4: dari aplikasi eksternal) |
| Pemilihan armada terkecil yang cukup, pecah ke beberapa armada | Optimasi rute kurir (Fase 1 manual oleh admin) |
| Slot harian: pembuatan, batas pesan, cut-off, kapasitas, penuh, batal operasional | Akun kurir (H13: Fase 1 tanpa akun kurir) |
| Ambil di drop point (ongkir 0, tingkat Mitra, tampilan K-38) | Harga barang (engine-harga) |
| Pembagian ongkir per anggota grup (K-25, K-44) | Alur pembayaran (pembayaran.md) |
| Interaksi gratis ongkir & pagar modal | COD (hanya pesanan individu, K-31) |
| Daftar antar per slot (H13), cabang gagal, handoff, kasus uji | Pesanan individu "Beli sendiri" (F-27): aturan ongkir sama, alur pesanannya belum punya spec (pembayaran.md T-5) |

Prinsip Operations: (1) satu sumber kebenaran ongkir = server, klien tidak pernah mengirim ongkir; (2) tagihan tidak pernah naik setelah terbit (P-19) — selisih biaya kirim aktual ditanggung NEKAT dan dicatat untuk KPI biaya kirim/order (T-041); (3) tidak ada titik tunggal kegagalan: adapter tarif punya fallback, dan drop point selalu jadi jalan keluar (ongkir 0).

---

## 2. Model data yang dipakai

| Tabel / sumber | Kolom yang dipakai | Catatan |
|---|---|---|
| `armada` | `kode` (`MOTOR`/`TOSSA`/`PICKUP`), `kapasitas_gram`, `aktif` | Aktif wajib punya kapasitas (CHECK). **Tidak ada kolom volume** → O-06 |
| `tarif_armada` (versi, append-only) | `tarif_dasar_rp`, `tarif_per_kg_rp`, `tarif_per_km_rp` (NULL semua bawaan), `sumber_adapter`, `ref_eksternal`, `berlaku_mulai`, `diambil_pada` | `sumber_adapter` = nama adapter eksternal atau `ADMIN` (fallback panel) |
| `kuotasi_ongkir` | `grup_id`, `peserta_id` (NULL = kuotasi grup), `armada_kode`, `berat_gram`, `jarak_meter`, `ongkir_rp`, `sumber_adapter`, `ref_eksternal`, `berlaku_sampai`, `dipakai_di_invoice_id` | Satu baris **per unit armada** (pecah armada = beberapa baris, §4.3) |
| `slot_kirim` | `zona_id`, `tanggal`, `mulai`, `selesai`, `cut_off_pada`, `kapasitas_gram` (NULL = tanpa batas, T-004), `status` (`DIBUKA`/`DITUTUP`/`DIBATALKAN`) | `UK (zona_id, tanggal, mulai)` = kunci idempotensi pembuatan slot |
| `zona`, `drop_point`, `gudang` + `config/lokasi.json` | `zona.gudang_id` (cabang penerima, F-20), `drop_point.zona_id`, `jam_ambil`, koordinat & `radiusMeter` (2000–3000) di config | Radius dari drop point (§5); `tentukanZona`, `jarakMeter` di `packages/domain/src/zona.ts` |
| `peserta_grup` | `cara_kirim` (`ANTAR_RUMAH`/`DROP_POINT`), `alamat_id` / `drop_point_id`, `alamat_snapshot` [PII] | CHECK: tepat satu dari alamat/drop point sesuai cara kirim |
| `alamat` | `lat`, `lng`, `alamat_teks` [PII] | Tanpa koordinat → jarak tidak bisa dihitung (§9) |
| `satuan_jual` | `berat_gram` (≥ 0) | `0` dianggap **belum diisi** untuk ongkir (§9 CG-08) |
| `invoice`, `baris_invoice` | `ongkir_rp`, `subsidi_ongkir_rp`; baris `ONGKIR` / `SUBSIDI_ONGKIR` per `peserta_id`; `subsidi_ongkir_baris_rp` | K-25: ongkir di tagihan yang sama dengan barang |
| `aturan_gratis_ongkir`, `pemakaian_promo` | `minimal_belanja_rp`, `zona_id`, `level`, `subsidi_jenis`/`subsidi_maks_rp`, kuota; `alasan_tidak_memenuhi` | §7 |

### 2.1 Perubahan skema yang dibutuhkan (untuk T-031/T-040, migrasi expand)

| Usulan | Isi | Alasan |
|---|---|---|
| Tabel `pola_slot` | `zona_id`, `hari` (1–7, Senin = 1), `mulai`, `selesai`, `cut_off_menit_sebelum` (integer > 0), `kapasitas_gram` NULL, `aktif` (bawaan false); kolom angka kosong bawaan | Pembuatan slot harian otomatis (§5.1) |
| Tabel `pemakaian_slot` | `slot_id` FK, `grup_id` FK, `berat_gram` ≥ 0, `status` (`AKTIF`/`DILEPAS`); `UK (grup_id) WHERE status='AKTIF'` | Reservasi kapasitas saat tagihan terbit (§5.3) |
| Kolom `kuotasi_ongkir.urutan_armada` smallint + `rincian` jsonb | Urutan unit armada dalam satu kuotasi grup; snapshot tarif dasar/kg/km, mode adapter, sisa pecahan (**tanpa PII**) | Pecah armada & audit tarif |
| Kunci konfigurasi | `ongkir.usia_maks_tarif_menit`, `ongkir.batas_wajar_rp`, `slot.horizon_hari`, `slot.min_menit_grup_baru` — semua kosong bawaan | §3, §5 |
| Peta kunci ADR §3.2 | Sisipkan `slot_kirim` FOR UPDATE **setelah `grup`, sebelum stok SKU** | Cek kapasitas tanpa balapan |

---

## 3. Rumus ongkir antar rumah

### 3.1 Satuan ongkir

**DEFAULT SEMENTARA (menunggu O-03):** satu **pengiriman grup** = semua anggota `ANTAR_RUMAH` dalam satu grup, satu rute dari titik asal. Ongkir grup dihitung sekali lalu dibagi (§6). Dasar: K-25 ("host bayar semua → satu ongkir; bayar sendiri → dibagi rata") dan rekomendasi K-44 ("dibagi hanya ke anggota antar rumah").

Input:
- `B` = Σ (`satuan_jual.berat_gram` × qty) baris anggota `ANTAR_RUMAH` (gram, integer).
- `J` = jarak (meter, integer) — **menunggu O-02**. DEFAULT SEMENTARA: asal = gudang penerima zona (`zona.gudang_id`, F-20); jarak = jarak rute multi-titik dari aplikasi eksternal; fallback = jarak garis lurus **terjauh** asal → alamat antar rumah (`jarakMeter`).
- Armada terpilih (§4); per unit armada `u`: `B_u` (berat yang dimuat), `T0_u`, `Tkg_u`, `Tkm_u`.

### 3.2 Rumus (keputusan §4, K-05)

```
ongkir_u   = T0_u + (B_u / 1000) × Tkg_u + (J / 1000) × Tkm_u
ongkir_grup = Σ_u ongkir_u
```
Semua tarif = **parameter kosong**; dibaca dari sumber tarif (§3.3). Tidak ada nilai di kode/seed.

### 3.3 Sumber tarif (#4, K-05, P-12) — port `SumberTarifOngkir`

Urutan, berhenti di sumber pertama yang valid:

| # | Sumber | Syarat valid | Dicatat |
|---|---|---|---|
| 1 | **Adapter aplikasi eksternal** (live). Dua mode, dipilih konfigurasi: `ONGKIR_JADI` (adapter mengembalikan Rupiah jadi per unit armada; pembulatan ikut adapter, P-12) atau `TARIF` (adapter mengembalikan T0/Tkg/Tkm; NEKAT menghitung §3.2) | Respon dalam batas waktu, integer ≥ 0, IDR, `armada_kode` sama, `ref` ada | `kuotasi_ongkir.sumber_adapter`, `ref_eksternal`; mode `TARIF` → versi baru `tarif_armada` |
| 2 | Tarif eksternal tersimpan terakhir (`tarif_armada`, sumber eksternal) | `diambil_pada ≥ sekarang − ongkir.usia_maks_tarif_menit`; ketiga tarif non-NULL. Konfigurasi kosong → sumber ini dilewati | sama |
| 3 | **Fallback konfigurasi admin** (`tarif_armada.sumber_adapter = 'ADMIN'`, versi terbaru `berlaku_mulai ≤ sekarang`) | Ketiga tarif non-NULL | `sumber_adapter = 'ADMIN'` + log peringatan "ongkir dari tarif cadangan" |
| 4 | Tidak ada | — | `ONGKIR_TIDAK_TERSEDIA` → antar rumah tidak bisa dipilih; drop point tetap bisa (§9 CG-01) |

- Respon adapter pecahan, negatif, mata uang lain, atau > `ongkir.batas_wajar_rp` (bila diisi) → **tidak valid**, lanjut sumber berikutnya + log (bukan diterima diam-diam).
- Panggilan adapter **di luar transaksi DB** (ADR §3.3); hasilnya disimpan sebagai `kuotasi_ongkir` dengan `berlaku_sampai`, lalu dipakai di transaksi penerbitan tagihan.
- Kunci API adapter dari environment variable (CLAUDE.md #6). Data ke adapter: koordinat & berat saja — **tanpa** nama/HP/alamat teks.

### 3.4 Pecahan rupiah (H6, K-28)

Berat dalam gram dan jarak dalam meter membuat `(B_u × Tkg_u + J × Tkm_u) / 1000` bisa pecahan.
- Hitung **eksak** dengan integer: `pembilang_u = 1000 × T0_u + B_u × Tkg_u + J × Tkm_u`; `ongkir_u = pembilang_u / 1000`.
- Tidak ada pembulatan ke ratusan/ribuan (H6).
- Sisa pecahan < Rp1: **menunggu O-01**. DEFAULT SEMENTARA: dibuang (`floor`) — pembeli diuntungkan, NEKAT menanggung < Rp1 per unit armada; sisa dicatat di `kuotasi_ongkir.rincian` (mengikuti pola K-28 "potongan diskon pecahan dibuang").
- Mode `ONGKIR_JADI`: angka adapter dipakai apa adanya (P-12).

---

## 4. Pemilihan armada terkecil yang cukup

### 4.1 Kandidat
Armada `aktif = true`, `kapasitas_gram` terisi, dan punya tarif valid dari §3.3. Urut naik `kapasitas_gram`; seri → ongkir lebih kecil; seri → `kode` alfabet (deterministik).

### 4.2 Satu armada cukup (`B ≤ Kmax`)
Pilih kandidat pertama dengan `kapasitas_gram ≥ B`. Volume: **menunggu O-06** (DEFAULT SEMENTARA: berat saja).

### 4.3 Melebihi armada terbesar (`B > Kmax`) — pecah
```
n_penuh = B div Kmax          (pembagian bulat, bukan pembulatan rupiah)
R       = B − n_penuh × Kmax
unit    = n_penuh × armada terbesar (B_u = Kmax) + (R > 0 ? armada terkecil yang cukup untuk R : —)
```
- Satu unit satuan jual (mis. 1 koli) dengan `berat_gram > Kmax` → `ARMADA_TIDAK_CUKUP` untuk peserta itu: antar rumah tidak bisa dipilih, tawarkan drop point + antrean tinjauan admin.
- Ini **armada tagih** (dasar ongkir). Muatan fisik per slot disusun ulang di daftar antar (§8); selisih biaya aktual vs tagih → laporan T-041, tidak pernah ditagihkan ke pembeli (P-19).
- Batas jumlah unit per grup: tidak ada di Fase 1; kapasitas slot (§5.3) yang membatasi.

---

## 5. Slot kirim harian

### 5.1 Pembuatan
- Job harian `buat-slot:{zona_kode}:{tanggal}` (WIB) membuat `slot_kirim` untuk `tanggal` s.d. `hari ini + slot.horizon_hari` dari `pola_slot` aktif zona itu. Horizon tampil: **U-06** (rekomendasi 7 hari).
- Idempoten: `UK (zona_id, tanggal, mulai)` → `ON CONFLICT DO NOTHING`. Perubahan `pola_slot` hanya memengaruhi slot yang **belum** dibuat; slot yang sudah ada diubah lewat panel (tercatat audit).
- `cut_off_pada = (tanggal + mulai) WIB − cut_off_menit_sebelum`; CHECK DB: cut-off < awal slot.
- Zona `aktif = false`, pola kosong, atau angka pola kosong → tidak ada slot (UI: "Belum ada jadwal kirim di zonamu", T-008 §3.4).
- Zona/drop point/gudang berubah saat slot masih `DIBUKA`: **Z-03** (DEFAULT SEMENTARA: sinkron ditolak, bisa dipaksa admin). Drop point dilayani gudang lain: **Z-02** (DEFAULT: tidak).

### 5.2 Batas pesan & cut-off
| Batas | Aturan | Kode bila dilanggar |
|---|---|---|
| Buat grup / gabung | `status = DIBUKA` ∧ `cut_off_pada − sekarang ≥ max(TTL invoice, slot.min_menit_grup_baru)` (kosong → hanya TTL) | 409 `SLOT_TERLALU_DEKAT_CUTOFF` |
| Terbit tagihan (manual K-22 / otomatis K-39) | `sekarang + TTL ≤ cut_off_pada` (group-order A-04) ∧ kapasitas cukup (§5.3) | 409 `MELEWATI_BATAS_CHECKOUT`, 409 `SLOT_PENUH` |
| Cut-off | Job `cutoff:{slot_id}` (group-order §6); slot → `DITUTUP` setelah semua grupnya diproses | — |

### 5.3 Kapasitas
- `kapasitas_gram` per slot; NULL = tanpa batas (T-004) — panel admin menampilkan peringatan "kapasitas belum diisi".
- Yang dihitung: berat **semua** baris tagihan grup di slot (antar rumah **dan** drop point, karena barang drop point juga diangkut dari gudang). Konservatif.
- Reservasi di transaksi penerbitan tagihan: kunci `grup` → `slot_kirim` FOR UPDATE → cek `Σ pemakaian_slot AKTIF + B_grup ≤ kapasitas_gram` → insert `pemakaian_slot`. Gagal → seluruh penerbitan rollback, 409 `SLOT_PENUH`.
- Dilepas/dikurangi di transaksi yang sama dengan: peserta dikeluarkan (K-12), grup batal (K-11, F-13), baris stok habis (K-29), alokasi parsial cut-off (F-09).
- Tampilan slot (U-06): `bisaDipilih = false` + chip "Penuh" bila terpakai ≥ kapasitas; tanpa angka sisa. Grup `DIBUKA` belum mereservasi, jadi slot bisa penuh sebelum tagihan grup terbit → §9 CG-05.

### 5.4 Batal operasional (F-21)
1. Admin (TOTP) menandai slot `DIBATALKAN` + alasan wajib + slot pengganti (zona sama). Override kapasitas slot pengganti boleh, tercatat.
2. Semua grup slot itu dipindah ke slot pengganti dalam satu transaksi per grup; **harga & ongkir tagihan tetap** (F-21, P-19). `pemakaian_slot` dipindah.
3. WA ke semua anggota: jadwal baru + pilihan "Tetap kirim" / "Batalkan pesanan".
4. Anggota minta batal → refund **seluruh** bagian tagihannya (barang + biaya admin + ongkir − subsidi) ke saldo **pembayar**, kunci `refund:{peserta_id}:SLOT_BATAL:{slot_id}` (pembayaran.md §8.2). Mode `HOST`: anggota tetap boleh minta batal; dana ke saldo host (G-06b). Sisa grup tetap jalan walau < 3 (harga sudah terkunci/terbayar).
5. Slot batal **sebelum** harga dikunci: **menunggu O-10** (DEFAULT SEMENTARA: perlakuan sama dengan langkah 1–4; grup `DIBUKA` ikut pindah).

---

## 6. Ambil di drop point & pembagian ongkir

### 6.1 Ambil di drop point (keputusan §4, F-12)
- Ongkir ke rumah = **0**; tidak ada baris `ONGKIR` untuk peserta itu; tidak dihitung ke `B` ongkir (tetap dihitung ke kapasitas slot).
- Drop point harus `aktif` dan di **zona grup** (group-order §8.1), dilayani gudang zona (Z-02).
- "Tingkat Mitra": di grup, harga grup sudah = Mitra Grosir (K-14) untuk antar rumah maupun drop point; grup < Rp100.000 → harga satuan (K-18) kecuali MOQ grosir (P-05). Cara kirim **tidak** mengubah jenis harga (engine-harga §5.2) — **menunggu O-05** untuk "Beli sendiri" & grup < Rp100.000.
- Tampilan (K-38, P-28): kata "Mitra" dan info drop point **hanya di checkout**. Kartu/detail/pemilih slot/WA tidak menyebutnya (T-008 R2).
- Checkout menampilkan perbandingan (K-25): "Antar ke rumah · ongkir perkiraan Rp{x}" vs "Ambil sendiri di {drop point} ({jam_ambil}) · ongkir Rp0". Perkiraan = bagian rata saat ini (§6.2) dan bisa berubah sampai tagihan terbit karena jumlah anggota antar rumah berubah; label "perkiraan" wajib.

### 6.2 Pembagian ongkir per anggota (K-25, K-44)

| Mode bayar | Tagihan |
|---|---|
| `HOST` | Satu ongkir grup di invoice gabungan host (tampil satu angka). Baris `ONGKIR` tetap ditulis **per peserta antar rumah** dengan bagian di bawah, agar refund per peserta bisa dihitung |
| `SENDIRI` | Ongkir grup dibagi rata ke peserta `ANTAR_RUMAH` saja (**DEFAULT SEMENTARA K-44**); peserta drop point = 0 |

Pembagian integer, tanpa pembulatan:
```
n = jumlah peserta ANTAR_RUMAH ber-tagihan;  q = ongkir_grup div n;  r = ongkir_grup − n × q   (0 ≤ r < n)
bagian(p) = q              untuk semua p
bagian(penerima_sisa) += r
```
- `penerima_sisa` = host (**DEFAULT SEMENTARA K-44**). Host memilih drop point → **menunggu O-04** (DEFAULT SEMENTARA: peserta antar rumah yang paling awal bergabung).
- Σ bagian = ongkir grup (invarian, diuji).
- Dihitung **sekali** saat tagihan terbit (K-25), di transaksi penerbitan, dari `kuotasi_ongkir` yang belum kedaluwarsa (kedaluwarsa → minta kuotasi ulang di luar transaksi, lalu ulang).
- Setelah terbit **tidak dihitung ulang** (P-19 tidak pernah tagih tambahan): peserta dikeluarkan (K-12) → bagiannya tidak dibebankan ke anggota lain; NEKAT menanggung. Alokasi parsial / stok habis sebagian: **menunggu O-07** (DEFAULT SEMENTARA: tidak ada refund ongkir; refund bagian ongkir hanya bila **semua** barang peserta antar rumah batal / alokasi 0, `REFUND_ONGKIR`, kunci `refund_ongkir:{invoice_id}:{peserta_id}`).
- Ganti cara kirim/alamat setelah tagihan terbit: tidak bisa (F-25). Sebelum terbit, dalam zona sama: boleh; kuotasi diulang.

---

## 7. Gratis ongkir & pagar modal

Dengan K-25 gratis ongkir dievaluasi **saat tagihan terbit** (bukan lagi di invoice ongkir terpisah).

1. Aturan dicek per tagihan akun (mode `HOST`: per bagian akun dalam invoice gabungan, seperti diskon engine-harga §6.1 langkah 5). Hanya peserta antar rumah dengan bagian ongkir > 0.
2. Minimal belanja dihitung **sesudah diskon** (P-13): `Σ(D × q − P)` akun.
3. Subsidi `S` ≤ bagian ongkir akun (CHECK `subsidi_ongkir_rp ≤ ongkir_rp`); `PENUH` = seluruh bagian, `MAKS` = min(bagian, `subsidi_maks_rp`).
4. Alokasi `S` ke baris menurut harga barang (P-20, `PROPORSIONAL_NILAI`, sisa terbesar; Σ = S).
5. Pagar per baris saat terbit: `(D × q − P − S_i) ≥ₚ Mi × q × (1 + β/10000)` (K-16, PG-3). Lantai DB: `harga×qty − potongan − subsidi ≥ modal×qty`.
6. Gagal → **tidak dibatalkan** (P-27): `GRATIS_ONGKIR_TIDAK_MEMENUHI_SYARAT` + alasan + jalan keluar `AMBIL_DI_DROP_POINT` / `BAYAR_ONGKIR_NORMAL` / tambah barang (T-007: "[Tambah barang] [Ambil sendiri di drop point] [Lanjut tanpa gratis ongkir]"). `pemakaian_promo.status = TIDAK_MEMENUHI`.
7. Saat cut-off: nilai bersih final setelah promo **dan subsidi ongkir** < modal terkini → grup **DITAHAN** (P-09, P-26; CHECK `nilai_bersih_final_rp ≥ modal_cutoff × a + subsidi`). DITAHAN sampai sebelum picking → BATAL + refund penuh termasuk ongkir (F-13).
8. Biaya admin tidak dipakai meloloskan pagar (engine-harga §6.2). Ongkir bukan bagian harga barang dan tidak masuk cek modal.

---

## 8. Daftar antar per slot (H13)

Dibuat job T-040 setelah cut-off slot selesai (semua grup `HARGA_TERKUNCI`/`DITAHAN`/`BATAL`), kunci `daftar-antar:{slot_id}`; dibuat ulang (versi baru) bila admin mengubah penugasan.

| Bagian | Isi | PII |
|---|---|---|
| Ringkasan slot | zona, tanggal, jam, total berat, jumlah stop, jumlah paket drop point, armada usulan (§4 atas total berat slot), selisih armada tagih vs usulan | Tidak |
| Per armada (urutan muat) | stop: kode paket (`{kode_grup}-{nomor}`), nama penerima, HP, alamat + patokan + catatan kurir, jumlah koli/berat | **Ya** — minimal yang dibutuhkan kurir |
| Serah ke drop point | per drop point: kode paket, nama samaran, jumlah koli | Tidak (nama samaran) |

- Fase 1: admin membagikan daftar ke kurir lokal **tanpa akun kurir** (H13). Penugasan stop ke armada & urutan: admin (manual), sistem hanya mengusulkan.
- Cara berbagi & retensi: **menunggu O-12**. DEFAULT SEMENTARA: hanya unduh/cetak dari panel admin (login TOTP, H9), setiap unduhan tercatat (`log_audit`), **tidak lewat n8n/WA otomatis** (H4: n8n tanpa PII), berkas tidak disimpan di server setelah dibuat.
- Status antar per paket (Diantar / Diterima / Gagal antar) diubah admin di panel T-039.
- Daftar picking (gudang) terpisah dan **tanpa PII** (`picking:{grup_id}`, T-009 §2).

---

## 9. Cabang gagal & pemulihan

| # | Kondisi | Deteksi | Perilaku | Pemulihan / idempotensi |
|---|---|---|---|---|
| CG-01 | Adapter tarif eksternal mati / respon tidak valid | Timeout, 5xx, validasi §3.3 | Turun ke sumber 2 → 3; log peringatan + metrik `ongkir_sumber` | Retry backoff di luar transaksi; alert admin bila sumber 3 dipakai > ambang (T-010) |
| CG-02 | Semua sumber tarif kosong (belum diisi / adapter mati tanpa fallback) | `ONGKIR_TIDAK_TERSEDIA` | Antar rumah nonaktif di checkout ("Antar ke rumah belum tersedia, ambil sendiri di drop point"); terbit tagihan manual ditahan bila ada peserta antar rumah: "Ongkir sedang dihitung, coba lagi" | Terbit otomatis K-39 di batas waktu: **menunggu O-08** (DEFAULT SEMENTARA: peserta antar rumah dialihkan ke drop point, ongkir 0, WA pemberitahuan) |
| CG-03 | Armada nonaktif semua / kapasitas kosong | Kandidat §4.1 kosong | Sama dengan CG-02 | Admin mengisi armada |
| CG-04 | Satu unit barang > armada terbesar | §4.3 | `ARMADA_TIDAK_CUKUP` untuk peserta itu; hanya drop point | Antrean tinjauan admin |
| CG-05 | Slot penuh saat terbit tagihan | `SLOT_PENUH` di transaksi | Tagihan tidak terbit; host diberi tahu | **Menunggu O-09** (DEFAULT SEMENTARA: admin menambah kapasitas atau memindah grup ke slot lain, tercatat; host tidak bisa memindah sendiri) |
| CG-06 | Alamat di luar radius zona | `tentukanZona` ≠ zona grup | 422/403 `LUAR_ZONA`: "Alamat ini di luar zona {zona}. Pilih drop point atau alamat lain" | Daftar tunggu WA bila di luar semua zona (F-18) |
| CG-07 | Alamat tanpa koordinat | `lat/lng` NULL | 422 `ALAMAT_BUTUH_TITIK`: minta pin lokasi | — |
| CG-08 | `berat_gram = 0` pada baris antar rumah | Validasi §3.1 | 422 `BERAT_BELUM_DIISI`; antar rumah tidak bisa untuk keranjang itu; drop point boleh | Antrean tinjauan `BERAT_KOSONG` → admin/CSV (T-038) |
| CG-09 | Kuotasi kedaluwarsa saat transaksi terbit | `berlaku_sampai < sekarang` | Rollback, kuotasi ulang di luar transaksi, ulang (maks. sekali; gagal → CG-02) | Kuotasi lama tidak dipakai (`dipakai_di_invoice_id` NULL) |
| CG-10 | Ongkir adapter > `ongkir.batas_wajar_rp` | §3.3 | Dianggap tidak valid → sumber berikutnya + alert | Admin memeriksa adapter |
| CG-11 | Slot batal operasional | Admin | §5.4 (F-21) | `refund:{peserta_id}:SLOT_BATAL:{slot_id}` |
| CG-12 | Armada fisik kurang di hari kirim | Admin saat menyusun daftar antar | Admin memindah sebagian grup lewat §5.4 atau menambah armada; biaya tambahan ditanggung NEKAT | Tercatat di laporan biaya kirim |
| CG-13 | Antar gagal (penerima tidak ada / tak bisa dihubungi) | Status kurir via admin | **Menunggu O-11** (DEFAULT SEMENTARA: paket dibawa ke drop point zona, WA "Siap diambil di {drop point}", tanpa ongkir tambahan, ongkir tidak dikembalikan) | Tidak diambil → alur F-28 |
| CG-14 | Grup DITAHAN di cut-off (F-13) | Job cut-off | Tidak masuk daftar antar; sampai sebelum picking tidak dilepas → BATAL + refund penuh termasuk ongkir | Kunci refund pembayaran.md §8.2 |
| CG-15 | Job buat slot tidak jalan | Tidak ada slot untuk besok | Alert DevOps; job idempoten, jalankan ulang | `UK (zona_id, tanggal, mulai)` |
| CG-16 | Zona/drop point dihapus saat slot DIBUKA | Sinkron config | Z-03 | — |

---

## 10. Kontrak handoff

Semua id dari server; `akun_id` dari sesi; ongkir/berat/jarak dari klien diabaikan (group-order §8.1).

### 10.1 T-031 — kalkulator ongkir & armada (`packages/domain/ongkir`, fungsi murni + port)

```ts
type Gram = number; type Meter = number; type Rupiah = bigint;
interface Armada { kode: string; kapasitasGram: Gram }
interface Tarif { t0: Rupiah; perKg: Rupiah; perKm: Rupiah; sumber: string; ref: string | null }

// Port (adapter di luar transaksi). Mode dari konfigurasi.
interface SumberTarifOngkir {
  ambil(p: { armadaKode: string; zonaKode: string; asal: Koordinat; tujuan: Koordinat[]; beratGram: Gram }):
    Promise<{ mode: 'TARIF'; tarif: Tarif; jarakMeter?: Meter } | { mode: 'ONGKIR_JADI'; ongkir: Rupiah; jarakMeter: Meter; ref: string }>;
}

function pilihArmada(beratGram: Gram, kandidat: Armada[]):            // §4, deterministik
  { ok: true; unit: { armadaKode: string; beratGram: Gram }[] } | { ok: false; kode: 'ARMADA_TIDAK_CUKUP' | 'ARMADA_KOSONG' };
function hitungOngkirUnit(beratGram: Gram, jarakMeter: Meter, t: Tarif):  // §3.2–§3.4
  { ongkir: Rupiah; sisaPecahanPer1000: number };
function bagiOngkir(ongkirGrup: Rupiah, pesertaAntar: { pesertaId: string; bergabungPada: Date }[], hostId: string):
  Map<string, Rupiah>;                                                  // §6.2, Σ = ongkirGrup
```
Error domain: `ONGKIR_TIDAK_TERSEDIA`, `ARMADA_TIDAK_CUKUP`, `ARMADA_KOSONG`, `BERAT_BELUM_DIISI`, `ALAMAT_BUTUH_TITIK`, `LUAR_ZONA`, `TARIF_TIDAK_VALID`. Panel admin: armada (kapasitas, aktif) & tarif fallback `ADMIN` — semua field kosong bawaan, simpan ditolak bila negatif.

### 10.2 T-033 — checkout

| Panggilan | Data | Sukses | Gagal |
|---|---|---|---|
| `GET grup/{kode}/opsi-kirim` | (sesi) | `[{cara: 'ANTAR_RUMAH', ongkirPerkiraanRp, tersedia, alasan?}, {cara: 'DROP_POINT', ongkirRp: 0, dropPoint: {nama, jamAmbil}}]` + label "perkiraan" | 404 |
| `PUT grup/{kode}/cara-kirim` (sebelum terbit) | `cara_kirim`, `id_alamat?` / `id_drop_point?` | ringkasan baru | 403 `LUAR_ZONA`, 422 `ALAMAT_BUTUH_TITIK`, 422 `BERAT_BELUM_DIISI`, 409 `TAGIHAN_SUDAH_TERBIT` (F-25), 503 `ONGKIR_TIDAK_TERSEDIA` (antar saja) |
| `POST grup/{kode}/checkout` | (group-order §8) | tagihan berisi `ongkir_rp`, `subsidi_ongkir_rp`, status gratis ongkir + `jalanKeluar[]` | + 409 `SLOT_PENUH`, 503 `ONGKIR_SEDANG_DIHITUNG` |
| `GET zona/{id}/slot-kirim` | `untuk` | T-008 §3.3 (`bisaDipilih`, `alasan`) | — |

### 10.3 T-040 — job pasca cut-off

| Event / masukan | Data | Keluaran |
|---|---|---|
| `SlotDitutup` (outbox internal setelah job `cutoff:{slot_id}` SELESAI) | `slot_id`, daftar `grup_id` `HARGA_TERKUNCI` | Picking per grup (`picking:{grup_id}`, tanpa PII) + daftar antar `daftar-antar:{slot_id}` (§8) |
| Penugasan admin | `slot_id`, stop → armada, urutan | Versi daftar antar baru (audit) |
| Status antar | `paket_id`, status, catatan | Peserta → DIKIRIM/DITERIMA/SIAP_DIAMBIL (group-order A12), WA T-010 |
| Laporan (T-041) | per slot: ongkir ditagih, subsidi, biaya armada usulan | `biaya_kirim_per_order` |

---

## 11. Kasus uji (simbolik; T-011, T-031, T-044)

| ID | Skenario | Harapan |
|---|---|---|
| TC-OS-01 | `B ≤ K_motor`, tarif lengkap | Armada `MOTOR`, `ongkir = T0 + B/1000×Tkg + J/1000×Tkm` |
| TC-OS-02 | `K_motor < B ≤ K_tossa` | `TOSSA` |
| TC-OS-03 | Dua armada kapasitas sama | Ongkir lebih kecil; seri → kode alfabet |
| TC-OS-04 | `B = 2×Kmax + R`, `0 < R ≤ K_motor` | 2 × armada terbesar + 1 `MOTOR`; Σ ongkir per unit |
| TC-OS-05 | `B = n×Kmax` | n × armada terbesar, tanpa unit sisa |
| TC-OS-06 | Satu unit barang > Kmax | `ARMADA_TIDAK_CUKUP`; drop point tetap tersedia |
| TC-OS-07 | `B×Tkg + J×Tkm` tidak habis dibagi 1000 | Ongkir = floor (DEFAULT O-01); sisa tercatat; tidak ada pembulatan ke ratusan |
| TC-OS-08 | Adapter mode `ONGKIR_JADI` valid | Angka adapter dipakai apa adanya (P-12) |
| TC-OS-09 | Adapter timeout, tarif eksternal tersimpan masih dalam usia maks | Sumber 2 dipakai |
| TC-OS-10 | Adapter mati, usia maks kosong, tarif `ADMIN` lengkap | Sumber 3, log peringatan |
| TC-OS-11 | Semua sumber kosong | `ONGKIR_TIDAK_TERSEDIA`; antar nonaktif; drop point bisa |
| TC-OS-12 | Adapter mengembalikan pecahan / negatif / > batas wajar | Tidak valid → sumber berikutnya |
| TC-OS-13 | Mode `SENDIRI`, 3 antar rumah, ongkir habis dibagi 3 | Bagian sama, Σ = ongkir grup |
| TC-OS-14 | Mode `SENDIRI`, ongkir = 3q + 2 | Host antar rumah dapat q + 2, lainnya q (K-44 default) |
| TC-OS-15 | Host memilih drop point, sisa r > 0 | Sisa ke antar rumah paling awal (O-04); host ongkir 0 |
| TC-OS-16 | Mode `HOST` | Satu angka ongkir di invoice host; baris `ONGKIR` per peserta antar; Σ = ongkir grup |
| TC-OS-17 | Semua peserta drop point | Tidak ada kuotasi, ongkir 0 |
| TC-OS-18 | Peserta antar dikeluarkan setelah terbit (K-12) | Bagian lain tidak berubah; tidak ada tagihan tambahan |
| TC-OS-19 | Semua barang satu peserta antar alokasi 0 | `REFUND_ONGKIR` bagian peserta, kunci deterministik; rerun tidak menggandakan |
| TC-OS-20 | Gratis ongkir: minimal belanja dicek sesudah diskon | P-13 |
| TC-OS-21 | Gratis ongkir: satu baris gagal `≥ₚ Mi×q×(1+β)` | `TIDAK_MEMENUHI_SYARAT` + jalan keluar; tagihan tetap bisa terbit |
| TC-OS-22 | Cut-off: modal naik, bersih − subsidi < modal | Grup DITAHAN (P-26) |
| TC-OS-23 | Dua grup terbit bersamaan, sisa kapasitas cukup untuk satu | Tepat satu sukses, satu `SLOT_PENUH` (kunci slot) |
| TC-OS-24 | Peserta dikeluarkan | `pemakaian_slot` berkurang di transaksi sama |
| TC-OS-25 | `kapasitas_gram` NULL | Tanpa batas; panel menampilkan peringatan |
| TC-OS-26 | Job buat slot dijalankan dua kali | Tidak ada slot ganda |
| TC-OS-27 | Buat grup saat `cut_off − sekarang < TTL` | 409 `SLOT_TERLALU_DEKAT_CUTOFF` |
| TC-OS-28 | Slot dibatalkan setelah harga terkunci, anggota minta batal | Refund penuh (termasuk ongkir − subsidi) ke saldo pembayar; harga anggota lain tetap |
| TC-OS-29 | Alamat di luar radius / tanpa koordinat | `LUAR_ZONA` / `ALAMAT_BUTUH_TITIK` |
| TC-OS-30 | Ganti cara kirim setelah tagihan terbit | 409 `TAGIHAN_SUDAH_TERBIT` (F-25) |
| TC-OS-31 | Klien mengirim `ongkir_rp`/`berat` di body | Diabaikan/400; nilai dari server |
| TC-OS-32 | DOM kartu/detail/pemilih slot | Tidak ada "Mitra", "drop point", nominal ongkir (K-38, T-008 R2) |
| TC-OS-33 | Payload ke adapter & daftar picking | Tanpa nama/HP/alamat teks |
| TC-OS-34 | Unduh daftar antar | Hanya admin TOTP; tercatat di log audit |

---

## 12. Temuan ketidaksesuaian dokumen (untuk sinkron, mis. T-047)

| # | Temuan | Usulan |
|---|---|---|
| S-1 | `engine-harga.md` §6.3 & PG-3/PG-4 masih menganggap gratis ongkir di invoice ongkir **setelah** cut-off (K-10, `Mc × a`); K-25 memindahkan ongkir ke tagihan saat terbit, sehingga PG-3 ongkir memakai `Mi × q` dan PG-4 cut-off **harus** memuat subsidi (sesuai CHECK `nilai_bersih_final_rp` dan P-26) | Perbarui engine-harga §4.1, §6.3, `hitungInvoiceOngkir` |
| S-2 | `group-order.md` B-08, §1 "Invoice ongkir", §6 langkah 7; `T-007-ux-halaman.md` "Tagihan kedua (ongkir)" & teks "Ongkir ditagih di tagihan final" | Ikuti K-25 (sama dengan pembayaran.md T-1) |
| S-3 | `group-order.md` §8 `hitungOngkir` per `anggota_id`; dokumen ini per grup (O-03) | Selaraskan setelah O-03 |
| S-4 | T-004 §3.12 tidak menyebut `kuotasi_ongkir.grup_id` & `peserta_id` NULL = kuotasi grup (sudah ada di skema) | Perbarui T-004 |
| S-5 | ADR §3.2 peta kunci belum memuat `slot_kirim` | Tambah setelah `grup` (§2.1) |
| S-6 | T-007 layar Buat Grup butir 4 menyebut drop point di luar checkout (T-008 temuan 2) | Ikuti K-38 |

---

## 13. Keputusan terbuka baru

ID sementara; dipindah ke `project-specs/keputusan-terbuka.md` oleh sesi berikutnya. Sampai diputuskan berlaku **DEFAULT SEMENTARA** (= rekomendasi). Butir lama terkait yang tetap terbuka: **K-44** (DEFAULT SEMENTARA: sisa ke host, dibagi hanya ke antar rumah), **Z-02**, **Z-03**, **U-06**.

| ID | Pertanyaan | Pemilik | Rekomendasi = DEFAULT SEMENTARA |
|---|---|---|---|
| O-01 | Rumus fallback (gram × tarif/kg, meter × tarif/km) bisa menghasilkan pecahan < Rp1. Diapakan, mengingat H6/K-28 tanpa pembulatan? | Efan | Hitung eksak; pecahan < Rp1 **dibuang** (pembeli diuntungkan, NEKAT menanggung), dicatat per kuotasi — pola sama dengan K-28 potongan diskon |
| O-02 | "Jarak km" di rumus ongkir: titik asal (gudang penerima atau drop point) dan cara ukur untuk grup dengan banyak alamat | Efan (+ Operations) | Asal = gudang penerima zona (F-20); jarak = jarak rute multi-titik dari aplikasi eksternal; fallback = jarak garis lurus terjauh asal → alamat antar rumah |
| O-03 | Ongkir dihitung **per grup** (semua alamat antar rumah satu rute, lalu dibagi K-25) atau **per alamat** (tiap anggota satu pengiriman)? | Randy + Efan | Per grup — sesuai K-25 "satu ongkir" dan rekomendasi K-44; lebih murah per order dan sejalan dengan tujuan belanja bareng |
| O-04 | Sisa pembagian ongkir (K-44 "ke host") bila host sendiri memilih ambil di drop point | Randy | Sisa ke anggota antar rumah yang paling awal bergabung; host drop point tetap ongkir 0 |
| O-05 | Keputusan §4 "drop point = tingkat Mitra": apakah ambil di drop point memberi harga Mitra Grosir **tanpa** MOQ untuk "Beli sendiri" (F-27) dan grup < Rp100.000 (K-18)? | Efan | Tidak — cara kirim tidak mengubah jenis harga (engine-harga §5.2); harga Mitra lewat syarat grup atau MOQ grosir (P-05); keuntungan drop point = ongkir 0 |
| O-06 | Kapasitas armada hanya berat; volume (barang ringan tapi besar: tisu, popok) belum ada kolomnya | Joseph (+ Operations) | Fase 1 berat saja; tambah kolom volume opsional di armada & satuan jual (NULL = tidak dicek) saat data volume tersedia |
| O-07 | Ongkir setelah alokasi parsial / stok habis sebagian / anggota dikeluarkan: dihitung ulang atau tetap? | Efan | Tetap (tidak pernah tagih tambahan, P-19); refund bagian ongkir hanya bila semua barang peserta antar rumah batal / alokasi 0 |
| O-08 | Tagihan terbit otomatis (K-39) saat semua sumber tarif tidak tersedia | Randy | Peserta antar rumah dialihkan ke ambil di drop point (ongkir 0) + WA pemberitahuan; terbit manual ditahan dengan pesan "Ongkir sedang dihitung" |
| O-09 | Slot penuh saat tagihan grup akan terbit: boleh host memindah grup ke slot lain? | Randy (+ Operations) | Boleh sebelum tagihan terbit, ke slot DIBUKA zona sama, semua anggota diberi tahu WA. DEFAULT SEMENTARA sampai diputuskan: tagihan ditolak `SLOT_PENUH`; admin menambah kapasitas atau memindah grup (tercatat) |
| O-10 | Slot dibatalkan operasional **sebelum** harga dikunci (F-21 hanya mengatur sesudahnya) | Randy | Sama dengan F-21: admin pindah slot, tagihan tetap, anggota boleh minta batal → saldo pembayar; grup DIBUKA ikut pindah |
| O-11 | Antar rumah gagal (penerima tidak ada / tak bisa dihubungi) | Randy (+ Operations) | Paket dibawa ke drop point zona, WA "Siap diambil", tanpa ongkir tambahan, ongkir tidak dikembalikan; tidak diambil → alur F-28 |
| O-12 | Cara admin membagikan daftar antar (berisi nama, HP, alamat) ke kurir tanpa akun (H13) & masa simpannya | Joseph (+ hukum) | Hanya unduh/cetak dari panel admin TOTP, setiap unduhan dicatat, tidak lewat n8n/WA otomatis (H4), berkas tidak disimpan di server; masa simpan ikut kebijakan privasi |
