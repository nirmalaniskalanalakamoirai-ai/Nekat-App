# Spesifikasi UX Halaman, Design Token & Fondasi CSS — NEKAT Fase 1

| Atribut | Nilai |
|---|---|
| Task | T-007 (`task/T-007-ux-halaman`) |
| Versi | 0.1 — Draf |
| Tanggal | 15 Nov 2026 |
| Penyusun | UX Architect (squad Produk & flow, pemilik: Randy) |
| Sumber wajib | `project-specs/keputusan.md` §3, §4, §9, §11–§13 (menang bila bertentangan); `docs/flow/group-order.md` (T-002 v0.5); `docs/referensi/group-order/README.md` (R1–R11); `docs/adr/0001-tech-stack.md` (React PWA, harga hanya dari server); `docs/legal/` |
| File pendamping | `docs/spec/T-007-tokens.css` — token & fondasi CSS (disalin ke `apps/web` oleh T-014) |
| Dipakai oleh | T-008 (komponen), T-014 (fondasi PWA), T-015, T-024, T-026–T-028, T-033, T-036, T-039, T-043 |
| Di luar cakupan | Kode aplikasi (T-014 dst.), angka harga/margin/tarif (semua `Rp —` / simbolik), produk rokok & bir (tidak dijual Fase 1) |

Notasi: `{x}` = nilai dari server/konfigurasi; `Rp —` = nominal dari server (agen tidak mengisi angka). **[menunggu K-xx]** = varian yang dipilih setelah manusia memutuskan. **[UX-xx]** = pertanyaan baru (§10).

---

## 1. Aturan bisnis yang wajib terlihat di UX

| # | Aturan (sumber) | Dampak di layar |
|---|---|---|
| A1 | Grup = **per keranjang**, boleh campur produk (G-01) | Tidak ada "grup per produk". Tombol "Belanja Bareng" ada di keranjang, detail, dan katalog; semuanya mengarah ke satu keranjang grup. |
| A2 | Grup aktif bila **≥ 3 akun berbeda yang menambah barang** (K-17, §3); akun unik per nomor HP OTP | Syarat 1 di blok syarat: "{n}/3 orang sudah ikut belanja". Akun yang ikut tanpa menambah barang tidak dihitung. |
| A3 | Minimum **total grup** `{min_grup}` (F-30 = Rp100.000, dari konfigurasi) | Syarat 2: "Total grup Rp — dari {min_grup}". |
| A4 | Grup ≥ 3 akun **dan** total ≥ `{min_grup}` → setiap barang dapat harga termurah = **harga Mitra Grosir**, walau 1 pcs (K-09, K-14) | Label harga "Harga Belanja Bareng". Tidak ada tangga "tambah 5 pcs lagi" di grup (pola R4 kuantitas diganti, lihat §2). |
| A5 | Grup < `{min_grup}` → **harga satuan** + saran cari grup + **perbandingan grup vs sendiri** (K-18) | Kartu perbandingan di keranjang, halaman grup, dan checkout. |
| A6 | Ikut/buat grup **tanpa bayar** (P-04, F-29) | "Ikut grup" tidak membuka pembayaran. Pembayaran baru saat tagihan terbit. |
| A7 | Tagihan berlaku **60 menit sejak terbit** (F-26, K-07) | Hitung mundur besar + jam batas absolut ("sebelum 14.35 WIB"). |
| A8 | Akun tak lunas 60 menit **dikeluarkan otomatis**; grup **batal bila akun lunas < 3** (K-12) | Peringatan sebelum bayar; status "Dikeluarkan dari grup"; status grup "Batal". |
| A9 | Fase 1 tiap akun bayar sendiri; saat tagihan tersedia **host boleh bayar semua** → tagihan disatukan + QR ke host (G-07, K-17) | Pilihan host di halaman grup; anggota melihat "Dibayar oleh host". |
| A10 | Harga & modal di-snapshot **saat tagihan** (K-15, P-08); stok habis → tagihan batal | Sebelum tagihan, harga diberi label "sementara"; setelah terbit, label "terkunci di tagihan". |
| A11 | **Ongkir** ditagih di **tagihan setelah final** (K-10) | Checkout: baris "Ongkir — ditagih di tagihan final". Tidak ada perkiraan nominal ongkir. |
| A12 | Biaya admin flat **per akun per grup** (G-05, K-06); PPN dari konfigurasi, harga sudah termasuk PPN, rincian di checkout/nota (G-04) | Baris rincian "Biaya admin Rp —" dan "Termasuk PPN Rp —" (bukan tambahan). Nilai kosong di spesifikasi. |
| A13 | Harga **kartu = detail = halaman grup**; promo **terpisah** (CLAUDE.md, engine-harga PG-6) | Satu komponen `Harga` untuk tiga tempat; promo selalu chip/baris sendiri, tidak menimpa harga. |
| A14 | Info harga **Mitra drop point hanya di checkout** (P-28) | Kartu, detail, grup, layar Buat Grup tidak menyebut harga/label Mitra. |
| A15 | Selisih/refund → **saldo = loyalty point**, 1 poin = Rp1, tanpa masa berlaku, bisa dicairkan, bisa dipakai bersama metode lain (G-03, G-06, K-13) | Satu halaman "Saldo"; di checkout toggle "Pakai saldo" + sisa via Xendit. Istilah UI tunggal: **"Saldo NEKAT"** (subjudul "poin = rupiah"). |
| A16 | Promo/gratis ongkir gagal pagar → **jangan batalkan**; tampilkan "tidak memenuhi syarat" + alasan + jalan keluar (P-27) | Pola `KartuTidakMemenuhiSyarat` (§4.3). Kata "modal" tidak pernah tampil ke pembeli. |
| A17 | Wajib setuju S&K + Kebijakan Privasi sebelum ikut grup (§3) | Layar persetujuan (H-08) sebelum aksi grup pertama. |
| A18 | Zona radius 2–3 km dari drop point, tanpa login (§5) | Pilih zona di awal (H-01); login hanya saat aksi grup/checkout. |
| A19 | Bayar di muka via Xendit (QRIS, VA, e-wallet); COD hanya akun lolos KPI 3 minggu, maks `{batas_cod}` (§2, §9) | COD tampil hanya bila server menyatakan layak. |
| A20 | Harga tidak pernah dihitung di klien (ADR-0001) | Offline = harga tidak ditampilkan (lihat §4.2). |

---

## 2. Penyelarasan dengan flow T-002 (keputusan.md menang)

Flow T-002 v0.5 masih memakai model lama. UX ini mengikuti keputusan.md; flow diselaraskan di T-047.

| Flow T-002 | Keputusan yang berlaku | Penerapan UX |
|---|---|---|
| Grup = produk × zona × slot | G-01: per keranjang | Halaman grup menampilkan keranjang campur, bukan satu produk |
| Bayar saat ikut grup (P1) | P-04/F-29: ikut tanpa bayar; tagihan 60 menit sejak terbit | Alur: tambah barang → tagihan terbit → bayar |
| Tier 6+/12+ per kuantitas; "Z lagi → harga" | K-09/K-14: grup ≥ `{min_grup}` = harga Mitra Grosir untuk semua barang | Tangga R3 menjadi **dua syarat** (3 orang, `{min_grup}`), bukan titik kuantitas. Satuan jual (1 pcs…koli) tetap ada untuk beli di luar grup / grup belum memenuhi |
| Belum lunas → seluruh grup batal | K-12: akun dikeluarkan; batal bila lunas < 3 | Teks peringatan memakai K-12 |
| Ongkir di checkout | K-10: ongkir di tagihan final | Checkout tidak menampilkan nominal ongkir |
| Selisih → "saldo" | K-13: saldo = loyalty point | Satu istilah "Saldo NEKAT" |

---

## 3. Persona, prinsip, peta rute

### 3.1 Persona & prinsip
- **Ibu rumah tangga** (HP Android kelas bawah, kuota terbatas, sering pindah aplikasi ke WhatsApp) dan **pemilik warung** (beli dus/koli, butuh cepat & jelas hitungannya).
- Kalimat pendek, kata sehari-hari: "Belanja Bareng", "tagihan", "saldo", "antar ke rumah", "ambil sendiri di drop point". Hindari: "cut-off", "MOQ", "tier", "invoice", "modal".
- Satu aksi utama per layar (tombol hijau-teal besar di bilah bawah). Angka penting (harga, sisa waktu, kurang berapa) selalu teks, bukan warna saja.
- Semua harga dalam Rupiah per satuan yang dipilih + setara per pcs bila satuan > 1.
- Waktu selalu "jam WIB" + hari relatif ("hari ini 14.35 WIB", "besok").

### 3.2 Aturan aksesibilitas global (berlaku semua halaman)
| # | Aturan |
|---|---|
| AX1 | Target sentuh ≥ 44 × 44 px (`--tap-min`); tombol utama & "+" cepat 48 px; jarak antar target ≥ 8 px. |
| AX2 | Kontras teks ≥ 4.5:1, teks besar & komponen UI ≥ 3:1, di tema terang **dan** gelap (§8.2). |
| AX3 | Teks isi ≥ 16 px, ukuran pakai `rem` (ikut ukuran huruf HP); tata letak tidak pecah sampai zoom 200% / lebar 320 px. |
| AX4 | Semua kontrol punya label teks yang terbaca pembaca layar; ikon saja wajib `aria-label` ("Tambah 1 Minyak Goreng 1 L ke keranjang"). |
| AX5 | Fokus terlihat (`:focus-visible`, 3 px); urutan tab mengikuti urutan visual; dialog/lembar bawah menjebak fokus dan kembali ke pemicu saat ditutup; `Esc`/tombol kembali menutup. |
| AX6 | Perubahan dinamis diumumkan lewat `aria-live="polite"` (masuk keranjang, syarat grup berubah); error formulir lewat `role="alert"`. Hitung mundur **tidak** diumumkan tiap detik: hanya pada 30, 10, 5, 2 menit tersisa. |
| AX7 | Status tidak hanya warna: selalu ada teks/ikon ("Lunas", "Belum bayar", "Kurang 1 orang"). |
| AX8 | Hormati `prefers-reduced-motion` (tanpa animasi skeleton/konfeti) dan `forced-colors`. |
| AX9 | Struktur: satu `h1` per halaman, landmark `header`/`main`/`nav`, tautan "Lewati ke isi". Harga dibaca lengkap: "Rp — per dus isi 24, setara Rp — per pcs". |
| AX10 | Input: `inputmode="numeric"` untuk HP/OTP/nominal, `autocomplete="one-time-code"` untuk OTP, `autocomplete="tel"` untuk HP. |

### 3.3 Peta rute (React Router, T-014)

| Rute | Halaman | Login? |
|---|---|---|
| `/zona` | H-01 Pilih zona | Tidak |
| `/` , `/k/:kategori/:sub?` , `/cari?q=` | H-02 Katalog & pencarian | Tidak |
| `/p/:slug` | H-03 Detail produk | Tidak |
| `/keranjang` | H-04 Keranjang (sendiri / Belanja Bareng) | Tidak (login saat aksi grup) |
| `/g/:kode` | H-05 Halaman grup (dari link) | Tidak untuk melihat; ya untuk ikut |
| `/masuk` | H-07 Login OTP WhatsApp | — |
| `/persetujuan` | H-08 S&K & privasi | Ya |
| `/checkout` | H-09 Checkout | Ya |
| `/tagihan/:id` | H-10 Tagihan & pembayaran | Ya |
| `/pesanan` , `/pesanan/:id` | H-11 Status pesanan | Ya |
| `/saldo` , `/saldo/cairkan` | H-12 Saldo NEKAT | Ya |
| `/akun` | H-13 Akun (tampilan, privasi, zona) | Ya |
| `/admin/*` | H-14 Panel admin | Login admin + TOTP (H9) |

**Navigasi bawah (pembeli):** Belanja · Keranjang (lencana jumlah) · Pesanan · Saldo · Akun. Lima tombol, ikon + label teks, tinggi 64 px. Halaman H-07/H-08/H-09/H-10 menyembunyikan navigasi bawah (fokus selesai bayar).
**App bar:** nama zona (tap → ganti zona) · ikon cari · ikon keranjang. **Pita grup aktif** (R10) di bawah app bar selama pengguna punya grup berjalan: "Kamu di Grup {nama} · tutup {jam} WIB · Lihat".

---

## 4. Pola bersama

### 4.1 State standar (dipakai semua halaman)
| State | Tampilan | Teks kunci |
|---|---|---|
| Memuat | Skeleton sesuai bentuk blok (kartu, baris); maks 300 ms tanpa apa-apa, lalu skeleton. Tombol aksi yang sedang diproses: spinner + label tetap ("Memproses…"), tombol nonaktif agar tidak ganda | — |
| Kosong | Ilustrasi kecil orisinal + satu kalimat + satu tombol jalan keluar | per halaman |
| Error server | Kartu error + "Coba lagi"; data lama **tidak** ditampilkan sebagai harga aktif | "Gagal memuat. Periksa sinyal lalu coba lagi." |
| Offline | Pita atas tetap `role="status"`: "Kamu sedang offline". Harga, stok, syarat grup **disembunyikan** (diganti "—"), tombol tambah/bayar nonaktif. Keranjang lokal (id produk + jumlah) tetap terlihat tanpa harga | "Kamu sedang offline. Harga akan muncul lagi saat tersambung." |
| Sesi habis | Lembar bawah "Masuk lagi", niat tersimpan, kembali ke layar semula | "Sesi kamu habis. Masuk lagi untuk lanjut." |
| Di luar zona | Katalog boleh dilihat, tombol tambah/ikut/checkout nonaktif + alasan | "NEKAT belum melayani lokasimu." |
| Akun dibekukan | Kartu info, tanpa tombol grup/checkout | "Akunmu tidak bisa ikut grup saat ini. Hubungi CS." |

### 4.2 Komponen `Harga` (satu sumber, A13/A20)
- Input hanya dari respons server `tampilanHarga` (`harga_aktif`, `harga_grup`, `promo`, `harga_coret`); klien tidak menghitung.
- Isi: harga aktif + satuan (`/pcs`, `/dus isi {n}`) · baris kecil "Belanja Bareng Rp —/pcs" (A4) · chip promo terpisah (A13) · harga coret **[menunggu P-17]** (varian A: tampil; varian B: disembunyikan sampai P-17).
- Tidak pernah menampilkan harga Mitra/drop point (A14) di luar checkout.
- Sebelum tagihan: catatan kecil "Harga bisa berubah sampai tagihan terbit" (A10).

### 4.3 Komponen `KartuTidakMemenuhiSyarat` (P-27)
Urutan: judul apa yang tidak berlaku → alasan sederhana → 1–3 jalan keluar (tombol) → tetap bisa lanjut.
> **Gratis ongkir belum bisa dipakai**
> Promo ini tidak berlaku untuk isi keranjangmu sekarang.
> [Tambah barang] [Ambil sendiri di drop point] [Lanjut tanpa gratis ongkir]

Varian alasan (server memberi kode, UI memetakan teks): belum capai minimal belanja setelah diskon (P-13) → "Kurang Rp — lagi"; kuota habis; di luar periode/zona; kombinasi barang (pagar modal, tanpa kata "modal"). Diskon tidak menumpuk (P-15): "Hanya satu diskon yang bisa dipakai. Kami pilih yang paling hemat untukmu." **[menunggu K-21]** cara tampil diskon (satu baris total vs per barang).

### 4.4 Komponen `SyaratGrup` (pengganti tangga R3)
Dua baris centang + progres:
1. "Orang yang ikut belanja: {n}/3" — ikon centang bila terpenuhi.
2. "Total belanja grup: Rp — dari {min_grup}" + bar progres.

Kalimat ajakan (R4) berdasarkan kondisi:
| Kondisi | Teks |
|---|---|
| n < 3, total < min | "Kurang {3−n} orang dan Rp — lagi agar dapat Harga Belanja Bareng" |
| n < 3, total ≥ min | "Kurang {3−n} orang lagi. Ajak tetangga!" |
| n ≥ 3, total < min | "Sudah 3 orang. Tambah belanja Rp — lagi agar dapat Harga Belanja Bareng" |
| terpenuhi | "Harga Belanja Bareng berlaku untuk semua barang di grup ini" |

### 4.5 Komponen `HitungMundur` (A7)
- Tampil: angka besar `mm:ss` + "Bayar sebelum {jam} WIB". ≤ 10 menit: warna peringatan + teks "Segera bayar"; ≤ 2 menit: warna bahaya + "Waktu hampir habis".
- Sumber waktu = `kedaluwarsa_pada` dari server; klien menyesuaikan selisih jam HP (offset dihitung dari header waktu server) agar jam HP yang salah tidak menipu.
- Habis: ganti isi ke status dari server (jangan anggap batal sebelum server konfirmasi): "Waktu bayar habis. Memeriksa status…".

### 4.6 Komponen `RincianBiaya` (A11, A12)
Urutan baris: Subtotal barang · Diskon (baris sendiri, bila ada) · Biaya admin Rp — · Ongkir: "ditagih di tagihan final" · Saldo dipakai −Rp — · **Total bayar sekarang Rp —** · baris kecil "Termasuk PPN Rp —" (untuk barang kena PPN; barang bebas PPN diberi tanda). Pembaca layar membaca tiap baris sebagai pasangan label–nilai (`<dl>`).

### 4.7 Nama samaran anggota
Anggota lain hanya tampil sebagai inisial + nama samaran ("Bu S***, RW 05"); tidak ada nomor HP/alamat (Kebijakan Privasi §3). Isi barang anggota lain: **[UX-03]**.

---

## 5. Halaman pembeli

### H-01 Pilih zona — `/zona`
**Tujuan:** menentukan zona layanan tanpa login, agar katalog, stok, dan grup sesuai lokasi.
**Blok (urut):** logo + "Belanja bareng tetangga, lebih hemat" → tombol utama "Pakai lokasiku sekarang" → tautan "Pilih manual" (daftar kelurahan/drop point + kolom cari) → catatan privasi singkat "Lokasi hanya dipakai untuk mencari drop point terdekat" + tautan Kebijakan Privasi.
**State:** memuat lokasi ("Mencari lokasimu…", maks 10 detik lalu tawarkan pilih manual) · izin ditolak · GPS mati · offline (hanya "Pilih manual" dari daftar tersimpan, bila ada) · error server.
**Cabang:**
- Dalam zona → simpan zona di sesi lokal → H-02 (atau kembali ke `/g/:kode` bila datang dari link).
- Izin ditolak → "Tidak apa-apa, pilih lokasi secara manual" + daftar.
- **Di luar zona** (B-13) → layar "NEKAT belum melayani lokasimu" + "Lihat katalog saja" (mode lihat, A-state di luar zona) + "Pilih lokasi lain". Daftar tunggu **[menunggu F-18]** (varian: tombol "Kabari saya lewat WhatsApp" bila F-18 = ya).
- Ganti zona saat keranjang berisi / sedang di grup → dialog "Ganti lokasi? Keranjang dan grupmu di {zona} tidak ikut pindah." (F-25).
**Teks kunci:** "Pakai lokasiku sekarang" · "Pilih manual" · "Kamu ada di zona {nama zona}" · "NEKAT belum melayani lokasimu".
**Aksesibilitas:** jangan minta izin lokasi otomatis saat halaman dibuka (hanya saat tombol ditekan); daftar manual bisa dicari dan dinavigasi keyboard; hasil deteksi diumumkan `aria-live`.

### H-02 Katalog & pencarian — `/`, `/k/:kategori/:sub?`, `/cari`
**Tujuan:** menemukan barang cepat dan menambahkannya dengan satu ketukan.
**Blok (urut):**
1. App bar (zona, cari, keranjang) + pita grup aktif (R10) bila ada.
2. Kolom cari (tap → `/cari`, keyboard langsung terbuka).
3. Kartu ajakan Belanja Bareng (R2): "Belanja Bareng tetangga: hemat pakai Harga Belanja Bareng" + "Cara kerjanya" (lembar bawah 3 langkah). Disembunyikan bila sedang di grup.
4. Tab kategori (gulir horizontal di dalam deret, bukan halaman) **dengan jumlah**: "Sembako (24)". Tab kedua baris: subkategori dengan jumlah "Minyak (6)". Tab terpilih `aria-selected`, jumlah dibaca "24 produk".
5. Grid kartu produk 2 kolom (3 kolom ≥ 600 px). Kartu: foto (rasio 1:1, lazy) · nama (maks 2 baris) · satuan default · `Harga` · chip promo · tombol **"+"** cepat 48 px di pojok kanan bawah foto.
6. Muat lebih banyak otomatis saat gulir (dengan tombol "Muat lagi" sebagai cadangan aksesibel).
**Tombol + cepat:** menambah 1 × satuan default (satuan terkecil yang tersedia). Setelah ditekan berubah menjadi stepper `− 1 +` di kartu (masing-masing 44 px). Produk dengan > 1 satuan jual: "+" tetap menambah satuan default; snackbar "Ditambahkan 1 pcs · Ganti satuan" (tautan ke detail).
**State:** memuat (skeleton 6 kartu) · kategori kosong "Belum ada produk di kategori ini" · pencarian kosong "Tidak ketemu '{q}'. Coba kata lain, mis. 'beras'" + kategori populer · error · offline · di luar zona (tombol "+" nonaktif).
**Cabang:**
- Stok habis **[menunggu K-20]**: varian A (rekomendasi) kartu tampil abu, label "Stok habis, segera distok", tombol "+" diganti teks nonaktif, tidak bisa masuk keranjang/grup; varian B: produk disembunyikan dan jumlah di tab tidak menghitungnya.
- Stok terbatas: "Sisa {n}" (bila server memberi).
- Sedang di grup: "+" menambah ke bagian kamu di keranjang grup (pita R10 menjelaskan), harga kartu memakai konteks grup yang sama dengan detail (A13).
**Teks kunci:** "Cari beras, minyak, sabun…" · "Ditambahkan ke keranjang" · "Stok habis, segera distok".
**Aksesibilitas:** "+" berlabel lengkap (AX4); stepper memakai `role="group"` + label nama produk; jumlah keranjang diumumkan `aria-live`.

### H-03 Detail produk — `/p/:slug`
**Tujuan:** memilih satuan jual & jumlah, memahami harga sendiri vs Belanja Bareng, lalu tambah atau ajak tetangga.
**Blok (urut):**
1. Foto (galeri geser, titik indikator, bisa diperbesar).
2. Nama, merek, isi/berat.
3. `Harga` (sama persis dengan kartu, A13) + chip promo terpisah.
4. **Pilih satuan jual** (P-03/F-04): radio berbentuk kartu, hanya satuan yang tersedia untuk produk ini, urut kecil → besar: 1 pcs · 3 pcs · lusin (12) · dus (isi {n}) · koli (isi {n}). Tiap opsi: "Rp — /{satuan}" + "setara Rp — /pcs". Bawaan: satuan terkecil.
5. Stepper jumlah (− / angka bisa diketik / +), di bawahnya "Total Rp —".
6. Kartu **Belanja Bareng**: "Di grup, semua barang dapat Harga Belanja Bareng Rp —/pcs bila grup sudah 3 orang dan total {min_grup}" + `SyaratGrup` bila pengguna sedang di grup.
7. Deskripsi, komposisi/keterangan, "Bebas PPN" bila flag (G-04).
8. Bilah CTA lengket: [Tambah ke keranjang] (sekunder) + [Belanja Bareng] (utama, R1).
**State:** memuat · produk tidak ditemukan/ tidak tayang ("Produk ini sudah tidak tersedia" + ke katalog) · stok habis **[menunggu K-20]** (CTA nonaktif + "Stok habis, segera distok") · stok kurang dari jumlah ("Sisa {n} {satuan}") · offline · di luar zona · error.
**Cabang:**
- "Belanja Bareng" belum di grup → lembar bawah: "Buat grup baru" (→ H-04 mode grup, barang ikut) · "Punya link grup? Tempel di sini". Sudah di grup → barang masuk bagian kamu di grup, snackbar "Masuk ke Grup {nama}".
- Ganti satuan saat sudah ada di keranjang → baris keranjang terpisah per satuan.
- Satuan pecahan/perlu ditinjau (K-01): tidak tayang → satuan tidak muncul sebagai opsi.
**Teks kunci:** "Pilih satuan" · "setara Rp — /pcs" · "Tambah ke keranjang" · "Belanja Bareng" · "Ajak tetangga lewat WhatsApp".
**Aksesibilitas:** pilihan satuan = `radiogroup` dengan label lengkap; harga per opsi dibaca bersama label; galeri punya tombol sebelumnya/berikutnya 44 px dan teks alternatif foto.

### H-04 Keranjang & Belanja Bareng — `/keranjang`
**Tujuan:** meninjau barang, lalu memilih belanja bareng (utama) atau sendiri, dan membuat/mengelola grup.
**Mode A — belum di grup**
1. Daftar barang: foto kecil · nama · satuan · stepper · harga baris · hapus (ikon + label, dengan "Urungkan" 5 detik).
2. Kartu **perbandingan** (K-18): "Belanja sendiri: Rp — · Belanja Bareng: Rp — · Hemat Rp —" (angka dari server untuk isi keranjang saat ini).
3. CTA utama "Belanja Bareng" → layar **Buat Grup** (R7, lihat di bawah). CTA kedua "Beli sendiri" **[menunggu F-27]** (varian A: tampil sebagai jalur biasa dengan harga satuan; varian B: tidak ada, hanya grup).

**Layar Buat Grup** (lembar penuh, adaptasi referensi §3):
1. Judul "Belanja Bareng" + "Grup per keranjang, boleh beda barang".
2. Kartu syarat: "Minimal 3 orang ikut belanja dan total grup {min_grup}" + `SyaratGrup`.
3. Slot kirim & jam tutup grup (hanya tampil, ditentukan sistem): "Dikirim {hari, jam}, grup tutup {jam} WIB" (R11). Bila > 1 slot tersedia: pilih slot (radio).
4. Cara kirim: antar ke rumah / ambil sendiri di drop point — **tanpa** label/nominal harga Mitra (A14). Dipilih per akun di checkout; di sini hanya info "Tiap orang bisa pilih sendiri".
5. Nama grup (default "Grup {nama depan}", maks 30 huruf, filter kata kasar).
6. Info bayar: "Belum bayar sekarang. Tagihan terbit nanti dan harus dibayar dalam 60 menit. Yang belum bayar dikeluarkan dari grup; grup batal bila kurang dari 3 orang yang bayar." (A6–A8).
7. CTA "Buat Grup & Bagikan" → (login H-07 + persetujuan H-08 bila perlu) → **lembar bagikan** (R9).

**Lembar bagikan:** pratinjau pesan (bisa diubah) "Yuk ikut Belanja Bareng di Grup {nama} di NEKAT! Grup tutup {jam} WIB. {link}" · link pendek `/g/{kode}` · tombol urut: **WhatsApp** (utama), **Salin link**, **Bagikan lainnya** (Web Share API bila ada). Tanpa harga di pesan (G-01).

**Mode B — sedang di grup** (keranjang = bagian kamu + ringkasan grup)
1. Kepala grup: "Grup {nama}" · peran (Host/Anggota) · "tutup {jam} WIB" · tombol "Undang".
2. `SyaratGrup`.
3. "Barang kamu" (bisa diubah sampai tagihan terbit).
4. "Total grup Rp — dari {n} orang" (+ isi anggota lain sesuai **[UX-03]**).
5. CTA: sebelum tagihan → "Lihat halaman grup"; setelah tagihan terbit → "Bayar tagihan" (H-10).
**State:** kosong ("Keranjangmu masih kosong" + "Mulai belanja") · memuat · harga berubah sejak ditambahkan (baris disorot + "Harga berubah dari Rp — ke Rp —") · stok kurang ("Tinggal {n}. Jumlah kami sesuaikan") · produk tidak tayang (baris abu + "Hapus") · offline (jumlah terlihat, harga "—", CTA nonaktif) · error.
**Cabang:** keranjang berisi barang beda zona setelah ganti zona → minta hapus/kosongkan; keluar grup (Anggota, sebelum tagihan) → dialog "Keluar dari Grup {nama}? Barangmu kembali ke keranjang biasa."; host keluar → **[UX-05]**.
**Aksesibilitas:** hapus selalu bisa diurungkan; perubahan total diumumkan; dialog keluar grup fokus ke tombol aman ("Batal").

### H-05 Halaman grup — `/g/:kode`
**Tujuan:** pintu masuk dari link WhatsApp: memahami grup, ikut, dan melihat progres sampai bayar.
**Blok (urut):**
1. Kepala: "Grup {nama}" · "Host: {nama samaran}" · zona · "Dikirim {slot}" · "Tutup {jam} WIB" (hitung mundur ke jam tutup bila < 3 jam).
2. `SyaratGrup` + kalimat ajakan.
3. Anggota: avatar inisial + "{n} orang · {m} barang" + tombol "Undang" (R5).
4. Perbandingan grup vs sendiri untuk keranjang kamu (K-18) bila total < `{min_grup}`.
5. Barang kamu (kosong: "Kamu belum menambah barang. Mulai belanja untuk ikut dihitung").
6. Status tagihan (setelah terbit): daftar anggota dengan status bayar ("Sudah bayar" / "Belum bayar"), tanpa nominal milik orang lain kecuali host bayar semua.
7. Bilah CTA sesuai status (tabel di bawah).
8. Banner "Tambah ke layar utama" (H-06) setelah pengguna ikut grup.

| Status grup (server) | Teks status | CTA |
|---|---|---|
| Terbuka, < 3 orang menambah barang | "Kurang {x} orang lagi" | Belum ikut: "Ikut grup" · Sudah ikut: "Tambah barang" + "Undang tetangga" |
| ≥ 3 orang, total < `{min_grup}` | "Tambah Rp — lagi untuk Harga Belanja Bareng" | "Tambah barang" |
| Syarat terpenuhi, tagihan belum terbit | "Harga Belanja Bareng berlaku" | "Tambah barang"; Host: "Terbitkan tagihan" **[UX-01]** |
| Tagihan terbit | "Bayar sebelum {jam} WIB" + `HitungMundur` | "Bayar tagihan" (→ H-10) |
| Host pilih bayar semua | Anggota: "Tagihanmu dibayar oleh host" · Host: tagihan gabungan | Host: "Bayar semua" |
| Kamu sudah bayar | "Kamu sudah bayar. Menunggu {x} orang lagi" | "Undang tetangga" (bila masih boleh) / "Lihat pesanan" |
| Kamu dikeluarkan (K-12) | "Kamu dikeluarkan dari grup karena belum bayar dalam 60 menit" | "Belanja lagi" |
| Grup batal (lunas < 3, K-12 / F-29) | "Grup batal karena kurang dari 3 orang yang bayar. Dana yang sudah dibayar masuk Saldo NEKAT" | "Buat grup baru" |
| Grup tidak tercapai saat tutup **[menunggu K-11]** | Varian A (rekomendasi K-11): pilihan "Lanjut harga satuan" / "Batalkan, dana ke Saldo", default batal; varian B: pesanan terkunci, tidak diproses | sesuai varian |
| Ditutup / dikunci / diproses | "Grup sudah ditutup" | Bukan anggota: "Buat grup baru" · Anggota: "Lihat pesanan" |
| Ditahan admin (P-09/P-26) | "Pesanan sedang kami periksa. Kabar paling lambat {waktu}" | "Lihat pesanan" |

**State:** memuat · link tidak ditemukan/format salah ("Link grup tidak ditemukan" + "Ke katalog"; tidak membocorkan apakah kode pernah ada) · zona belum diketahui (minta lokasi H-01 lalu kembali) · zona lain (B-13: "Grup ini untuk zona {zona}. Kamu bisa buat grup di zonamu" **[F-19]**) · offline · error.
**Cabang:** belum login + tekan "Ikut grup" → niat disimpan → H-07 → H-08 → kembali ke `/g/:kode` dengan niat yang sama (guard dicek ulang: "Grup sudah ditutup selama kamu masuk"). Sudah anggota → langsung tampilkan status, bukan tombol ikut. Barang di keranjang biasa saat ikut grup → dialog "Pindahkan {n} barang di keranjangmu ke grup ini?" [Pindahkan] [Tidak].
**Teks kunci:** "Ikut grup" · "Undang tetangga" · "Belum bayar sekarang — tagihan terbit nanti" · "Kurang {x} orang lagi".
**Aksesibilitas:** perubahan syarat/anggota (polling/realtime) diumumkan `polite` dan maks 1 kali/30 detik; daftar anggota = daftar berlabel, status bayar dalam teks.

### H-06 Ajakan "Tambah ke layar utama" (komponen di H-05, H-11)
- Muncul **setelah** aksi bernilai (ikut grup / bayar), bukan saat pertama buka; maks 1 kali per 7 hari bila ditutup; tidak muncul bila sudah terpasang (`display-mode: standalone`).
- Android/Chrome: tombol "Pasang" memanggil `beforeinstallprompt`. iOS Safari: lembar petunjuk 2 langkah bergambar ("Ketuk ikon Bagikan → pilih 'Tambah ke Layar Utama'").
- Teks: "Pasang NEKAT di layar HP biar gampang cek grup" [Pasang] [Nanti saja].
- A11y: banner `role="region"` berlabel, bisa ditutup dengan tombol 44 px, tidak menutupi CTA bawah.

### H-07 Masuk dengan OTP WhatsApp — `/masuk`
**Tujuan:** verifikasi nomor HP (satu nomor = satu akun) saat aksi grup/checkout pertama.
**Blok:** alasan singkat ("Masuk untuk ikut grup dan bayar") → input nomor HP (awalan +62 tetap, contoh "812xxxx") → "Kirim kode lewat WhatsApp" → layar kode 6 digit (satu kolom `one-time-code`, tempel otomatis) → "Kirim ulang dalam {mm:ss}" → "Ganti nomor".
**State:** mengirim · kode terkirim ("Kode dikirim ke WhatsApp +62 812•••• 34") · kode salah ("Kode salah. Sisa {n} percobaan") · kedaluwarsa ("Kode sudah kedaluwarsa. Kirim kode baru") · terlalu sering ("Terlalu banyak percobaan. Coba lagi {waktu}") · WhatsApp tidak tersedia (M-05: "Kode belum bisa dikirim. Coba beberapa menit lagi") · offline · akun dibekukan.
**Cabang:** sukses + belum setuju S&K versi terkini → H-08; sudah → kembali ke niat tersimpan. Pesan tidak membedakan nomor baru/lama (ADR-0001 §4.3).
**Aksesibilitas:** `inputmode="numeric"`, `autocomplete="tel"` / `one-time-code`; hitung mundur kirim ulang tidak diumumkan tiap detik; error `role="alert"` terhubung ke input (`aria-describedby`).

### H-08 Persetujuan S&K & Kebijakan Privasi — `/persetujuan`
**Tujuan:** persetujuan wajib sebelum ikut/buat grup (A17).
**Blok:** judul "Sebelum ikut grup" → ringkasan 3 butir bahasa sederhana (grup minimal 3 orang; tagihan 60 menit; selisih/refund masuk Saldo NEKAT) → tautan "Baca Syarat & Ketentuan" dan "Baca Kebijakan Privasi" (buka lembar, bukan pindah halaman) → kotak wajib (teks persis dari `docs/legal/kebijakan-privasi.md` bagian akhir) → kotak promo opsional, **tidak dicentang bawaan** → tombol "Setuju & lanjut" (nonaktif sampai kotak wajib dicentang, dengan alasan terbaca: "Centang persetujuan untuk lanjut").
**State:** memuat teks · gagal simpan ("Persetujuan belum tersimpan. Coba lagi") · versi berubah **[F-23]** (judul "Ada pembaruan Syarat & Ketentuan").
**Cabang:** tidak setuju / tutup → kembali, tetap bisa melihat katalog: "Kamu tetap bisa melihat katalog. Untuk ikut grup, persetujuan diperlukan."
**Aksesibilitas:** kotak centang ≥ 44 px dengan label yang bisa diketuk; tombol nonaktif tetap fokusable dengan `aria-disabled` + penjelasan.

### H-09 Checkout — `/checkout`
**Tujuan:** menentukan cara kirim, slot, cara bayar, dan melihat rincian sebelum tagihan dibayar.
**Blok (urut):**
1. Ringkasan grup (bila grup): "Grup {nama} · {n} orang · Harga Belanja Bareng berlaku / belum berlaku".
2. **Cara kirim** (radio kartu): "Antar ke rumah" (alamat + patokan + catatan kurir; alamat harus dalam zona) · "Ambil sendiri di drop point" ({nama drop point}, jam buka). Di sinilah info harga drop point tampil (P-28): kartu info "Ambil di drop point dihitung pesanan Mitra. Harga Mitra Rp — berlaku bila syarat terpenuhi" (teks dari server, A14).
3. **Slot kirim**: tanggal + jam (radio), "Grup tutup {jam} WIB". Slot penuh → nonaktif + "Penuh".
4. Barang (bisa dilipat): nama · satuan · jumlah · harga.
5. Promo/diskon: chip otomatis + `KartuTidakMemenuhiSyarat` bila gagal (A16).
6. **Pakai Saldo NEKAT**: toggle "Pakai saldo (Rp — tersedia)" → baris "Saldo dipakai −Rp —". Saldo menutup semua → metode bayar disembunyikan, CTA "Bayar pakai saldo".
7. **Metode bayar** (sisa): QRIS · Virtual Account (pilih bank) · e-wallet (pilih) · COD hanya bila server menyatakan layak (A19; batas `{batas_cod}`, dibanding total sebelum/sesudah saldo **[P-18]**).
8. Host saja, saat tagihan tersedia: "Siapa yang bayar?" — "Tiap orang bayar sendiri" (bawaan) / "Saya bayar untuk semua ({n} orang)" → rincian gabungan per anggota (nama samaran + subtotal) + biaya admin × {n} akun (K-06) + catatan "Selisih harga nanti masuk Saldo NEKAT kamu" (G-06b).
9. `RincianBiaya` (A11, A12).
10. Peringatan: "Setelah tagihan terbit, bayar dalam 60 menit. Yang belum bayar dikeluarkan dari grup."
11. CTA lengket: "Bayar Rp —" → H-10.
**State:** memuat · alamat di luar zona ("Alamat ini di luar zona {zona}. Pilih drop point atau alamat lain") · slot habis · stok berubah saat tagihan dibuat (P-08: "Stok {produk} habis. Tagihan dibatalkan, ubah keranjangmu") · harga berubah sejak keranjang ("Harga terbaru: Rp —") · grup belum memenuhi syarat (K-18: harga satuan + perbandingan + "Tetap lanjut dengan harga satuan" / "Ajak tetangga dulu") · gateway gangguan ("Pembayaran sedang gangguan. Coba lagi beberapa menit") · Gudang tidak terjangkau (H14: "Kami sedang memeriksa stok. Checkout belum bisa dilanjutkan") · offline · error.
**Cabang:** tagihan sudah terbit sebelumnya → langsung ke H-10 (tidak membuat tagihan ganda); host sudah bayar semua → anggota melihat "Tagihanmu sudah dibayar host" tanpa CTA bayar.
**Teks kunci:** "Antar ke rumah" · "Ambil sendiri di drop point" · "Pakai Saldo NEKAT" · "Ongkir ditagih di tagihan final" · "Bayar Rp —".
**Aksesibilitas:** setiap grup radio punya `legend`; total bayar diumumkan saat berubah; CTA berisi nominal yang sama dengan total.

### H-10 Tagihan & pembayaran — `/tagihan/:id`
**Tujuan:** menyelesaikan pembayaran sebelum 60 menit habis (A7).
**Blok (urut):** `HitungMundur` → nominal "Bayar Rp —" + tombol salin → instruksi sesuai metode:
- QRIS: gambar QR besar (latar putih juga di tema gelap) + "Simpan QR" + langkah 3 baris.
- VA: nomor VA besar + "Salin" + nama bank + langkah per kanal (ATM, m-banking) dalam akordeon.
- E-wallet: tombol "Buka {e-wallet}".
→ "Saldo dipakai −Rp —" (bila ada) → rincian (lipat) → "Ganti metode bayar" (selama belum dibayar) → "Batalkan tagihan" (dua langkah, **[F-07]**).
**Host bayar semua:** satu tagihan gabungan + QR (K-17); judul "Tagihan Grup {nama} · {n} orang"; QR juga dikirim ke WhatsApp host.
**Tagihan final (ongkir, K-10)** **[UX-02]**: kartu terpisah "Tagihan final: ongkir Rp —" dengan `HitungMundur` sendiri, muncul setelah grup dikunci.
**State:** menunggu bayar · memeriksa ("Kami sedang memastikan pembayaranmu…"; halaman kembali dari Xendit **tidak** dianggap bukti lunas, status dari server — ADR-0001) · lunas (centang + "Pembayaran diterima" + "Lihat pesanan"; banner H-06) · kedaluwarsa ("Waktu bayar habis. Kamu dikeluarkan dari grup.") · dibatalkan · bayar terlambat (P17: "Pembayaranmu masuk setelah batas waktu. Rp — masuk Saldo NEKAT") · offline (QR/VA tetap terlihat dari data yang sudah dimuat, status "Tidak bisa cek status saat offline").
**Aksesibilitas:** QR punya alternatif teks (nominal + "kode QRIS untuk membayar Rp —") dan opsi VA/e-wallet; nomor VA dibaca per kelompok digit; salin memberi konfirmasi `aria-live` "Nomor disalin".

### H-11 Status pesanan — `/pesanan`, `/pesanan/:id`
**Tujuan:** tahu posisi pesanan, uang, dan kapan barang datang tanpa harus chat CS.
**Daftar:** tab "Berjalan" / "Selesai" / "Batal"; kartu: grup/sendiri · tanggal slot · status (teks + ikon) · total. Kosong: "Belum ada pesanan" + "Mulai belanja".
**Detail (urut):** status besar → garis waktu (Grup dibuat → Tagihan terbit → Dibayar → Grup dikunci → Disiapkan → Diantar / Siap diambil → Diterima) dengan tanggal-jam → kartu aksi sesuai status → barang (qty teralokasi bila parsial) → rincian bayar & tagihan final → kredit ke saldo (bila ada) → bantuan (WhatsApp CS) → nota (unduh/bagikan, berisi rincian PPN).
**Teks status** (mengikuti flow §9.1, diselaraskan keputusan):
| Status | Teks |
|---|---|
| Menunggu bayar | "Bayar sebelum {jam} WIB" |
| Lunas, grup berjalan | "Sudah dibayar · grup tutup {jam} WIB" |
| Dikeluarkan (K-12) | "Dikeluarkan dari grup · belum bayar dalam 60 menit" |
| Grup batal (K-12) | "Grup batal · Rp — masuk Saldo NEKAT" |
| Ditahan | "Sedang kami periksa · kabar paling lambat {waktu}" |
| Dikunci | "Harga final Rp — · sedang disiapkan" (+ "Rp — masuk Saldo NEKAT" bila ada selisih) |
| Parsial | "{a} dari {q} {satuan} tersedia · Rp — masuk Saldo NEKAT" |
| Diantar / Siap diambil | "Sedang diantar" / "Siap diambil di {drop point}, {jam}" |
| Diterima | "Pesanan diterima" |
**Cabang:** batal (sebelum tutup, **[F-07]**) dua langkah dengan dampak ("Grup jadi kurang 1 orang", "Rp — masuk Saldo NEKAT"); kalah balapan dengan tutup grup → "Grup sudah ditutup, pesanan tidak bisa dibatalkan"; grup tidak tercapai **[menunggu K-11]**.
**Aksesibilitas:** garis waktu = daftar berurutan, langkah aktif `aria-current="step"`; status tidak hanya warna.

### H-12 Saldo NEKAT (loyalty point) — `/saldo`, `/saldo/cairkan`
**Tujuan:** melihat saldo, asal-usulnya, memakainya, dan mencairkannya.
**Blok (urut):** kartu saldo besar "Rp —" + "1 poin = Rp1 · tidak kedaluwarsa" → tombol "Belanja pakai saldo" dan "Cairkan" → riwayat (filter: Semua / Masuk / Keluar), baris: ikon arah · alasan ("Selisih harga Grup {nama}", "Refund grup batal", "Dipakai untuk pesanan #{no}", "Pencairan ke {tujuan}") · tanggal · nominal (+ hijau / − teks utama) · status pencairan.
**Cairkan (`/saldo/cairkan`):** tujuan (rekening bank / virtual account / e-wallet; pilih dari daftar) → data tujuan (nama pemilik dicocokkan bila tersedia) → nominal (bisa "Semua") → rincian (biaya & minimal **[UX-04]**) → konfirmasi ulang OTP WhatsApp **[UX-04]** → status "Diproses / Berhasil / Gagal (saldo dikembalikan)".
**State:** saldo 0 ("Saldo kamu Rp0. Selisih harga grup akan masuk ke sini") · memuat · riwayat kosong · pencairan belum dibuka (**[menunggu H5]** tinjauan hukum: tombol "Cairkan" tampil nonaktif + "Pencairan segera tersedia") · gagal · offline (saldo "—").
**Aksesibilitas:** nominal dibaca dengan tanda ("masuk Rp —", "keluar Rp —"), bukan warna; formulir pencairan dengan label & error per kolom.

### H-13 Akun — `/akun` (ringkas)
Nomor HP (disamarkan) · nama panggilan · alamat tersimpan · zona · **Tampilan: Terang / Gelap / Ikuti HP** (bawaan Ikuti HP, `data-theme` pada `<html>`, disimpan lokal dengan try/catch) · Ukuran huruf mengikuti HP · Privasi (Profil > Privasi: unduh data, hapus akun, tarik persetujuan promo) · S&K · Bantuan · Keluar.

---

## 6. H-14 Panel admin — struktur navigasi saja

Akses `/admin` (bagian PWA yang sama, rute & API terpisah, RBAC). Login: OTP + **TOTP wajib** (H9). Tata letak ≥ 900 px: sidebar 256 px + isi; < 900 px: drawer. Setiap aksi uang/harga mencatat log audit dengan alasan.

| Menu | Submenu |
|---|---|
| Beranda | Ringkasan hari ini (grup tercapai, pesanan, tagihan kedaluwarsa, antrean tugas) |
| Produk | Daftar produk & SKU · Satuan jual per produk · Import CSV (T-038) · Perlu ditinjau (modal pecahan K-01, tanpa harga) · Kategori & subkategori |
| Harga & margin | Margin % / harga jual per satuan per level (**field kosong**, diisi pemilik) · Timpaan modal + tanggal kedaluwarsa (K-03) · Log perubahan modal (K-02) · Peringatan pagar |
| Stok & Gudang | Sumber stok (Lokal / API Gudang) · Status sinkron & usia data (P-10) · Penyesuaian stok |
| Grup | Berjalan (per zona/slot, progres syarat) · Ditahan (P-09/P-26, aksi Lanjutkan/Batalkan) · Selesai/Batal · Tanda review akun ganda (B-17) |
| Pesanan & tagihan | Daftar pesanan · Tagihan (terbit/kedaluwarsa/lunas) · Pembayaran terlambat & yatim · Ubah status kirim |
| Pengiriman | Slot kirim & jam tutup · Armada · Drop point · Daftar antar per slot · Picking list |
| Promo | Diskon · Gratis ongkir · Peringatan pagar (batas bawah dari konfigurasi, K-16) |
| Saldo | Riwayat ledger per akun · Antrean pencairan · Koreksi (dengan alasan) · Dana ditahan |
| Pengguna | Akun · COD: KPI & status (cabut manual dengan alasan) · Pembekuan akun |
| Laporan | Harian (grup tercapai, repeat rate, biaya kirim/order) · Ekspor |
| Pengaturan | Zona & lokasi · Biaya admin (kosong) · PPN (tarif & DPP) · Minimum grup · Masa berlaku tagihan · Versi S&K & privasi · Template WhatsApp · Admin & peran (2FA) |
| Log audit | Semua perubahan harga, modal, status, saldo |

State panel: daftar kosong, memuat (skeleton tabel), error, tanpa izin ("Peranmu tidak punya akses ke menu ini"). Tabel di layar kecil berubah menjadi kartu bertumpuk.

---

## 7. Fondasi tata letak & responsif

| Lebar | Pembeli | Admin |
|---|---|---|
| 320–359 px | Satu kolom, gutter 16 px, grid produk 2 kolom (kartu min ~140 px), teks tidak terpotong | Drawer, tabel → kartu |
| ≥ 360 px (`sm`) | Basis desain | sama |
| ≥ 600 px (`md`) | Grid produk 3 kolom, kontainer maks 640 px | Tabel sederhana |
| ≥ 900 px (`lg`) | Tetap kolom tengah 640 px (aplikasi HP di layar lebar) | Sidebar tetap |
| ≥ 1200 px (`xl`) | sama | Tabel lebar, panel detail samping |

Aturan: tidak ada scroll horizontal halaman (tab kategori menggulir di dalam deretnya); bilah CTA lengket menghormati `safe-area-inset-bottom`; konten tidak tertutup CTA (`.l-app--with-cta`); gambar `loading="lazy"` + ukuran tetap agar tata letak tidak lompat; aset statis saja yang di-cache service worker, data harga/stok selalu jaringan (ADR-0001).

Kerangka halaman (urutan DOM): `a.skip-link` → `header.l-appbar` → pita (offline / grup aktif) → `main#isi.l-container` → `div.l-cta-bar` (bila ada) → `nav.l-bottomnav`.

---

## 8. Design token

### 8.1 Ringkasan (detail di `docs/spec/T-007-tokens.css`)
| Kelompok | Token | Catatan |
|---|---|---|
| Warna permukaan | `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-overlay` | Latar halaman abu sangat muda, kartu putih |
| Warna teks | `--color-text`, `--color-text-muted`, `--color-text-subtle`, `--color-text-on-primary` | |
| Merek | `--color-primary` (+ `-hover`, `-pressed`, `-soft`) | Hijau-teal tua `#0B6B5F` / gelap `#3CCFB4`; bukan warna Shopee/Grab |
| Semantik | `--color-success`, `--color-warning`, `--color-danger`, `--color-info` (+ `-soft`) | Hitung mundur: warning ≤ 10 mnt, danger ≤ 2 mnt |
| Khusus NEKAT | `--color-price`, `--color-price-group`, `--color-price-strike`, `--color-promo`, `--color-saldo` | Harga = warna teks utama (bukan merah); promo ungu terpisah dari harga (A13) |
| Tipografi | `--font-sans` (font sistem), `--text-xs`…`--text-3xl` (13–30 px), `--leading-*`, `--weight-*` | Teks isi 16 px |
| Spasi | `--space-0`…`--space-16` (grid 4 px) | Gutter 16 px |
| Radius | `--radius-sm` 6 · `md` 10 · `lg` 14 · `xl` 20 · `full` | |
| Bayangan | `--shadow-1`…`--shadow-3`, `--shadow-top` | Lebih gelap di tema gelap |
| Sentuh | `--tap-min` 44 · `--tap-comfort` 48 · `--tap-gap` 8 | AX1 |
| Tata letak | `--container-shop` 640 · `--container-admin` 1280 · `--appbar-h` 56 · `--bottomnav-h` 64 · `--cta-bar-h` 72 · safe area | |
| Lapisan & gerak | `--z-*`, `--dur-*`, `--ease-standard` | reduced motion dihormati |
| Breakpoint | 360 / 600 / 900 / 1200 px (`min-width`) | dicatat sebagai komentar; custom property tidak bisa di `@media` |

Tema: bawaan **ikuti HP** (`prefers-color-scheme`), dipaksa lewat `html[data-theme="light|dark"]` (pengaturan H-13). Primitif fondasi di file CSS: `.l-container`, `.l-stack`, `.l-cluster`, `.l-grid-products`, `.l-scroll-x`, `.l-app`, `.l-appbar`, `.l-bottomnav`, `.l-cta-bar`, `.l-admin`, `.btn*`, `.card`, `.chip*`, `.tab`, `.input`, `.price*`, `.countdown`, `.progress`, `.skeleton`, `.sr-only`, `.skip-link`. Konvensi nama: `l-` tata letak, komponen satu kata + modifier `--`; komponen penuh (T-008) memakai CSS Modules/berkas per komponen yang hanya membaca token.

### 8.2 Cek kontras (WCAG 2.1, dihitung)
| Pasangan | Terang | Gelap |
|---|---|---|
| Teks utama / surface | 16.9:1 | 14.0:1 |
| Teks muted / surface | 7.9:1 | 8.2:1 |
| Teks subtle / surface | 5.3:1 | 5.7:1 |
| Teks di tombol utama | 6.4:1 | 8.1:1 |
| Primary sebagai teks / bg | 6.0:1 | 9.4:1 |
| Primary / primary-soft (chip grup) | 5.6:1 | 7.3:1 |
| Warning / warning-soft | 6.2:1 | 8.9:1 |
| Danger / surface | 7.6:1 | 7.2:1 |
| Promo / promo-soft | 6.9:1 | 8.2:1 |
| Border-strong (kontrol) / surface | 3.9:1 | 4.2:1 |

---

## 9. Varian menunggu keputusan (terbuka di `keputusan-terbuka.md`)

| # | Halaman | Varian A (rekomendasi yang tertulis) | Varian B |
|---|---|---|---|
| K-11 | H-05, H-11 | Grup tidak tercapai: pembeli memilih "Lanjut harga satuan" / "Batalkan, dana ke Saldo"; bawaan batal | Pesanan terkunci, tidak diproses, dana ke saldo |
| K-20 | H-02, H-03 | Stok habis tampil abu + "Stok habis, segera distok", tidak bisa ditambah | Disembunyikan; jumlah tab tidak menghitung |
| K-21 | H-09 | Satu baris "Diskon −Rp —" atas total | Diskon per barang di tiap baris |
| P-17 | Komponen `Harga` | Harga coret tampil | Disembunyikan |
| F-27 | H-04 | Ada "Beli sendiri" | Hanya grup |
| F-07 | H-11 | Batal sampai grup tutup | Sesuai keputusan |
| F-18 | H-01 | Daftar tunggu WhatsApp di luar zona | Tanpa daftar tunggu |
| F-19 / F-23 / P-18 | H-05 / H-08 / H-09 | Lihat teks di halaman masing-masing | — |
| H5 | H-12 | Pencairan dibuka | Nonaktif sampai tinjauan hukum |

---

## 10. Pertanyaan keputusan baru (UX)

| # | Pertanyaan | Rekomendasi | Pemilik |
|---|---|---|---|
| UX-01 | Kapan tagihan grup terbit (awal 60 menit, K-07)? (a) tiap anggota menekan "Bayar" sendiri, (b) host menekan "Terbitkan tagihan" setelah syarat terpenuhi, (c) otomatis 60 menit sebelum grup tutup | (b) + cadangan (c) bila host tidak menekan: satu waktu snapshot harga (K-15) untuk semua, pilihan host bayar semua (G-07) masuk akal, hitung mundur sama untuk semua anggota | Randy |
| UX-02 | K-10 "ongkir di tagihan setelah final": dua pembayaran (barang lalu ongkir) atau satu tagihan yang baru terbit setelah grup final? Bila dua: tagihan ongkir juga 60 menit, dan apa akibat bila ongkir tidak dibayar? | Satu tagihan setelah grup final berisi barang + biaya admin + ongkir (pembeli sekali bayar); bila tetap dua, ongkir tak dibayar → barang ditahan di drop point, tidak membatalkan grup | Randy + Efan |
| UX-03 | Apakah anggota boleh melihat **isi barang** anggota lain di halaman grup (bukan hanya jumlah & nama samaran)? Host yang bayar semua jelas perlu melihat rincian | Anggota: hanya jumlah orang, total grup, nama samaran; host: rincian barang per anggota hanya saat memilih "bayar semua" (tanpa alamat/HP) | Randy |
| UX-04 | Pencairan saldo (G-06d): minimal nominal, biaya pencairan (ditanggung siapa), dan apakah wajib OTP ulang + pencocokan nama pemilik rekening? | OTP WhatsApp ulang wajib + nama pemilik harus cocok dengan nama akun; minimal & biaya diisi pemilik di Pengaturan (kosong dulu) | Efan (nominal/biaya) + Joseph (keamanan) |
| UX-05 | Host keluar grup sebelum tagihan terbit: grup bubar atau peran host pindah ke anggota pertama? | Pindah ke anggota yang paling awal menambah barang; host tidak bisa keluar setelah tagihan terbit | Randy |
| UX-06 | Setelah anggota dikeluarkan (K-12), akun lunas masih ≥ 3 tetapi total lunas < `{min_grup}`: harga tetap Harga Belanja Bareng yang sudah dibayar, atau turun ke harga satuan (tagih tambahan)? | Tetap harga yang dibayar, tanpa tagihan tambahan, selama lolos pagar modal (bila tidak lolos → DITAHAN seperti P-09) | Efan |
| UX-07 | Boleh menambah barang / ikut grup setelah tagihan terbit (sebelum grup tutup)? | Tidak: keranjang grup terkunci saat tagihan terbit; pendatang baru diarahkan ke grup baru | Randy |

---

## 11. Serah terima

Urutan implementasi (T-014 → T-026/T-028/T-033): (1) salin `T-007-tokens.css` ke `apps/web/src/styles/` dan pasang kerangka §7; (2) komponen `Harga`, `SyaratGrup`, `HitungMundur`, `RincianBiaya`, `KartuTidakMemenuhiSyarat` (T-008); (3) H-01 → H-02 → H-03 → H-04 → H-05 → H-07/H-08 → H-09/H-10 → H-11 → H-12; (4) H-14 setelah T-036. Semua teks UI disimpan di satu berkas string Bahasa Indonesia (siap diubah tanpa ubah kode). Tes Playwright (T-043) memakai teks kunci di dokumen ini sebagai selektor peran/label, bukan kelas CSS.
