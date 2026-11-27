# T-010 — Notifikasi WhatsApp & job otomatis

Status: usulan v0.1 (27 Nov 2026) · Squad: Build & QA (Joseph) · Penyusun: Automation Governance Architect
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
| WA-01 | `auth_otp_v1` | `{{1}}` kode 6 digit | "*{{1}}* adalah kode verifikasi Anda. Demi keamanan, jangan bagikan kode ini." + footer "Kode ini kedaluwarsa dalam {n} menit." | Salin kode | Teks template authentication **ditetapkan Meta** (tidak bisa ditulis bebas); kalimat di sini perkiraan, cek di WhatsApp Manager. `{n}` diisi saat template dibuat = `otp.kedaluwarsa_menit` T-016 (**DEFAULT 5**). Tanpa URL, tanpa emoji. Krit. |

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
| WA-03 | `tagihan_kedaluwarsa_v1` | 1 nama grup | "Waktu bayar tagihan grup {{1}} sudah habis, jadi pesananmu dikeluarkan dari grup. Poin NEKAT yang dipakai untuk tagihan ini sudah dikembalikan." | Buka aplikasi | Ya |
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
| WA-40 | `promo_zona_dibuka_v1` (F-18) | 1 nama kelurahan | "Kabar baik, NEKAT sekarang melayani area {{1}}. Yuk mulai belanja bareng tetangga lewat aplikasi." | Buka aplikasi; balas cepat "Berhenti promo" | Penerima: daftar tunggu yang mencentang "kabari saya lewat WhatsApp" (persetujuan khusus di form daftar tunggu) |
| WA-41 | `promo_ajak_belanja_v1` | 1 nama kelurahan | "Tetangga di {{1}} sedang belanja bareng di NEKAT. Lihat grup yang sedang buka di zonamu." | Buka aplikasi; "Berhenti promo" | **Belum aktif** (flag `wa.promo_aktif=false`) sampai rancangan Growth (loop ajak tetangga) disetujui Randy |

---

## 2. Matriks pemicu → template → penerima → batas

### 2.1 Matriks

Kunci outbox mengikuti ADR §3.3: `wa:{template}:{ref_jenis}:{ref_id}:{akun_id}[:{periode_WIB}]` (`template` = kode tanpa versi, mis. `grup_kurang_akun`). `periode` = tanggal WIB `YYYYMMDD` bila pesan boleh berulang harian. **Basi** = `outbox.kedaluwarsa_pesan`; lewat waktu itu pesan tidak dikirim (status `KEDALUWARSA`).

| Pemicu (transisi / job) | Template | Penerima | Batas frekuensi (F-17) | Jam tenang | Kunci idempotensi | Basi | Fallback |
|---|---|---|---|---|---|---|---|
| Minta OTP (T-016) | WA-01 | pemohon | batas kirim per nomor & per IP + anggaran global (T-016) | tidak | `otp:{otp_permintaan_id}` | kedaluwarsa OTP | Tidak ada SMS (N-02): UI "Kode belum terkirim, coba lagi" |
| J-03 harian / batas − 180 mnt, akun berbarang < 3 | WA-05 | **akun berbarang saja** (terhitung) | maks 1 per grup per akun per hari WIB | ya | `wa:grup_kurang_akun:grup:{grup_id}:{akun_id}:{YYYYMMDD}` | batas terbit | Progres di halaman grup |
| sama, akun ≥ 3, total < minimum | WA-05b | akun berbarang | sama (berbagi kuota dengan WA-05: maks 1 dari keduanya per hari) | ya | `wa:grup_kurang_total:…:{YYYYMMDD}` | batas terbit | Halaman grup |
| J-03 batas − 30 mnt, belum Siap | WA-06 | anggota berbarang belum Siap | 1 per grup per akun | tidak | `wa:grup_pengingat_siap:grup:{grup_id}:{akun_id}` | batas − 5 mnt | Banner keranjang |
| J-03 batas − 30 mnt, semua Siap, host belum terbit | WA-06b | host | 1 per grup | tidak | `wa:grup_pengingat_terbit:grup:{grup_id}:{akun_id}` | batas | Tombol "Terbitkan tagihan" |
| J-04 batas − 5 mnt (K-39) | WA-06c | anggota berbarang belum Siap | 1 per grup per akun | tidak | `wa:grup_peringatan_keluar:grup:{grup_id}:{akun_id}` | batas | Banner + hitung mundur |
| J-04 batas: dikeluarkan (K-39) | WA-06d | anggota yang dikeluarkan | 1 per grup per akun | tidak | `wa:grup_dikeluarkan_belum_siap:grup:{grup_id}:{akun_id}` | cut-off | Status pesanan |
| Grup GAGAL, pilihan K-11 dibuka | WA-08c | anggota berbarang | 1 per grup per akun | tidak | `wa:grup_gagal_pilih:grup:{grup_id}:{akun_id}` | batas pilih | Default K-11 (batal) berlaku tanpa WA |
| Tagihan terbit (manual K-22 / otomatis K-39) | WA-04 / WA-04b | pembayar per tagihan; non-host bila `HOST` | 1 per tagihan per akun | tidak | `wa:tagihan_terbit:invoice:{invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Halaman tagihan |
| Terbit otomatis dengan O-08 | WA-04c | peserta yang cara kirimnya dialihkan | 1 per tagihan | tidak | `wa:tagihan_kirim_dialihkan:invoice:{invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Keterangan di tagihan |
| J-02 `kedaluwarsa − 15 mnt` | WA-03a | pembayar tagihan DITERBITKAN | 1 per tagihan | tidak | `wa:tagihan_pengingat_bayar:invoice:{invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Hitung mundur |
| J-01 TTL habis (A3) | WA-03 | pembayar (+ anggota bila `HOST`) | 1 per tagihan per akun | tidak | `wa:tagihan_kedaluwarsa:invoice:{invoice_id}:{akun_id}` | cut-off + 24 jam | Status pesanan |
| PAID (A4) | WA-02 | pembayar saja (mode `HOST`: anggota non-host tidak menerima WA-02; WA-04b sudah cukup) | 1 per pembayaran | tidak | `wa:pembayaran_diterima:pembayaran:{pembayaran_id}:{akun_id}` | + 24 jam | Status pesanan |
| PAID terlambat (A9, FP-09) | WA-15 | pembayar | 1 per pembayaran | tidak | `wa:pembayaran_terlambat:pembayaran:{pembayaran_id}:{akun_id}` | + 72 jam | Riwayat saldo |
| Stok baris habis (K-29) | WA-03b | pembayar | 1 per baris | tidak | `wa:stok_habis_baris:baris:{baris_invoice_id}:{akun_id}` | `kedaluwarsa_pada` | Tagihan |
| Cut-off HARGA_TERKUNCI | WA-07 / WA-07b | pembayar (poin) / anggota | 1 per grup per akun | ya | `wa:grup_dikunci:grup:{grup_id}:{akun_id}` (satu kunci untuk 07/07b) | + 24 jam | Status pesanan |
| Alokasi parsial / 0 (B-09, A8) | WA-11 | pembayar | 1 per grup per akun (menggantikan WA-07b) | ya | `wa:alokasi_parsial:grup:{grup_id}:{akun_id}` | + 72 jam | Status pesanan |
| DITAHAN (G6) | WA-09 | anggota lunas | 1 per grup per akun | ya | `wa:grup_ditahan:grup:{grup_id}:{akun_id}` | batas tahan | Status pesanan |
| Grup BATAL (semua alasan) | WA-08 / WA-08b | anggota berbarang / pembayar dana | 1 per grup per akun | tidak | `wa:grup_batal:grup:{grup_id}:{akun_id}` | + 72 jam | Riwayat "batal" |
| Slot dipindah (F-21, O-10) | WA-16 | anggota grup | 1 per grup per slot tujuan | tidak | `wa:slot_dipindah:grup:{grup_id}:{akun_id}:{slot_tujuan_id}` | awal slot tujuan | Status pesanan |
| Admin: Diantar / Siap diambil / Gagal antar / Diterima (T-039) | WA-12 / 13 / 13c / 14 | penerima paket | 1 per paket per status | 12/13/13c tidak; 14 ya | `wa:{template}:paket:{paket_id}:{akun_id}` | 12: akhir slot; 13/13c/14: + 72 jam | Status pesanan |
| J-11 COD aktif / dicabut KPI | WA-20 / WA-21 | akun | 1 per akun per minggu | ya | `wa:cod_status:akun:{akun_id}:{akun_id}:{YYYY-Www}` | + 7 hari | Halaman akun |
| Cabut COD manual | WA-22 | akun | 1 per pencabutan | ya | `wa:cod_dicabut_admin:status_cod:{id_log}:{akun_id}` | + 7 hari | Halaman akun |
| Dokumen legal versi baru (wajib setuju ulang) | WA-23 | akun AKTIF | 1 per versi | ya | `wa:kebijakan_berubah:dokumen:{dokumen_legal_id}:{akun_id}` | tanggal berlaku + 7 hari | Layar setuju ulang (F-23) |
| J-08 laporan harian | WA-30 | admin penerima laporan | 1 per tanggal | ya | `wa:admin_laporan_harian:laporan:{YYYYMMDD}:{admin_akun_id}` | + 24 jam | Panel admin |
| Alert (§4.3) | WA-31 | admin jaga | maks 1 per kode alert per referensi per jam | tidak | `wa:admin_alert:{kode}:{ref}:{admin_akun_id}:{YYYYMMDDHH}` | + 6 jam | Error tracking SaaS |
| Zona dibuka (F-18) | WA-40 | daftar tunggu ber-opt-in | 1 per zona per nomor | jendela 09.00–19.00 | `wa:promo_zona_dibuka:zona:{zona_id}:{daftar_tunggu_id}` | + 14 hari | — |

Catatan:
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

Urutan evaluasi saat worker mengambil pesan (§3.3 langkah 2): penerima aktif → opt-out → basi → jam tenang → batas global → jeda penerima → kirim.

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
| `sandbox` | `MetaCloudGateway` + daftar izin | Hanya ke nomor di `WA_SANDBOX_NOMOR_IZIN` (HMAC E.164); nomor lain → `KEDALUWARSA` alasan `DIBLOKIR_SANDBOX`, tidak dikirim | non-production dengan nomor uji Meta |
| `meta` | `MetaCloudGateway` (atau adapter BSP dengan port sama) | Kirim sungguhan | **hanya production** |

Penjaga start (API & worker): `APP_ENV=production` ∧ `WA_MODE ≠ meta` → tolak start; `APP_ENV ≠ production` ∧ `WA_MODE = meta` → tolak start. `sandbox` tanpa daftar izin → tolak start.

Variabel environment (nama saja; nilai di secret store, ADR §6): `WA_MODE`, `WA_API_VERSI` (dipin), `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `WA_ACCESS_TOKEN` [rahasia, token System User akun bisnis badan usaha, H7], `WA_APP_SECRET` [rahasia, verifikasi tanda tangan webhook], `WA_WEBHOOK_VERIFY_TOKEN` [rahasia], `WA_SANDBOX_NOMOR_IZIN`, `WA_KIRIM_PER_DETIK` (**DEFAULT 20**, di bawah batas throughput Meta). Rotasi token: pemilik Joseph; token kedaluwarsa → galat `OTENTIKASI` → alert (§4.3 `WA_TOKEN`).

### 3.3 Pengirim outbox (`wa-kirim`, worker)

1. API/job menulis `outbox(jenis='WA', kunci_idempotensi, payload={template, akun_id, ref, parameter, tombol}, kedaluwarsa_pesan, kirim_setelah)` **di transaksi bisnis yang sama** (`ON CONFLICT (kunci_idempotensi) DO NOTHING`). Payload **tanpa nomor HP**; nomor diambil worker dari modul `akun` tepat sebelum kirim. Setelah commit, API memanggil `boss.send('wa-kirim', {})` sebagai pembangun (latensi OTP); cron tiap menit menyapu sisanya.
2. Worker klaim batch (≤ 50, `FOR UPDATE SKIP LOCKED`, lease 2 menit) dan menjalankan urutan §2.2.
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

5. Pembatas laju: token bucket per `WA_PHONE_NUMBER_ID` (`WA_KIRIM_PER_DETIK`) disimpan di proses + kunci advisory Postgres agar 1 pengirim aktif (antrean `singleton`).

### 3.4 Status pengiriman (webhook Meta)

- `GET /webhook/whatsapp`: verifikasi `hub.verify_token` (constant-time) → balas `hub.challenge`.
- `POST /webhook/whatsapp`: verifikasi `X-Hub-Signature-256` = HMAC-SHA256(`WA_APP_SECRET`, body mentah), constant-time; salah → `401` + log keamanan (tanpa body). Benar → insert `wa_webhook_event(UNIQUE(wamid, status))` + `boss.send('wa-status')` → `200` cepat. Duplikat → `200` tanpa efek.
- Worker `wa-status`: status hanya maju `DIKIRIM_KE_PENYEDIA → SENT → DELIVERED → READ`; `FAILED` final (kode galat → §3.3 tabel). Status datang tidak berurutan → simpan waktu tiap status, abaikan yang mundur.
- Payload disimpan **sudah diredaksi** (`wa_id`/nomor → HMAC, teks pesan masuk tidak disimpan). Retensi N-12.
- Metrik: `wa_terkirim_total{template,status}`, `wa_gagal_total{template,kelas}`, rasio DELIVERED/terkirim per template per hari (turun < 90% → alert `WA_KUALITAS`).

### 3.5 Pesan masuk & opt-out

| Masuk | Tindakan |
|---|---|
| Tombol "Berhenti promo" / teks `STOP`, `BERHENTI`, `BERHENTI PROMO` (tanpa beda huruf besar/kecil) | `promo_wa = false`, sumber `WA_BALASAN`, `log_audit`; satu balasan teks bebas dalam jendela 24 jam: "Kamu tidak akan menerima promo NEKAT lagi. Info pesanan tetap dikirim." |
| Teks lain | Tidak dibalas otomatis (Fase 1 tanpa chatbot); tidak disimpan; metrik `wa_masuk_total` |
| Pengaturan di aplikasi | Toggle "Info promo" (`promo_wa`) dan "Pengingat ajak teman" (WA-05/05b, N-10). Template kritis dan transaksi tidak bisa dimatikan (pengguna tetap bisa memblokir nomor) |

Tabel baru (migrasi expand, T-016): `akun_notifikasi(akun_id PK, promo_wa, promo_wa_sumber, promo_wa_diubah_pada, pengingat_ajak, wa_tidak_tersedia)`, `template_wa(nama PK, kategori, status_meta, dijeda, diperbarui_pada)`, `pesan_wa(id, outbox_id UK, akun_id, template, kategori, wamid UK NULL, status, kode_galat, waktu_*)` — **tanpa nomor HP dan tanpa teks jadi**, `wa_webhook_event`. `JENIS_TINJAUAN` tidak berubah.

### 3.6 Pemantauan template

Job `wa-template-sinkron` (J-15) menarik status template dari Meta (Graph API, read-only) dan memperbarui `template_wa`. Template dipakai kode tapi tidak `APPROVED` → alert `WA_TEMPLATE`. Daftar template di kode (`packages/domain/notifikasi/templat.ts`) adalah sumber kebenaran nama + jumlah parameter; tes memastikan setiap kode WA di §1 punya entri dan jumlah parameter cocok.

---

## 4. Katalog job (worker pg-boss)

### 4.1 Aturan bersama

- Semua job di `apps/worker`, didaftarkan seperti `daftarkanJobInventori` (antrean dibuat bila belum ada). Penamaan antrean `{domain}-{aksi}` (pola yang sudah ada: `inventori-sinkron`, `inventori-kirim-picking`).
- Jadwal WIB: `boss.schedule(nama, cron, data, { tz: "Asia/Jakarta" })` **wajib** untuk cron jam-tetap; server tetap `TZ=UTC` (ADR §3.3 butir 4). Cron per-menit/per-interval tidak bergantung zona. Menit jadwal sengaja bukan :00 (hindari tabrakan beban).
- Cron sapuan memakai `policy: "singleton"`. Job per entitas (`ttl`, `cek`) memakai `singletonKey` = ID entitas + `startAfter`.
- `job_run(kunci)` untuk job berperiode (lease 5 menit + heartbeat 60 dtk; ambil alih bila lease habis, ADR §3.3 butir 1). Efek ganda dicegah update bersyarat + kunci unik ledger/outbox, bukan oleh `job_run`.
- Waktu dari port `Clock`. Tidak ada HTTP keluar di dalam transaksi DB.
- Gagal setelah `retryLimit` → antrean mati `job-mati` (`deadLetter`) → alert `JOB_MATI`.
- **Log wajib per run** (pino, JSON): `job`, `versi_job`, `kunci`, `mulai`, `selesai`, `durasi_ms`, `sumber` (cron/event/manual), `ref_jenis`+`ref_id` (ID saja), `hasil` (`SUKSES`/`SEBAGIAN`/`GAGAL`/`DILEWATI`), `jumlah{...}`, `kelas_galat`, `catatan` (≤ 200 karakter, tanpa PII). pino `redact` untuk nomor HP/alamat/nama/token; error tracking SaaS dengan penyamaran aktif (K-43, H8). Data transaksi tidak dikirim ke SaaS.
- **Metrik** (Fase 1 sebagai baris log terstruktur + tabel `job_run`; ekspor Prometheus menyusul T-045): `job_durasi_ms{job}`, `job_gagal_total{job}`, `job_terlambat_detik{job}` (selisih dari jadwal/tenggat).

### 4.2 Ringkasan

| ID | Antrean | Jadwal (WIB) | Kunci / lock | Timeout · retry | Pemilik kode |
|---|---|---|---|---|---|
| J-01 | `tagihan-ttl` (+ `tagihan-ttl-sapu`) | per tagihan `startAfter = kedaluwarsa_pada + tenggang` (K-47); sapu `* * * * *` | `singletonKey=ttl:{invoice_id}`; kunci grup FOR UPDATE | 120 dtk · 5×, backoff 30 dtk | T-030 |
| J-02 | `tagihan-pengingat` | per tagihan `startAfter = kedaluwarsa_pada − 15 mnt` | `singletonKey=pengingat:{invoice_id}` | 30 dtk · 3× | T-035 |
| J-03 | `grup-pengingat` | `*/5 * * * *` + harian `7 10 * * *` | `singleton`; kunci WA per periode | 120 dtk · 2× | T-035 |
| J-04 | `grup-batas-terbit` (K-39) | `* * * * *` | `singleton`; per grup `job_run(terbit-otomatis:{grup_id})` + kunci grup FOR UPDATE | 120 dtk · lihat langkah | T-022/T-035 |
| J-05 | `slot-cutoff` | `* * * * *` | `job_run(cutoff:{slot_id})`; per grup update bersyarat | lease 5 mnt + heartbeat · retry per langkah | T-023 |
| J-06 | `inventori-kirim-picking` (**ada**) | `* * * * *` | `singleton`; `picking:{grup_id}` | lease `leasePicking` · backoff 30 dtk×2^(n−1) maks 30 mnt s.d. 6 jam (IG-07) | T-019 ✔ |
| J-07 | `inventori-sinkron` (**ada**) | `cronSinkron(INVENTORY_INTERVAL_SINKRON_MENIT)`, hanya mode `gudang` | `singleton` | retry adapter; bagian gagal dilewati | T-019 ✔ |
| J-08 | `slot-daftar-antar` | event `SlotDitutup` | `daftar-antar:{slot_id}:{versi}` | 120 dtk · 3× | T-040 |
| J-09 | `slot-buat` | `37 0 * * *` | `buat-slot:{zona_kode}:{tanggal}` + UK DB | 300 dtk · 3× | T-031 |
| J-10 | `grup-ditahan-batas` (F-13) | `* * * * *` | update bersyarat `DITAHAN → BATAL` | 120 dtk · 3× | T-023 |
| J-11 | `cod-evaluasi-mingguan` | `17 2 * * 1` (Senin) | `job_run(kpi-cod:{YYYY-Www})`; PK `(akun_id, minggu_mulai)` | lease 10 mnt · 3×, lanjut dari akun terakhir | T-042 |
| J-12 | `pembayaran-rekonsiliasi` | `17 3 * * *` | `job_run(rekon:{tanggal})` | lease 10 mnt · 3× | T-030 |
| J-13 | `pembayaran-cek-status` | event W5b / J-12 | `singletonKey=cek:{pembayaran_id}` | 60 dtk · 6×, backoff 30 dtk | T-030 |
| J-14 | `saldo-cek-invarian` | `47 3 * * *` | `job_run(saldo-cek:{tanggal})` | 300 dtk · 2× | T-021 |
| J-15 | `wa-template-sinkron` | `13 */6 * * *` | `singleton` | 60 dtk · 3× | T-016 |
| J-16 | `laporan-harian` | `7 6 * * *` | `job_run(laporan:{tanggal})` | 300 dtk · 3× | T-041 |
| J-17 | `harga-timpaan-kedaluwarsa` (K-03) | `7 7 * * *` | `tinjauan TIMPAAN_KEDALUWARSA` unik per timpaan | 120 dtk · 3× | T-037 |
| J-18 | `pemeliharaan-harian` | `17 4 * * *` | `job_run(rawat:{tanggal})` | 600 dtk · 2× | T-045 |
| J-19 | `wa-kirim` | event + `* * * * *` | `singleton` (§3.3) | lease 2 mnt | T-016 |
| J-20 | `wa-status` | event webhook | UK `(wamid, status)` | 30 dtk · 5× | T-016 |

Jam J-09/J-11/J-12/J-14/J-16/J-17/J-18 = **DEFAULT** (N-09). Urutan harian: rekonsiliasi 03.17 → cek saldo 03.47 → pemeliharaan 04.17 → laporan 06.07 (laporan memuat hasil keduanya).

### 4.3 Rincian job

**J-01 TTL tagihan** — input `{invoice_id}`. Langkah = `pembayaran.md` §7 (lewati non-DITERBITKAN & COD; GET Xendit dulu; PAID → jalur webhook; belum bayar → tutup QR/VA lalu satu transaksi KEDALUWARSA + `SALDO_BALIK` + DIKELUARKAN + evaluasi grup; outbox WA-03 / WA-08). Sapu tiap menit memakai indeks `(status, kedaluwarsa_pada) WHERE status='DITERBITKAN' AND metode_bayar <> 'COD'`. GET gagal → **jangan** kedaluwarsakan; retry; habis → alert `TTL_XENDIT`. Terlambat (worker mati): API sudah menolak bayar setelah TTL (guard waktu); run berikutnya memproses; `job_terlambat_detik > 300` → alert `JOB_TERLAMBAT`. Log: `invoice_id`, `grup_id`, hasil (`KEDALUWARSA`/`LUNAS_LEWAT_GET`/`DILEWATI`).

**J-02 Pengingat bayar** — input `{invoice_id}`. Masih DITERBITKAN ∧ belum ada pembayaran LUNAS → outbox WA-03a (basi = `kedaluwarsa_pada`). Tagihan TTL < 20 menit tersisa saat terbit → tidak dijadwalkan.

**J-03 Pengingat grup** — sapu grup `DIBUKA`/`AKTIF`: (a) harian 10.07 dan sekali pada `batas − 180 mnt` (**DEFAULT**): syarat belum terpenuhi → WA-05 atau WA-05b ke akun berbarang dengan `pengingat_ajak = true` (F-17: hanya terhitung; maks 1/hari lewat kunci periode); (b) `batas − 30 mnt`: WA-06 ke akun berbarang belum Siap; semua Siap → WA-06b ke host. Tidak mengubah status apa pun.

**J-04 Batas terbit tagihan (K-39)** — sapu grup `DIBUKA`/`AKTIF` dengan `sekarang ≥ batas − 5 mnt`:
1. `sekarang ≥ batas − 5 mnt` → outbox WA-06c ke akun berbarang belum Siap (kunci per akun; sekali).
2. `sekarang ≥ batas` → satu transaksi (kunci grup → slot → peserta): akun berbarang belum Siap → `DIKELUARKAN` alasan `BELUM_SIAP` + WA-06d; host belum Siap → N-06; hitung ulang syarat di dalam kunci.
3. Syarat terpenuhi → panggil use case **yang sama** dengan tombol "Terbitkan tagihan" (aktor `SISTEM`, cara bayar = pilihan host bila sudah dipilih, selain itu `SENDIRI`), termasuk cek stok cabang (F-20, H14), kuotasi ongkir (tarif mati → O-08), kapasitas slot (O-09). Sukses → WA-04/04b(/04c).
4. Syarat tidak terpenuhi → grup `GAGAL` → pilihan K-11 (WA-08c); tanpa pilihan sampai batas pilih → batal (WA-08b).
5. Terbit gagal karena sebab teknis (Gudang tak terjangkau, Xendit gagal, `SLOT_PENUH`) → N-07 (DEFAULT: ulang tiap menit maks 5 menit setelah batas; tetap gagal → `BATAL` alasan `TERBIT_OTOMATIS_GAGAL`, tidak ada dana, WA-08b "pesanan tidak dapat diproses", alert `TERBIT_OTOMATIS_GAGAL`; tidak dihitung KPI COD).
Idempotensi: `job_run(terbit-otomatis:{grup_id})`; status grup `TAGIHAN_TERBIT` sebagai checkpoint; tagihan unik per peserta. Terlambat: API "Siap"/ubah keranjang menolak sendiri setelah batas; terbit manual setelah batas ditolak `MELEWATI_BATAS_CHECKOUT`.

**J-05 Cut-off slot + kunci harga final + selisih → saldo** — input slot `cut_off_pada ≤ sekarang` ∧ `job_run(cutoff:{slot_id}) ≠ SELESAI`. Langkah = `group-order.md` §6: grup belum terbit → GAGAL/BATAL (K-11/K-39); `TAGIHAN_TERBIT` tersisa (anomali A-04 atau N-07) → tunggu tagihan final lalu lanjut + alert; per grup lunas: `konfirmasiStok` → alokasi FIFO `waktu_bayar` → harga cut-off & `hitungHargaFinal` → **satu transaksi**: harga final, `qty_teralokasi`, ledger kredit `selisih:{grup_id}:{anggota_id}` ke pembayar (dibatasi pagar modal P-23), status `HARGA_TERKUNCI`, outbox `picking:{grup_id}` + WA-07/07b/11. Pagar gagal / INV-PE tidak tersedia setelah retry / modal > 15 menit → `DITAHAN` + WA-09 + tinjauan `GRUP_DITAHAN` + alert. Kunci harga & selisih **bukan job terpisah**: harus satu transaksi dengan alokasi agar tidak ada kredit tanpa kunci harga. Selesai → `job_run` SELESAI, slot `DITUTUP`, outbox internal `SlotDitutup` → J-08. Metrik per run: jumlah grup per hasil. Terlambat > 2 menit dari `cut_off_pada` → alert `CUTOFF_TERLAMBAT` (guard API sudah menutup grup tepat waktu).

**J-06 Picking (ada, T-019)** — tidak diubah. Tambahan T-040: alert `PICKING_BELUM_TERKIRIM` bila ada `picking:{grup_id}` belum `TERKIRIM` pada `slot.mulai − slot.menit_siap_picking` (kosong → alert saat GAGAL saja); entri `GAGAL` sudah masuk tinjauan `PICKING_GAGAL`.

**J-07 Sinkron Gudang (ada, T-019)** — tidak diubah. Tambahan: hasil `gagal.length > 0` tiga run berturut-turut, atau ambang nonaktif (IG-08) terlampaui → alert `SINKRON_GUDANG`. Data modal > 15 menit menahan checkout (P-10, H14) — bukan tugas job ini.

**J-08 Daftar antar per slot (H13)** — input `SlotDitutup {slot_id, grup_id[]}`. Bangun penugasan paket → armada usulan + urutan (ongkir-slot §8), simpan `daftar_antar` versi baru **tanpa PII**; buat kode ambil drop point (hash). Notifikasi admin: tinjauan/panel "Daftar antar slot {kode} siap" (+ WA-31 `DAFTAR_ANTAR_SIAP` hanya kode slot). PII dirender **saat unduh** di panel ber-TOTP dan dicatat `log_audit` (O-12 DEFAULT); **tidak lewat n8n/WA**. Admin ubah penugasan → versi baru, kunci `daftar-antar:{slot_id}:{versi}`. Grup DITAHAN tidak masuk sampai dilepas. Catatan: ADR §3.3 menulis `antar:{slot_id}`; dokumen ini memakai `daftar-antar:` (ongkir-slot §8).

**J-09 Buat slot** — ongkir-slot §5.1; `ON CONFLICT DO NOTHING`. Tidak ada slot untuk besok di zona aktif setelah run → alert `SLOT_KOSONG`.

**J-10 Batas DITAHAN (F-13)** — grup `DITAHAN` dengan `sekarang ≥ slot.mulai − slot.menit_siap_picking` → G8: BATAL + refund ke saldo pembayar (kecuali `dana_ditahan`) + WA-08. `slot.menit_siap_picking` kosong → batas = `slot.mulai` (DEFAULT) dan panel menandai "isi waktu siap picking".

**J-11 Evaluasi KPI COD mingguan (T-042)** — input `minggu_mulai` (Senin 00.00 WIB minggu lalu, K-52 DEFAULT). Langkah = `pembayaran.md` §10.1; satu transaksi per akun (`kpi_cod_mingguan` + `status_cod`), proses berurutan per `akun_id` dengan cursor tersimpan di `job_run` agar run lanjutan meneruskan. Minggu terlewat → evaluasi berurutan dari yang tertua. WA-20/21 lewat outbox (jam tenang → terkirim 07.00). Ambang dari `ambang_kpi_cod` versi berlaku (tidak di-hardcode). Log: jumlah dievaluasi/lolos/diaktifkan/dicabut. Rerun minggu sama = no-op.

**J-12 Rekonsiliasi pembayaran harian** — tanggal WIB kemarin: pembayaran MENUNGGU lewat `kedaluwarsa_pada`, KEDALUWARSA/GAGAL, LUNAS/LUNAS_TERLAMBAT hari itu → GET Xendit (laju dibatasi `xendit.rekon_per_detik`, **DEFAULT 5**). Status beda → jadwalkan J-13 (jalur yang sama dengan webhook, tidak pernah LUNAS langsung dari job ini); nominal beda / yatim → tinjauan (K-58). Hasil agregat di `rekonsiliasi_harian(tanggal PK, jumlah_dicek, jumlah_beda, selesai_pada)`. Xendit tidak tersedia → retry; tetap gagal → `job_run GAGAL` + alert `REKON_GAGAL`; laporan menandai "rekonsiliasi belum selesai".

**J-13 Cek status pembayaran** — `pembayaran.md` §6.4: GET + W5 + §6.2, tanpa baris `webhook_event`; idempoten lewat update bersyarat.

**J-14 Cek Σ ledger = saldo** — panggil `cariSelisihSaldo(db)` (T-021, transaksi baca `repeatable read`). Hanya melapor, **tanpa koreksi otomatis**. Hasil > 0 → alert P1 `SALDO_SELISIH` (ID akun saja) + masuk laporan; koreksi hanya lewat `KOREKSI_ADMIN` four-eyes (L-03/L-05). Simpan `saldo_cek_harian(tanggal, jumlah_akun_selisih)`.

**J-15 Sinkron status template** — §3.6.

**J-16 Laporan harian owner (T-041)** — tanggal WIB kemarin. Isi agregat (tanpa PII): grup dibuat / tagihan terbit / harga terkunci / gagal / batal per alasan; jumlah pesanan & pembeli unik; repeat rate (pembeli dengan pesanan selesai > 1 dalam 30 hari); biaya kirim per order + Σ `penanggungan_ongkir` per alasan (O-13); DITAHAN terbuka; invoice COD lewat slot belum ditutup (pembayaran.md §10.3); outbox WA/PICKING `GAGAL`; hasil J-12 & J-14; tinjauan terbuka per jenis. Simpan `laporan_harian(tanggal PK, data jsonb, versi)` lalu outbox WA-30 ke `laporan.penerima_admin` (**DEFAULT**: owner). View read-only `v_laporan_harian` untuk n8n (§5). Prasyarat (J-12/J-14) belum SELESAI → laporan tetap dibuat dengan tanda, tidak menunggu. Kirim ulang: endpoint internal `POST /internal/laporan/{tanggal}/kirim-ulang` (idempoten per tanggal+penerima, tercatat).

**J-17 Timpaan modal kedaluwarsa (K-03)** — timpaan dengan `kedaluwarsa_pada ≤ sekarang` → tinjauan `TIMPAAN_KEDALUWARSA` (unik per timpaan) berisi catatan admin + WA-31 ringkas. Tidak mengubah harga otomatis.

**J-18 Pemeliharaan** — pangkas `webhook_payload` Xendit > 90 hari (T-004 §6.3), `wa_webhook_event` & `pesan_wa` sesuai N-12, outbox `TERKIRIM/KEDALUWARSA` > 30 hari; arsip `pg-boss` bawaan. Tidak menyentuh ledger/invoice.

---

## 5. Pembagian n8n vs worker pg-boss (governance)

| Otomasi | Tempat | Verdict | Alasan |
|---|---|---|---|
| Semua job §4 (TTL, K-39, cut-off, kunci harga, saldo, picking, daftar antar, rekonsiliasi, KPI COD, laporan) | **Wajib kode** (`apps/worker`) | APPROVE | Uang/status/stok; perlu transaksi, tes, CI (ADR §4.4) |
| WA ke pembeli (semua template §1) | **Wajib kode** | APPROVE | Butuh nomor HP (PII) + token WA; H4 melarang PII di n8n |
| Daftar antar berisi nama/HP/alamat | **Wajib kode**, unduh panel TOTP | PARTIAL AUTOMATION ONLY | Sistem menyusun, admin membagikan (H13, O-12); n8n dilarang |
| Laporan harian: kirim salinan ke email/spreadsheet internal | n8n boleh (opsional) | APPROVE AS PILOT | Baca `v_laporan_harian` (agregat, user DB read-only terpisah) |
| Rute alert ke kanal tim (email/obrolan tim) | n8n boleh (opsional) | APPROVE AS PILOT | Payload hanya kode alert + ID; sumber tetap worker |
| Pengingat tim internal (mis. "isi tarif armada", "cek tinjauan terbuka") | n8n boleh | APPROVE AS PILOT | Tanpa data pelanggan |
| Chatbot WA / balasan otomatis pelanggan | — | DEFER | Butuh PII + kebijakan CS; tidak di Fase 1 |
| Promo massal WA | — | DEFER | Menunggu rancangan Growth & opt-in nyata (WA-41 nonaktif) |

Aturan n8n (H4): host terpisah dari DB production; akses hanya view `v_laporan_harian`, `v_alert_operasional` (tanpa nomor HP/alamat/nama) dengan user DB read-only; aksi hanya lewat endpoint internal terautentikasi (token khusus, rotasi, rate limit), idempoten, tercatat `log_audit`; tidak menyimpan kredensial Xendit/WA/DB tulis; workflow diekspor ke `n8n/` tanpa kredensial dan di-review seperti kode; nama `[ENV]-[SYSTEM]-[PROCESS]-[ACTION]-v[MAJOR.MINOR]`, mis. `PROD-NEKAT-LaporanHarian-KirimEmail-v1.0`, `PROD-NEKAT-Alert-RuteTim-v1.0`. Go-live Fase 1 **tidak membutuhkan** n8n: semua yang wajib berjalan tanpa n8n. Region: n8n di region Indonesia (H12) atau n8n cloud hanya bila tetap tanpa PII (H4).

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
    antrean wa-kirim (§3.3), webhook /webhook/whatsapp + wa-status (§3.4), opt-out (§3.5), J-15,
    migrasi akun_notifikasi, template_wa, pesan_wa, wa_webhook_event.
  Fungsi domain: antreWa(tx, { template, akunId, ref:{jenis,id}, parameter[], tombol?, periodeWib?, basiPada })
    -> { dibuat: boolean }  // ON CONFLICT DO NOTHING; dipanggil DI DALAM transaksi bisnis pemanggil
  OTP: kirimOtp lewat outbox jenis WA template auth_otp_v1, kunci otp:{otp_permintaan_id}, basi = kedaluwarsa OTP.
  Syarat lulus: TC-NJ-01..12, 25..27.

HANDOFF T-035 (status pesanan + notifikasi)
  Memanggil antreWa pada setiap transisi di matriks §2.1 (kecuali OTP, COD, admin).
  Memasang J-02, J-03, J-04 (bersama T-022). Template individu_* bila spec pesanan individu ada.
  Larangan: tidak mengirim WA di luar outbox; tidak menaruh nomor HP di payload.

HANDOFF T-040 (pasca cut-off)
  Masukan: SlotDitutup { slot_id, grup_id[] (HARGA_TERKUNCI) } dari J-05.
  Keluaran: J-08 daftar_antar versi (tanpa PII), kode ambil, alert PICKING_BELUM_TERKIRIM (J-06 tambahan), J-10.
  Status antar dari panel (T-039) -> WA-12/13/13c/14 lewat antreWa.

HANDOFF T-041 (laporan harian)
  J-16: laporan_harian(tanggal, data, versi) + v_laporan_harian (read-only, tanpa PII) + WA-30.
  Endpoint internal kirim-ulang (token internal, idempoten). n8n opsional (§5).

HANDOFF T-042 (KPI COD mingguan)
  J-11: evaluasiMinggu({ minggu_mulai WIB }) -> { dievaluasi, lolos, diaktifkan, dicabut } ; idempoten (akun, minggu).
  WA-20/21 lewat antreWa kunci wa:cod_status:akun:{akun_id}:{akun_id}:{YYYY-Www}.
```

Kontrak alert (dipakai semua job): `catatAlert({ kode, ref, tingkat: "P1"|"P2", catatan })` → tabel `alert_operasional(kode, ref, jam_WIB UK)` + error tracking + WA-31 (P1 segera; P2 hanya ringkasan di laporan). Kode alert: `JOB_MATI`, `JOB_TERLAMBAT`, `CUTOFF_TERLAMBAT`, `TTL_XENDIT`, `TERBIT_OTOMATIS_GAGAL`, `GRUP_DITAHAN`, `PICKING_BELUM_TERKIRIM`, `SINKRON_GUDANG`, `REKON_GAGAL`, `SALDO_SELISIH`, `SLOT_KOSONG`, `WA_TOKEN`, `WA_TEMPLATE`, `WA_KUALITAS`, `WA_ANGGARAN`, `DAFTAR_ANTAR_SIAP`.

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
| TC-NJ-19 | K-39: Gudang tak terjangkau di `batas` sampai +5 menit | Grup BATAL `TERBIT_OTOMATIS_GAGAL`, tanpa dana, alert (N-07) |
| TC-NJ-20 | J-04 dijalankan dua kali bersamaan | Satu set tagihan; WA tidak ganda |
| TC-NJ-21 | Pengingat bayar: tagihan dilunasi sebelum `kedaluwarsa − 15` | WA-03a tidak dikirim |
| TC-NJ-22 | J-01: GET Xendit gagal terus | Tagihan tidak dikedaluwarsakan; alert `TTL_XENDIT` |
| TC-NJ-23 | J-05 mati setelah 2 dari 5 grup | Run berikutnya memproses 3 sisanya; ledger selisih & picking tidak ganda |
| TC-NJ-24 | Semua cron WIB terdaftar dengan `tz: "Asia/Jakarta"`; `Clock` = 05.59 vs 06.07 WIB | Laporan hanya jalan 06.07 WIB (23.07 UTC hari sebelumnya) |
| TC-NJ-25 | Payload outbox WA | Tidak berisi nomor HP/alamat/nama (tes skema payload) |
| TC-NJ-26 | Nama grup "Promo wa.me/62812345678" | Variabel WA menjadi "Belanja Bareng" |
| TC-NJ-27 | Setiap kode WA di §1 | Ada entri di `templat.ts`, jumlah parameter cocok, variabel tidak di awal/akhir teks |
| TC-NJ-28 | J-08: daftar antar dibuat | Tabel `daftar_antar` tanpa kolom PII; unduh panel tercatat `log_audit`; tidak ada WA/n8n berisi alamat |
| TC-NJ-29 | J-11 dijalankan ulang untuk minggu yang sama | No-op; WA-20/21 tidak ganda |
| TC-NJ-30 | J-11 tidak jalan 2 minggu | Run berikut mengevaluasi 2 minggu berurutan dari yang tertua |
| TC-NJ-31 | J-12: GET = PAID untuk pembayaran MENUNGGU | J-13 dijadwalkan; LUNAS hanya lewat jalur §6.2 |
| TC-NJ-32 | J-14: satu akun `saldo_rp ≠ Σ ledger` (disuntik di tes) | Alert `SALDO_SELISIH` berisi ID akun; tidak ada koreksi |
| TC-NJ-33 | J-16 dengan J-12 belum SELESAI | Laporan terbit dengan tanda "rekonsiliasi belum selesai" |
| TC-NJ-34 | Kirim ulang laporan dua kali | Satu WA per penerima per tanggal |
| TC-NJ-35 | View `v_laporan_harian` | Tidak memuat kolom nomor HP/alamat/nama (tes skema) |
| TC-NJ-36 | Template marketing | Tidak ada pola nominal `Rp` atau angka harga di teks (tes statis) |
| TC-NJ-37 | Volume 100× (1.000 grup, 10.000 pesan dalam 10 menit) | Laju ≤ `WA_KIRIM_PER_DETIK`; kritis didahulukan; tidak ada pesan ganda; lag cut-off < 2 menit |

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
| N-07 | Terbit otomatis K-39 gagal karena sebab teknis (Gudang tak terjangkau H14, Xendit gagal, `SLOT_PENUH` O-09) | Randy (+ Joseph) | Ulang tiap menit maks 5 menit setelah batas (tagihan tetap TTL 60 menit penuh, cut-off menunggu tagihan final); tetap gagal → grup BATAL `TERBIT_OTOMATIS_GAGAL`, tanpa dana, WA permintaan maaf, alert; tidak dihitung KPI COD | Seperti rekomendasi |
| N-08 | Kanal alert operasional | Joseph | Error tracking SaaS (K-43) + WA-31 ke ≥ 2 admin jaga (H7); n8n opsional untuk email tim; isi alert hanya kode + ID | Seperti rekomendasi; penerima = semua admin `owner` |
| N-09 | Jadwal job WIB | Efan (laporan) + Joseph (teknis) | Buat slot 00.37; KPI COD Senin 02.17; rekonsiliasi 03.17; cek saldo 03.47; pemeliharaan 04.17; laporan owner 06.07; timpaan modal 07.07 | Seperti rekomendasi |
| N-10 | Pengguna boleh mematikan pengingat "ajak teman" (WA-05/05b)? Kode ambil drop point dikirim di WA atau hanya di aplikasi? | Randy | Boleh dimatikan (bawaan nyala); kode ambil hanya di aplikasi (pesan WA yang diteruskan tidak bisa dipakai mengambil paket) | Seperti rekomendasi |
| N-11 | Isi laporan harian di WA owner | Efan | WA hanya hitungan (grup, pesanan, butir perlu tindakan) + link panel; angka uang (biaya kirim/order, penanggungan ongkir) hanya di panel TOTP | Seperti rekomendasi |
| N-12 | Masa simpan `pesan_wa` & webhook WA | Joseph (+ hukum) | Status kirim 1 tahun (bukti pemberitahuan saat sengketa); payload webhook terredaksi 90 hari; teks pesan masuk tidak disimpan | Seperti rekomendasi |

### 9.1 Temuan ketidaksesuaian (untuk sinkron dokumen, mis. T-047)

| Dokumen | Temuan | Usulan |
|---|---|---|
| `group-order.md` §9.2 | Masih memakai invoice ongkir terpisah (WA-13 "invoice ongkir") dan "checkout"; K-25 menyatukan ongkir di satu tagihan, K-22 memakai "Terbitkan tagihan" + "Siap" | Rujuk katalog §1 dokumen ini |
| ADR §3.3 | Kunci `antar:{slot_id}` dan status `GAGAL_LANJUT_SATUAN` | `daftar-antar:{slot_id}:{versi}`; status skema `LANJUT_SATUAN` |
| `pembayaran.md` §7 | "WA Waktu bayar habis" tanpa kode | WA-03 `tagihan_kedaluwarsa_v1` |
| `project-specs/jadwal-otomatis.md` | Berisi jadwal sesi agen, bukan job produk | Job produk hanya di §4 dokumen ini |
