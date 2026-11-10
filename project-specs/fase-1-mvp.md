# Spesifikasi Fase 1 — MVP pilot individu (2 minggu)

## Tujuan
Pembeli individu di 1 zona bisa belanja dengan group order dan barang terkirim di slot harian.
Selesai jika: 50 rumah tangga aktif, minimal 1 grup tercapai per hari.

## Fitur wajib
1. Pilih lokasi/zona tanpa login; login OTP WhatsApp saat checkout.
2. Katalog: kategori + subkategori (tab dengan jumlah produk), pencarian, tombol + cepat.
3. Kartu produk: harga coret + harga aktif, progress grup "X/Y di zona kamu · Z lagi → harga".
4. Detail produk: pilih satuan jual (1 pcs, grup 6+, grup 12+), progress grup, tombol "Ikut grup", tombol "Ajak tetangga via WhatsApp".
5. Group order: grup = produk × zona × slot kirim; grup aktif jika minimal 3 akun berbeda (OTP); tiap grup punya link unik + deep link (buka app / install lalu kembali ke grup; PWA: buka web + ajakan install); MOQ per tier diatur admin; cut-off; harga dikunci saat tutup; selisih kembali sebagai saldo. Persetujuan S&K + Privasi wajib sebelum ikut grup (`docs/legal/`).
6. Checkout: pilih slot kirim (antar rumah / ambil di drop point), bayar di muka via Xendit (QRIS / VA / e-wallet). COD hanya untuk pengguna lolos KPI 3 minggu berturut-turut, maks Rp500.000. Ongkir dihitung dari berat, jarak, armada sesuai tarif yang diatur admin; drop point = pesanan tingkat Mitra.
7. Status pesanan + notifikasi WhatsApp: konfirmasi, pengingat cut-off, "kurang X orang", dikirim, diterima.
8. Panel admin: produk (bulk import CSV), harga & margin per tier (field KOSONG, diisi pemilik), stok, grup aktif, pesanan, tarif ongkir & armada, aturan diskon/gratis ongkir, KPI COD.
10. Modul integrasi Gudang (`InventorySource`: lokal / API Gudang), bisa dinyalakan via konfigurasi.
11. Job mingguan evaluasi KPI COD.
9. Job otomatis setelah cut-off: daftar picking gudang, daftar antar per slot, laporan harian ke owner.

## Di luar Fase 1
Mitra Grosir, Franchise, tempo, multi-gudang, aplikasi native.

## Keputusan yang menunggu manusia
Keputusan final ada di `keputusan.md`. Sisa yang belum diputuskan ada di `keputusan-terbuka.md`.
