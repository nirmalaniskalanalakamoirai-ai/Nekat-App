# Referensi UI/UX Group Order — ShopeeFood & GrabFood

Diberikan pemilik (Randy) 12 Nov 2026 sebagai acuan desain group order NEKAT. Wajib dipakai oleh T-007 (spesifikasi UX), T-008 (komponen UI), T-024 (link grup), T-027 (kartu produk), T-028 (detail produk), dan T-033 (checkout).

Screenshot di folder ini hanya untuk referensi internal. Jangan menyalin logo, nama merek, ilustrasi, atau warna khas Shopee/Grab ke aplikasi NEKAT.

| File | Isi |
|---|---|
| `shopeefood-grup-berjalan.jpg` | Halaman toko saat grup berjalan: kartu "Dapatkan diskon s.d. 7%", tangga diskon per jumlah orang, jumlah anggota, tombol Undang |
| `grab-halaman-toko.jpg` | Tombol "Group Order" di halaman toko, chip promo "Up to 55% off Group Order" |
| `grab-buat-grup.jpg` | Layar buat grup: syarat minimum belanja grup, tangga diskon 3–6 orang, cara bayar, batas tambah barang, nama grup, tombol Buat |
| `grab-bagikan-link.jpg` | Lembar bagikan: pratinjau pesan + link pendek + WhatsApp/Telegram/Salin link |

## 1. Pola yang DIPAKAI

| # | Pola | Sumber | Penerapan di NEKAT |
|---|---|---|---|
| R1 | Tombol **"Group Order"** menonjol di samping aksi utama | Grab | Di detail produk dan halaman toko/kategori: tombol "Belanja Bareng (Group Order)" di samping "+ Keranjang" |
| R2 | Chip promo "Hemat s.d. X% pakai Group Order" | Grab, Shopee | Chip di kartu produk & detail; angka X dihitung dari harga tier termurah vs harga 1 pcs (rupiah tetap ditampilkan, aturan "harga kartu = detail") |
| R3 | **Kartu progres bertingkat** (garis dengan titik per tingkat) | Shopee, Grab | Satu komponen `TanggaGrup`: titik = tingkat harga produk (1 pcs, 3 pcs, lusin, dus, koli sesuai produk, keputusan P-03); label bawah = harga per pcs; titik aktif berwarna |
| R4 | **Kalimat ajakan konkret**: "Ajak 2 orang untuk dapat diskon 6%" | Shopee | "Kurang **2 akun** agar grup terbuka" (sebelum 3 akun) lalu "Tambah **5 pcs** lagi → Rp{harga}/pcs" (setelah grup terbuka) |
| R5 | Baris anggota: avatar + "1 orang" + tombol **Undang** | Shopee | Avatar inisial (nama disamarkan, Kebijakan Privasi §3) + "{n} akun · {m} pcs" + tombol "Undang" |
| R6 | Header grup: "**{nama} Group Order**" + tombol **Batal** | Shopee | "Grup {nama}" + "Keluar grup" (batal hanya sebelum bayar/cut-off sesuai flow T-002) |
| R7 | Layar **Buat grup** berisi syarat, tangga, cara bayar, batas waktu, nama grup, tombol besar di bawah | Grab | Lihat §3 |
| R8 | **Syarat grup dalam satu kalimat**: "Belanja min. Rp100.000 sebagai grup, min. 1 barang per orang" | Grab | "Minimal 3 akun dan total belanja Rp100.000" (F-06; per akun/total menunggu F-30) |
| R9 | **Lembar bagikan** dengan pratinjau pesan + link pendek + tombol WhatsApp di depan | Grab | Pesan siap kirim berbahasa Indonesia + link `/g/{kode}` (keputusan #3); urutan tombol: WhatsApp, Salin link, lainnya |
| R10 | **Banner grup aktif** di atas halaman toko selama grup berjalan | Grab | Pita "Kamu sedang di Grup {nama} · tutup {jam}" di katalog sampai cut-off |
| R11 | Info waktu ("Tiba dalam 26 menit") dekat kartu grup | Shopee | "Dikirim {slot}, grup tutup {jam cut-off}" |

## 2. Pola yang DIUBAH karena keputusan NEKAT

| Referensi | NEKAT | Dasar |
|---|---|---|
| Diskon naik berdasarkan **jumlah orang** (2, 3…6 orang) | Harga naik-turun berdasarkan **kuantitas barang** per tingkat produk; jumlah akun hanya syarat **membuka** grup (min. 3) | `keputusan.md` #3, P-03 |
| Diskon ditampilkan sebagai **persen** | Tampilkan **rupiah per pcs**, persen boleh sebagai pelengkap | CLAUDE.md "harga kartu = detail" |
| **Split bill**: pembuat grup membayar dulu | Setiap akun **bayar sendiri di awal** via VA/QRIS, batas bayar 60 menit | F-01, F-26 |
| **Deadline** diatur pembuat grup ("None") | Batas waktu = **cut-off slot kirim**, ditentukan sistem, tidak bisa diubah pembuat grup | `keputusan.md` #3, T-002 |
| Grup gagal = tidak dapat diskon tapi tetap kirim | Grup < 3 akun: harga satuan, pesanan **terkunci/tidak diproses** | F-02 |
| Pengiriman instan (26–45 menit) | Pengiriman terjadwal per slot harian | `keputusan.md` #4 |
| Promo berlangganan pihak ketiga (VIP, GrabUnlimited) | Tidak ada di Fase 1 | — |

## 3. Layar "Buat Grup" NEKAT (adaptasi R7)

Urutan dari atas:
1. Judul "Belanja Bareng" + nama produk/toko kecil di bawahnya.
2. Ilustrasi sederhana orisinal NEKAT (bukan ilustrasi Grab).
3. Kartu syarat + `TanggaGrup` (R3, R8).
4. **Slot kirim** (tanggal + jam) dan jam tutup grup — hanya tampil, tidak bisa diubah.
5. **Cara kirim**: antar ke rumah / ambil di drop point (drop point = harga Mitra bila memenuhi syarat P-05).
6. **Nama grup** (bisa diubah, default "Grup {nama depan}").
7. **Pembayaran**: "Setiap anggota bayar bagiannya sendiri di awal (VA/QRIS), batas 60 menit".
8. Tombol besar hijau di bawah: **"Buat Grup & Bagikan"** → langsung membuka lembar bagikan (R9).

Pesan bagikan default (bisa diubah pengguna):
> Yuk ikut Belanja Bareng {produk} di NEKAT! Makin banyak yang ikut, makin murah — sekarang Rp{harga}/pcs. Grup tutup {jam}. {link}

## 4. Butuh keputusan (ditambahkan ke issue #5)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| G-01 | Satu grup berisi **satu produk** (rancangan sekarang: produk × zona × slot) atau **satu keranjang berisi banyak produk** seperti Grab/Shopee? | A) per produk; B) per keranjang (tiap produk tetap punya tingkat harga sendiri) | **B**: sesuai referensi dan syarat "min. Rp100.000 sebagai grup" (F-06); butuh revisi kecil flow T-002 & model data T-004 |
| G-02 | Fitur "Grup yang bisa diundang" (simpan daftar tetangga/grup lama) | Fase 1 / Fase 2 | Fase 2 (setelah pilot) |
| F-30 | Minimum Rp100.000 per akun atau total grup? | per akun / total grup | **Total grup + min. 1 barang per akun**, sama seperti referensi Grab |
