# Keputusan terbuka (diisi manusia)

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| 1 | Persentase margin & harga tiap produk (diisi lewat panel/CSV) | Efan | belum |
| 2 | Nilai final KPI COD (usulan ada di keputusan.md #2) | Randy | belum |
| 3 | Koordinat gudang pusat & titik drop point pertama | Joseph | belum |
| 4 | Tarif ongkir: per kg, per km, tarif dasar tiap armada | Efan | belum |
| 5 | Nama badan usaha, kontak, dan bagian [kurung siku] di docs/legal | Randy | belum |
| 6 | Domain aplikasi (contoh nekat.id) | Joseph | belum |

Catatan: bagian di bawah ditambahkan oleh sesi Build otomatis 10–11 Nov 2026. Detail opsi, rekomendasi, dan DEFAULT SEMENTARA ada di dokumen sumber: PR #1 (T-001), PR #2 (T-002), PR #3 (T-003). Isi kolom Status dengan jawaban, atau tulis keputusan di `keputusan.md`.

## Dari ADR-0001 (T-001) — `docs/adr/0001-tech-stack.md` bagian 9

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| H1 | Setujui stack inti TypeScript/Node + Fastify + PostgreSQL + React PWA (vs Laravel) | Joseph | **DIPUTUSKAN 11 Nov: setuju Opsi A (TypeScript), sesuai rekomendasi** → `keputusan.md` #10 |
| H2 | Gateway WhatsApp untuk OTP & notifikasi (Meta Cloud API / BSP resmi / tidak resmi), SMS sebagai cadangan? Verifikasi Meta tergantung #5 | Joseph + Randy | belum |
| H3 | Penyedia hosting & PostgreSQL self-managed vs managed (kelas biaya) | Joseph (+ Finance) | belum |
| H4 | Peran n8n: laporan/tepi saja, atau juga boleh memicu job; lokasi hosting n8n | Joseph | belum |
| H5 | Saldo bisa ditarik / refund ke metode asal atau tidak; perlu tinjauan hukum (aturan uang elektronik BI) | Randy (+ hukum) | belum |
| H6 | Aturan pembulatan rupiah (termasuk modal per satuan hasil bagi karton), tidak pernah di bawah modal | Efan | belum |
| H7 | Kepemilikan akun (GitHub org + paket GitHub untuk gerbang production, Xendit, hosting, domain, Meta Business, secret store), min. 2 admin | Joseph + Randy | belum |
| H8 | Error tracking & log: SaaS vs self-host (masking PII) | Joseph | belum |
| H9 | Login admin: wajib TOTP atau cukup OTP WA | Joseph | belum |
| H10 | Terima ADR-0001 (merge PR T-001) — membuka semua task kode | Joseph | **DIPUTUSKAN 11 Nov: diterima, PR #1 di-merge** → `keputusan.md` #10 |
| H11 | (Fase 5) Deferred deep link iOS: layanan pihak ketiga vs fallback kode manual (selisih dengan keputusan #3) | Randy + Joseph | belum |
| H12 | Lokasi penyimpanan data (region Indonesia atau luar negeri) + isian "[lokasi]" di kebijakan privasi | Randy + Joseph (+ hukum) | belum |
| H13 | Cara kurir lokal & drop point menerima data antar (Fase 1: daftar antar dari admin, tanpa akun kurir?) | Randy (+ Operations) | belum |
| H14 | Stok saat API Gudang tidak bisa dihubungi: tetap jual dengan snapshot di bawah batas umur (P-10) atau tahan checkout | Joseph + Efan | belum |

## Dari peta flow group order (T-002) — `docs/flow/group-order.md` §12

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| F-01 | Harga apa yang dibayar di muka saat ikut grup, dan bagaimana bila harga final lebih tinggi (paling mendesak; terkait S&K §4.5) | Efan + Randy | belum |
| F-02 | Grup gagal (<3 akun): pilihan lanjut harga satuan atau refund, dan default bila pengguna diam | Randy | belum |
| F-03 | Tafsiran keputusan #9: apakah SEMUA refund & selisih masuk saldo (default dokumen), selaras S&K §7.1; saldo bisa dicairkan? (= H5) | Randy + Joseph | belum |
| F-04 | Satuan MOQ tier (total pcs di grup atau pcs per orang); ada harga grup dasar sebelum 6+? | Efan | belum |
| F-05 | Siapa yang dihitung ke 3 akun (hanya yang lunas?) dan perlakuan peserta COD | Randy | belum |
| F-06 | Batas kuantitas per akun per grup | Efan | belum |
| F-07 | Batas akhir pembatalan setelah bayar; boleh kurangi kuantitas sebagian? admin boleh memajukan cut-off? | Randy | belum |
| F-08 | Harga modal berubah saat grup berjalan (snapshot saat grup dibuka atau tahan grup); MOQ di-snapshot per grup? | Efan | belum |
| F-09 | Stok parsial: urutan alokasi, harga tetap terkunci, dan bila tersisa <3 akun | Efan | belum |
| F-10 | Dana akun ganda/curang & evaluasi ulang grup | Randy | belum |
| F-11 | Basis waktu pembayaran terlambat: `paid_at` gateway atau waktu webhook diterima | Joseph | belum |
| F-12 | Drop point & antar rumah dalam satu grup atau terpisah (interaksi harga Mitra) | Efan | belum |
| F-13 | Grup yang masih DITAHAN saat cut-off | Randy | belum |
| F-14 | Satu grup atau beberapa per produk × zona × slot | Randy | belum |
| F-15 | Istilah resmi ≥3 akun: "terbuka" (keputusan #3) atau "aktif" (S&K §4.2) | Randy | belum |
| F-16 | Boleh ikut produk yang sama di slot berbeda | Randy | belum |
| F-17 | Penerima pengingat (termasuk yang belum bayar?) & batas frekuensi WhatsApp | Randy | belum |
| F-18 | Daftar tunggu untuk pengguna di luar semua zona | Randy + Efan | belum |
| F-19 | Pengguna zona lain membuka link grup | Randy | belum |
| F-20 | Ongkir saat sebagian baris pesanan batal / grup gagal / alokasi parsial | Efan + Operations | belum |
| F-21 | Slot kirim dibatalkan karena operasional setelah harga dikunci | Randy + Operations | belum |
| F-22 | Atribusi pengundang (parameter ref) pada link grup | Randy + Growth | belum |
| F-23 | Versi S&K / Kebijakan Privasi berubah: wajib persetujuan ulang? | Randy | belum |
| F-24 | Keluhan barang rusak/kurang setelah diterima | Randy | belum |
| F-25 | Ganti alamat/zona setelah ikut grup | Randy + Operations | belum |
| F-26 | Lama batas bayar (TTL invoice Xendit) per metode | Randy + Joseph | belum |
| F-27 | Ada/tidaknya jalur "beli biasa" di luar grup | Randy | belum |
| F-28 | Barang di drop point tidak diambil: status akhir peserta/grup dan perlakuan dana (refund ke saldo, biaya simpan, batas hari) — terkait T-006 (sesi QA 11 Nov) | Randy + Operations | belum |

## Dari spesifikasi engine harga (T-003) — `docs/spec/engine-harga.md` §11

| # | Keputusan | Pemilik | Status |
|---|---|---|---|
| P-01 | Margin persen atau nominal; per produk atau per level; presisi persen | Efan | belum |
| P-02 | Mode pembulatan & kelipatan K (= H6) | Efan | belum |
| P-03 | Tier 6+/12+ dihitung per unit atau per akun; pembeli 1 pcs dihitung? (= F-04) | Efan + Randy | belum |
| P-04 | Harga yang dibayar saat ikut grup (= F-01) | Efan + Joseph | belum |
| P-05 | Syarat "total memenuhi syarat" untuk harga Mitra di drop point — **WAJIB diisi sebelum pilot** (tanpa ini drop point tidak pernah dapat harga Mitra) | Efan + Operations | belum |
| P-06 | Margin Mitra wajib diisi agar produk tayang? | Efan | belum |
| P-07 | Promo yang melanggar modal: tidak diterapkan atau dibatasi sampai modal | Efan | belum |
| P-08 | Harga grup LIVE (ikut modal terkini) atau DIBEKUKAN sejak grup dibuka; ambang margin menipis (= F-08) | Efan | belum |
| P-09 | Tindakan bila modal saat cut-off melewati harga dibayar peserta | Efan + Randy | belum |
| P-10 | Batas usia data modal dari Gudang | Joseph + Efan | belum |
| P-11 | Sel CSV kosong pada produk lama: biarkan atau hapus | Efan + Joseph | belum |
| P-12 | Pembulatan berat/jarak ongkir; tarif per kg global atau per armada | Efan + Operations | belum |
| P-13 | Minimal belanja gratis ongkir dihitung sebelum atau sesudah diskon | Efan | belum |
| P-14 | Perlu pagar harga antar kemasan (dus vs pcs)? | Efan | belum |
| P-15 | Pembulatan diskon persen; boleh diskon menumpuk? | Efan | belum |
| P-16 | Margin nol diizinkan? | Efan | belum |
| P-17 | Harga coret = harga 1 pcs riil? | Randy + Efan | belum |
| P-18 | Batas COD dibandingkan dengan total sebelum atau sesudah saldo | Randy + Joseph | belum |
| P-19 | Siapa menanggung bila harga final > harga dibayar tapi masih ≥ modal | Efan + Randy | belum |
| P-20 | Cara alokasi subsidi gratis ongkir ke baris pesanan untuk pagar modal | Efan + Joseph | belum |
| P-21 | Tier grup (mis. 12+) boleh opsional per produk? | Efan | belum |
| P-22 | Cakupan pagar "individu ≥ Mitra ≥ Franchise": pagar KETAT wajib (CLAUDE.md); yang diputuskan hanya apakah ditambah pemeriksaan per tier (`KETAT_PLUS_PER_TIER`). Opsi "per tier saja" dihapus di sesi QA 11 Nov karena melanggar CLAUDE.md | Efan | belum |
| P-23 | Promo saat checkout lalu harga turun di cut-off: batasi kredit selisih agar bersih ≥ modal? | Efan + Randy | belum |
| P-24 | Cakupan kategori terlarang Fase 1 (hanya rokok & bir, atau semua tembakau/nikotin & alkohol) | Randy | belum |
| P-25 | Modal saat mode Gudang: boleh ditimpa dari panel/CSV? | Joseph + Efan | belum |
| P-26 | Grup DITAHAN bila nilai bersih setelah promo & subsidi ongkir < modal saat cut-off (perluasan P-09) | Efan + Randy | belum |
| P-27 | Satu baris gagal pagar modal saat gratis ongkir: batalkan gratis ongkir seluruh pesanan? | Efan | belum |
| P-28 | Halaman detail menampilkan info "Ambil di drop point: Rp{harga Mitra}" yang tidak ada di kartu? A) boleh sebagai info terpisah; B) hanya di checkout (DEFAULT SEMENTARA, patuh "harga kartu = detail"); C) di kartu & detail (sesi QA 11 Nov) | Randy + Efan | belum |
