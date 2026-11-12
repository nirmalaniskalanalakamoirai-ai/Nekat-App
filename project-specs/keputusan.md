# Keputusan bisnis (ditetapkan pemilik, 10 Nov 2026)

Agen WAJIB mengikuti keputusan ini. Perubahan hanya oleh manusia.

## 1. Model pendapatan — DIPUTUSKAN
Closed ecosystem: hanya NEKAT yang menjual. Tidak ada penjual luar, komisi, atau listing fee.

## 2. Pembayaran & COD — DIPUTUSKAN
- Default: **bayar di muka** (Xendit).
- COD hanya untuk pengguna yang **lolos evaluasi KPI mingguan 3 minggu berturut-turut**.
- Batas COD: **maksimal Rp500.000 per pesanan**.
- Evaluasi otomatis setiap minggu; gagal 1 minggu → status COD dicabut dan hitungan 3 minggu mulai lagi.
- KPI usulan (nilai bisa diubah admin, belum final):
  - minimal 2 pesanan selesai per minggu,
  - tingkat sukses pesanan ≥ 95%,
  - 0 penolakan barang saat diantar,
  - 0 pembatalan setelah barang dikirim.
- Admin bisa mencabut COD manual dengan alasan tercatat.

## 3. Group order — DIPUTUSKAN
- Grup baru **terbuka** jika minimal **3 akun berbeda** ikut. Di bawah 3 akun, harga grup tidak berlaku.
- Setiap grup punya **link unik** (contoh: `nekat.id/g/AB12CD`).
- Klik link: jika aplikasi terpasang → langsung buka halaman grup; jika belum → halaman install, lalu setelah install kembali otomatis ke grup yang sama (deferred deep link). Untuk PWA: buka halaman grup di browser + ajakan "Tambah ke layar utama".
- Akun dihitung unik per nomor HP terverifikasi OTP (cegah satu orang banyak akun).
- Pengguna wajib menyetujui S&K dan Kebijakan Privasi sebelum bergabung (lihat `docs/legal/`).

## 4. Ongkir & diskon — DIPUTUSKAN (dibuat sebagai opsi yang diatur admin)
Semua angka diatur admin di panel, tidak di-hardcode. Opsi:
- **Kirim ke rumah**: ongkir = tarif dasar armada + (berat kg × tarif/kg) + (jarak km × tarif/km).
- **Armada**: motor / tossa / pickup, masing-masing punya kapasitas kg, tarif dasar, tarif per km; sistem memilih armada terkecil yang cukup.
- **Ambil di drop point**: ongkir ke rumah 0; pesanan yang dikumpulkan di drop point dihitung sebagai **pesanan tingkat Mitra** (harga mengikuti level Mitra bila total memenuhi syarat).
- **Gratis ongkir**: aturan opsional (minimal belanja, zona, periode, level member).
- **Diskon**: aturan opsional (% atau nominal, per produk/kategori/level/periode, kuota).
- Pagar: diskon + gratis ongkir tidak boleh membuat harga akhir di bawah harga modal; sistem menolak dan memberi peringatan.

## 5. Zona pilot — DIPUTUSKAN
- Radius **2–3 km, skala kelurahan, dari drop point**.
- Gudang/toko pusat: https://maps.app.goo.gl/ndmvgK8wARYJbabZ7 (koordinat diisi Joseph di `config/lokasi.json`; link tidak bisa dibuka otomatis).

## 6. Margin & harga — KOSONG, DIISI PEMILIK
Agen TIDAK BOLEH mengisi persentase margin atau harga produk. Sediakan field kosong di panel admin & import CSV. Produk tanpa harga tidak boleh tayang.

## 7. Rokok & bir — DIPUTUSKAN
Tidak dijual di Fase 1. Masuk paling cepat Fase 3 setelah verifikasi umur (KTP, 21+) dan izin beres. Dilarang jual rokok per batang (PP 28/2024 Pasal 434).

## 8. Integrasi dengan Gudang — DIPUTUSKAN
NEKAT berdiri sendiri (repo & database sendiri) dan menyediakan **modul integrasi** ke sistem Gudang (Gudang-Repo):
- Interface `InventorySource` dengan dua implementasi: `LocalInventory` (default) dan `GudangApiInventory`.
- Data yang disinkron: SKU, stok tersedia, harga modal; arah balik: pesanan terkonfirmasi → permintaan picking ke Gudang.
- Integrasi bisa dinyalakan/dimatikan lewat konfigurasi.

## 9. Payment gateway — DIPUTUSKAN
**Xendit**: QRIS, Virtual Account, e-wallet. Webhook untuk status bayar, refund/selisih harga masuk saldo pengguna.

## 10. Tech stack (ADR-0001) — DIPUTUSKAN 11 Nov 2026
- **H1:** stack inti **TypeScript/Node.js + Fastify + PostgreSQL + React PWA** (Opsi A di `docs/adr/0001-tech-stack.md`), sesuai rekomendasi agen. Laravel tidak dipakai.
- **H10:** ADR-0001 **diterima**; PR #1 di-merge 11 Nov 2026. Task kode yang tergantung T-001 boleh dikerjakan.
- Butir H2–H9, H11–H14 tetap terbuka (default sementara di ADR §9 berlaku sampai diputuskan).

## 11. Jawaban issue keputusan — DIPUTUSKAN 12 Nov 2026
Sumber: komentar di issue #5 (Randy), #6 (Efan), #7 (Joseph). Riwayat di `keputusan-terbuka.md`.

**Group order & pembayaran**
- **F-01:** grup dilunasi di awal memakai Virtual Account atau QRIS. **P-04:** masuk/membuat grup tanpa bayar. (Batas pelunasan masih dibuka sebagai F-29.)
- **F-02:** grup gagal (<3 akun) → harga satuan, dan pesanan tidak bisa diproses/terkunci.
- **F-06:** tidak ada batas kuantitas per akun; 1 grup minimal 3 akun dengan minimum pembelian Rp100.000 (per akun/per grup dibuka sebagai F-30).
- **F-08:** harga modal di-snapshot saat grup dibuka.
- **F-09:** stok parsial mengikuti default dokumen T-002 §12.
- **F-11:** keterlambatan bayar memakai `paid_at` dari Xendit; waktu webhook tetap disimpan.
- **F-12:** drop point & antar rumah dalam satu grup.
- **F-20:** ketersediaan barang dicek dulu di gudang/toko cabang penerima pesanan sebelum pesanan diterima/diproses; ongkir berlaku setelah terkunci; dibayar di muka.
- **F-26:** batas bayar (TTL invoice) 60 menit.
- **F-29:** ikut/buat grup tanpa bayar; batas pelunasan 60 menit; bila belum lunas, group order dibatalkan dan tercatat di riwayat sebagai "batal".
- **G-05:** biaya admin flat (Rupiah) per pesanan; nilai dikosongkan, diinput admin nanti.

**Harga** (agen tetap tidak mengisi angka harga/margin)
- **#1:** data produk diserahkan Efan sebagai 3 file CSV (issue #6) untuk import (T-038).
- **P-01:** margin per produk dalam persen (tidak sama tiap produk); admin bisa input persen **atau** harga jual rupiah secara manual.
- **H6 / P-02:** tidak ada pembulatan rupiah.
- **P-03 / F-04:** price level berdasarkan satuan kuantitas: 1 pcs, 3 pcs, lusin, dus, koli; tiap produk memilih satuan yang tersedia. Minimum kuantitas Mitra berbeda per barang.
- **P-05:** tingkatan harga paling bawah bernama **"grosir"**; syarat kuantitasnya diatur per produk.
- **P-22:** pagar KETAT saja (individu ≥ Mitra ≥ Franchise), tanpa pemeriksaan per tier.
- **P-25:** modal boleh ditimpa dari panel/CSV saat mode Gudang.
- **P-28:** info harga Mitra drop point hanya di checkout (kartu = detail).

**Teknis & operasional**
- **#3 koordinat** dan **#6 domain:** diisi setelah aplikasi jadi (tetap dari konfigurasi).
- **#4 tarif ongkir:** akan diintegrasikan dengan aplikasi eksternal.
- **H2:** gateway WhatsApp jalur resmi Meta (Cloud API/BSP resmi).
- **H3:** 1 VPS + PostgreSQL terkelola.
- **H4:** n8n hanya di tepi (tanpa PII), host terpisah dari DB production.
- **H7:** semua akun atas nama badan usaha, min. 2 admin dengan 2FA.
- **H8:** error tracking SaaS dengan penyamaran data pribadi.
- **H9:** login admin cukup OTP WA (tanpa TOTP).
- **H14:** API Gudang tidak bisa dihubungi → tahan checkout. **P-10:** batas usia data modal 15 menit.
- **H15:** Node 22 sekarang; bump ke Active LTS di T-045 sebelum pilot.
