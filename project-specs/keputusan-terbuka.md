# Keputusan terbuka (diisi manusia)

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| 1 | Persentase margin & harga tiap produk (diisi lewat panel/CSV) | Efan | **DIPUTUSKAN 12 Nov: data produk dilampirkan sebagai 3 file CSV (produk 1–1000, 1001–2000, 2001–3000) di komentar issue #6; diproses lewat import CSV (T-038) (issue #6)** |
| 2 | Nilai final KPI COD (usulan ada di keputusan.md #2) | Randy | **DIPUTUSKAN 18 Nov: setuju — nilai KPI COD final = usulan di keputusan.md #2 (issue #5)** |
| 3 | Koordinat gudang pusat & titik drop point pertama | Joseph | **DIPUTUSKAN 12 Nov: akan diisi kemudian setelah aplikasi jadi (issue #7)** |
| 4 | Tarif ongkir: per kg, per km, tarif dasar tiap armada | Efan | **DIPUTUSKAN 12 Nov: nanti diintegrasikan dengan aplikasi eksternal (tarif tidak diisi manual sekarang) (issue #6)** |
| 5 | Nama badan usaha, kontak, dan bagian [kurung siku] di docs/legal | Randy | belum |
| 6 | Domain aplikasi (contoh nekat.id) | Joseph | **DIPUTUSKAN 12 Nov: belum ada, akan diinput ketika aplikasi jadi (issue #7)** |

Catatan: bagian di bawah ditambahkan oleh sesi Build otomatis 10–11 Nov 2026. Detail opsi, rekomendasi, dan DEFAULT SEMENTARA ada di dokumen sumber: PR #1 (T-001), PR #2 (T-002), PR #3 (T-003). Isi kolom Status dengan jawaban, atau tulis keputusan di `keputusan.md`.

## Dari ADR-0001 (T-001) — `docs/adr/0001-tech-stack.md` bagian 9

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| H1 | Setujui stack inti TypeScript/Node + Fastify + PostgreSQL + React PWA (vs Laravel) | Joseph | **DIPUTUSKAN 11 Nov: setuju Opsi A (TypeScript), sesuai rekomendasi** → `keputusan.md` #10 |
| H2 | Gateway WhatsApp untuk OTP & notifikasi (Meta Cloud API / BSP resmi / tidak resmi), SMS sebagai cadangan? Verifikasi Meta tergantung #5 | Joseph + Randy | **DIPUTUSKAN 12 Nov: setuju rekomendasi: jalur resmi Meta (Cloud API/BSP resmi) (issue #7)** |
| H3 | Penyedia hosting & PostgreSQL self-managed vs managed (kelas biaya) | Joseph (+ Finance) | **DIPUTUSKAN 12 Nov: setuju rekomendasi: 1 VPS + PostgreSQL terkelola (issue #7)** |
| H4 | Peran n8n: laporan/tepi saja, atau juga boleh memicu job; lokasi hosting n8n | Joseph | **DIPUTUSKAN 12 Nov: setuju rekomendasi: n8n hanya di tepi (tanpa PII), host terpisah dari DB production (issue #7)** |
| H5 | Saldo bisa ditarik / refund ke metode asal atau tidak; perlu tinjauan hukum (aturan uang elektronik BI) | Randy (+ hukum) | **DIPUTUSKAN 18 Nov: setuju — minta pendapat hukum (aturan uang elektronik BI) sebelum fitur pencairan dibuka (issue #5)** |
| H6 | Aturan pembulatan rupiah (termasuk modal per satuan hasil bagi karton), tidak pernah di bawah modal | Efan | **DIPUTUSKAN 12 Nov: tidak boleh ada pembulatan rupiah (issue #6)** |
| H7 | Kepemilikan akun (GitHub org + paket GitHub untuk gerbang production, Xendit, hosting, domain, Meta Business, secret store), min. 2 admin | Joseph + Randy | **DIPUTUSKAN 12 Nov: setuju rekomendasi: semua akun atas nama badan usaha, min. 2 admin dengan 2FA (issue #7)** |
| H8 | Error tracking & log: SaaS vs self-host (masking PII) | Joseph | **DIPUTUSKAN 12 Nov: pakai SaaS (dengan penyamaran data pribadi) (issue #7)** |
| H9 | Login admin: wajib TOTP atau cukup OTP WA | Joseph | **DIPUTUSKAN ulang 12 Nov malam: tidak hanya OTP WA → admin wajib TOTP (rekomendasi ADR §9); menggantikan jawaban "cukup OTP WA" (lihat K-04)** |
| H10 | Terima ADR-0001 (merge PR T-001) — membuka semua task kode | Joseph | **DIPUTUSKAN 11 Nov: diterima, PR #1 di-merge** → `keputusan.md` #10 |
| H11 | (Fase 5) Deferred deep link iOS: layanan pihak ketiga vs fallback kode manual (selisih dengan keputusan #3) | Randy + Joseph | **DIPUTUSKAN 18 Nov: setuju — Fase 1 cukup link web + ajakan install; deferred deep link iOS ditunda ke Fase 5 (issue #5)** |
| H12 | Lokasi penyimpanan data (region Indonesia atau luar negeri) + isian "[lokasi]" di kebijakan privasi | Randy + Joseph (+ hukum) | belum — 18 Nov Randy: "serahkan pada keputusan Joseph" → dipindah ke issue #7 |
| H13 | Cara kurir lokal & drop point menerima data antar (Fase 1: daftar antar dari admin, tanpa akun kurir?) | Randy (+ Operations) | **DIPUTUSKAN 18 Nov: setuju — Fase 1 daftar antar per slot dibagikan admin, tanpa akun kurir; nanti akun kurir diintegrasikan dengan pihak ketiga (16 Nov) (issue #5)** |
| H14 | Stok saat API Gudang tidak bisa dihubungi: tetap jual dengan snapshot di bawah batas umur (P-10) atau tahan checkout | Joseph + Efan | **DIPUTUSKAN 12 Nov: tahan checkout (issue #7)** |
| H15 | Versi Node: ADR minta Active LTS terbaru, scaffold T-012 dipin Node 22 (Maintenance LTS, EOL ±Apr 2027) karena hanya itu yang bisa diuji. Rekomendasi: terima 22 sekarang, bump ke Active LTS di T-045 sebelum pilot (PR #8, issue #7) | Joseph | **DIPUTUSKAN 12 Nov: setuju usulan: Node 22 sekarang, bump ke Active LTS di T-045 sebelum pilot (issue #7)** |

## Dari peta flow group order (T-002) — `docs/flow/group-order.md` §12

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| F-01 | Harga apa yang dibayar di muka saat ikut grup, dan bagaimana bila harga final lebih tinggi (paling mendesak; terkait S&K §4.5) | Efan + Randy | **DIPUTUSKAN 12 Nov: jika grup, pelunasan di awal memakai Virtual Account atau QRIS (issue #6)** |
| F-02 | Grup gagal (<3 akun): pilihan lanjut harga satuan atau refund, dan default bila pengguna diam | Randy | **DIPUTUSKAN 12 Nov: harga satuan, dan pesanan tidak bisa diproses atau terkunci (issue #5)** |
| F-03 | Tafsiran keputusan #9: apakah SEMUA refund & selisih masuk saldo (default dokumen), selaras S&K §7.1; saldo bisa dicairkan? (= H5) | Randy + Joseph | **DIPUTUSKAN 18 Nov: ya — semua refund & selisih masuk saldo (= loyalty point, K-13) (issue #5)** |
| F-04 | Satuan MOQ tier (total pcs di grup atau pcs per orang); ada harga grup dasar sebelum 6+? | Efan | **DIPUTUSKAN 12 Nov: minimum kuantitas untuk Mitra berbeda untuk setiap barang (issue #6)** |
| F-05 | Siapa yang dihitung ke 3 akun (hanya yang lunas?) dan perlakuan peserta COD | Randy | **DIPUTUSKAN 18 Nov: setuju — alur: gabung lewat link undangan host → pilih pesanan; tagihan terbit bila ≥3 akun, tiap akun ≥1 barang, dan minimum qty atau total ≥ Rp100.000; harga di tagihan sudah final (termasuk biaya lain); grup wajib bayar lewat aplikasi, COD hanya pesanan retail/individu sesuai syarat; pesanan diproses bila semua akun lunas (bayar sendiri) atau host lunas (host bayar semua) (issue #5, 16 & 18 Nov)** |
| F-06 | Batas kuantitas per akun per grup | Efan | **DIPUTUSKAN 12 Nov: tidak ada batas kuantitas per akun; 1 grup minimal 3 akun dengan minimum pembelian Rp100.000 (issue #6)** |
| F-07 | Batas akhir pembatalan setelah bayar; boleh kurangi kuantitas sebagian? admin boleh memajukan cut-off? | Randy | **DIPUTUSKAN 18 Nov: tidak bisa batal setelah bayar (pesanan sudah masuk fase diproses); bayar sendiri: akun yang belum lunas 60 menit sejak tagihan terbit dikeluarkan, dana yang sudah dibayar (bila grup batal) masuk loyalty point (16 Nov) (issue #5)** — bertentangan dengan K-30 → K-40 |
| F-08 | Harga modal berubah saat grup berjalan (snapshot saat grup dibuka atau tahan grup); MOQ di-snapshot per grup? | Efan | **DIPUTUSKAN 12 Nov: ya, snapshot saat grup dibuka (issue #6)** |
| F-09 | Stok parsial: urutan alokasi, harga tetap terkunci, dan bila tersisa <3 akun | Efan | **DIPUTUSKAN 12 Nov: setuju default dokumen (PR #2 §12) (issue #6)** |
| F-10 | Dana akun ganda/curang & evaluasi ulang grup | Randy | belum |
| F-11 | Basis waktu pembayaran terlambat: `paid_at` gateway atau waktu webhook diterima | Joseph | **DIPUTUSKAN 12 Nov: setuju rekomendasi: waktu bayar dari Xendit (paid_at); kedua waktu tetap disimpan (issue #7)** |
| F-12 | Drop point & antar rumah dalam satu grup atau terpisah (interaksi harga Mitra) | Efan | **DIPUTUSKAN 12 Nov: satu grup (drop point & antar rumah digabung) (issue #6)** |
| F-13 | Grup yang masih DITAHAN saat cut-off | Randy | belum |
| F-14 | Satu grup atau beberapa per produk × zona × slot | Randy | belum |
| F-15 | Istilah resmi ≥3 akun: "terbuka" (keputusan #3) atau "aktif" (S&K §4.2) | Randy | belum |
| F-16 | Boleh ikut produk yang sama di slot berbeda | Randy | belum |
| F-17 | Penerima pengingat (termasuk yang belum bayar?) & batas frekuensi WhatsApp | Randy | belum |
| F-18 | Daftar tunggu untuk pengguna di luar semua zona | Randy + Efan | belum |
| F-19 | Pengguna zona lain membuka link grup | Randy | belum |
| F-20 | Ongkir saat sebagian baris pesanan batal / grup gagal / alokasi parsial | Efan + Operations | **DIPUTUSKAN 12 Nov: gudang/toko cabang yang terpilih sebagai penerima pesanan dicek dulu ketersediaan barangnya sebelum pesanan diterima/diproses; ongkir baru diberlakukan setelah terkunci; dibayar di muka (issue #6)** |
| F-21 | Slot kirim dibatalkan karena operasional setelah harga dikunci | Randy + Operations | belum |
| F-22 | Atribusi pengundang (parameter ref) pada link grup | Randy + Growth | belum |
| F-23 | Versi S&K / Kebijakan Privasi berubah: wajib persetujuan ulang? | Randy | belum |
| F-24 | Keluhan barang rusak/kurang setelah diterima | Randy | belum |
| F-25 | Ganti alamat/zona setelah ikut grup | Randy + Operations | belum |
| F-26 | Lama batas bayar (TTL invoice Xendit) per metode | Randy + Joseph | **DIPUTUSKAN 12 Nov: 60 menit (issue #5)** |
| F-27 | Ada/tidaknya jalur "beli biasa" di luar grup | Randy | belum |
| F-28 | Barang di drop point tidak diambil: status akhir peserta/grup dan perlakuan dana (refund ke saldo, biaya simpan, batas hari) — terkait T-006 (sesi QA 11 Nov) | Randy + Operations | belum |

## Dari spesifikasi engine harga (T-003) — `docs/spec/engine-harga.md` §11

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| P-01 | Margin persen atau nominal; per produk atau per level; presisi persen | Efan | **DIPUTUSKAN 12 Nov: persen tidak sama tiap produk; sediakan input manual dalam persen DAN harga jual dalam rupiah (issue #6)** |
| P-02 | Mode pembulatan & kelipatan K (= H6) | Efan | **DIPUTUSKAN 12 Nov: mengikuti H6: tanpa pembulatan (issue #6)** |
| P-03 | Tier 6+/12+ dihitung per unit atau per akun; pembeli 1 pcs dihitung? (= F-04) | Efan + Randy | **DIPUTUSKAN 12 Nov: price level berdasarkan satuan kuantitas: 1 pcs, 3 pcs, lusin, dus, koli; tiap produk bisa memilih satuan yang tersedia (issue #6)** |
| P-04 | Harga yang dibayar saat ikut grup (= F-01) | Efan + Joseph | **DIPUTUSKAN 12 Nov: masuk/membuat grup tanpa bayar (lihat klarifikasi F-29) (issue #6)** |
| P-05 | Syarat "total memenuhi syarat" untuk harga Mitra di drop point — **WAJIB diisi sebelum pilot** (tanpa ini drop point tidak pernah dapat harga Mitra) | Efan + Operations | **DIPUTUSKAN 12 Nov: buat tingkatan harga paling bawah dengan istilah "grosir"; kuantitasnya disesuaikan per produk (issue #6)** |
| P-06 | Margin Mitra wajib diisi agar produk tayang? | Efan | **DIPUTUSKAN 13 Nov: setuju default dokumen: margin Mitra tidak wajib agar produk tayang (`mitra_wajib_untuk_tayang = false`) (issue #6)** |
| P-07 | Promo yang melanggar modal: tidak diterapkan atau dibatasi sampai modal | Efan | **DIPUTUSKAN 13 Nov: batas bawah 5% margin (promo dibatasi, margin tidak boleh di bawah 5%) (issue #6)** — basis 5% lihat K-16 |
| P-08 | Harga grup LIVE (ikut modal terkini) atau DIBEKUKAN sejak grup dibuka; ambang margin menipis (= F-08) | Efan | **DIPUTUSKAN 13 Nov: harga di-snapshot ketika sudah jadi invoice; bila stok habis invoice dibatalkan; barang yang hanya dimasukkan keranjang tidak memotong stok (issue #6)** — hubungan dengan F-08 lihat K-15 |
| P-09 | Tindakan bila modal saat cut-off melewati harga dibayar peserta | Efan + Randy | **DIPUTUSKAN 14 Nov: setuju rekomendasi A — grup DITAHAN untuk keputusan admin, tidak pernah jual di bawah modal (issue #6)** |
| P-10 | Batas usia data modal dari Gudang | Joseph + Efan | **DIPUTUSKAN 12 Nov: 15 menit (issue #7)** |
| P-11 | Sel CSV kosong pada produk lama: biarkan atau hapus | Efan + Joseph | **DIPUTUSKAN 14 Nov: biarkan (sel kosong = nilai tersimpan tidak berubah; tafsiran agen sesuai rekomendasi) (issue #6)** — tambahan jawaban soal stok habis → K-20 |
| P-12 | Pembulatan berat/jarak ongkir; tarif per kg global atau per armada | Efan + Operations | **DIPUTUSKAN 14 Nov: menunggu/mengikuti aplikasi eksternal ongkir (#4, K-05); engine harga hanya menerima ongkir jadi (issue #6)** |
| P-13 | Minimal belanja gratis ongkir dihitung sebelum atau sesudah diskon | Efan | **DIPUTUSKAN 14 Nov: sesudah diskon (issue #6)** |
| P-14 | Perlu pagar harga antar kemasan (dus vs pcs)? | Efan | **DIPUTUSKAN 16 Nov: perlu — pagar harga antar kemasan (dus vs pcs) diterapkan (issue #6)** |
| P-15 | Pembulatan diskon persen; boleh diskon menumpuk? | Efan | **DIPUTUSKAN 14 Nov: diskon tidak boleh menumpuk; diskon dihitung secara keseluruhan (issue #6)**; pembulatan mengikuti H6 (tanpa pembulatan) — arti "keseluruhan" lihat K-21 |
| P-16 | Margin nol diizinkan? | Efan | **DIPUTUSKAN 14 Nov: tidak — diskon/harga tidak boleh membuat margin 0; bila perlu, kekurangan dimasukkan sebagai biaya admin (issue #6)** |
| P-17 | Harga coret = harga 1 pcs riil? | Randy + Efan | belum |
| P-18 | Batas COD dibandingkan dengan total sebelum atau sesudah saldo | Randy + Joseph | belum |
| P-19 | Siapa menanggung bila harga final > harga dibayar tapi masih ≥ modal | Efan + Randy | **DIPUTUSKAN 18 Nov: pembeli tidak pernah ditagih tambahan — pembeli hanya bisa bayar setelah harga final; tagihan = harga final + biaya + ongkir; perubahan harga saat tagihan terbit tidak memengaruhi tagihan itu; selisih ditanggung NEKAT selama harga ≥ modal + ongkir (Efan 16 Nov) (issue #5, #6)** |
| P-20 | Cara alokasi subsidi gratis ongkir ke baris pesanan untuk pagar modal | Efan + Joseph | **DIPUTUSKAN 16 Nov: setuju — subsidi gratis ongkir dibagi ke baris menurut harga barang (issue #6)** |
| P-21 | Tier grup (mis. 12+) boleh opsional per produk? | Efan | **DIPUTUSKAN 16 Nov: setuju — tier grup boleh dipilih per produk oleh admin; harga satuan wajib ada (issue #6)** |
| P-22 | Cakupan pagar "individu ≥ Mitra ≥ Franchise": pagar KETAT wajib (CLAUDE.md); yang diputuskan hanya apakah ditambah pemeriksaan per tier (`KETAT_PLUS_PER_TIER`). Opsi "per tier saja" dihapus di sesi QA 11 Nov karena melanggar CLAUDE.md | Efan | **DIPUTUSKAN 12 Nov: pagar KETAT (default), tanpa pemeriksaan per tier (issue #6)** |
| P-23 | Promo saat checkout lalu harga turun di cut-off: batasi kredit selisih agar bersih ≥ modal? | Efan + Randy | **DIPUTUSKAN 14 Nov: ya, dibatasi (A), dengan keterangan tambahan sebagai biaya admin (issue #6)** |
| P-24 | Cakupan kategori terlarang Fase 1 (hanya rokok & bir, atau semua tembakau/nikotin & alkohol) | Randy | belum |
| P-25 | Modal saat mode Gudang: boleh ditimpa dari panel/CSV? | Joseph + Efan | **DIPUTUSKAN 12 Nov: boleh (issue #7)** |
| P-26 | Grup DITAHAN bila nilai bersih setelah promo & subsidi ongkir < modal saat cut-off (perluasan P-09) | Efan + Randy | **DIPUTUSKAN 14 Nov: setuju rekomendasi A (issue #6)** |
| P-27 | Satu baris gagal pagar modal saat gratis ongkir: batalkan gratis ongkir seluruh pesanan? | Efan | **DIPUTUSKAN 14 Nov: jangan langsung dibatalkan; tampilkan keterangan "tidak memenuhi syarat" beserta alasannya dan rekomendasi jalan keluar agar pembeli bisa meneruskan pesanan grup (issue #6)** |
| P-28 | Halaman detail menampilkan info "Ambil di drop point: Rp{harga Mitra}" yang tidak ada di kartu? A) boleh sebagai info terpisah; B) hanya di checkout (DEFAULT SEMENTARA, patuh "harga kartu = detail"); C) di kartu & detail (sesi QA 11 Nov) | Randy + Efan | **DIPUTUSKAN 12 Nov: B — info harga Mitra drop point hanya di checkout (issue #5)** |

## Baru dari sesi Build 12 Nov (setelah jawaban issue)

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| F-29 | Klarifikasi F-01 vs P-04: ikut/buat grup tanpa bayar (P-04), tetapi grup wajib lunas di awal via VA/QRIS (F-01). Kapan batas pelunasan, dan apakah yang belum lunas dihitung ke 3 akun & Rp100.000? Rekomendasi: ikut tanpa bayar; pelunasan wajib dalam TTL invoice 60 menit (F-26) dan paling lambat sebelum cut-off; hanya peserta lunas yang dihitung | Efan + Randy | **DIPUTUSKAN 12 Nov: batas pelunasan 60 menit; bila belum lunas, group order dibatalkan dan tercatat di riwayat sebagai "batal" (issue #5)** |
| F-30 | Minimum pembelian Rp100.000 (F-06): per akun atau total grup? Rekomendasi: per akun per grup | Efan | **DIPUTUSKAN 13 Nov: total grup (issue #6)** |
| G-01 | Grup per produk atau per keranjang banyak produk (referensi Grab/Shopee, PR #10) | Randy | **DIPUTUSKAN 12 Nov: grup per keranjang, bisa campur produk (issue #5)** |
| G-02 | Daftar grup/tetangga tersimpan untuk diundang | Randy | **DIPUTUSKAN 18 Nov: setuju — Fase 2 (issue #5)** |
| G-03 | Cara bayar grup (jawaban 12 Nov issue #5): opsi 1 host pembuka grup bayar untuk semua, opsi 2 tiap akun bayar pesanannya. Perlu diputuskan: bila host bayar semua, selisih harga/refund masuk saldo siapa, dan apakah 3 akun tetap dihitung dari akun yang menambah pesanan? | Randy + Efan | **DIPUTUSKAN 12 Nov: selisih/refund masuk ke sistem loyalty point senilai Rupiah; loyalty point menjadi salah satu opsi pembayaran di checkout, bisa dikombinasikan dengan pembayaran lain (nominal dipotong poin, sisanya dilunasi metode lain) (issue #5)**. Rinciannya lihat G-06 |
| G-04 | PPN (jawaban 12 Nov: "sesuaikan kebijakan nasional"). Tarif 2026: 12% × DPP 11/12 (efektif 11%) untuk barang non-mewah; sebagian bahan pokok dibebaskan PPN. Perlu: status PKP badan usaha, harga tampil sudah termasuk PPN atau ditambahkan di checkout, tanda bebas PPN per produk | Efan (+ konsultan pajak) | **DIPUTUSKAN 13 Nov: setuju rekomendasi: tarif & DPP dari konfigurasi (tidak di-hardcode), flag "bebas PPN" per produk, harga tampil sudah termasuk PPN, rincian PPN di checkout/nota (issue #6)** |
| G-05 | Biaya admin flat (Rupiah) per pesanan: field kosong, diisi admin nanti (jawaban 12 Nov issue #5) | Efan | **DIPUTUSKAN 12 Nov: biaya admin flat Rupiah, nilai dikosongkan dan diinput admin nanti (issue #5)** |
| G-06 | Klarifikasi G-03 (baru 13 Nov): (a) loyalty point = saldo ledger yang sama (T-021, 1 poin = Rp1) atau sistem terpisah? (b) bila host bayar semua (opsi 1), poin selisih/refund masuk ke akun siapa? (c) poin punya masa berlaku? (d) poin bisa dicairkan (terkait H5)? | Randy + Efan | **DIPUTUSKAN 13 Nov: (a) loyalty point = saldo ledger yang sama, 1 poin = Rp1, tanpa pembulatan; (b) bila host bayar semua, poin ke akun host/pembayar; (c) tanpa masa berlaku; (d) bisa dicairkan ke rekening bank, virtual account, atau e-wallet (ShopeePay, GoPay, DANA, dsb.) (issue #5 & #6)** — lihat catatan H5 |
| G-07 | Sisa G-03 (baru 13 Nov, QA): jawaban G-03 menentukan ke mana selisih/refund (loyalty point) tetapi belum memilih **cara bayar**: (a) pembuat grup bayar semua, tiap akun bayar sendiri, atau keduanya tersedia? (b) bila host bayar semua, apakah syarat 3 akun dihitung dari akun yang menambah barang ke keranjang? | Randy + Efan | **DIPUTUSKAN 13 Nov: (a) Fase 1: tiap akun bayar sendiri; saat invoice tersedia pilihan host yang membayar (issue #5). (b) cara hitung syarat 3 akun bila host bayar: belum, lihat K-17** |
## Klarifikasi dari sesi QA 12 Nov (review PR #4 & PR #9)

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| K-01 | Modal per satuan pecahan (hasil bagi karton/dus) vs H6 "tanpa pembulatan", padahal nominal Xendit integer: simpan modal dengan presisi lebih tinggi, atau modal wajib diinput per satuan jual? | Efan + Joseph | **DIPUTUSKAN 13 Nov: modal diinput manual per satuan jual; modal pecahan → SKU tidak tayang + antrean "perlu ditinjau", tanpa pembulatan (issue #6 & #7)** |
| K-02 | Ambang penurunan modal dari Gudang yang ditahan untuk tinjauan admin (cegah modal salah membuat harga jatuh) | Efan | **DIPUTUSKAN 13 Nov: setuju default: penurunan modal dari Gudang hanya dicatat di log admin (issue #6)** |
| K-03 | Timpaan modal (P-25) berlaku sampai dicabut admin, atau kedaluwarsa bila nilai Gudang berubah? | Joseph + Efan | **DIPUTUSKAN 13 Nov: timpaan modal berlaku sampai dicabut admin; tambah kolom tanggal kedaluwarsa (opsional), dan saat tanggal itu tercapai kirim pemberitahuan otomatis untuk barang tersebut beserta catatannya (issue #6 & #7)** |
| K-04 | Tinjau ulang H9 (admin cukup OTP WA): satu faktor, rawan ambil-alih WA/SIM swap, padahal admin bisa menimpa modal & memproses refund (temuan Security Auditor) | Joseph | **DIPUTUSKAN 12 Nov malam: pemilik setuju admin tidak hanya OTP WA → TOTP wajib (H9 diperbarui di PR #9)** |
| K-05 | #4 "tarif ongkir diintegrasikan aplikasi eksternal": rumus ongkir di `keputusan.md` #4 diganti, atau tetap berlaku dengan tarif dari aplikasi eksternal? | Efan | **DIPUTUSKAN 13 Nov: setuju rekomendasi: rumus ongkir keputusan.md #4 tetap, angka tarif dari adapter aplikasi eksternal (issue #6)** |
| K-06 | G-05 biaya admin flat: per pesanan, per akun per grup, atau per grup? (kata "per pesanan" tambahan agen) | Efan | **DIPUTUSKAN 13 Nov: biaya admin flat per akun per grup (issue #6)** |
| K-07 | F-29 "belum lunas → group order dibatalkan": seluruh grup atau hanya pesanan akun yang belum lunas? 60 menit dihitung sejak akun ikut/membuat grup atau sejak invoice dibuat? | Randy + Efan | **DIPUTUSKAN 12–13 Nov: seluruh grup dibatalkan; 60 menit dihitung sejak invoice diterbitkan (issue #5 & #6)** |
| K-08 | P-05 "tingkatan paling bawah = grosir": apakah ini level **Mitra Grosir** di pagar CLAUDE.md (individu ≥ Mitra Grosir ≥ Franchise)? | Efan | **DIPUTUSKAN 13 Nov: ya, tingkat "grosir" = level Mitra Grosir; urutan pagar individu ≥ Mitra Grosir ≥ Franchise benar (issue #6)** |
| K-09 | P-03/F-04: tingkat harga dihitung dari kuantitas gabungan grup atau per akun? P-01 margin "per produk": tetap per level (individu/Mitra/Franchise) sesuai pagar? | Efan + Randy | **DIPUTUSKAN 13 Nov: dalam pesanan grup, setiap barang langsung mendapat harga termurah dari tingkatan harga meskipun hanya 1 pcs per jenis, dengan syarat minimum Rp100.000 total belanja grup (issue #6)** — hubungan dengan pagar Mitra Grosir lihat K-14 |
| K-10 | F-20 "ongkir berlaku setelah terkunci" vs bayar di muka 60 menit: ongkir ditagih di invoice awal, atau tagihan kedua setelah cut-off? | Randy + Efan | **DIPUTUSKAN 13 Nov: ongkir ditagih di invoice setelah final (bukan di invoice awal) (issue #6)** |
| K-11 | F-02 grup gagal: "harga satuan" atau "pesanan tidak diproses/terkunci"? Bila pengguna tidak memilih, apa default-nya? | Randy | **DIPUTUSKAN 18 Nov: pengguna memilih; default = pesanan dibatalkan; sudah bayar → dana ke loyalty point, belum bayar → hanya dibatalkan (issue #5)** |
| K-12 | (QA 13 Nov, auditor keamanan) F-29 "seluruh grup batal bila ada yang belum lunas" + P-04 ikut tanpa bayar → satu akun bisa sengaja ikut lalu tidak bayar dan membatalkan grup orang lain (griefing murah). Perlu mitigasi? | Randy + Efan | **DIPUTUSKAN 13 Nov: ikut rekomendasi: akun yang tidak melunasi dalam 60 menit dikeluarkan otomatis dari grup; grup batal bila akun lunas < 3 (issue #5)** |
| K-13 | (QA 13 Nov) G-03 "selisih/refund → loyalty point" vs keputusan.md §9 & CLAUDE.md "selisih kembali sebagai saldo": dua istilah untuk hal yang sama atau dua sistem? Sama dengan G-06(a); bila beda, §9 dan CLAUDE.md perlu diselaraskan oleh manusia | Randy + Efan + Joseph | **DIPUTUSKAN 13 Nov: setuju, satu ledger, loyalty point = saldo (issue #5); pencairan mengikuti G-06(d)** |
| K-14 | (13 Nov, dari jawaban K-09) "Harga termurah dari tingkatan harga" untuk pesanan grup ≥ Rp100.000: tingkat termurah **di antara tier grup individu**, atau termasuk tingkat Grosir/Mitra? Bila termasuk Grosir, pagar CLAUDE.md "harga grup individu ≥ Mitra Grosir" jadi sama persis (tidak ada selisih untuk drop point). Juga: grup < Rp100.000 memakai harga apa? | Efan + Randy | **DIPUTUSKAN 13 Nov: harga grup individu = harga Mitra Grosir (kemudahan dapat harga grosir tanpa MOQ) (issue #6, Randy ikut Efan di issue #5)** — pagar ≥ terpenuhi dengan sama; grup < Rp100.000 lihat K-18 |
| K-15 | (13 Nov) F-08 "snapshot saat grup dibuka" vs P-08 "snapshot ketika sudah jadi invoice": mana yang berlaku untuk harga & modal? | Efan | **DIPUTUSKAN 13 Nov: snapshot harga & modal saat invoice (menggantikan F-08) (issue #6)** |
| K-16 | (13 Nov) P-07 "batas bawah 5% margin": 5% dihitung dari modal (harga setelah promo ≥ modal × 1,05) atau dari harga jual? Berlaku juga untuk gratis ongkir (PG-4) dan untuk margin yang diinput admin (P-16)? Nilai disimpan sebagai konfigurasi | Efan | **DIPUTUSKAN 13 Nov: setuju rekomendasi: 5% dari modal, berlaku untuk promo & gratis ongkir, angka di konfigurasi (issue #6)** |
| K-17 | (13 Nov, dari G-07) Bila host memilih membayar semua saat invoice: syarat minimal 3 akun (F-29/K-12) dihitung dari akun yang menambah barang ke keranjang grup, atau cukup host? | Randy + Efan | **DIPUTUSKAN 14 Nov: tetap minimal 3 akun berbeda yang menambah barang; host hanya memilih cara bayar; bila host membayar seluruhnya → invoice langsung disatukan dan QR code dikirim (issue #5 & #6)** |
| K-18 | (13 Nov, dari K-14) Grup dengan total belanja < Rp100.000 (syarat K-09) memakai harga apa? | Efan | **DIPUTUSKAN 14 Nov: pakai harga satuan, tetap sarankan mencari grup; tampilkan perbandingan harga pesan grup vs sendiri (issue #6)** |
| K-19 | (13 Nov, T-045) Staging: penyedia VPS + PostgreSQL terkelola (H3 memilih bentuk, belum penyedia) dan siapa membuat server + secret deploy (SSH deploy key, `DATABASE_URL`, kunci backup) di GitHub Environment `staging` | Joseph (+ Finance) | **DIPUTUSKAN 19 Nov: untuk saat ini tanpa server staging — preview dibuat di Claude dulu; penyedia server/hosting menyusul (issue #7)** |
| K-20 | (14 Nov, dari jawaban P-11) Produk stok habis: tetap tampil dengan label "Stok habis, segera distok" (tombol beli nonaktif), atau disembunyikan seperti di backlog T-025 ("hanya produk berstok")? | Efan + Randy | **DIPUTUSKAN 18 Nov: tampil dengan label "Stok habis, segera distok", tombol beli nonaktif, tidak bisa masuk keranjang/grup (issue #5, #6)** |
| K-21 | (14 Nov, dari jawaban P-15) "Diskon dihitung secara keseluruhan": satu diskon atas total pesanan (lalu dibagi proporsional ke baris untuk cek modal), atau satu diskon per barang? | Efan | **DIPUTUSKAN 16 Nov: satu diskon atas total belanja; dibagi ke tiap barang hanya untuk cek tidak di bawah modal (issue #6)** |
| K-22 | (15 Nov, T-047/T-007) Kapan tagihan (invoice) grup terbit? Bolehkah ikut/menambah barang setelah tagihan terbit? | Randy | **DIPUTUSKAN 18 Nov: host menekan "Terbitkan tagihan" bila semua anggota sudah memenuhi syarat dan menekan "Siap" di keranjangnya; setelah tagihan terbit tidak bisa tambah anggota maupun barang (issue #5)** — tanpa terbit otomatis → K-39 |
| K-23 | (15 Nov, T-047) Dasar hitung minimum Rp100.000 (F-30): harga apa yang dijumlah? | Efan | **DIPUTUSKAN 17 Nov: jumlah harga grup termasuk PPN, sebelum diskon, tanpa biaya admin & ongkir (issue #6)** |
| K-24 | (15 Nov, T-047/T-007) Setelah akun tak lunas dikeluarkan (K-12), akun lunas masih ≥3 tetapi total < Rp100.000: harga apa? | Efan + Randy | **DIPUTUSKAN 18 Nov: harga grup yang sudah dibayar tetap berlaku tanpa tagihan tambahan, asal tidak di bawah modal (Randy; Efan ikut Randy) (issue #5, #6)** |
| K-25 | (15 Nov, T-047/T-004/T-007) K-10 ongkir: tagihan kedua setelah final — bila tagihan ongkir tidak lunas 60 menit, apa akibatnya? | Randy + Efan | **DIPUTUSKAN 18 Nov: ongkir tidak ditagih terpisah — masuk satu tagihan bersama barang saat tagihan terbit (menggantikan K-10); pembeli memilih diantar atau ambil di drop point dengan perbandingan harga; host bayar semua → satu ongkir, bayar sendiri → ongkir dibagi rata (issue #5, #6)** |
| K-26 | (15 Nov, T-004/T-047) Biaya admin flat (K-06): bila host bayar semua tetap dihitung per akun peserta? Masuk tagihan barang atau tagihan ongkir? Ikut dikembalikan bila grup batal? | Efan | **DIPUTUSKAN 17 Nov: per akun peserta; masuk tagihan barang; dikembalikan ke saldo bila grup batal; yang ditampilkan hanya total biaya admin (issue #6)** |
| K-27 | (15 Nov, T-047/T-004) Satuan jual yang harga Mitra Grosir-nya kosong: dalam grup memakai harga satuan? | Efan | **DIPUTUSKAN 16 Nov: setuju — satuan itu memakai harga satuan dan ditandai di panel admin (issue #6)** |
| K-28 | (15 Nov, T-047/T-004) H6 tanpa pembulatan vs hasil pecahan dari margin %, diskon %, rincian PPN. Pagar modal dibanding harga tanpa PPN? | Efan (+ konsultan pajak) + Joseph | **DIPUTUSKAN 17 Nov: setuju rekomendasi — harga pecahan dari margin % → tidak tayang + "perlu ditinjau"; potongan diskon pecahan dibuang; rincian PPN ikut konsultan pajak; cek modal memakai harga tanpa PPN (issue #6, #7)** |
| K-29 | (15 Nov, T-047) Stok habis setelah invoice (P-08): batalkan seluruh invoice atau hanya baris barang itu? | Efan | **DIPUTUSKAN 16 Nov: hanya baris barang itu dibatalkan, nilainya kembali ke saldo; kirim notifikasi ke admin untuk stok ulang (issue #6)** |
| K-30 | (15 Nov, T-047/T-007, F-07) Anggota boleh batal sendiri setelah tagihan terbit? S&K §7.1: batal sebelum cut-off = dana kembali penuh | Randy | belum — 18 Nov Randy "setuju" (boleh batal, dana ke saldo), tetapi F-07 (18 Nov) "tidak bisa batal setelah bayar" → konflik, ditanyakan ulang sebagai K-40 |
| K-31 | (15 Nov, T-047, F-01 vs F-05) COD berlaku di pesanan grup? | Randy | **DIPUTUSKAN 18 Nov: COD tidak berlaku di pesanan grup (issue #5)** |
| K-32 | (15 Nov, T-007) Anggota boleh melihat isi barang anggota lain? | Randy | **DIPUTUSKAN 18 Nov: setuju rekomendasi — anggota tidak melihat isi barang anggota lain; host melihat rincian (nama samaran, tanpa alamat/HP) hanya saat memilih bayar semua (16 Nov sempat usul opsi tampil/sembunyi per anggota) (issue #5)** |
| K-33 | (15 Nov, T-007) Host keluar grup sebelum tagihan terbit | Randy | **DIPUTUSKAN 18 Nov: peran host pindah ke anggota yang masuk grup paling awal setelah host (menggantikan jawaban 16 Nov "grup batal") (issue #5)** |
| K-34 | (15 Nov, T-007/T-004, G-06d) Aturan pencairan saldo: minimal, biaya, limit harian, masa tahan saldo baru, verifikasi | Efan + Joseph | **DIPUTUSKAN 17 Nov: setuju rekomendasi — wajib OTP ulang, rekening/e-wallet atas nama pemilik akun, jeda setelah tujuan baru/ganti HP, saldo baru ditahan, limit harian; angka diisi pemilik; dibuka setelah H5 (issue #6, #7)** |
| K-35 | (15 Nov, T-004) Hapus akun yang saldonya > 0, dan nomor HP sama mendaftar lagi; retensi hash nomor HP (UU PDP) | Randy (+ hukum) | **DIPUTUSKAN 18 Nov: setuju — saldo wajib dicairkan dulu; hash nomor HP disimpan, masa simpan ditetapkan hukum (issue #5)** |
| K-36 | (15 Nov, T-004/T-007) E-wallet boleh untuk tagihan grup? (F-01 menyebut VA atau QRIS) | Randy + Joseph | **DIPUTUSKAN 19 Nov: hanya QRIS/VA dulu; e-wallet menyusul bila kerja sama memungkinkan (issue #5, #7)** |
| K-37 | (15 Nov, T-004) Host bayar semua → tagihan gabungan baru: batas 60 menit mulai ulang atau ikut tagihan tertua? | Randy | **DIPUTUSKAN 18 Nov: setuju — tagihan gabungan ikut batas waktu tagihan paling awal; total = semua pesanan anggota (issue #5)** |
| K-38 | (15 Nov, T-047/T-007) K-14 harga grup = Mitra Grosir vs P-28 (info harga Mitra hanya di checkout): harga Mitra Grosir tampil di kartu sebagai "Harga Belanja Bareng"? | Efan + Randy | **DIPUTUSKAN 18 Nov: ya — kartu & detail menampilkan "Harga Belanja Bareng"; kata "Mitra" & info drop point hanya di checkout (issue #5, #6)** |
| K-39 | (19 Nov, dari K-22) Bila sampai grup tutup host tidak menekan "Terbitkan tagihan" (atau ada anggota yang tidak pernah menekan "Siap"), apa yang terjadi? | Randy | belum — rekomendasi: anggota yang belum "Siap" saat 60 menit sebelum grup tutup dikeluarkan otomatis; bila syarat tetap terpenuhi tagihan terbit otomatis, bila tidak grup batal (K-11) |
| K-40 | (19 Nov) Konflik K-30 vs F-07: K-30 "setuju" (anggota yang sudah bayar boleh batal sebelum grup tutup, dana ke saldo) vs F-07 "tidak bisa batal setelah bayar". Mana yang berlaku? S&K §7.1 perlu disesuaikan | Randy | belum — rekomendasi: ikut F-07 (jawaban terakhir): tidak bisa batal setelah bayar; S&K §7.1 diubah; dana hanya kembali ke saldo bila grup batal / stok habis |
Catatan: tim memakai satu akun GitHub bersama (dikonfirmasi pemilik 12 Nov malam); jawaban dari akun itu sah sebagai jawaban pemilik.



Catatan 13 Nov 02.20 WIB: K-01–K-11 yang masih terbuka kini juga dicantumkan di tabel issue #5/#6/#7 (sebelumnya hanya di file ini).

Catatan 13 Nov 12.20 WIB (sesi Build): 16 jawaban dicatat dari issue #5/#6/#7 (F-30, G-04, G-06, K-01–K-03, K-05–K-10, P-06–P-08); baru: K-14, K-15, K-16.

Catatan 13 Nov 14.20 WIB (sesi Tindak Lanjut): 6 jawaban dicatat dari issue #5/#6 (G-07, K-12–K-16); baru: K-17, K-18.

Catatan 14 Nov 02.15 WIB (sesi Build): tidak ada jawaban baru di issue #5–#7; baru: K-19 (issue #7).

Catatan 14 Nov 22.30 WIB (sesi Build): 11 jawaban dicatat dari issue #5/#6 (K-17, K-18, P-09, P-11, P-12, P-13, P-15, P-16, P-23, P-26, P-27); P-19, P-20, P-21 belum dipahami → ditulis ulang; baru: K-20, K-21.

Catatan 15 Nov (sesi Build): tidak ada jawaban baru di issue #5–#7; baru: K-22–K-38 dari T-047/T-004/T-007. Risiko dicatat (bukan keputusan): satu orang dengan 3 nomor HP bisa memenuhi syarat 3 akun; harga tetap ≥ modal.


Catatan 19 Nov (sesi Build): 33 jawaban 16–19 Nov dicatat dari issue #5/#6/#7 (2, H5, H11, H13, F-03, F-05, F-07, P-14, P-19, P-20, P-21, G-02, K-11, K-19, K-20–K-29, K-31–K-38). Jawaban terakhir dipakai bila ada dua jawaban (K-22, K-25, K-32, K-33, K-19). H12 dialihkan ke Joseph (issue #7). Baru: K-39, K-40 (konflik K-30 vs F-07).
