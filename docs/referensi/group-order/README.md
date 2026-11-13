# Referensi UI/UX Group Order — ShopeeFood & GrabFood

Diberikan pemilik (Randy) 12 Nov 2026 sebagai acuan desain group order NEKAT. Usulan agen: dipakai sebagai acuan oleh T-007 (spesifikasi UX), T-008 (komponen UI), T-024 (link grup), T-027 (kartu produk), T-028 (detail produk), dan T-033 (checkout). Status "wajib" menunggu persetujuan Randy (merge PR #10). Bila bertentangan dengan `keputusan.md` atau spesifikasi yang sudah di-merge, keputusan/spesifikasi yang menang.

Screenshot di folder ini hanya untuk referensi internal; nama akun, nama kontak, dan link undangan asli sudah ditutup (sesi QA 12 Nov). Jangan menyalin logo, nama merek, ilustrasi, atau warna khas Shopee/Grab ke aplikasi NEKAT.

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
| R2 | Chip promo "Hemat s.d. X% pakai Group Order" | Grab, Shopee | Chip di kartu produk & detail; angka X dihitung hanya dari tingkat harga yang **berlaku untuk level pembeli yang melihat** (bukan harga Mitra/grosir), vs harga 1 pcs; rupiah tetap ditampilkan, aturan "harga kartu = detail"; definisi harga coret menunggu P-17 |
| R3 | **Kartu progres bertingkat** (garis dengan titik per tingkat) | Shopee, Grab | Satu komponen `TanggaGrup`: titik = tingkat harga produk (1 pcs, 3 pcs, lusin, dus, koli sesuai produk, keputusan P-03); label bawah = harga per pcs; titik aktif berwarna |
| R4 | **Kalimat ajakan konkret**: "Ajak 2 orang untuk dapat diskon 6%" | Shopee | "Kurang **2 akun** agar grup terbuka" (sebelum 3 akun) lalu, per produk di keranjang grup (G-01), "Tambah **5 pcs** lagi → Rp{harga}/pcs" (setelah grup terbuka). Disertai catatan "Harga sementara; harga final dikunci saat cut-off, selisih dikembalikan sebagai loyalty point" (CLAUDE.md, G-03). *Tafsiran agen*: tingkat harga dihitung dari kuantitas gabungan grup per produk; cara hitung (gabungan atau per akun) menunggu **K-09** |
| R5 | Baris anggota: avatar + "1 orang" + tombol **Undang** | Shopee | Avatar inisial (nama disamarkan, Kebijakan Privasi §3) + "{n} akun · {m} pcs" + tombol "Undang" |
| R6 | Header grup: "**{nama} Group Order**" + tombol **Batal** | Shopee | "Grup {nama}" + "Keluar grup" (batal hanya sebelum bayar/cut-off sesuai flow T-002) |
| R7 | Layar **Buat grup** berisi syarat, tangga, cara bayar, batas waktu, nama grup, tombol besar di bawah | Grab | Lihat §3 |
| R8 | **Syarat grup dalam satu kalimat**: "Belanja min. Rp100.000 sebagai grup, min. 1 barang per orang" | Grab | "Minimal 3 akun dan belanja min. Rp100.000" (F-06; per akun/total grup menunggu F-30) |
| R9 | **Lembar bagikan** dengan pratinjau pesan + link pendek + tombol WhatsApp di depan | Grab | Pesan siap kirim berbahasa Indonesia + link `/g/{kode}` (keputusan #3); urutan tombol: WhatsApp, Salin link, lainnya |
| R10 | **Banner grup aktif** di atas halaman toko selama grup berjalan | Grab | Pita "Kamu sedang di Grup {nama} · tutup {jam}" di katalog sampai cut-off |
| R11 | Info waktu ("Tiba dalam 26 menit") dekat kartu grup | Shopee | "Dikirim {slot}, grup tutup {jam cut-off}" |

## 2. Pola yang DIUBAH karena keputusan NEKAT

| Referensi | NEKAT | Dasar |
|---|---|---|
| Diskon naik berdasarkan **jumlah orang** (2, 3…6 orang) | Harga naik-turun berdasarkan **kuantitas barang** per tingkat produk; jumlah akun hanya syarat **membuka** grup (min. 3) | `keputusan.md` #3, P-03 (cara hitung kuantitas menunggu K-09, lihat R4) |
| Diskon ditampilkan sebagai **persen** | Tampilkan **rupiah per pcs**, persen boleh sebagai pelengkap | CLAUDE.md "harga kartu = detail" |
| **Split bill**: pembuat grup membayar dulu | Dilunasi di awal via VA/QRIS, batas bayar 60 menit; bila ada anggota belum lunas, **seluruh grup batal** (F-29). Selisih harga/refund dikembalikan sebagai **loyalty point senilai Rupiah**, yang bisa dipakai sebagai opsi bayar di checkout dan digabung dengan VA/QRIS (G-03). Pembuat grup bayar semua vs tiap akun bayar sendiri, dan akun penerima poin: **menunggu G-06** | F-01, F-26, F-29, G-03, G-06 |
| **Deadline** diatur pembuat grup ("None") | Batas waktu = **cut-off slot kirim**, ditentukan sistem, tidak bisa diubah pembuat grup | flow T-002 (PR #2) |
| Grup gagal = tidak dapat diskon tapi tetap kirim | Grup < 3 akun: harga satuan, pesanan **terkunci/tidak diproses** | F-02 |
| Pengiriman instan (26–45 menit) | Pengiriman terjadwal per slot harian | backlog T-006 (slot harian) |
| Promo berlangganan pihak ketiga (VIP, GrabUnlimited) | Tidak ada di Fase 1 | — |

## 3. Layar "Buat Grup" NEKAT (adaptasi R7)

Urutan dari atas:
1. Judul "Belanja Bareng" + nama grup/toko kecil di bawahnya (grup per keranjang, G-01).
2. Ilustrasi sederhana orisinal NEKAT (bukan ilustrasi Grab).
3. Kartu syarat + `TanggaGrup` (R3, R8).
4. **Slot kirim** (tanggal + jam) dan jam tutup grup — hanya tampil, tidak bisa diubah.
5. **Cara kirim**: antar ke rumah / ambil di drop point. Jangan tampilkan nominal/label harga Mitra di layar ini; info harga Mitra drop point hanya di checkout (P-28).
6. **Nama grup** (bisa diubah, default "Grup {nama depan}").
7. **Pembayaran**: dilunasi di awal via VA/QRIS (bisa dipotong loyalty point, G-03), batas 60 menit; peringatan "Bila ada anggota belum lunas dalam 60 menit, seluruh grup batal" (F-29). Pilihan pembuat grup bayar semua / tiap anggota bayar sendiri menunggu **G-06**.
8. Tombol besar hijau di bawah: **"Buat Grup & Bagikan"** → langsung membuka lembar bagikan (R9).

Pesan bagikan default (bisa diubah pengguna):
> Yuk ikut Belanja Bareng di Grup {nama} di NEKAT! Grup tutup {jam}. {link}

Harga per pcs tidak dimasukkan ke pesan karena keranjang grup bisa campur produk (G-01) dan harga ditentukan kuantitas, bukan jumlah orang; harga tampil di halaman grup, sama persis dengan kartu produk (CLAUDE.md).

## 4. Keputusan terkait (issue #5)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| G-01 | Satu grup berisi satu produk atau satu keranjang banyak produk? | — | **DIPUTUSKAN 12 Nov: grup per keranjang, bisa campur produk (issue #5)**. Revisi flow T-002 & model data T-004 lewat T-047; cara hitung tingkat harga per produk menunggu K-09 |
| G-02 | Fitur "Grup yang bisa diundang" (simpan daftar tetangga/grup lama) | Fase 1 / Fase 2 | Fase 2 (setelah pilot) |
| F-30 | Minimum Rp100.000 per akun atau total grup? | per akun / total grup | **Total grup + min. 1 barang per akun**, sama seperti referensi Grab |
