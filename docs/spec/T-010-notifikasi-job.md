# T-010 — Notifikasi WhatsApp & job otomatis

Status: usulan v0.2 (27 Nov 2026, putaran review 1: OTP tanpa outbox, kunci WA bersama, opsi pg-boss 12.38, urutan kunci ledger, A-04 di K-39, skema, n8n tanpa DB, opt-in, webhook) · v0.1 (27 Nov 2026) · Squad: Build & QA (Joseph) · Penyusun: Automation Governance Architect
Dasar: `keputusan.md` #2, #3, §11 (H2, H4, H8, F-26, F-29), §14 (K-22, K-25, K-29, H13), §15 (K-39, K-40, K-43, K-45, F-13, F-17, F-18, F-21, F-28, H12); ADR-0001 §3.3, §4.3, §4.4, §7; `docs/flow/group-order.md` §6, §9; `docs/flow/pembayaran.md` §6–§10; `docs/flow/ongkir-slot.md` §5, §8, §9; `apps/worker` (pg-boss).
Dipakai oleh: T-016 (adapter WA + OTP), T-035 (status + notifikasi), T-040 (pasca cut-off), T-041 (laporan harian), T-042 (KPI COD), T-023, T-030.

Aturan dokumen: tidak ada angka harga/margin. Angka teknis bertanda **DEFAULT** bisa diubah lewat konfigurasi tanpa ubah kode. Hal yang butuh keputusan → §9 (N-01 dst.).

Prinsip yang berlaku di seluruh dokumen:
1. **Status di aplikasi adalah sumber kebenaran.** WA hanya pemberitahuan. Tidak ada aturan bisnis yang bergantung pada WA terkirim.
2. **WA tidak pernah menjadi syarat transisi.** Job dan API memakai guard waktu sendiri (ADR §3.3 butir 7).
3. **Uang, status, stok, dan PII hanya di kode** (`apps/worker`, `apps/api`). n8n hanya di tepi tanpa PII (H4).
4. **Satu efek = satu kunci idempotensi.** `job_run` mencegah run ganda; constraint unik ledger/outbox mencegah efek ganda.

---

## 1. Katalog template WhatsApp

### 1.1 Aturan umum template

| Aturan | Isi |
|---|---|
| Penamaan | `{domain}_{peristiwa}_v{n}`, huruf kecil + garis bawah. Nama di Meta tidak bisa diubah → perubahan teks = versi baru (`_v2`), versi lama dihapus setelah tidak dipakai |
| Bahasa | `id` (Bahasa Indonesia). Satu bahasa saja di Fase 1 |
| Variabel boleh | nama grup (disanitasi), jam WIB, jumlah akun, nominal Rupiah/poin **milik penerima**, nama produk, nama drop point (tempat umum), alasan dari daftar tetap |
| Variabel dilarang | nama/HP/alamat orang lain, alamat penerima, isi keranjang anggota lain (K-32), token/OTP di luar template OTP, ID internal yang bisa ditebak |
| Sanitasi nama grup | buang baris baru/tab, maks 30 karakter, tolak pola URL dan deret angka ≥ 6 (cegah nomor HP/link disisipkan lewat nama grup); kosong → "Belanja Bareng" |
| Bentuk teks | Variabel tidak di awal/akhir teks, tidak berdampingan; tanpa emoji di template OTP; teks utility tanpa bahasa promosi |
| Tombol URL | Satu tombol URL dinamis: `https://{DOMAIN}/g/{{1}}` (kode grup) atau `https://{DOMAIN}/p/{{1}}` (ID pesanan acak, wajib login). Domain menunggu #6 → **template berisi tombol belum bisa diajukan ke Meta sampai domain ada** |
| Marketing | Hanya ke akun `promo_wa = true` (Kebijakan Privasi: centang opsional), **tanpa nominal harga/diskon**, dengan tombol balas cepat "Berhenti promo" |
| Persetujuan Meta | Diajukan lewat WhatsApp Manager setelah verifikasi bisnis (butuh data badan usaha #5, H7). Meta bisa mengubah kategori (utility → marketing) — lihat N-01. Status `PAUSED`/`DISABLED` dipantau (§3.6) |

Kolom **Krit.** = kritis waktu (lihat §2.2: tidak kena jam tenang & batas global).

### 1.2 Authentication

| Kode | Nama | Variabel | Teks (dibuat Meta, bahasa `id`) | Tombol | Catatan |
|---|---|---|---|---|---|
| WA-01 | `auth_otp_v1` | `{{1}}` kode 6 digit | "*{{1}}* adalah kode verifikasi Anda. Demi keamanan, jangan bagikan kode ini." + footer "Kode ini kedaluwarsa dalam {n} menit." | Salin kode | Teks template authentication **ditetapkan Meta** (tidak bisa ditulis bebas); kalimat di sini perkiraan, cek di WhatsApp Manager. `{n}` diisi saat template dibuat = `otp.kedaluwarsa_menit` T-016 (**DEFAULT 5**). Tanpa URL, tanpa emoji. Krit. **Tidak lewat outbox** (§3.3a) |

### 1.3 Utility — grup sebelum tagihan

| Kode | Nama | Variabel | Teks persis | Tombol | Krit. |
|---|---|---|---|---|---|
| WA-05 | `grup_kurang_akun_v1` | 1 nama grup, 2 jumlah akun, 3 jam batas | "Grup {{1}} masih kurang {{2}} akun yang menambah barang. Tagihan grup paling lambat terbit pukul {{3}} WIB. Ajak tetangga lewat tombol di bawah." | Buka grup → `/g/{kode}` | Tidak |
| WA-05b | `grup_kurang_total_v1` | 1 nama grup, 2 kekurangan Rupiah, 3 jam batas | "Total belanja grup {{1}} kurang Rp{{2}} lagi agar harga Belanja Bareng berlaku. Tagihan grup paling lambat terbit pukul {{3}} WIB. Lihat grup lewat tombol di bawah." | Buka grup | Tidak |
| WA-06 | `grup_pengingat_siap_v1` | 1 nama grup, 2 jam batas | "Pesananmu di grup {{1}} belum ditandai Siap. Tekan Siap di keranjang sebelum pukul {{2}} WIB agar pesananmu ikut tagihan grup." | Buka grup | Ya |
| WA-06b | `grup_pengingat_terbit_v1` | 1 nama grup, 2 jam batas | "Semua anggota grup {{1}} sudah Siap. Terbitkan tagihan sebelum pukul {{2}} WIB. Bila belum, tagihan terbit otomatis pada jam itu." | Buka grup | Ya |
| WA-06c | `grup_peringatan_keluar_v1` (K-39, 5 menit) | 1 nama grup, 2 jam keluar | "Pesananmu di grup {{1}} akan dikeluarkan pukul {{2}} WIB karena belum ditandai Siap. Buka keranjang dan tekan Siap sekarang." | Buka grup | Ya |
| WA-06d | `grup_dikeluarkan_belum_siap_v1` | 1 nama grup, 2 jam | "Pesananmu dikeluarkan dari grup {{1}} karena belum ditandai Siap sampai pukul {{2}} WIB. Kamu bisa ikut grup lain atau beli sendiri di aplikasi." | Buka aplikasi → `/` | Ya |
| WA-08c | `grup_gagal_pilih_v1` (K-11) | 1 nama grup, 2 jam batas pilih | "Grup {{1}} tidak memenuhi syarat. Pilih lanjut dengan harga satuan atau batalkan pesanan sebelum pukul {{2}} WIB. Tanpa pilihan, pesanan dibatalkan." | Pilih sekarang → `/p/{id}` | Ya |

### 1.4 Utility — tagihan & pembayaran

| Kode | Nama | Variabel | Teks persis | Tombol | Krit. |
|---|---|---|---|---|---|
| WA-04 | `tagihan_terbit_v1` | 1 nama grup, 2 jam kedaluwarsa | "Tagihan grup {{1}} sudah terbit. Bayar lewat QRIS atau Virtual Account di aplikasi sebelum pukul {{2}} WIB." | Bayar → `/p/{id}` | Ya |
| WA-04b | `tagihan_dibayar_host_v1` | 1 nama grup | "Tagihan grup {{1}} sudah terbit dan dibayar oleh host. Kamu tidak perlu membayar tagihan ini." | Lihat pesanan | Ya |
| WA-04c | `tagihan_kirim_dialihkan_v1` (O-08) | 1 nama grup, 2 nama drop point | "Ongkir antar untuk grup {{1}} belum bisa dihitung, jadi pesananmu diubah ke ambil sendiri di {{2}}. Rinciannya ada di tagihan." | Lihat tagihan | Ya |
| WA-03a | `tagihan_pengingat_bayar_v1` | 1 nama grup, 2 jam kedaluwarsa | "Tagihan grup {{1}} belum dibayar. Batas bayar pukul {{2}} WIB. Lewat batas itu, pesananmu dikeluarkan dari grup." | Bayar | Ya |
| WA-03 | `tagihan_kedaluwarsa_v1` (tagihan tanpa poin) | 1 nama grup | "Waktu bayar tagihan grup {{1}} sudah habis, jadi pesananmu dikeluarkan dari grup. Kamu bisa ikut grup lain atau beli sendiri di aplikasi." | Buka aplikasi | Ya |
| WA-03s | `tagihan_kedaluwarsa_poin_v1` (tagihan memakai poin) | 1 nama grup, 2 poin | "Waktu bayar tagihan grup {{1}} sudah habis, jadi pesananmu dikeluarkan dari grup. Sebanyak {{2}} poin yang dipakai sudah kembali ke Poin NEKAT kamu." | Lihat saldo | Ya |
| WA-02 | `pembayaran_diterima_v1` | 1 nominal, 2 nama grup, 3 jam tutup | "Pembayaran Rp{{1}} untuk grup {{2}} sudah kami terima. Harga final dikunci saat grup tutup pukul {{3}} WIB." | Lihat pesanan | Ya |
| WA-15 | `pembayaran_terlambat_v1` | 1 nominal, 2 nama grup | "Pembayaran Rp{{1}} masuk setelah batas waktu tagihan grup {{2}}. Dananya sudah masuk Poin NEKAT kamu." | Lihat saldo → `/saldo` | Ya |
| WA-03b | `stok_habis_baris_v1` (K-29, K-49) | 1 nama produk, 2 nama grup | "Maaf, stok {{1}} di tagihan grup {{2}} habis. Nilai barang itu masuk Poin NEKAT kamu setelah tagihan lunas." | Lihat tagihan | Ya |

### 1.5 Utility — setelah grup tutup & pengiriman

| Kode | Nama | Variabel | Teks persis | Tombol | Krit. |
|---|---|---|---|---|---|
| WA-07 | `grup_dikunci_v1` | 1 nama grup | "Grup {{1}} sudah tutup dan harga final dikunci. Pesananmu sedang disiapkan." | Lihat pesanan | Tidak |
| WA-07b | `grup_dikunci_poin_v1` | 1 nama grup, 2 poin | "Grup {{1}} sudah tutup dan harga final dikunci. Selisih {{2}} poin masuk Poin NEKAT kamu." | Lihat saldo | Tidak |
| WA-11 | `alokasi_parsial_v1` | 1 nama grup, 2 poin | "Maaf, sebagian barang di grup {{1}} tidak tersedia. Senilai {{2}} poin masuk Poin NEKAT kamu, rinciannya ada di aplikasi." | Lihat pesanan | Tidak |
| WA-09 | `grup_ditahan_v1` | 1 nama grup, 2 waktu kabar | "Pesanan grup {{1}} sedang kami periksa. Kabar paling lambat {{2}} WIB." | Lihat pesanan | Tidak |
| WA-08 | `grup_batal_dana_v1` | 1 nama grup, 2 alasan, 3 nominal | "Grup {{1}} batal karena {{2}}. Dana Rp{{3}} sudah masuk Poin NEKAT kamu." | Lihat saldo | Ya |
| WA-08b | `grup_batal_v1` | 1 nama grup, 2 alasan | "Grup {{1}} batal karena {{2}}. Tidak ada dana yang perlu dikembalikan." | Buka aplikasi | Ya |
| WA-16 | `slot_dipindah_v1` (F-21) | 1 nama grup, 2 jadwal baru | "Jadwal kirim grup {{1}} dipindah ke {{2}}. Harga tidak berubah. Pilih tetap kirim atau batalkan di aplikasi." | Pilih → `/p/{id}` | Ya |
| WA-12 | `pesanan_diantar_v1` | 1 nama grup | "Pesanan grup {{1}} sedang diantar hari ini. Pastikan ada yang menerima di alamatmu." | Lihat pesanan | Ya |
| WA-13 | `pesanan_siap_diambil_v1` | 1 nama grup, 2 nama drop point | "Pesanan grup {{1}} siap diambil di {{2}}. Tunjukkan kode ambil dari aplikasi saat mengambil." | Lihat kode → `/p/{id}` | Ya |
| WA-13c | `pesanan_antar_gagal_v1` (O-11) | 1 nama grup, 2 nama drop point | "Pesanan grup {{1}} belum berhasil diantar. Paketmu bisa diambil di {{2}}, kode ambil ada di aplikasi." | Lihat pesanan | Ya |
| WA-14 | `pesanan_diterima_v1` | 1 nama grup | "Pesanan grup {{1}} sudah diterima. Terima kasih sudah belanja bareng di NEKAT." | Lihat pesanan | Tidak |

Daftar tetap `{{alasan}}` (WA-08/08b): "kurang dari 3 akun lunas", "tagihan tidak terbit sampai batas waktu", "dibatalkan host", "dibatalkan admin", "pesanan tidak dapat diproses", "jadwal kirim dibatalkan". Teks bebas dilarang.

Pesanan individu ("Beli sendiri", F-27) memakai template yang sama dengan kata "grup {{1}}" diganti: template terpisah `individu_*_v1` dibuat di T-035 bila spec pesanan individu sudah ada (pembayaran.md §15 T-5). Sampai itu, WA pesanan individu memakai WA-02/03/03a/12/13/14 versi `individu_` dengan teks sama tanpa nama grup.

### 1.6 Utility — akun, COD, internal

| Kode | Nama | Variabel | Teks persis | Tombol | Krit. |
|---|---|---|---|---|---|
| WA-20 | `cod_aktif_v1` | 1 tanggal | "Mulai {{1}}, bayar di tempat (COD) tersedia untuk pesanan Beli sendiri di akunmu." | Buka aplikasi | Tidak |
| WA-21 | `cod_dicabut_kpi_v1` | 1 alasan KPI | "Bayar di tempat (COD) di akunmu dinonaktifkan karena {{1}} minggu lalu. COD bisa aktif lagi setelah 3 minggu berturut-turut memenuhi syarat." | — | Tidak |
| WA-22 | `cod_dicabut_admin_v1` | — | "Bayar di tempat (COD) di akunmu dinonaktifkan. Hubungi CS NEKAT lewat aplikasi untuk informasi." | — | Tidak |
| WA-23 | `kebijakan_berubah_v1` (F-23) | 1 tanggal berlaku | "Syarat & Ketentuan atau Kebijakan Privasi NEKAT diperbarui mulai {{1}}. Kamu akan diminta menyetujui versi baru sebelum ikut grup berikutnya." | Baca → `/legal` | Tidak |
| WA-30 | `admin_laporan_harian_v1` (ke admin) | 1 tanggal, 2 grup tutup, 3 pesanan, 4 jumlah butir perlu tindakan | "Laporan NEKAT tanggal {{1}} siap: {{2}} grup tutup, {{3}} pesanan, {{4}} butir perlu tindakan. Rincian di panel admin." | Panel → `/admin/laporan` | Tidak |
| WA-31 | `admin_alert_v1` (ke admin) | 1 kode alert, 2 referensi | "Peringatan operasional NEKAT {{1}} untuk {{2}}. Periksa panel admin segera." | Panel → `/admin` | Ya |

Alasan KPI WA-21 dari daftar tetap: "pesanan selesai kurang dari syarat", "tingkat sukses di bawah syarat", "ada penolakan saat diantar", "ada pembatalan setelah dikirim" (lebih dari satu → yang pertama + "dan syarat lain").
WA-30/31 hanya berisi angka hitungan dan ID referensi (kode grup/slot), tanpa nominal uang dan tanpa PII (N-11).

### 1.7 Marketing (opt-in, tanpa nominal harga)

| Kode | Nama | Variabel | Teks persis | Tombol | Catatan |
|---|---|---|---|---|---|
| WA-40 | `promo_zona_dibuka_v1` (F-18) | 1 nama kelurahan | "Kabar baik, NEKAT sekarang melayani area {{1}}. Yuk mulai belanja bareng tetangga lewat aplikasi." | Buka aplikasi; balas cepat "Berhenti promo" | Penerima: baris `daftar_tunggu` yang mencentang "kabari saya lewat WhatsApp" (persetujuan khusus di form daftar tunggu). Sumber nomor & retensi: §3.5 tabel `daftar_tunggu` |
| WA-41 | `promo_ajak_belanja_v1` | 1 nama kelurahan | "Tetangga di {{1}} sedang belanja bareng di NEKAT. Lihat grup yang sedang buka di zonamu." | Buka aplikasi; "Berhenti promo" | **Belum aktif** (flag `wa.promo_aktif=false`) sampai rancangan Growth (loop ajak tetangga) disetujui Randy |

---

## 2. Matriks pemicu → template → penerima → batas

### 2.1 Matriks

Kunci outbox mengikuti ADR §3.3: `wa:{template}:{ref_jenis}:{ref_id}:{akun_id}[:{periode_WIB}]` (`template` = kode tanpa versi, mis. `grup_kurang_akun`). `periode` = tanggal WIB `YYYYMMDD` bila pesan boleh berulang harian. **Basi** = `outbox.kedaluwarsa_pesan`; lewat waktu itu pesan tidak dikirim (status `KEDALUWARSA`).

| Pemicu (transisi / job) | Template | Penerima | Batas frekuensi (F-17) | Jam tenang | Kunci idempotensi | Basi | Fallback |
|---|---|---|---|---|---|---|---|
| Minta OTP (T-016) | WA-01 | pemohon | batas kirim per nomor & per IP + anggaran global (T-016) | tidak | `otp:{otp_permintaan_id}` (UK `pesan_wa.kunci`; **bukan outbox**, §3.3a) | kedaluwarsa OTP | Tidak ada SMS (N-02): UI "Kode belum terkirim, coba lagi" |
| J-03 harian / batas − 180 mnt, akun berbarang < 3 | WA-05 | **akun berbarang saja** (terhitung) | maks 1 dari WA-05/05b per grup per akun per hari WIB (satu kunci bersama) | ya | `wa:grup_kurang:grup:{grup_id}:{akun_id}:{YYYYMMDD}` | batas terbit | Progres di halaman grup |
| sama, akun ≥ 3, total < minimum | WA-05b | akun berbarang | kuota bersama dengan WA-05 (kunci sama; yang pertama ditulis menang) | ya | `wa:grup_kurang:grup:{grup_id}:{akun_id}:{YYYYMMDD}` | batas terbit | Halaman grup |
| J-03 batas − 30 mnt, belum Siap | WA-06 | anggota berbarang belum Siap | 1 per grup per akun | tidak | `wa:grup_pengingat_siap:grup:{grup_id}:{akun_id}` | batas − 5 mnt | Banner keranjang |
| J-03 batas − 30 mnt, semua Siap, host belum terbit | WA-06b | host | 1 per grup | tidak | `wa:grup_pengingat_terbit:grup:{grup_id}:{akun_id}` | batas | Tombol "Terbitkan tagihan" |
| J-04 batas − 5 mnt (K-39) | WA-06c | anggota berbarang belum Siap | 1 per grup per akun | tidak | `wa:grup_peringatan_keluar:grup:{grup_id}:{akun_id}` | batas | Banner + hitung mundur |
| J-04 batas: dikeluarkan (K-39) | WA-06d | anggota yang dikeluarkan | 1 per grup per akun | tidak | `wa:grup_dikeluarkan_belum_siap:grup:{grup_id}:{akun_id}` | cut-off | Status pesanan |
| Grup GAGAL, pilihan K-11 dibuka | WA-08c | anggota berbarang | 1 per grup per akun | tidak | `wa:grup_gagal_pilih:grup:{grup_id}:{akun_id}` | batas pilih | Default K-11 (batal) berlaku tanpa WA |
| Tagihan terbit (manual K-22 / otomatis K-39) | WA-04 / WA-04b | pembayar per tagihan; non-host bila `HOST` | 1 per tagihan per akun | tidak | `wa:tagihan_terbit:invoice:{invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Halaman tagihan |
| Terbit otomatis dengan O-08 | WA-04c | peserta yang cara kirimnya dialihkan | 1 per tagihan | tidak | `wa:tagihan_kirim_dialihkan:invoice:{invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Keterangan di tagihan |
| J-02 `kedaluwarsa − 15 mnt` | WA-03a | pembayar tagihan DITERBITKAN | 1 per tagihan | tidak | `wa:tagihan_pengingat_bayar:invoice:{invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Hitung mundur |
| J-01 TTL habis (A3) | WA-03 / WA-03s (dipilih di transaksi: `SALDO_BALIK` > 0 → 03s) | pembayar (+ anggota bila `HOST`, selalu WA-03) | 1 per tagihan per akun | tidak | `wa:tagihan_kedaluwarsa:invoice:{invoice_id}:{akun_id}` (satu kunci untuk 03/03s) | cut-off + 24 jam | Status pesanan |
| PAID (A4) | WA-02 | pembayar saja (mode `HOST`: anggota non-host tidak menerima WA-02; WA-04b sudah cukup) | 1 per pembayaran | tidak | `wa:pembayaran_diterima:pembayaran:{pembayaran_id}:{akun_id}` | + 24 jam | Status pesanan |
| PAID terlambat (A9, FP-09) | WA-15 | pembayar | 1 per pembayaran | tidak | `wa:pembayaran_terlambat:pembayaran:{pembayaran_id}:{akun_id}` | + 72 jam | Riwayat saldo |
| Stok baris habis (K-29) | WA-03b | pembayar | 1 per baris | tidak | `wa:stok_habis_baris:baris:{baris_invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Tagihan |
| Cut-off HARGA_TERKUNCI (J-05) | **tepat satu** dari WA-11 / WA-07b / WA-07, dipilih di transaksi kunci harga: ada unit tak teralokasi → WA-11; selain itu kredit selisih > 0 → WA-07b; selain itu WA-07 | pembayar (11/07b) / anggota non-pembayar (07) | 1 per grup per akun | ya | `wa:grup_dikunci:grup:{grup_id}:{akun_id}` (**satu kunci untuk 07/07b/11** — mustahil dua pesan) | + 72 jam | Status pesanan |
| DITAHAN (G6) | WA-09 | anggota lunas | 1 per grup per akun | ya | `wa:grup_ditahan:grup:{grup_id}:{akun_id}` | batas tahan | Status pesanan |
| Grup BATAL (semua alasan) | WA-08 / WA-08b | anggota berbarang / pembayar dana | 1 per grup per akun | tidak | `wa:grup_batal:grup:{grup_id}:{akun_id}` | + 72 jam | Riwayat "batal" |
| Slot dipindah (F-21, O-10) | WA-16 | anggota grup | 1 per grup per slot tujuan | tidak | `wa:slot_dipindah:grup:{grup_id}:{akun_id}:{slot_tujuan_id}` | awal slot tujuan | Status pesanan |
| Admin: Diantar / Siap diambil / Gagal antar / Diterima (T-039) | WA-12 / 13 / 13c / 14 | penerima paket | 1 per paket per status | 12/13/13c tidak; 14 ya | `wa:{template}:paket:{paket_id}:{akun_id}` | 12: akhir slot; 13/13c/14: + 72 jam | Status pesanan |
| J-11 COD aktif / dicabut KPI | WA-20 / WA-21 | akun | 1 per akun per minggu (satu kunci untuk 20/21: satu evaluasi hanya menghasilkan satu perubahan) | ya | `wa:cod_status:akun:{akun_id}:{akun_id}:{YYYY-Www}` — `akun_id` muncul dua kali karena referensinya akun itu sendiri (`ref_jenis=akun`, `ref_id=akun_id`) dan penerimanya akun yang sama; pola ADR dipertahankan agar parser kunci seragam | + 7 hari | Halaman akun |
| Cabut COD manual | WA-22 | akun | 1 per pencabutan | ya | `wa:cod_dicabut_admin:status_cod:{id_log}:{akun_id}` | + 7 hari | Halaman akun |
| Dokumen legal versi baru (wajib setuju ulang) | WA-23 | akun AKTIF | 1 per versi | ya | `wa:kebijakan_berubah:dokumen:{dokumen_legal_id}:{akun_id}` | tanggal berlaku + 7 hari | Layar setuju ulang (F-23) |
| J-16 laporan harian | WA-30 | admin penerima laporan | 1 per tanggal (+ kirim ulang manual, §4.3 J-16) | ya | `wa:admin_laporan_harian:laporan:{YYYYMMDD}:{admin_akun_id}` ; kirim ulang ke-n: `…:{admin_akun_id}:ulang{n}` | + 24 jam | Panel admin |
| Alert (§4.3) | WA-31 | admin jaga | maks 1 per kode alert per referensi per jam | tidak | `wa:admin_alert:{kode}:{ref}:{admin_akun_id}:{YYYYMMDDHH}` | + 6 jam | Error tracking SaaS |
| Zona dibuka (F-18) | WA-40 | daftar tunggu ber-opt-in | 1 per zona per nomor | jendela 09.00–19.00 | `wa:promo_zona_dibuka:zona:{zona_id}:{daftar_tunggu_id}` | + 14 hari | — |

Catatan:
- **Sumber F-17** (DIPUTUSKAN 25 Nov: ikut rekomendasi): `docs/flow/group-order.md` versi commit `a5ec5fa` §12, baris F-17: *"Pengingat cut-off & bayar ke semua peserta termasuk MENUNGGU_BAYAR; 'kurang X orang' hanya ke terhitung; maks 1 per jenis per grup per hari (konfigurasi)"*. Diterapkan dengan dua adaptasi ke model keranjang K-22/K-25 (bukan perubahan keputusan): (1) "pengingat cut-off" menjadi pengingat **batas terbit tagihan** (WA-06/06b/06c), karena di model K-22 masa bayar 60 menit berada sebelum cut-off sehingga pengingat tepat sebelum cut-off sudah tidak berguna; (2) "pengingat bayar ke semua peserta termasuk MENUNGGU_BAYAR" menjadi pengingat ke **pembayar** tiap tagihan DITERBITKAN (WA-03a). Pada mode `HOST` anggota lain tidak bisa membayar, jadi tidak diberi pengingat. "Maks 1 per jenis per grup per hari" tetap dan disimpan di konfigurasi (`wa.maks_per_jenis_per_grup_per_hari`, DEFAULT 1). Batas global per akun (§2.2) adalah tambahan.
- **Opt-in WA** (N-13): semua pesan bisnis selain OTP hanya dikirim ke akun dengan `akun_notifikasi.wa_optin_pada` terisi. Tanpa opt-in, pesan ditulis `KEDALUWARSA` dengan alasan `TANPA_OPTIN` dan informasinya tetap tersedia di aplikasi.
- `batas` = batas terbit tagihan = `cut_off_pada − invoice.ttl_menit` (A-04, K-39). Semua offset menit di tabel (180, 30, 5, 15) dari konfigurasi; 5 menit = K-39 (diputuskan), sisanya **DEFAULT** (N-05).
- Mode `HOST`: anggota non-host tidak menerima WA-03a/WA-02 nominal; cukup WA-04b dan WA-03 bila host tidak membayar.
- Akun DIBEKUKAN / DIHAPUS / nomor dianonimkan: tidak ada WA kecuali WA-22. Ditulis sebagai `KEDALUWARSA` dengan alasan `PENERIMA_TIDAK_AKTIF`.

### 2.2 Batas frekuensi & jam tenang (DEFAULT, N-04)

| Aturan | Nilai DEFAULT | Kunci konfigurasi |
|---|---|---|
| Jam tenang (WIB) untuk template **tidak kritis** | 21.00–07.00; pesan yang jatuh di jam tenang diberi `kirim_setelah` = 07.00 berikutnya; bila sudah basi → dibuang | `wa.jam_tenang_mulai`, `wa.jam_tenang_selesai` |
| Template kritis (kolom Krit. = Ya) | Tidak kena jam tenang & batas global (terkait tenggat/uang), tetap kena kunci idempotensi | — |
| Batas global per akun, utility tidak kritis | maks 6 per akun per hari WIB; kelebihan → `KEDALUWARSA` alasan `BATAS_HARIAN` | `wa.maks_tidak_kritis_per_hari` |
| Jarak antar pesan ke nomor yang sama | ≥ 6 detik (batas pasangan Meta) — antre, bukan dibuang | `wa.jeda_per_penerima_detik` |
| Marketing | maks 1 per akun per 7 hari, jendela 09.00–19.00 WIB, hanya `promo_wa = true` | `wa.promo_maks_per_7_hari` |
| Anggaran harian seluruh WA (non-OTP) | kosong = tanpa batas; diisi Finance; 80% → alert, 100% → hanya template kritis | `wa.anggaran_harian_pesan` |
| Anggaran OTP | per jam & per hari (T-016); 100% → OTP ditolak + alert (anti *pumping*) | `otp.anggaran_jam`, `otp.anggaran_hari` |

Urutan evaluasi saat worker mengambil pesan (§3.3 langkah 2): penerima aktif → opt-in WA (N-13) → opt-out promo/pengingat → basi → jam tenang → batas global → jeda penerima → kirim.

---

## 3. Adapter WhatsApp (untuk T-016)

### 3.1 Port

```ts
// packages/domain/notifikasi/whatsapp.ts
export type KategoriTemplate = "AUTHENTICATION" | "UTILITY" | "MARKETING";
export interface PesanTemplate {
  nomorE164: string;                 // hanya di memori adapter; tidak pernah di log
  namaTemplate: string;              // mis. "tagihan_terbit_v1"
  bahasa: "id";
  parameterBody: string[];           // sudah disanitasi, urut {{1}}..{{n}}
  parameterTombolUrl?: string;       // sufiks URL dinamis (kode grup / id pesanan)
  kunciIdempotensi: string;          // = outbox.kunci_idempotensi
}
export type KelasGalatWa =
  | "SEMENTARA"          // jaringan, 5xx, timeout → retry
  | "BATAS"              // rate limit (throughput / pasangan / tier harian) → tunda
  | "PENERIMA"           // nomor tidak bisa menerima / bukan pengguna WA → stop, tandai nomor
  | "OPT_OUT_MARKETING"  // pengguna berhenti menerima marketing → stop, promo_wa=false
  | "TEMPLATE"           // template tidak ada / parameter salah / PAUSED / DISABLED → stop template + alert
  | "OTENTIKASI"         // token kedaluwarsa / izin dicabut → hentikan semua kirim + alert
  | "KEBIJAKAN";         // akun dibatasi Meta → hentikan semua + alert
export interface HasilKirimWa { idPesanPenyedia: string }       // wamid
export class WaGalat extends Error { kelas: KelasGalatWa; kodePenyedia?: string; tundaDetik?: number }
export interface WhatsAppGateway {
  readonly mode: "log" | "sandbox" | "meta";
  kirimTemplate(p: PesanTemplate): Promise<HasilKirimWa>;      // lempar WaGalat
  kirimOtp(p: { nomorE164: string; kode: string; kunciIdempotensi: string }): Promise<HasilKirimWa>;
}
```

Pemetaan kode galat Meta ke `KelasGalatWa` ada di satu tabel di adapter (diuji unit). Kode yang diketahui saat ini (verifikasi ulang di dokumentasi Meta saat T-016): 130429/131056/80007/4 → BATAS; 131026 → PENERIMA; 131050 → OPT_OUT_MARKETING; 131049 → BATAS (tunda ≥ 24 jam, marketing saja); 132000/132001/132012/132015/132016 → TEMPLATE; 190 → OTENTIKASI; 131031/368 → KEBIJAKAN; kode tak dikenal → SEMENTARA maks 3 kali lalu GAGAL.

### 3.2 Mode & penjaga start

| `WA_MODE` | Implementasi | Perilaku | Lingkungan |
|---|---|---|---|
| `log` | `LogGateway` | Tulis ke `pesan_wa` (status `LOG`) + log (nomor disamarkan `+62***1234`). OTP terlihat di halaman dev **hanya** di mode ini | lokal, tes, CI, preview Claude (K-19) |
| `sandbox` | `MetaCloudGateway` + daftar izin | Hanya ke nomor di `WA_SANDBOX_NOMOR_IZIN`; nomor lain → `KEDALUWARSA` alasan `DIBLOKIR_SANDBOX`, tidak dikirim. Format daftar: dipisah koma, tiap entri `v{versi}:{hex}` = HMAC-SHA256 nomor E.164 dengan **kunci HMAC nomor HP yang sama dengan `akun.hp_hmac`** pada versi `hp_hmac_kunci_versi` itu. Pencocokan memakai versi entri, sehingga rotasi kunci tidak membuka nomor lain; entri versi yang sudah tidak dikenal → tolak start | non-production dengan nomor uji Meta |
| `meta` | `MetaCloudGateway` (atau adapter BSP dengan port sama) | Kirim sungguhan | **hanya production** |

Penjaga start (API & worker): `APP_ENV=production` ∧ `WA_MODE ≠ meta` → tolak start; `APP_ENV ≠ production` ∧ `WA_MODE = meta` → tolak start. `sandbox` tanpa daftar izin → tolak start.

Variabel environment (nama saja; nilai di secret store, ADR §6): `WA_MODE`, `WA_API_VERSI` (dipin), `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `WA_ACCESS_TOKEN` [rahasia, token System User akun bisnis badan usaha, H7], `WA_APP_SECRET` [rahasia, verifikasi tanda tangan webhook], `WA_WEBHOOK_VERIFY_TOKEN` [rahasia], `WA_SANDBOX_NOMOR_IZIN`, `WA_KIRIM_PER_DETIK` (**DEFAULT 20**, di bawah batas throughput Meta). Rotasi token: pemilik Joseph; token kedaluwarsa → galat `OTENTIKASI` → alert (§4.3 `WA_TOKEN`).

### 3.3a OTP: kirim sinkron dari API, tidak lewat outbox

`otp_permintaan` hanya menyimpan `hp_hmac` dan hash kode. Outbox/pg-boss **tidak boleh** memuat kode atau nomor (keduanya tersimpan di DB dan log job), jadi OTP tidak memakai outbox.
1. API (T-016) membangkitkan kode di memori → satu transaksi: insert `otp_permintaan` (hash kode, `hp_hmac`, kedaluwarsa) + `pesan_wa(kunci='otp:{otp_permintaan_id}', template='auth_otp_v1', status='ANTRE')` → commit.
2. **Setelah commit, di luar transaksi**, API memanggil `gateway.kirimOtp({ nomorE164, kode, kunciIdempotensi: 'otp:{id}' })`. Nomor dan kode hanya ada di variabel request dan dibuang setelah panggilan. Keduanya tidak masuk log, error tracking, pg-boss, outbox, atau `pesan_wa`.
3. Retry hanya di dalam request: maks 2 percobaan untuk kelas SEMENTARA/BATAS, timeout per panggilan 5 dtk (**DEFAULT**), total ≤ 12 dtk. Tetap gagal → `pesan_wa.status='GAGAL'` + `kode_galat`; respons "Kode belum terkirim, coba lagi" (tidak membedakan nomor terdaftar/belum). Kirim ulang = permintaan OTP baru (OTP lama batal, kena batas T-016).
4. Idempotensi: UK `pesan_wa.kunci`; satu `otp_permintaan_id` paling banyak satu `wamid`. Kelas TEMPLATE/OTENTIKASI → alert seperti §3.3 langkah 4.
5. Status webhook untuk `wamid` OTP hanya memperbarui `pesan_wa.status`.
6. `LogGateway` (dev) menyimpan kode terakhir per nomor **hanya di memori proses** (TTL = kedaluwarsa OTP) untuk halaman dev `WA_MODE=log`; tidak menulis kode ke DB atau log.

### 3.3 Pengirim outbox (`wa-kirim`, worker) — semua template kecuali OTP

1. API/job menulis `outbox(jenis='WA', kunci_idempotensi, akun_id, kritis, payload={template, ref, parameter, tombol}, kedaluwarsa_pesan, kirim_setelah)` **di transaksi bisnis yang sama** (`ON CONFLICT (kunci_idempotensi) DO NOTHING`). Payload **tanpa nomor HP dan tanpa rahasia**; nomor diambil worker dari modul `akun` tepat sebelum kirim, hanya di memori. Setelah commit, pemanggil `boss.send('wa-kirim', null)` sebagai pembangun; cron tiap menit menyapu sisanya.
2. Worker klaim batch (≤ 50, `FOR UPDATE SKIP LOCKED`, urut `kritis DESC, kirim_setelah`, isi `outbox.lease_sampai` = sekarang + 2 menit) dan menjalankan urutan §2.2.
3. Kirim lewat port. Sukses → `outbox.status = TERKIRIM`, `pesan_wa` (status `DIKIRIM_KE_PENYEDIA`, `wamid`).
4. Galat → per kelas:

| Kelas | Tindakan | Jadwal ulang |
|---|---|---|
| SEMENTARA | `percobaan + 1` | 15 dtk × 2^(n−1), maks 10 menit, + jitter ±20%; berhenti di `kedaluwarsa_pesan` atau 8 percobaan → `GAGAL` |
| BATAS | tidak menambah `percobaan` di atas 8 | `tundaDetik` dari penyedia atau 60 dtk; pasangan (131056) → ≥ 6 dtk untuk nomor itu saja |
| PENERIMA | `GAGAL`; `akun_notifikasi.wa_tidak_tersedia = true` | — (pesan berikutnya ke akun itu langsung `KEDALUWARSA` alasan `NOMOR_TIDAK_WA` sampai login OTP sukses lagi) |
| OPT_OUT_MARKETING | `GAGAL`; `promo_wa = false` | — |
| TEMPLATE | `GAGAL`; template ditandai `dijeda` di `template_wa`; alert `WA_TEMPLATE` | pesan template itu ditahan (`kirim_setelah` + 15 menit) sampai admin membuka jeda |
| OTENTIKASI / KEBIJAKAN | hentikan seluruh `wa-kirim` (flag `wa.kirim_dijeda`); alert P1 | dilanjutkan manual setelah perbaikan |

5. Pembatas laju: token bucket per `WA_PHONE_NUMBER_ID` (`WA_KIRIM_PER_DETIK`) di proses. Antrean `wa-kirim` memakai policy `stately` (1 antre + 1 aktif): banyak pembangun digabung jadi satu job antre, dan hanya satu pengirim aktif. OTP sinkron (§3.3a) berbagi anggaran laju lewat penghitung per detik di Postgres (`wa_laju(detik, jumlah)`), bukan lewat antrean.
6. Pesan yang tidak dikirim diberi `outbox.status='KEDALUWARSA'` + `outbox.alasan` ∈ {`BASI`, `JAM_TENANG_BASI`, `BATAS_HARIAN`, `TANPA_OPTIN`, `OPT_OUT`, `NOMOR_TIDAK_WA`, `PENERIMA_TIDAK_AKTIF`, `DIBLOKIR_SANDBOX`, `ANGGARAN`}.

### 3.4 Status pengiriman (webhook Meta)

- `GET /webhook/whatsapp`: verifikasi `hub.verify_token` (constant-time) → balas `hub.challenge`.
- `POST /webhook/whatsapp`, urutan wajib:
  1. Batas ukuran body 256 KB (**DEFAULT**); lebih besar → `413`. Rate limit terpisah dari API publik.
  2. Baca **body mentah** (byte asli, sebelum parse JSON). Header `X-Hub-Signature-256` wajib berbentuk `sha256=<64 hex>`; bentuk lain → `401`. Bandingkan HMAC-SHA256(`WA_APP_SECRET`, body mentah) secara constant-time; salah → `401` + log keamanan (tanpa body).
  3. Parse JSON, lalu validasi skema (Zod). Setiap `entry[].changes[].value.metadata.phone_number_id` harus = `WA_PHONE_NUMBER_ID`; bila tidak, bagian itu diabaikan dan dicatat.
  4. `statuses[]`: `wamid` yang tidak ada di `pesan_wa` → diabaikan (`200`, metrik `wa_status_tak_dikenal`), tidak membuat baris. `wamid` dikenal → insert `wa_webhook_event(UNIQUE(wamid, status))`.
  5. `messages[]` (masuk): UK `wa_pesan_masuk(id_pesan_meta)` (= `messages[].id`), sehingga balasan opt-out tidak diproses dua kali.
  6. `boss.send('wa-status', null)` lalu `200` cepat. Duplikat → `200` tanpa efek.
  - Pertahanan replay: Meta tidak mengirim stempel waktu bertanda tangan. Pengulangan dicegah oleh UK di langkah 4–5 dan aturan status hanya maju. Event dengan `timestamp` > 7 hari diabaikan dan dicatat.
- Worker `wa-status`: status hanya maju `DIKIRIM_KE_PENYEDIA → SENT → DELIVERED → READ`; `FAILED` final (kode galat → §3.3 tabel). Status datang tidak berurutan → simpan waktu tiap status, abaikan yang mundur.
- Payload disimpan **sudah diredaksi** (`wa_id`/nomor → HMAC, teks pesan masuk tidak disimpan). Retensi N-12.
- Metrik: `wa_terkirim_total{template,status}`, `wa_gagal_total{template,kelas}`, rasio DELIVERED/terkirim per template per hari (turun < 90% → alert `WA_KUALITAS`).

### 3.5 Pesan masuk & opt-out

| Masuk | Tindakan |
|---|---|
| Tombol "Berhenti promo" / teks `STOP`, `BERHENTI`, `BERHENTI PROMO` (tanpa beda huruf besar/kecil) | `promo_wa = false`, sumber `WA_BALASAN`, `log_audit`; satu balasan teks bebas dalam jendela 24 jam: "Kamu tidak akan menerima promo NEKAT lagi. Info pesanan tetap dikirim." |
| Teks lain | Tidak dibalas otomatis (Fase 1 tanpa chatbot); tidak disimpan; metrik `wa_masuk_total` |
| Opt-in WA (N-13) | Layar verifikasi OTP menampilkan pernyataan "Kirim info pesanan ke WhatsApp nomor ini" dengan centang, bawaan tidak dicentang. Dicentang → `wa_optin_pada`, `wa_optin_sumber='LOGIN_OTP'`. Bisa diubah di Pengaturan (`PENGATURAN`). Dicabut → semua WA kecuali OTP berhenti |
| Pengaturan di aplikasi | Toggle "Info promo" (`promo_wa`) dan "Pengingat ajak teman" (WA-05/05b, N-10). Template kritis dan transaksi tidak bisa dimatikan (pengguna tetap bisa memblokir nomor) |

**Perubahan skema (migrasi expand; T-016 kecuali disebut lain).** Semua tabel tanpa teks pesan jadi. Nomor HP hanya ada di `daftar_tunggu`, dalam bentuk terenkripsi.

| Tabel | Kolom | Catatan |
|---|---|---|
| `akun_notifikasi` (baru) | `akun_id` PK, `wa_optin_pada`, `wa_optin_sumber` (`LOGIN_OTP`/`PENGATURAN`), `wa_optin_dicabut_pada`, `promo_wa`, `promo_wa_sumber`, `promo_wa_diubah_pada`, `pengingat_ajak` (bawaan true), `wa_tidak_tersedia` | Perubahan dicatat `log_audit` |
| `template_wa` (baru) | `nama` PK, `kategori`, `jumlah_parameter`, `status_meta`, `dijeda`, `diperbarui_pada` | J-15 |
| `pesan_wa` (baru) | `id`, `kunci` UK (= `outbox.kunci_idempotensi` atau `otp:{id}`), `outbox_id` NULL, `akun_id` NULL (OTP sebelum akun ada → NULL), `template`, `kategori`, `wamid` UK NULL, `status` (`ANTRE`/`LOG`/`DIKIRIM_KE_PENYEDIA`/`SENT`/`DELIVERED`/`READ`/`GAGAL`), `kode_galat`, `waktu_sent`/`waktu_delivered`/`waktu_read`/`waktu_gagal` | **Tanpa nomor, kode OTP, atau parameter** |
| `wa_webhook_event` (baru) | `wamid`, `status`, `diterima_pada`, `payload_redaksi` jsonb; UK (`wamid`, `status`) | Retensi N-12 |
| `wa_pesan_masuk` (baru) | `id_pesan_meta` UK, `hp_hmac`, `jenis` (`OPT_OUT`/`LAIN`), `diterima_pada` | Teks tidak disimpan |
| `wa_laju` (baru) | `detik` PK, `jumlah` | Pembatas laju bersama; dipangkas J-18 |
| `daftar_tunggu` (baru, T-035/F-18) | `id`, `hp_enc` (AES-GCM, AAD = id, versi kunci), `hp_hmac` UK, `kelurahan_teks`, `lat`/`lng` dibulatkan 3 desimal, `setuju_wa_pada`, `dibuat_pada`, `dihapus_pada` | Dihapus (anonim) 14 hari setelah WA-40 terkirim atau 12 bulan tanpa zona dibuka (**DEFAULT**, N-12); balasan "Berhenti promo" → hapus segera |
| `outbox` (ubah, T-013b) | + `akun_id` NULL, + `kritis` bool (bawaan false), + `alasan` (wajib bila `KEDALUWARSA`, CHECK), + `lease_sampai`, + `pemegang` | Indeks antrean `(kritis DESC, kirim_setelah) WHERE status='MENUNGGU'`; `jenis` tetap `WA`/`PICKING`/`BATAL_PEMBAYARAN_XENDIT` |
| `job_run` (ubah, T-013b) | + `heartbeat_pada`, + `cursor` jsonb (posisi lanjut, mis. `akun_id` terakhir J-11), + `hasil` (`SUKSES`/`SEBAGIAN`/`GAGAL`/`DILEWATI`), + `ringkasan` jsonb (hitungan, tanpa PII) | Heartbeat memperpanjang `lease_sampai` |
| `alert_operasional`, `laporan_harian`, `rekonsiliasi_harian`, `saldo_cek_harian` (baru; T-041/T-030/T-021) | lihat §4.3 & §7 | Agregat tanpa PII |
| `slot_kirim` (ubah, T-031) | + `menit_siap_picking` NULL | J-06/J-10 |

`JENIS_TINJAUAN` tidak berubah.

### 3.6 Pemantauan template

Job `wa-template-sinkron` (J-15) menarik status template dari Meta (Graph API, read-only) dan memperbarui `template_wa`. Template dipakai kode tapi tidak `APPROVED` → alert `WA_TEMPLATE`. Daftar template di kode (`packages/domain/notifikasi/templat.ts`) adalah sumber kebenaran nama + jumlah parameter; tes memastikan setiap kode WA di §1 punya entri dan jumlah parameter cocok.

---

## 4. Katalog job (worker pg-boss)

### 4.1 Aturan bersama

- Semua job di `apps/worker`, didaftarkan seperti `daftarkanJobInventori` (antrean dibuat bila belum ada). Penamaan antrean `{domain}-{aksi}` (pola yang sudah ada: `inventori-sinkron`, `inventori-kirim-picking`).
- pg-boss **12.38.0** (`apps/worker/package.json`). Opsi yang dipakai sudah dicek di definisi tipe versi ini: `ScheduleOptions.tz`, `.key`, `.missed`; `QueuePolicy` `singleton`/`stately`/`short`; `SendOptions.singletonKey`/`startAfter`/`deadLetter`.
- Jadwal WIB: `boss.schedule(nama, cron, data, { tz: "Asia/Jakarta", missed: "once" })` **wajib** untuk semua cron harian/mingguan (J-03 harian, J-09, J-11, J-12, J-14, J-16, J-17, J-18). `missed: "once"` = bila worker mati saat jadwal, satu job dikirim saat hidup lagi. Bawaan pg-boss `skip` akan melewatkan laporan/KPI. Server tetap `TZ=UTC` (ADR §3.3 butir 4). Cron per-menit (`* * * * *`, `*/5`) memakai bawaan `skip`, karena run berikutnya menyapu semuanya. Menit jadwal sengaja bukan :00.
- Satu antrean dengan dua jadwal (J-03) wajib memakai `key` berbeda (`key: "sapu-5mnt"`, `key: "harian"`). Tanpa `key`, jadwal kedua menimpa yang pertama.
- Policy antrean (ditetapkan saat `createQueue`): sapuan cron → `singleton` (pola yang sudah ada). Job per entitas (J-01 `ttl`, J-02 `pengingat`, J-13 `cek`) → `stately` + `singletonKey` = ID entitas (1 antre + 1 aktif per kunci). **`singletonKey` tanpa policy `singleton`/`stately`/`short` tidak mencegah duplikat** di antrean `standard`. `wa-kirim`/`wa-status` → `stately` tanpa kunci (pembangun digabung).
- Antrean mati: `createQueue("job-mati")` dibuat **lebih dulu** di `daftarkanJob*`, baru antrean lain dibuat dengan `deadLetter: "job-mati"`. Worker `job-mati` → alert `JOB_MATI` (nama antrean + id job saja).
- `job_run(kunci)` untuk job berperiode (lease 5 menit + `heartbeat_pada` tiap 60 dtk; ambil alih bila lease habis, ADR §3.3 butir 1; `cursor` untuk lanjut). Efek ganda dicegah update bersyarat + kunci unik ledger/outbox, bukan oleh `job_run`.
- Waktu dari port `Clock`. Tidak ada HTTP keluar di dalam transaksi DB.
- **Urutan kunci baris** (pembayaran.md §3.5 versi T-021 + ongkir-slot §5.3): `grup` → `slot_kirim` → stok SKU → `peserta_grup` → `invoice` → `pembayaran` → `akun` (FOR SHARE) → `akun_saldo` (terakhir). Transaksi yang mengkredit/debit **lebih dari satu** pembayar/invoice (J-01 grup batal, J-05, J-10) **wajib** memanggil `kunciLedgerBatch` (T-021, PR #36) di awal, urut id, sebelum kredit satu per satu.
- **Log wajib per run** (pino, JSON): `job`, `versi_job`, `kunci`, `mulai`, `selesai`, `durasi_ms`, `sumber` (cron/event/manual), `ref_jenis`+`ref_id` (ID saja), `hasil` (`SUKSES`/`SEBAGIAN`/`GAGAL`/`DILEWATI`), `jumlah{...}`, `kelas_galat`, `catatan` (≤ 200 karakter, tanpa PII). pino `redact` untuk nomor HP/alamat/nama/token; error tracking SaaS dengan penyamaran aktif (K-43, H8). Data transaksi tidak dikirim ke SaaS.
- **Metrik** (Fase 1 sebagai baris log terstruktur + tabel `job_run`; ekspor Prometheus menyusul T-045): `job_durasi_ms{job}`, `job_gagal_total{job}`, `job_terlambat_detik{job}` (selisih dari jadwal/tenggat).

### 4.2 Ringkasan

| ID | Antrean | Jadwal (WIB) | Kunci / lock | Timeout · retry | Pemilik kode |
|---|---|---|---|---|---|
| J-01 | `tagihan-ttl` (+ `tagihan-ttl-sapu`) | per tagihan `startAfter = kedaluwarsa_pada + tenggang` (K-47); sapu `* * * * *` | `stately` + `singletonKey=ttl:{invoice_id}`; urutan kunci §4.1 + `kunciLedgerBatch` bila grup batal | 120 dtk · 5×, backoff 30 dtk | T-030 |
| J-02 | `tagihan-pengingat` | per tagihan `startAfter = kedaluwarsa_pada − 15 mnt` | `stately` + `singletonKey=pengingat:{invoice_id}` | 30 dtk · 3× | T-035 |
| J-03 | `grup-pengingat` | `*/5 * * * *` (`key: sapu-5mnt`) + `7 10 * * *` (`key: harian`, `missed: once`) | `singleton`; kunci WA per periode | 120 dtk · 2× | T-035 |
| J-04 | `grup-batas-terbit` (K-39) | `* * * * *` | `singleton`; per grup `job_run(terbit-otomatis:{grup_id})` + kunci grup FOR UPDATE | 120 dtk · lihat langkah | T-022/T-035 |
| J-05 | `slot-cutoff` | `* * * * *` | `job_run(cutoff:{slot_id})`; per grup update bersyarat; urutan kunci §4.1 + `kunciLedgerBatch` | lease 5 mnt + heartbeat · retry per langkah | T-023 |
| J-06 | `inventori-kirim-picking` (**ada**) | `* * * * *` | `singleton`; `picking:{grup_id}` | lease `leasePicking` · backoff 30 dtk×2^(n−1) maks 30 mnt s.d. 6 jam (IG-07) | T-019 ✔ |
| J-07 | `inventori-sinkron` (**ada**) | `cronSinkron(INVENTORY_INTERVAL_SINKRON_MENIT)`, hanya mode `gudang` | `singleton` | retry adapter; bagian gagal dilewati | T-019 ✔ |
| J-08 | `slot-daftar-antar` | event `SlotDitutup` | `daftar-antar:{slot_id}:{versi}` | 120 dtk · 3× | T-040 |
| J-09 | `slot-buat` | `37 0 * * *` | `buat-slot:{zona_kode}:{tanggal}` + UK DB | 300 dtk · 3× | T-031 |
| J-10 | `grup-ditahan-batas` (F-13) | `* * * * *` | update bersyarat `DITAHAN → BATAL`; urutan kunci §4.1 + `kunciLedgerBatch` | 120 dtk · 3× | T-023 |
| J-11 | `cod-evaluasi-mingguan` | `17 2 * * 1` (Senin) | `job_run(kpi-cod:{YYYY-Www})`; PK `(akun_id, minggu_mulai)` | lease 10 mnt · 3×, lanjut dari akun terakhir | T-042 |
| J-12 | `pembayaran-rekonsiliasi` | `17 3 * * *` | `job_run(rekon:{tanggal})` | lease 10 mnt · 3× | T-030 |
| J-13 | `pembayaran-cek-status` | event W5b / J-12 | `stately` + `singletonKey=cek:{pembayaran_id}` | 60 dtk · 6×, backoff 30 dtk | T-030 |
| J-14 | `saldo-cek-invarian` | `47 3 * * *` | `job_run(saldo-cek:{tanggal})` | 300 dtk · 2× | T-021 |
| J-15 | `wa-template-sinkron` | `13 */6 * * *` | `singleton` | 60 dtk · 3× | T-016 |
| J-16 | `laporan-harian` | `7 6 * * *` | `job_run(laporan:{tanggal})` | 300 dtk · 3× | T-041 |
| J-17 | `harga-timpaan-kedaluwarsa` (K-03) | `7 7 * * *` | `tinjauan TIMPAAN_KEDALUWARSA` unik per timpaan | 120 dtk · 3× | T-037 |
| J-18 | `pemeliharaan-harian` | `17 4 * * *` | `job_run(rawat:{tanggal})` | 600 dtk · 2× | T-045 |
| J-19 | `wa-kirim` | event + `* * * * *` | `stately` (§3.3) | lease 2 mnt | T-016 |
| J-20 | `wa-status` | event webhook | `stately`; UK `(wamid, status)` | 30 dtk · 5× | T-016 |

Jam J-09/J-11/J-12/J-14/J-16/J-17/J-18 = **DEFAULT** (N-09); semuanya `tz: Asia/Jakarta`, `missed: once`. Urutan harian: rekonsiliasi 03.17 → cek saldo 03.47 → pemeliharaan 04.17 → laporan 06.07 (laporan memuat hasil keduanya).

### 4.3 Rincian job

**J-01 TTL tagihan** — input `{invoice_id}`. Langkah = `pembayaran.md` §7 (lewati non-DITERBITKAN & COD; GET Xendit dulu; PAID → jalur webhook; belum bayar → tutup QR/VA lalu satu transaksi dengan urutan kunci §4.1: KEDALUWARSA + `SALDO_BALIK` + DIKELUARKAN + evaluasi grup. Bila grup batal (lunas < 3), `kunciLedgerBatch` atas semua invoice/akun pembayar dipanggil sebelum `REFUND` per peserta; outbox WA-03/03s / WA-08). Sapu tiap menit memakai indeks `(status, kedaluwarsa_pada) WHERE status='DITERBITKAN' AND metode_bayar <> 'COD'`. GET gagal → **jangan** kedaluwarsakan; retry; habis → alert `TTL_XENDIT`. Terlambat (worker mati): API sudah menolak bayar setelah TTL (guard waktu); run berikutnya memproses; `job_terlambat_detik > 300` → alert `JOB_TERLAMBAT`. Log: `invoice_id`, `grup_id`, hasil (`KEDALUWARSA`/`LUNAS_LEWAT_GET`/`DILEWATI`).

**J-02 Pengingat bayar** — input `{invoice_id}`. Masih DITERBITKAN ∧ belum ada pembayaran LUNAS → outbox WA-03a (basi = `kedaluwarsa_pada`). Tagihan TTL < 20 menit tersisa saat terbit → tidak dijadwalkan.

**J-03 Pengingat grup** — sapu grup `DIBUKA`/`AKTIF`: (a) harian 10.07 dan sekali pada `batas − 180 mnt` (**DEFAULT**): syarat belum terpenuhi → WA-05 atau WA-05b ke akun berbarang dengan `pengingat_ajak = true` (F-17: hanya terhitung; maks 1/hari lewat kunci periode); (b) `batas − 30 mnt`: WA-06 ke akun berbarang belum Siap; semua Siap → WA-06b ke host. Tidak mengubah status apa pun.

**J-04 Batas terbit tagihan (K-39)** — sapu grup `DIBUKA`/`AKTIF` dengan `sekarang ≥ batas − 5 mnt`:
1. `sekarang ≥ batas − 5 mnt` → outbox WA-06c ke akun berbarang belum Siap (kunci per akun; sekali).
2. `sekarang ≥ batas` → satu transaksi (kunci grup → slot → peserta): akun berbarang belum Siap → `DIKELUARKAN` alasan `BELUM_SIAP` + WA-06d; host belum Siap → N-06; hitung ulang syarat di dalam kunci.
3. Syarat terpenuhi → panggil use case **yang sama** dengan tombol "Terbitkan tagihan" (aktor `SISTEM`, cara bayar = pilihan host bila sudah dipilih, selain itu `SENDIRI`), termasuk cek stok cabang (F-20, H14), kuotasi ongkir (tarif mati → O-08), kapasitas slot (O-09). Sukses → WA-04/04b(/04c).
4. Syarat tidak terpenuhi → grup `GAGAL` → pilihan K-11 (WA-08c); tanpa pilihan sampai batas pilih → batal (WA-08b).
5. A-04 (`sekarang + TTL ≤ cut_off`) tidak pernah dilonggarkan. Terbit otomatis memakai `kedaluwarsa_pada = cut_off_pada` (= batas + TTL). Selisih detik karena proses berjalan setelah tepat `batas` memendekkan TTL beberapa detik, bukan memperpanjang lewat cut-off (lihat N-07). Retry hanya **di dalam satu run** untuk galat SEMENTARA, maks 3 percobaan dalam `grup.terbit_otomatis_maks_detik` (**DEFAULT 60**). Masih gagal karena sebab teknis (Gudang tak terjangkau, Xendit gagal, `SLOT_PENUH`) → **DEFAULT SEMENTARA N-07: BATAL** dengan alasan `TERBIT_OTOMATIS_GAGAL`, tanpa dana (belum ada tagihan lunas; tagihan yang sempat dibuat dibatalkan + `SALDO_BALIK`), WA-08b "pesanan tidak dapat diproses", alert `TERBIT_OTOMATIS_GAGAL`, tidak dihitung KPI COD. Tidak ada retry lintas run.
Idempotensi: `job_run(terbit-otomatis:{grup_id})`; status grup `TAGIHAN_TERBIT` sebagai checkpoint; tagihan unik per peserta. Terlambat: API "Siap"/ubah keranjang menolak sendiri setelah batas; terbit manual setelah batas ditolak `MELEWATI_BATAS_CHECKOUT`.

**J-05 Cut-off slot + kunci harga final + selisih → saldo** — input slot `cut_off_pada ≤ sekarang` ∧ `job_run(cutoff:{slot_id}) ≠ SELESAI`. Langkah = `group-order.md` §6 (langkah 6 = transaksi kunci harga). Grup belum terbit → GAGAL/BATAL (K-11/K-39). Grup `TAGIHAN_TERBIT` dengan tagihan masih DITERBITKAN adalah **jalur normal**: tagihan terbit di batas kedaluwarsa tepat di cut-off, lalu J-01 menutupnya pada `kedaluwarsa_pada + tenggang` (K-47). J-05 melewati grup itu (status bukan checkpoint) dan mengulang tiap menit sampai semua tagihan final, lalu lanjut G3/G4. Alert `CUTOFF_TERTAHAN` hanya bila masih ada tagihan DITERBITKAN pada `cut_off + tenggang + 5 menit`. Per grup lunas: `konfirmasiStok` → alokasi FIFO `waktu_bayar` → harga cut-off & `hitungHargaFinal` → **satu transaksi**, dengan urutan kunci §4.1: `grup` FOR UPDATE `WHERE status=…` → `slot_kirim` → stok SKU → semua `peserta_grup` → `kunciLedgerBatch(invoice + akun semua pembayar, urut id)` → tulis harga final, `qty_teralokasi`, peserta TERKUNCI/A8, lalu ledger:

| Entri ledger J-05 (format kanonik T-021, `@nekat/domain` `identitasKredit`) | Kunci idempotensi |
|---|---|
| `SELISIH_HARGA` per peserta (D − F unit teralokasi, dibatasi pagar modal P-23) ke pembayar | `selisih:{grup_id}:{peserta_id}` |
| `REFUND` alasan `ALOKASI` per baris (unit tak teralokasi) ke pembayar | `refund:{baris_invoice_id}:ALOKASI:cutoff:{slot_id}` (`jobCutoffId` = `cutoff:{uuid}` huruf kecil, identitas stabil `job_run`, bukan id percobaan) |

Dalam transaksi yang sama: status `HARGA_TERKUNCI`, outbox `picking:{grup_id}`, dan satu WA per akun dengan kunci `grup_dikunci` (§2.1). Pagar gagal / INV-PE tidak tersedia setelah retry / modal > 15 menit → `DITAHAN` + WA-09 + tinjauan `GRUP_DITAHAN` + alert. Kunci harga & selisih **bukan job terpisah**: harus satu transaksi dengan alokasi agar tidak ada kredit tanpa kunci harga. Selesai → `job_run` SELESAI, slot `DITUTUP`, outbox internal `SlotDitutup` → J-08. Metrik per run: jumlah grup per hasil. Run pertama dimulai > 2 menit setelah `cut_off_pada` → alert `CUTOFF_TERLAMBAT` (guard API sudah menutup grup tepat waktu). Menunggu J-01 untuk tagihan yang masih DITERBITKAN tidak dihitung terlambat.

**J-06 Picking (ada, T-019)** — tidak diubah. Tambahan T-040: alert `PICKING_BELUM_TERKIRIM` bila ada `picking:{grup_id}` belum `TERKIRIM` pada `slot.mulai − slot.menit_siap_picking` (kosong → alert saat GAGAL saja); entri `GAGAL` sudah masuk tinjauan `PICKING_GAGAL`.

**J-07 Sinkron Gudang (ada, T-019)** — tidak diubah. Tambahan: hasil `gagal.length > 0` tiga run berturut-turut, atau ambang nonaktif (IG-08) terlampaui → alert `SINKRON_GUDANG`. Data modal > 15 menit menahan checkout (P-10, H14) — bukan tugas job ini.

**J-08 Daftar antar per slot (H13)** — input `SlotDitutup {slot_id, grup_id[]}`. Bangun penugasan paket → armada usulan + urutan (ongkir-slot §8), simpan `daftar_antar` versi baru **tanpa PII**; buat kode ambil drop point (hash). Notifikasi admin: tinjauan/panel "Daftar antar slot {kode} siap" (+ WA-31 `DAFTAR_ANTAR_SIAP` hanya kode slot). PII dirender **saat unduh** di panel ber-TOTP dan dicatat `log_audit` (O-12 DEFAULT); **tidak lewat n8n/WA**. Admin ubah penugasan → versi baru, kunci `daftar-antar:{slot_id}:{versi}`. Grup DITAHAN tidak masuk sampai dilepas. Catatan: ADR §3.3 menulis `antar:{slot_id}`; dokumen ini memakai `daftar-antar:` (ongkir-slot §8).

**J-09 Buat slot** — ongkir-slot §5.1; `ON CONFLICT DO NOTHING`. Tidak ada slot untuk besok di zona aktif setelah run → alert `SLOT_KOSONG`.

**J-10 Batas DITAHAN (F-13)** — grup `DITAHAN` dengan `sekarang ≥ slot.mulai − slot.menit_siap_picking` → G8 dalam satu transaksi dengan urutan kunci §4.1 + `kunciLedgerBatch`: BATAL + `REFUND` per peserta ke saldo pembayar (kunci sesuai pembayaran.md §8.2 / T-021; kecuali `dana_ditahan`) + WA-08. `slot.menit_siap_picking` kosong → batas = `slot.mulai` (DEFAULT) dan panel menandai "isi waktu siap picking".

**J-11 Evaluasi KPI COD mingguan (T-042)** — input `minggu_mulai` (Senin 00.00 WIB minggu lalu, K-52 DEFAULT). Langkah = `pembayaran.md` §10.1; satu transaksi per akun (`kpi_cod_mingguan` + `status_cod`), proses berurutan per `akun_id` dengan cursor tersimpan di `job_run` agar run lanjutan meneruskan. Minggu terlewat → evaluasi berurutan dari yang tertua. WA-20/21 lewat outbox (jam tenang → terkirim 07.00). Ambang dari `ambang_kpi_cod` versi berlaku (tidak di-hardcode). Log: jumlah dievaluasi/lolos/diaktifkan/dicabut. Rerun minggu sama = no-op.

**J-12 Rekonsiliasi pembayaran harian** — tanggal WIB kemarin: pembayaran MENUNGGU lewat `kedaluwarsa_pada`, KEDALUWARSA/GAGAL, LUNAS/LUNAS_TERLAMBAT hari itu → GET Xendit (laju dibatasi `xendit.rekon_per_detik`, **DEFAULT 5**). Status beda → jadwalkan J-13 (jalur yang sama dengan webhook, tidak pernah LUNAS langsung dari job ini); nominal beda / yatim → tinjauan (K-58). Hasil agregat di `rekonsiliasi_harian(tanggal PK, jumlah_dicek, jumlah_beda, selesai_pada)`. Xendit tidak tersedia → retry; tetap gagal → `job_run GAGAL` + alert `REKON_GAGAL`; laporan menandai "rekonsiliasi belum selesai".

**J-13 Cek status pembayaran** — `pembayaran.md` §6.4: GET + W5 + §6.2, tanpa baris `webhook_event`; idempoten lewat update bersyarat.

**J-14 Cek Σ ledger = saldo** — panggil `cariSelisihSaldo(db)` (T-021, transaksi baca `repeatable read`). Hanya melapor, **tanpa koreksi otomatis**. Hasil > 0 → alert P1 `SALDO_SELISIH` (ID akun saja) + masuk laporan; koreksi hanya lewat `KOREKSI_ADMIN` four-eyes (L-03/L-05). Simpan `saldo_cek_harian(tanggal, jumlah_akun_selisih)`.

**J-15 Sinkron status template** — §3.6.

**J-16 Laporan harian owner (T-041)** — tanggal WIB kemarin. Isi agregat (tanpa PII): grup dibuat / tagihan terbit / harga terkunci / gagal / batal per alasan; jumlah pesanan & pembeli unik; repeat rate (pembeli dengan pesanan selesai > 1 dalam 30 hari); biaya kirim per order + Σ `penanggungan_ongkir` per alasan (O-13); DITAHAN terbuka; invoice COD lewat slot belum ditutup (pembayaran.md §10.3); outbox WA/PICKING `GAGAL`; hasil J-12 & J-14; tinjauan terbuka per jenis. Simpan `laporan_harian(tanggal PK, data jsonb, versi)` lalu outbox WA-30 ke `laporan.penerima_admin` (**DEFAULT**: owner). Ringkasan untuk n8n hanya lewat endpoint internal `GET /internal/ringkasan-harian/{tanggal}` (§5): hanya hitungan, tanpa nominal uang dan tanpa PII. Prasyarat (J-12/J-14) belum SELESAI → laporan tetap dibuat dengan tanda, tidak menunggu. Kirim ulang: endpoint internal `POST /internal/laporan/{tanggal}/kirim-ulang` (admin TOTP atau token internal). Setiap permintaan menaikkan `laporan_harian.kirim_ulang_ke` (n) di transaksi yang sama dengan penulisan outbox kunci `…:{admin_akun_id}:ulang{n}` dan baris `log_audit` (siapa, kapan, n). Kunci asli yang sudah `GAGAL` tidak di-reset. Permintaan yang sama dikirim dua kali dengan header `Idempotency-Key` sama → satu n saja.

**J-17 Timpaan modal kedaluwarsa (K-03)** — timpaan dengan `kedaluwarsa_pada ≤ sekarang` → tinjauan `TIMPAAN_KEDALUWARSA` (unik per timpaan) berisi catatan admin + WA-31 ringkas. Tidak mengubah harga otomatis.

**J-18 Pemeliharaan** — pangkas `webhook_payload` Xendit > 90 hari (T-004 §6.3), `wa_webhook_event` & `pesan_wa` sesuai N-12, outbox `TERKIRIM/KEDALUWARSA` > 30 hari; arsip `pg-boss` bawaan. Tidak menyentuh ledger/invoice.

---

## 5. Pembagian n8n vs worker pg-boss (governance)

| Otomasi | Tempat | Verdict | Alasan |
|---|---|---|---|
| Semua job §4 (TTL, K-39, cut-off, kunci harga, saldo, picking, daftar antar, rekonsiliasi, KPI COD, laporan) | **Wajib kode** (`apps/worker`) | APPROVE | Uang/status/stok; perlu transaksi, tes, CI (ADR §4.4) |
| WA ke pembeli (semua template §1) | **Wajib kode** | APPROVE | Butuh nomor HP (PII) + token WA; H4 melarang PII di n8n |
| Daftar antar berisi nama/HP/alamat | **Wajib kode**, unduh panel TOTP | PARTIAL AUTOMATION ONLY | Sistem menyusun, admin membagikan (H13, O-12); n8n dilarang |
| Laporan harian: kirim salinan ke email/spreadsheet internal | n8n boleh (opsional) | APPROVE AS PILOT | Hanya **hitungan tanpa nominal uang** (sejalan N-11), diambil lewat endpoint internal bertoken `GET /internal/ringkasan-harian/{tanggal}`, **bukan** koneksi DB |
| Rute alert ke kanal tim (email/obrolan tim) | n8n boleh (opsional) | APPROVE AS PILOT | Worker mendorong ke webhook n8n bertanda tangan HMAC; payload hanya kode alert + ID; sumber tetap worker |
| Pengingat tim internal (mis. "isi tarif armada", "cek tinjauan terbuka") | n8n boleh | APPROVE AS PILOT | Tanpa data pelanggan |
| Chatbot WA / balasan otomatis pelanggan | — | DEFER | Butuh PII + kebijakan CS; tidak di Fase 1 |
| Promo massal WA | — | DEFER | Menunggu rancangan Growth & opt-in nyata (WA-41 nonaktif) |

Aturan n8n (H4): host terpisah dari DB production; **tidak ada koneksi DB** (termasuk read-only). Data masuk hanya lewat endpoint internal `GET /internal/ringkasan-harian/{tanggal}` (hitungan saja: grup per status, pesanan, pembeli unik, butir tinjauan, outbox gagal; tanpa nominal uang/PII; skema diuji TC-NJ-35) dan dorongan alert dari worker. Aksi hanya lewat endpoint internal terautentikasi (token khusus `N8N_TOKEN_INTERNAL`, rotasi 90 hari, allowlist IP host n8n, rate limit), idempoten, tercatat `log_audit`; tidak menyimpan kredensial Xendit/WA/DB tulis; workflow diekspor ke `n8n/` tanpa kredensial dan di-review seperti kode; nama `[ENV]-[SYSTEM]-[PROCESS]-[ACTION]-v[MAJOR.MINOR]`, mis. `PROD-NEKAT-LaporanHarian-KirimEmail-v1.0`, `PROD-NEKAT-Alert-RuteTim-v1.0`. Go-live Fase 1 **tidak membutuhkan** n8n: semua yang wajib berjalan tanpa n8n. Hosting: **n8n self-host di region Indonesia** (H12). n8n cloud tidak dipakai: K-43 hanya mengizinkan log/error tracking SaaS luar negeri, bukan alat otomasi yang menerima data operasional.

---

## 6. Cabang gagal

| # | Kondisi | Deteksi | Perilaku | Pemulihan |
|---|---|---|---|---|
| NG-01 | API Meta tidak tersedia | SEMENTARA berulang | Outbox antre; status aplikasi tetap benar; OTP gagal → UI coba lagi | Backoff; pesan basi dibuang; alert bila > 15 menit |
| NG-02 | Token WA kedaluwarsa/dicabut | OTENTIKASI | Seluruh kirim dijeda; OTP tidak bisa → login pembeli terhenti; admin tetap bisa login (sandi + TOTP, A-01) | Alert P1 `WA_TOKEN`; ganti token; buka jeda; pesan belum basi terkirim |
| NG-03 | Template PAUSED/DISABLED/ditolak | TEMPLATE / J-15 | Template itu ditahan, lainnya jalan | Alert; ajukan versi baru `_v{n+1}`; peta kode → nama diganti di konfigurasi |
| NG-04 | Nomor bukan pengguna WA | PENERIMA | Tandai `wa_tidak_tersedia`; tidak dicoba lagi | Login OTP sukses berikutnya menghapus tanda |
| NG-05 | Rate limit / tier harian Meta | BATAS | Tunda; template kritis didahulukan (prioritas di klaim batch) | Alert pada 80% tier; ajukan naik tier |
| NG-06 | Anggaran OTP habis (*pumping*) | Penghitung | OTP ditolak umum + alert | Admin meninjau pola IP/prefiks; naikkan anggaran hanya dengan keputusan |
| NG-07 | Webhook Meta tanda tangan salah | HMAC | `401`, tanpa efek | Alert bila berulang (rotasi `WA_APP_SECRET`) |
| NG-08 | Status WA ganda / tidak urut | UK / urutan | Abaikan duplikat & mundur | — |
| NG-09 | Worker mati | `job_run` lease habis, `job_terlambat_detik` | Guard waktu API menutup grup/tagihan tepat waktu; job menyusul | Run berikutnya ambil alih; alert `JOB_TERLAMBAT` |
| NG-10 | Dua worker aktif | singleton + `job_run` | Hanya satu memegang lease | — |
| NG-11 | Job cut-off mati di tengah | Lease | Status grup jadi checkpoint; grup selesai dilewati | ADR §3.3 butir 1 |
| NG-12 | Terbit otomatis K-39 gagal teknis | J-04 langkah 5 | N-07 | Alert; admin melihat daftar grup |
| NG-13 | Pesan jatuh di jam tenang & basi sebelum 07.00 | Evaluasi §2.2 | Dibuang (`KEDALUWARSA` `JAM_TENANG_BASI`) | Informasi tetap di aplikasi |
| NG-14 | Pengguna opt-out promo | Balasan / 131050 | Tidak ada marketing; utility tetap | — |
| NG-15 | Xendit tak tersedia saat TTL/rekon | GET gagal | Tidak kedaluwarsakan tanpa jawaban; rekon ditandai belum selesai | Retry; alert |
| NG-16 | Selisih saldo ditemukan | J-14 | Laporan + alert, tanpa koreksi otomatis | Koreksi admin four-eyes |
| NG-17 | Nama grup berisi link/nomor | Sanitasi | Diganti "Belanja Bareng" di WA | — |
| NG-18 | pg-boss `schedule` tanpa `tz` | Tes konfigurasi | Cron WIB bergeser 7 jam | Tes wajib (TC-NJ-24) |
| NG-19 | Admin penerima laporan/alert tidak punya nomor WA | Validasi konfigurasi | Hanya panel + error tracking | Panel peringatan "penerima alert kosong" |

---

## 7. Kontrak handoff

```
HANDOFF T-016 (adapter WA + OTP)
  Menyediakan: port WhatsAppGateway (§3.1) + LogGateway, MetaCloudGateway(sandbox|meta), penjaga start (§3.2),
    antrean wa-kirim (§3.3), webhook /webhook/whatsapp + wa-status (§3.4), opt-in/opt-out (§3.5), J-15,
    migrasi §3.5: akun_notifikasi, template_wa, pesan_wa, wa_webhook_event, wa_pesan_masuk, wa_laju,
    outbox(+akun_id, kritis, alasan, lease_sampai, pemegang), job_run(+heartbeat_pada, cursor, hasil, ringkasan).
  Fungsi domain: antreWa(tx, { template, akunId, ref:{jenis,id}, parameter[], tombol?, periodeWib?, basiPada })
    -> { dibuat: boolean }  // ON CONFLICT DO NOTHING; dipanggil DI DALAM transaksi bisnis pemanggil
  OTP (§3.3a): API commit otp_permintaan + pesan_wa(kunci otp:{otp_permintaan_id}, status ANTRE), lalu DI LUAR
    transaksi gateway.kirimOtp({ nomorE164, kode, kunciIdempotensi }) — nomor & kode hanya di memori request.
    TIDAK lewat outbox/pg-boss. pesan_wa hanya status + kode_galat.
  Syarat lulus: TC-NJ-01..12, 25..27, 38..41.

HANDOFF T-035 (status pesanan + notifikasi)
  Memanggil antreWa pada setiap transisi di matriks §2.1 (kecuali OTP, COD, admin).
  Memasang J-02, J-03, J-04 (bersama T-022). Template individu_* bila spec pesanan individu ada.
  Larangan: tidak mengirim WA di luar outbox; tidak menaruh nomor HP di payload.

HANDOFF T-040 (pasca cut-off)
  Masukan: SlotDitutup { slot_id, grup_id[] (HARGA_TERKUNCI) } dari J-05.
  Keluaran: J-08 daftar_antar versi (tanpa PII), kode ambil, alert PICKING_BELUM_TERKIRIM (J-06 tambahan), J-10
    (G8 dengan urutan kunci §4.1 + kunciLedgerBatch). Kolom baru slot_kirim.menit_siap_picking (T-031).
  Status antar dari panel (T-039) -> WA-12/13/13c/14 lewat antreWa.

HANDOFF T-041 (laporan harian)
  J-16: laporan_harian(tanggal PK, data jsonb, versi, kirim_ulang_ke) + WA-30.
  GET /internal/ringkasan-harian/{tanggal} (token internal; hitungan saja, tanpa uang/PII) untuk n8n opsional (§5).
  POST /internal/laporan/{tanggal}/kirim-ulang (sufiks ulang{n} + log_audit).

HANDOFF T-042 (KPI COD mingguan)
  J-11: evaluasiMinggu({ minggu_mulai WIB }) -> { dievaluasi, lolos, diaktifkan, dicabut } ; idempoten (akun, minggu).
  Jadwal schedule('cod-evaluasi-mingguan', '17 2 * * 1', null, { tz: 'Asia/Jakarta', missed: 'once' });
  lanjut dari job_run.cursor (akun_id terakhir).
  WA-20/21 lewat antreWa kunci wa:cod_status:akun:{akun_id}:{akun_id}:{YYYY-Www}.
```

Kontrak alert (dipakai semua job): `catatAlert({ kode, ref, tingkat: "P1"|"P2", catatan })` → tabel `alert_operasional(kode, ref, jam_WIB; UK (kode, ref, jam_WIB))` + error tracking + WA-31 (P1 segera; P2 hanya ringkasan di laporan). Kode alert: `JOB_MATI`, `JOB_TERLAMBAT`, `CUTOFF_TERLAMBAT`, `CUTOFF_TERTAHAN`, `TTL_XENDIT`, `TERBIT_OTOMATIS_GAGAL`, `GRUP_DITAHAN`, `PICKING_BELUM_TERKIRIM`, `SINKRON_GUDANG`, `REKON_GAGAL`, `SALDO_SELISIH`, `SLOT_KOSONG`, `WA_TOKEN`, `WA_TEMPLATE`, `WA_KUALITAS`, `WA_ANGGARAN`, `DAFTAR_ANTAR_SIAP`.

---

## 8. Kasus uji

| # | Skenario | Hasil yang diharapkan |
|---|---|---|
| TC-NJ-01 | `WA_MODE=log`, minta OTP | `pesan_wa` status LOG; kode tampil di halaman dev; log tidak memuat nomor utuh |
| TC-NJ-02 | `APP_ENV=production`, `WA_MODE=log` | API & worker menolak start |
| TC-NJ-03 | `APP_ENV=preview`, `WA_MODE=meta` | Menolak start |
| TC-NJ-04 | Sandbox, nomor di luar daftar izin | Tidak dikirim; `KEDALUWARSA DIBLOKIR_SANDBOX` |
| TC-NJ-05 | Transisi sama ditulis dua kali (rerun) | Satu baris outbox; satu WA |
| TC-NJ-06 | Galat 5xx dua kali lalu sukses | 3 percobaan, jeda naik, satu `wamid` |
| TC-NJ-07 | Galat 131026 | GAGAL; `wa_tidak_tersedia = true`; pesan berikut tidak dicoba |
| TC-NJ-08 | Galat 132015 (template dijeda) | Template ditahan + alert; template lain tetap terkirim |
| TC-NJ-09 | Galat 190 | Semua kirim dijeda + alert P1 |
| TC-NJ-10 | Webhook status tanda tangan salah | `401`, tanpa perubahan |
| TC-NJ-11 | Status `delivered` datang sebelum `sent` | Akhir = DELIVERED; `sent` dicatat waktunya saja |
| TC-NJ-12 | Balasan "berhenti promo" | `promo_wa = false`; WA-40 berikutnya tidak dikirim; utility tetap |
| TC-NJ-13 | WA-05 dua kali di hari WIB yang sama (J-03 harian + batas − 180) | Hanya satu terkirim |
| TC-NJ-14 | WA-05 dibuat 22.00 WIB, basi 06.30 | Dibuang `JAM_TENANG_BASI` |
| TC-NJ-15 | WA-06c (kritis) pada 06.55 WIB | Terkirim (tidak kena jam tenang) |
| TC-NJ-16 | Akun ke-7 pesan tidak kritis hari itu | `KEDALUWARSA BATAS_HARIAN`; template kritis tetap lewat |
| TC-NJ-17 | K-39: anggota belum Siap di `batas − 5` | WA-06c sekali; di `batas` → DIKELUARKAN + WA-06d |
| TC-NJ-18 | K-39: setelah pengeluaran syarat terpenuhi | Tagihan terbit otomatis (aktor SISTEM, `SENDIRI` bila host belum memilih) + WA-04 |
| TC-NJ-19 | K-39: Gudang tak terjangkau selama run di `batas` (3 percobaan dalam 60 dtk) | Grup BATAL `TERBIT_OTOMATIS_GAGAL`, tanpa dana, alert (N-07); tidak ada run kedua yang menerbitkan |
| TC-NJ-20 | J-04 dijalankan dua kali bersamaan | Satu set tagihan; WA tidak ganda |
| TC-NJ-21 | Pengingat bayar: tagihan dilunasi sebelum `kedaluwarsa − 15` | WA-03a tidak dikirim |
| TC-NJ-22 | J-01: GET Xendit gagal terus | Tagihan tidak dikedaluwarsakan; alert `TTL_XENDIT` |
| TC-NJ-23 | J-05 mati setelah 2 dari 5 grup | Run berikutnya memproses 3 sisanya; ledger selisih & picking tidak ganda |
| TC-NJ-24 | Semua cron WIB terdaftar dengan `tz: "Asia/Jakarta"`; `Clock` = 05.59 vs 06.07 WIB | Laporan hanya jalan 06.07 WIB (23.07 UTC hari sebelumnya) |
| TC-NJ-25 | Minta OTP lalu periksa `outbox`, tabel/arsip pg-boss, `pesan_wa`, log pino, event error tracking | Tidak ada baris outbox/job untuk OTP; kode OTP & nomor tidak muncul di tabel/log mana pun (cari string kode & nomor); `pesan_wa` hanya kunci/status. Payload outbox WA lain tanpa nomor/alamat/nama (tes skema) |
| TC-NJ-26 | Nama grup "Promo wa.me/62812345678" | Variabel WA menjadi "Belanja Bareng" |
| TC-NJ-27 | Setiap kode WA di §1 | Ada entri di `templat.ts`, jumlah parameter cocok, variabel tidak di awal/akhir teks |
| TC-NJ-28 | J-08: daftar antar dibuat | Tabel `daftar_antar` tanpa kolom PII; unduh panel tercatat `log_audit`; tidak ada WA/n8n berisi alamat |
| TC-NJ-29 | J-11 dijalankan ulang untuk minggu yang sama | No-op; WA-20/21 tidak ganda |
| TC-NJ-30 | J-11 tidak jalan 2 minggu | Run berikut mengevaluasi 2 minggu berurutan dari yang tertua |
| TC-NJ-31 | J-12: GET = PAID untuk pembayaran MENUNGGU | J-13 dijadwalkan; LUNAS hanya lewat jalur §6.2 |
| TC-NJ-32 | J-14: satu akun `saldo_rp ≠ Σ ledger` (disuntik di tes) | Alert `SALDO_SELISIH` berisi ID akun; tidak ada koreksi |
| TC-NJ-33 | J-16 dengan J-12 belum SELESAI | Laporan terbit dengan tanda "rekonsiliasi belum selesai" |
| TC-NJ-34 | Kirim ulang laporan dua kali | Satu WA per penerima per tanggal |
| TC-NJ-35 | `GET /internal/ringkasan-harian/{tanggal}` | Hanya kolom hitungan (tanpa `_rp`/nominal, nomor, alamat, nama); tanpa token → 401; n8n tidak punya kredensial DB |
| TC-NJ-36 | Template marketing | Tidak ada pola nominal `Rp` atau angka harga di teks (tes statis) |
| TC-NJ-37 | Volume 100× (1.000 grup, 10.000 pesan dalam 10 menit) | Laju ≤ `WA_KIRIM_PER_DETIK`; kritis didahulukan; tidak ada pesan ganda; lag cut-off < 2 menit |
| TC-NJ-38 | Kirim OTP: Meta timeout 2× lalu sukses dalam request | Satu `wamid`; respons sukses ≤ 12 dtk; gagal 3× → `pesan_wa GAGAL`, UI "Kode belum terkirim" |
| TC-NJ-39 | Kondisi grup memenuhi WA-05 lalu WA-05b di hari WIB yang sama | Hanya satu pesan (kunci `wa:grup_kurang:…:{YYYYMMDD}`) |
| TC-NJ-40 | Cut-off: peserta dengan alokasi parsial **dan** selisih harga | Tepat satu WA (WA-11); ledger `selisih:{grup_id}:{peserta_id}` + `refund:{baris_invoice_id}:ALOKASI:cutoff:{slot_id}`; rerun tanpa entri/WA ganda |
| TC-NJ-41 | Worker mati 02.00–08.00 WIB Senin, hidup 08.05 | J-11, J-12, J-14, J-16 masing-masing berjalan **sekali** (`missed: once`); cron per menit tidak menumpuk |
| TC-NJ-42 | J-03 didaftarkan dengan dua jadwal | `getSchedules('grup-pengingat')` mengembalikan 2 baris (`key` sapu-5mnt & harian) |
| TC-NJ-43 | `send('tagihan-ttl', …, {singletonKey: 'ttl:X'})` dua kali | Satu job antre (policy `stately`); antrean dibuat setelah `job-mati` dan `deadLetter` terpasang |
| TC-NJ-44 | J-05 untuk grup 4 pembayar, dua transaksi cut-off & TTL bersamaan | Tidak deadlock (urutan kunci §4.1 + `kunciLedgerBatch`); satu hasil |
| TC-NJ-45 | Tagihan terbit otomatis di `batas`; J-05 berjalan di cut-off | `kedaluwarsa_pada = cut_off_pada`; J-05 menunggu J-01 tanpa alert `CUTOFF_TERLAMBAT`; alert `CUTOFF_TERTAHAN` hanya lewat cut-off + tenggang + 5 mnt |
| TC-NJ-46 | Webhook WA: header `sha256=` hilang / body > 256 KB / `phone_number_id` lain / `wamid` tak dikenal / `messages[].id` diulang | 401 / 413 / bagian diabaikan / diabaikan tanpa baris / opt-out diproses sekali |
| TC-NJ-47 | Akun tanpa `wa_optin_pada` | Hanya OTP terkirim; pesan lain `KEDALUWARSA TANPA_OPTIN` |
| TC-NJ-48 | Kirim ulang laporan 2× (Idempotency-Key berbeda) | Dua WA (`ulang1`, `ulang2`) + 2 baris `log_audit`; Idempotency-Key sama → satu |
| TC-NJ-49 | Sandbox: entri izin versi kunci HMAC lama setelah rotasi | Cocok hanya dengan versi itu; versi tak dikenal → tolak start |

---

## 9. Keputusan terbuka baru

ID sementara; dipindah ke `project-specs/keputusan-terbuka.md` oleh sesi berikutnya. Sampai diputuskan berlaku **DEFAULT SEMENTARA**.

| ID | Pertanyaan | Pemilik | Rekomendasi | DEFAULT SEMENTARA |
|---|---|---|---|---|
| N-01 | Pesan "kurang X orang" (WA-05/05b) diajukan sebagai utility, tetapi Meta bisa menggolongkannya marketing (ajakan berbagi). Bila Meta menggolongkan marketing, tetap dikirim? | Randy | Ajukan sebagai utility dengan teks netral (§1.3). Bila digolongkan marketing: kirim hanya ke akun `promo_wa = true`; progres grup tetap di aplikasi | Sama dengan rekomendasi |
| N-02 | SMS sebagai cadangan OTP bila WA gagal (H2 menyebut opsional)? | Joseph (+ Randy untuk biaya) | Fase 1 tanpa SMS; port siap untuk adapter SMS; tinjau setelah pilot bila gagal OTP > ambang | Tanpa SMS |
| N-03 | Nomor HP + isi pesan dikirim ke Meta/BSP (server di luar negeri). Sesuai H12/K-43 ("data pribadi tetap di region Indonesia")? | Joseph (+ hukum) | Boleh sebagai pemroses pengiriman, isi minimal (tanpa alamat/daftar barang), disebut di Kebijakan Privasi (sudah ada "WhatsApp Business"); pilih BSP berhosting Indonesia bila biaya setara. **Wajib dikonfirmasi sebelum production** | Dev/preview memakai mode `log` (tanpa data ke Meta); production menunggu jawaban |
| N-04 | Jam tenang & batas kirim | Randy | Tidak kritis 21.00–07.00 WIB; maks 6 tidak kritis/akun/hari; marketing 09.00–19.00, maks 1/7 hari; kritis bebas jam tenang | Seperti rekomendasi (§2.2) |
| N-05 | Waktu pengingat | Randy | Bayar: `kedaluwarsa − 15 mnt`; Siap/terbit: `batas − 30 mnt`; kurang akun: 10.07 WIB harian + `batas − 180 mnt` (maks 1/hari, F-17) | Seperti rekomendasi |
| N-06 | K-39: host yang punya barang tetapi belum "Siap" di batas waktu. Dikeluarkan seperti anggota lain? Siapa memilih cara bayar saat terbit otomatis? | Randy | Diperlakukan sama (dikeluarkan); peran host pindah ke anggota paling awal (pola K-33) sebelum terbit; terbit otomatis memakai cara bayar yang sudah dipilih host, selain itu `SENDIRI` | Seperti rekomendasi |
| N-07 | (a) Terbit otomatis K-39 gagal karena sebab teknis (Gudang tak terjangkau H14, Xendit gagal, `SLOT_PENUH` O-09): apa yang terjadi? (b) Tagihan terbit otomatis selesai beberapa detik setelah batas; A-04 melarang tagihan hidup melewati cut-off, sedangkan K-07 meminta 60 menit sejak terbit. Mana yang didahulukan? | Randy (+ Joseph) | (a) Retry singkat hanya di dalam satu run (≤ 60 dtk); tetap gagal → grup BATAL `TERBIT_OTOMATIS_GAGAL`, tanpa dana, WA permintaan maaf, alert, tidak dihitung KPI COD. Alternatif yang perlu keputusan pemilik: pindahkan grup ke slot berikutnya (perlu persetujuan anggota). (b) A-04 didahulukan: `kedaluwarsa_pada = cut_off_pada`, sehingga TTL efektif berkurang beberapa detik. Tidak pernah melewati cut-off | (a) BATAL pada kegagalan pertama setelah retry di dalam run; (b) `kedaluwarsa_pada = cut_off_pada` |
| N-08 | Kanal alert operasional | Joseph | Error tracking SaaS (K-43) + WA-31 ke ≥ 2 admin jaga (H7); n8n opsional untuk email tim; isi alert hanya kode + ID | Seperti rekomendasi; penerima = semua admin `owner` |
| N-09 | Jadwal job WIB | Efan (laporan) + Joseph (teknis) | Buat slot 00.37; KPI COD Senin 02.17; rekonsiliasi 03.17; cek saldo 03.47; pemeliharaan 04.17; laporan owner 06.07; timpaan modal 07.07 | Seperti rekomendasi |
| N-10 | Pengguna boleh mematikan pengingat "ajak teman" (WA-05/05b)? Kode ambil drop point dikirim di WA atau hanya di aplikasi? | Randy | Boleh dimatikan (bawaan nyala); kode ambil hanya di aplikasi (pesan WA yang diteruskan tidak bisa dipakai mengambil paket) | Seperti rekomendasi |
| N-11 | Isi laporan harian di WA owner & ringkasan untuk n8n | Efan | WA dan endpoint ringkasan n8n hanya berisi hitungan (grup, pesanan, butir perlu tindakan) + link panel; angka uang (biaya kirim/order, penanggungan ongkir) hanya di panel TOTP | Seperti rekomendasi |
| N-12 | Masa simpan `pesan_wa`, webhook WA, dan `daftar_tunggu` (nomor HP terenkripsi) | Joseph (+ hukum) | Status kirim 1 tahun (bukti pemberitahuan saat sengketa); payload webhook terredaksi 90 hari; teks pesan masuk tidak disimpan; `daftar_tunggu` dianonimkan 14 hari setelah WA-40 terkirim atau 12 bulan tanpa zona dibuka, segera bila "Berhenti promo" | Seperti rekomendasi |
| N-13 | Persetujuan (opt-in) menerima pesan bisnis WhatsApp (diwajibkan kebijakan Meta) untuk pesan selain OTP: bagaimana dan kapan diambil? | Randy (+ hukum) | Centang "Kirim info pesanan ke WhatsApp nomor ini" di layar OTP, **bawaan tidak dicentang**, dicatat `wa_optin_pada` + sumber; bisa diubah di Pengaturan; tanpa opt-in semua info hanya di aplikasi. Kebijakan Privasi menyebut WA sebagai kanal info pesanan | Seperti rekomendasi |

### 9.1 Temuan ketidaksesuaian (untuk sinkron dokumen, mis. T-047)

| Dokumen | Temuan | Usulan |
|---|---|---|
| `group-order.md` §9.2 | Masih memakai invoice ongkir terpisah (WA-13 "invoice ongkir") dan "checkout"; K-25 menyatukan ongkir di satu tagihan, K-22 memakai "Terbitkan tagihan" + "Siap" | Rujuk katalog §1 dokumen ini |
| ADR §3.3 | Kunci `antar:{slot_id}` dan status `GAGAL_LANJUT_SATUAN` | `daftar-antar:{slot_id}:{versi}`; status skema `LANJUT_SATUAN` |
| `pembayaran.md` §7 | "WA Waktu bayar habis" tanpa kode | WA-03 `tagihan_kedaluwarsa_v1` |
| `project-specs/jadwal-otomatis.md` | Berisi jadwal sesi agen, bukan job produk | Job produk hanya di §4 dokumen ini |
