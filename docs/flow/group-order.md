# Peta Flow Group Order — NEKAT Fase 1

| Atribut | Nilai |
|---|---|
| Task | T-002 (`task/T-002-flow-group-order`) |
| Versi | 0.5 — Draf (v0.5: G15 batal seluruh pesanan MENUNGGU_BAYAR + TC-GO-76, istilah `waktu_bayar`; v0.3: pagar modal & picking grup gagal lanjut satuan, ledger langsung di transaksi, balapan webhook vs cut-off, checkout dua fase, kunci idempotensi selaras ADR-0001; v0.4: hasil sesi QA 11 Nov — lihat §13) |
| Tanggal | 10 Nov 2026 (rev. 11 Nov 2026) |
| Penyusun | Workflow Architect (squad Produk & flow, pemilik: Randy) |
| Status | Draf, menunggu Reality Checker setelah T-022/T-023 dibangun |
| Sumber wajib | `project-specs/keputusan.md` (#2, #3, #4, #8, #9), `project-specs/fase-1-mvp.md` (fitur 5–7, 9), `docs/legal/syarat-ketentuan.md` §2, §4, §5, §7 |
| Diselaraskan dengan | `docs/adr/0001-tech-stack.md` (T-001: job, reservasi stok, Xendit, waktu UTC), `docs/spec/engine-harga.md` (T-003: §5.3 harga final, §5.4 rumus nilai bersih) |
| Urutan merge | **Merge bersama / setelah PR T-001 (ADR-0001) & PR T-003 (engine-harga)**: definisi harga final (§5.3), nilai bersih (§5.4), peta kunci (§3.2) dan aturan OTP (§4.3) dirujuk dari dua dokumen itu dan belum ada di `main` |
| Dipakai oleh | T-003, T-004, T-005, T-010, T-011, T-022, T-023, T-024, T-030, T-035, T-039, T-040, T-043 |

Dokumen ini menetapkan **perilaku yang wajib**, bukan cara implementasi. Tidak ada angka harga, margin, atau tarif di sini. Setiap hal bisnis yang belum diputuskan ditulis di §12 dengan **DEFAULT SEMENTARA**. Default ini asumsi kerja agar developer & QA bisa jalan, **bukan keputusan**. Penanda `[F-xx]` di badan teks menunjuk asumsi tersebut.

---

## 1. Definisi & istilah

| Istilah | Definisi |
|---|---|
| **Grup** | Satu wadah pembelian bersama dengan kunci unik **produk × zona × slot kirim**. Satu kunci = satu grup [F-14]. |
| **Produk** | SKU yang tayang (punya harga di semua tier yang dipakai, punya stok). Produk tanpa harga tidak tayang dan tidak bisa punya grup. |
| **Zona** | Area radius 2–3 km dari drop point (skala kelurahan), dari `config/lokasi.json` (keputusan #5). |
| **Slot kirim** | Jendela waktu pengiriman harian yang diatur Operations. Semua grup di satu slot berbagi **satu waktu cut-off** (asumsi A-01). |
| **Link grup** | URL unik `{BASE_URL}/g/XXXXXX` (6 karakter alfanumerik, base URL dari konfigurasi, keputusan-terbuka #6). Kode tidak berubah selama grup ada. |
| **Akun** | Satu orang = satu nomor HP terverifikasi OTP WhatsApp. Akun dihitung unik per nomor HP (keputusan #3). |
| **Peserta** | Satu baris keikutsertaan sebuah akun dalam satu grup (produk, kuantitas, cara kirim). Satu akun maksimal **satu** peserta aktif per grup. |
| **Pesanan** | Satu checkout untuk satu slot kirim: berisi 1..n peserta (satu per produk/grup), satu ongkir, satu pembayaran (asumsi A-02). |
| **Akun terhitung** | Akun unik yang peserta-nya berstatus `LUNAS` atau `COD_TERKONFIRMASI` [F-05]. Yang `MENUNGGU_BAYAR` tidak dihitung. |
| **Grup aktif** | Grup dengan akun terhitung ≥ 3. Di bawah 3, harga grup tidak berlaku (keputusan #3). Istilah UI: "aktif" [F-15]. |
| **Tier MOQ** | Ambang kuantitas yang diatur admin per produk (mis. "6+", "12+"); setiap tier punya harga sendiri dari engine harga. Satuan ambang [F-04]. |
| **Tier tercapai** | Tier tertinggi yang ambangnya terpenuhi oleh kuantitas terhitung **dan** grup aktif. |
| **Harga satuan** | Harga individu non-grup per pcs dari engine harga (dasar pembayaran di muka [F-01]). |
| **Harga dibayar** | Harga per unit yang sudah dibayar peserta saat checkout (disimpan per peserta, tidak pernah berubah). |
| **Cut-off** | Waktu grup ditutup: tidak ada peserta baru, tidak ada pembatalan oleh pengguna (S&K §7.2). |
| **Harga final** | Harga per unit yang **dikunci saat cut-off**: minimum dari harga dibayar dan harga yang berlaku saat cut-off (tier grup bila grup aktif; harga satuan bila grup gagal & peserta lanjut; harga Mitra bila syarat terpenuhi), rinci di engine-harga §5.3. **Tidak pernah di bawah modal** saat cut-off; bila harga dibayar < modal saat cut-off → grup DITAHAN [P-09]. Berlaku sama untuk peserta grup aktif **dan** peserta lanjut harga satuan. |
| **Selisih harga** | Bagian kredit karena harga final lebih murah dari harga dibayar, untuk unit yang **teralokasi**: tanpa promo `(harga dibayar − harga final) × qty teralokasi`. |
| **Refund stok** | Bagian kredit untuk unit yang **tidak teralokasi** karena stok kurang saat cut-off: tanpa promo `harga dibayar × (qty pesan − qty teralokasi)`. |
| **Kredit cut-off** | Selisih harga + refund stok satu peserta, dihitung sebagai nilai bersih dengan rumus engine-harga §5.4 (memperhitungkan diskon & subsidi ongkir). Ditulis sebagai **satu** entri ledger dengan kunci `selisih:{grup_id}:{peserta_id}`, **langsung** di transaksi kunci harga (§6 langkah 9); rincian dua komponen ditampilkan terpisah di riwayat saldo & WA. Selalu ke **saldo** (keputusan #9) [F-03]. |
| **Refund** | Pengembalian dana di luar kredit cut-off (batal, grup gagal + pilih refund, grup dibatalkan). Satu refund per peserta, kunci `refund:{peserta_id}`, ditulis langsung di transaksi yang membatalkan peserta. Nilai bersih mengikuti engine-harga §5.4 bila ada promo. Tidak ditulis bila `dana_ditahan = true`. |
| **Dana ditahan** | Flag peserta `dana_ditahan = true` (akun dibekukan karena dugaan curang) [F-10]. Sebelum harga dikunci: peserta yang dibatalkan/kedaluwarsa dengan dana masuk berstatus `DANA_DITAHAN` (hanya dari BATAL / KEDALUWARSA), tanpa kredit. Setelah harga dikunci: **hanya flag** yang menahan kredit cut-off; status pengiriman peserta tidak berubah. |
| **Saldo** | Ledger kredit/debit per akun (T-021). Tidak pernah negatif. Dipakai hanya untuk belanja di NEKAT [F-03 / H5]. |
| **Alokasi** | Pembagian stok riil ke peserta saat cut-off bila stok kurang dari total pesanan. |
| **Drop point** | Titik ambil di zona. Pesanan ambil di drop point: ongkir ke rumah 0 dan dihitung **tingkat Mitra** (keputusan #4) [F-12, P-05]. |
| **Kunci idempotensi** | Kunci unik per operasi efek samping sehingga eksekusi ulang tidak menggandakan efek. Ledger (`kunci_idempotensi UNIQUE`, ADR-0001 §5.2): `selisih:{grup_id}:{peserta_id}`, `refund:{peserta_id}`, `debit:{pesanan_id}`, `saldo-balik:{pesanan_id}`, `bayar_terlambat:{pembayaran_id}`, `refund_ongkir:{pesanan_id}`. Outbox: `picking:{grup_id}`, `wa:{template}:{ref_jenis}:{ref_id}:{akun_id}[:{periode_WIB}]`. Job: `cutoff:{slot_id}`. |
| **Outbox** | Hanya untuk efek eksternal (WhatsApp, permintaan picking ke Gudang). **Ledger saldo tidak pernah lewat outbox**: kredit/debit ditulis langsung di transaksi bisnisnya (ADR-0001 §3.3). |

### Asumsi dasar (bukan keputusan bisnis)

| # | Asumsi | Dasar | Risiko bila salah |
|---|---|---|---|
| A-01 | Cut-off ditetapkan per slot kirim (konfigurasi Operations), bukan per grup | fase-1-mvp fitur 5, T-006 | Job cut-off harus per grup; urutan picking berubah |
| A-02 | Keranjang dibagi per slot; satu pesanan = satu slot = satu pembayaran berisi banyak peserta | fase-1-mvp fitur 6 | Model pesanan T-004 berubah |
| A-03 | (Dipindah ke §12 sebagai **F-27** karena menyangkut keputusan bisnis: ada/tidaknya jalur "beli biasa" di luar grup) | — | — |
| A-04 | Grup dibuat secara malas (lazy): saat akun pertama menekan "Ikut grup" atau "Ajak tetangga" untuk kunci yang belum punya grup | keputusan #3 (link unik) | Grup kosong dibuat massal untuk semua produk |
| A-05 | Batas bayar invoice Xendit = `min(TTL bayar, cut-off)`; tidak ada invoice yang hidup melewati cut-off | S&K §5.3 | Pembayaran sukses setelah harga dikunci |
| A-06 | Waktu disimpan sebagai UTC (`timestamptz`); jadwal cut-off & tanggal bisnis dihitung dalam WIB (Asia/Jakarta); event memakai ISO-8601 dengan offset; `+07:00` hanya di tampilan | ADR-0001 | Cut-off meleset 7 jam |
| A-07 | Reservasi stok milik NEKAT (modul inventori), dihitung di atas snapshot stok lokal `InventorySource` (stok tersedia − reservasi aktif); Gudang hanya menerima permintaan picking per grup setelah harga dikunci | ADR-0001 | Dobel-jual saat Gudang lambat |
| A-08 | Semua transaksi grup/uang mengikuti **peta kunci baris ADR-0001 §3.2**: `grup` FOR UPDATE (urut `grup_id`) → stok SKU → peserta → `akun_saldo`; status dicek di dalam transaksi setelah kunci diambil. Tidak ada panggilan HTTP keluar di dalam transaksi | ADR-0001 §3.2–3.3 | Deadlock, hitungan akun ganda |

---

## 2. Aktor & komponen

| Kode | Aktor / komponen | Peran |
|---|---|---|
| USR | Pengguna (pembeli individu) | Membuka link, ikut grup, bayar, batal, menerima barang |
| FE | PWA (frontend) | Halaman grup, checkout, status; tidak menghitung harga sendiri |
| GE | Engine group order (T-022/T-023) | Pemilik status grup & peserta, hitung akun & tier, cut-off |
| PE | Engine harga (T-020, spek T-003) | Harga per tier/level dari modal + margin; pagar ≥ modal |
| PAY | Layanan pembayaran + Xendit (T-029/T-030) | Invoice, webhook, kedaluwarsa |
| SAL | Ledger saldo (T-021) | Kredit selisih/refund, debit pemakaian saldo |
| INV | `InventorySource` (`LocalInventory` / `GudangApiInventory`, T-018/T-019) | Snapshot stok tersedia & harga modal (`disinkron_pada`), konfirmasi stok saat cut-off, permintaan picking per grup |
| RSV | Modul reservasi stok NEKAT (bukan bagian adapter Gudang) | Reservasi/lepas reservasi di atas snapshot lokal (A-07) |
| WA | Notifikasi WhatsApp (adapter T-016, template T-010) | Pesan ke pengguna |
| JOB | Penjadwal job (T-010/T-040) | Satu cron tiap menit untuk cut-off (slot dengan `cut_off ≤ sekarang` yang `job_run`-nya belum SELESAI; `job_run` berstatus + lease), kedaluwarsa, rekonsiliasi |
| ADM | Admin (panel T-039) | Menahan/membatalkan grup, menyelesaikan grup `DITAHAN`, membekukan akun |

Prasyarat grup bisa dibuat: produk tayang di zona; produk **bukan** kategori terlarang Fase 1 (rokok & bir, keputusan #7; cakupan P-24) — produk seperti itu tidak bisa punya grup dan API menolak; tier & harga satuan tersedia dari PE; slot kirim berikutnya punya cut-off di masa depan; stok tersedia > 0 menurut INV.

Catatan istilah [F-15]: status `DIBUKA` berarti grup **sudah dibuat** (0–2 akun terhitung), bukan "terbuka" dalam arti keputusan #3. Harga grup baru berlaku setelah `AKTIF` (≥3 akun). Nama status dapat diganti (mis. `DIBUAT`) bila F-15 diputuskan lain; perilaku tidak berubah.

---

## 3. Mesin status grup

```mermaid
stateDiagram-v2
    [*] --> DIBUKA: Ikut grup / Ajak tetangga pertama (grup dibuat + kode link)
    DIBUKA --> BELUM_AKTIF: akun terhitung 1..2
    BELUM_AKTIF --> AKTIF: akun terhitung >= 3
    AKTIF --> BELUM_AKTIF: batal / akun dibekukan, akun terhitung < 3
    BELUM_AKTIF --> DIBUKA: akun terhitung = 0
    AKTIF --> AKTIF: qty berubah, atribut tier_tercapai diperbarui
    DIBUKA --> CUT_OFF: waktu cut-off slot
    BELUM_AKTIF --> CUT_OFF: waktu cut-off slot
    AKTIF --> CUT_OFF: waktu cut-off slot
    CUT_OFF --> GAGAL: akun terhitung < 3, tidak ada peserta lanjut satuan
    CUT_OFF --> GAGAL_LANJUT_SATUAN: akun terhitung < 3, ada peserta lanjut, alokasi + harga satuan lolos pagar
    CUT_OFF --> HARGA_TERKUNCI: akun >= 3, harga final lolos pagar, alokasi selesai
    CUT_OFF --> DITAHAN: pagar modal gagal / INV atau PE tidak tersedia
    DITAHAN --> HARGA_TERKUNCI: admin menyelesaikan (akun >= 3)
    DITAHAN --> GAGAL_LANJUT_SATUAN: admin menyelesaikan (akun < 3)
    DITAHAN --> GAGAL: admin membatalkan / batas waktu tahan habis
    HARGA_TERKUNCI --> DIPROSES: permintaan picking diterima INV
    GAGAL_LANJUT_SATUAN --> DIPROSES: permintaan picking diterima INV
    DIPROSES --> SELESAI: semua peserta di status akhir
    DIBUKA --> DIBATALKAN: admin (produk ditarik, slot dibatalkan)
    BELUM_AKTIF --> DIBATALKAN: admin
    AKTIF --> DIBATALKAN: admin
    GAGAL --> [*]
    SELESAI --> [*]
    DIBATALKAN --> [*]
```

Atribut tambahan (bukan status): `pendaftaran_ditutup` (true bila stok habis sebelum cut-off, §5 B-08), `tier_tercapai` (null = belum ada tier; hanya bermakna saat AKTIF), `akun_terhitung`, `qty_terhitung`, `snapshot_moq` [F-08], `harga_grup_berlaku` (false untuk GAGAL / GAGAL_LANJUT_SATUAN), `evaluasi_dimulai_pada` (diisi §6 langkah 4; sejak terisi, webhook PAID untuk grup ini → P17), `himpunan_terhitung` (daftar peserta_id/akun_id terhitung yang dicatat langkah 4, diverifikasi langkah 9).

`GAGAL` = harga grup tidak berlaku dan **tidak ada** barang yang diproses (status akhir). `GAGAL_LANJUT_SATUAN` = harga grup tidak berlaku, tetapi ≥1 peserta memilih lanjut: harga satuan sudah dikunci & lolos pagar, stok sudah dialokasikan, dan grup masuk picking seperti HARGA_TERKUNCI.

### 3.1 Tabel transisi grup

| # | Status asal | Pemicu | Syarat (guard) | Aksi | Status tujuan | Pemicu oleh |
|---|---|---|---|---|---|---|
| G1 | — | `IkutGrup` / `AjakTetangga` untuk kunci tanpa grup | Produk tayang, slot punya cut-off > sekarang, stok > 0 | Buat grup (unik per kunci, kunci DB unik), buat kode link, snapshot MOQ | DIBUKA | USR via FE |
| G2 | DIBUKA | `PesertaTerhitung` | akun_terhitung naik ke 1..2 | Hitung ulang progress | BELUM_AKTIF | PAY (webhook) / GE (COD, saldo penuh) |
| G3 | BELUM_AKTIF | `PesertaTerhitung` | akun_terhitung ≥ 3 | Emit `GrupAktif`; hitung tier; notif WA-04 ke semua peserta terhitung (teks bergantung `tier_tercapai`, §9.2) | AKTIF | PAY / GE |
| G4 | AKTIF | `PesertaKeluar` (batal, dibekukan) | akun_terhitung < 3 | Emit `GrupTidakAktif`; notif WA-05 | BELUM_AKTIF | USR / ADM |
| G5 | BELUM_AKTIF | `PesertaKeluar` | akun_terhitung = 0 | — | DIBUKA | USR / JOB |
| G6 | AKTIF | `QtyBerubah` | qty_terhitung melewati ambang MOQ (naik/turun) | Update atribut `tier_tercapai`; naik → notif WA-06 | AKTIF | GE |
| G7 | DIBUKA / BELUM_AKTIF / AKTIF | `CutOffTiba` | sekarang ≥ waktu cut-off slot; update bersyarat status ∈ {DIBUKA, BELUM_AKTIF, AKTIF} | Tolak ikut/batal baru; jalankan §6 (langkah 2 mengedaluwarsakan invoice di Xendit saja; status peserta baru berubah di langkah 4) | CUT_OFF | JOB |
| G8 | CUT_OFF | Evaluasi §6 langkah 4 | akun_terhitung < 3 **dan** tidak ada peserta `LANJUT_SATUAN` | **Satu transaksi** (kunci ADR §3.2): status grup GAGAL + peserta terhitung LUNAS → DIREFUND (P10) + baris ledger `refund:{peserta_id}` ditulis langsung; peserta COD → BATAL tanpa dana, tanpa ledger (+ `refund_ongkir:{pesanan_id}` bila semua baris pesanan batal) + outbox WA-08 | GAGAL | GE |
| G8b | CUT_OFF | Evaluasi §6 langkah 4–9 | akun_terhitung < 3, ≥1 peserta `LANJUT_SATUAN`, INV & PE menjawab, harga final satuan ≥ modal dan nilai bersih lolos engine-harga §5.4 untuk semua peserta lanjut **dengan alokasi > 0**, himpunan terhitung = langkah 4 | Satu transaksi langkah 9: peserta REFUND → P10 (COD: BATAL tanpa dana, tanpa ledger); peserta lanjut → alokasi, harga satuan dikunci (P9); ledger kredit cut-off & refund ditulis langsung; outbox `picking:{grup_id}` + WA-08 | GAGAL_LANJUT_SATUAN | GE |
| G9 | CUT_OFF | Evaluasi §6 langkah 5–9 | akun ≥ 3, PE & INV menjawab, harga final ≥ modal dan nilai bersih lolos engine-harga §5.4 untuk semua peserta **dengan alokasi > 0** (peserta alokasi 0 → P11, tidak diuji pagar karena tidak punya harga final), himpunan terhitung = langkah 4 | Satu transaksi langkah 9: kunci harga, alokasi, ledger kredit cut-off ditulis langsung, outbox `picking:{grup_id}` + WA-07 | HARGA_TERKUNCI | GE |
| G10 | CUT_OFF | Evaluasi gagal (grup aktif **atau** grup gagal dengan peserta lanjut) | PE/INV tidak tersedia setelah retry, atau syarat lolos nilai bersih engine-harga §5.4 gagal (harga dibayar setelah promo & subsidi ongkir < modal saat cut-off) untuk peserta mana pun dengan alokasi > 0 [P-09, P-26] | Tidak ada kredit, refund, atau picking; emit `GrupDitahan` + alert admin; notif WA-09 | DITAHAN | GE |
| G11 | DITAHAN | Admin "Lanjutkan" | Guard G9 kini lolos (akun ≥ 3) | Seperti G9 | HARGA_TERKUNCI | ADM |
| G11b | DITAHAN | Admin "Lanjutkan" | Guard G8b kini lolos (akun < 3) | Seperti G8b | GAGAL_LANJUT_SATUAN | ADM |
| G12 | DITAHAN | Admin "Batalkan" atau batas waktu tahan habis [F-13] | — | Semua peserta → BATAL + refund saldo penuh (kecuali `dana_ditahan`; COD: BATAL tanpa dana, tanpa ledger) | GAGAL | ADM / JOB |
| G13 | HARGA_TERKUNCI / GAGAL_LANJUT_SATUAN | `PickingDiterima` | INV mengonfirmasi permintaan picking `picking:{grup_id}`. Bila total `qty_teralokasi` grup = 0 (semua peserta P11), **tidak** ada permintaan picking; grup langsung SELESAI setelah semua peserta di status akhir | Peserta TERKUNCI → DIPROSES | DIPROSES | INV |
| G14 | DIPROSES (atau HARGA_TERKUNCI / GAGAL_LANJUT_SATUAN dengan total alokasi 0) | Peserta terakhir mencapai status akhir | Semua peserta ∈ {DITERIMA, DITOLAK, KEDALUWARSA, DIREFUND, BATAL tanpa dana, DANA_DITAHAN} | Tutup grup; masuk laporan harian. Peserta DANA_DITAHAN (dan flag `dana_ditahan` yang menahan kredit cut-off) tetap di antrean admin | SELESAI | GE |
| G15 | DIBUKA / BELUM_AKTIF / AKTIF | Admin "Batalkan grup" | Alasan wajib diisi | Semua peserta → BATAL; refund saldo penuh untuk peserta yang sudah membayar (kecuali `dana_ditahan`); COD & MENUNGGU_BAYAR: tanpa ledger refund. MENUNGGU_BAYAR: **seluruh pesanan** peserta itu dibatalkan seperti P6 (termasuk barisnya di grup lain, karena satu invoice & satu debit saldo per pesanan): kunci semua grup pesanan urut `grup_id` (ADR §3.2), semua baris BATAL, lepas reservasi, `saldo-balik:{pesanan_id}`, pembayaran `dibatalkan`, invoice dibatalkan di luar transaksi; PAID sesudahnya → P17; notif WA-10 menyebut semua produk yang ikut batal | DIBATALKAN | ADM |

Aturan umum: status hanya maju lewat **update bersyarat** (`WHERE status = <asal>`) di dalam transaksi yang mengunci baris sesuai peta kunci ADR-0001 §3.2 (A-08); transisi yang kalah balapan tidak menimbulkan efek samping. Refund pada G12/G15 juga ditulis langsung ke ledger dalam transaksi yang sama (`refund:{peserta_id}`).

---

## 4. Mesin status peserta

```mermaid
stateDiagram-v2
    [*] --> MENUNGGU_BAYAR: checkout Xendit (stok direservasi)
    [*] --> LUNAS: dibayar penuh dengan saldo
    [*] --> COD_TERKONFIRMASI: checkout COD (lolos KPI 3 minggu, total <= Rp500.000)
    MENUNGGU_BAYAR --> LUNAS: webhook PAID (sebelum cut-off)
    MENUNGGU_BAYAR --> KEDALUWARSA: batas bayar habis sebelum cut-off / cut-off langkah 4 (setelah masa tenggang)
    MENUNGGU_BAYAR --> BATAL: pengguna batal / grup dibatalkan / akun dibekukan (tanpa dana)
    LUNAS --> BATAL: batal sebelum cut-off / grup dibatalkan / gagal + pilih refund / akun dibekukan
    COD_TERKONFIRMASI --> BATAL: batal sebelum cut-off / grup dibatalkan / gagal + pilih refund / akun dibekukan (tanpa dana, tanpa ledger)
    LUNAS --> TERKUNCI: cut-off, grup terkunci atau lanjut satuan (harga final >= modal + alokasi)
    COD_TERKONFIRMASI --> TERKUNCI: cut-off, sama seperti LUNAS
    TERKUNCI --> BATAL: alokasi 0 (stok habis)
    TERKUNCI --> DIPROSES: picking diterima
    DIPROSES --> DIKIRIM: antar rumah
    DIPROSES --> SIAP_DIAMBIL: drop point
    DIKIRIM --> DITERIMA: kurir konfirmasi
    SIAP_DIAMBIL --> DITERIMA: diambil di drop point
    DIKIRIM --> DITOLAK: COD ditolak saat diantar
    BATAL --> DIREFUND: ada dana masuk, dana_ditahan = false, ledger ditulis di transaksi yang sama
    BATAL --> DANA_DITAHAN: ada dana masuk, akun dibekukan
    KEDALUWARSA --> DANA_DITAHAN: PAID terlambat, akun dibekukan
    DANA_DITAHAN --> DIREFUND: admin melepas tahanan
    DANA_DITAHAN --> [*]: admin menetapkan lain sesuai S&K (F-10)
    BATAL --> [*]: tidak ada dana masuk
    KEDALUWARSA --> [*]
    DIREFUND --> [*]
    DITERIMA --> [*]
    DITOLAK --> [*]
```

Atribut peserta: `qty_pesan`, `qty_teralokasi`, `harga_dibayar`, `harga_final`, `jenis_harga` (GRUP / SATUAN / MITRA), `cara_kirim` (ANTAR / DROP_POINT), `jika_grup_gagal` (LANJUT_SATUAN / REFUND) [F-02], `alasan_batal`, `metode_bayar` (XENDIT / SALDO / SALDO+XENDIT / COD), `dana_ditahan` (bool). `DANA_DITAHAN` adalah status tunggu yang hanya dimasuki dari BATAL atau KEDALUWARSA: dana tidak masuk saldo sampai admin memutuskan [F-10]. Peserta yang akunnya dibekukan **setelah** harga dikunci tetap di status pengirimannya (TERKUNCI/DIPROSES/…) dengan flag `dana_ditahan = true` yang hanya menahan kredit cut-off (P18).

`BATAL` dengan dana masuk bersifat sementara di dalam transaksi: transaksi yang membatalkan peserta juga menulis ledger dan memindahkan peserta ke DIREFUND (atau DANA_DITAHAN). Gagal menulis ledger = rollback seluruh transaksi, lalu operasi diulang; tidak ada status "refund tertunda".

### 4.1 Tabel transisi peserta

| # | Status asal | Pemicu | Syarat (guard) | Aksi | Status tujuan | Pemicu oleh |
|---|---|---|---|---|---|---|
| P1 | — | Checkout dengan Xendit | `akun_id` **hanya dari sesi** (§8.1), zona diturunkan server, Login OTP, S&K versi terkini disetujui, dalam zona, grup ∈ {DIBUKA, BELUM_AKTIF, AKTIF}, `pendaftaran_ditutup = false`, belum jadi peserta aktif di grup ini, snapshot stok lebih muda dari batas usia [P-10], reservasi RSV sukses (satu transaksi DB dengan pembuatan peserta) | **Dua fase.** Fase 1 (satu transaksi, kunci grup → stok SKU → akun_saldo): buat pesanan, peserta MENUNGGU_BAYAR, baris pembayaran (`pembayaran_id` = calon `external_id`), reservasi RSV, simpan `harga_dibayar` (= harga satuan [F-01]), debit saldo sementara bila dipakai (`debit:{pesanan_id}`). Fase 2 (di luar transaksi): panggil Xendit dengan `external_id` = `pembayaran_id`, kedaluwarsa = min(TTL [F-26], cut-off). Timeout → ulang/cek status dengan `external_id` yang sama; peserta dikedaluwarsakan (P5) **hanya bila invoice terbukti tidak ada** di Xendit (M-06) | MENUNGGU_BAYAR | USR |
| P2 | — | Checkout dibayar penuh saldo | Guard P1 + saldo ≥ total | Satu transaksi (grup → stok SKU → peserta → akun_saldo): debit saldo `debit:{pesanan_id}` + peserta LUNAS | LUNAS | USR |
| P3 | — | Checkout COD | Guard P1 + status COD aktif + total ≤ Rp500.000 [P-18] | Tanpa invoice | COD_TERKONFIRMASI | USR |
| P4 | MENUNGGU_BAYAR | Webhook PAID (dikonfirmasi GET ke Xendit sebelum transaksi) | Satu transaksi insert `webhook_event` + proses, kunci grup → peserta (ADR §3.2). Di dalam kunci: status peserta MENUNGGU_BAYAR, pembayaran tidak berstatus `dibatalkan`, debit saldo sementara pesanan (`debit:{pesanan_id}`, bila ada) masih aktif (tidak ada `saldo-balik:{pesanan_id}`), nominal cocok, dan **(a)** grup ∈ {DIBUKA, BELUM_AKTIF, AKTIF}, atau **(b)** grup = CUT_OFF, `evaluasi_dimulai_pada IS NULL`, `waktu_bayar` (= `waktu_bayar` dari GET Xendit) ≤ cut-off (masa tenggang) [F-11]. Selain itu → P17 | Catat pembayaran; hitung ulang akun terhitung dari data peserta; outbox WA-02 | LUNAS | PAY |
| P5 | MENUNGGU_BAYAR | Invoice kedaluwarsa **sebelum cut-off** / **§6 langkah 4** cut-off (setelah masa tenggang) / invoice terbukti tidak ada (M-06) | Bukan oleh §6 langkah 2 (langkah 2 hanya mengedaluwarsakan invoice di Xendit) | Satu transaksi: lepas reservasi stok; kembalikan debit saldo sementara (`saldo-balik:{pesanan_id}`); outbox WA-03 | KEDALUWARSA | PAY / JOB |
| P6 | MENUNGGU_BAYAR | Pengguna batal | Sebelum cut-off | Pembatalan pada pesanan yang masih MENUNGGU_BAYAR berlaku untuk **seluruh pesanan** (semua barisnya), karena satu invoice menanggung semua baris dan debit saldo sementara (`debit:{pesanan_id}`) milik pesanan, bukan baris. Satu transaksi (grup-grup urut `grup_id` → stok SKU → peserta → pesanan → akun_saldo): semua peserta pesanan BATAL, lepas reservasi, `saldo-balik:{pesanan_id}`, pembayaran ditandai `dibatalkan`. Setelah commit, batalkan invoice di Xendit **di luar transaksi**; PAID yang tetap masuk sesudahnya → P17 (seluruh nominal ke saldo), tidak pernah menghidupkan baris. Batal per baris hanya untuk baris LUNAS/COD (P7) | BATAL | USR |
| P7 | LUNAS / COD_TERKONFIRMASI | Pengguna batal | Sebelum cut-off [F-07]; satu transaksi grup → stok SKU → peserta → akun_saldo | Lepas reservasi; hitung ulang akun terhitung; ledger `refund:{peserta_id}` langsung (LUNAS) | BATAL → DIREFUND (LUNAS) / BATAL (COD) | USR |
| P8 | LUNAS / COD_TERKONFIRMASI | Cut-off, grup → HARGA_TERKUNCI (G9/G11) | Harga final ≥ modal saat cut-off (dijamin guard G9) | Set `harga_final`, `qty_teralokasi`; kredit cut-off `selisih:{grup_id}:{peserta_id}` (§6) | TERKUNCI | GE |
| P9 | LUNAS / COD_TERKONFIRMASI | Cut-off, grup → GAGAL_LANJUT_SATUAN (G8b/G11b) | `jika_grup_gagal = LANJUT_SATUAN`; INV mengonfirmasi stok; PE memberi harga satuan dengan modal saat cut-off; harga final ≥ modal (dijamin guard G8b; gagal → grup DITAHAN, peserta tetap LUNAS/COD sampai admin) | `jenis_harga = SATUAN`, `harga_final` = min(harga dibayar, harga satuan saat cut-off, harga Mitra bila syarat) per engine-harga §5.3; alokasi; kredit cut-off; masuk `picking:{grup_id}` | TERKUNCI | GE |
| P10 | LUNAS / COD_TERKONFIRMASI | Cut-off, grup → GAGAL atau GAGAL_LANJUT_SATUAN | `jika_grup_gagal = REFUND` | LUNAS: ledger `refund:{peserta_id}` langsung di transaksi G8 / langkah 9, kecuali `dana_ditahan` → DIREFUND. COD: BATAL tanpa dana, tanpa ledger | BATAL → DIREFUND (LUNAS) / BATAL (COD) | GE |
| P11 | TERKUNCI | Alokasi = 0 | Stok tidak cukup | LUNAS: kredit cut-off = seluruh nilai bersih (refund stok). COD: tanpa dana, tanpa ledger, tidak ada tagihan. Notif WA-11 | BATAL → DIREFUND (LUNAS) / BATAL (COD) | GE |
| P12 | TERKUNCI | `PickingDiterima` | — | — | DIPROSES | INV |
| P13 | DIPROSES | Kurir berangkat / barang tiba di drop point | sesuai `cara_kirim` | notif WA-12 / WA-13 | DIKIRIM / SIAP_DIAMBIL | ADM / kurir |
| P14 | DIKIRIM / SIAP_DIAMBIL | Konfirmasi terima / ambil | — | notif WA-14 | DITERIMA | kurir / drop point |
| P15 | DIKIRIM | COD ditolak | metode = COD | Catat penolakan untuk KPI COD (keputusan #2); barang kembali ke stok | DITOLAK | kurir |
| P16 | BATAL | Di transaksi yang sama dengan pembatalan (P7/P10/G12/G15) | Ada dana masuk (Xendit atau saldo) **dan** `dana_ditahan = false` | Baris ledger `refund:{peserta_id}` ditulis langsung (bukan outbox) | DIREFUND | GE / SAL |
| P16b | BATAL / KEDALUWARSA | Akun dibekukan (B-17) atau PAID terlambat untuk akun dibekukan | Ada dana masuk; harga belum dikunci untuk peserta ini | **Tidak** ada kredit; `dana_ditahan = true`; tugas review admin | DANA_DITAHAN | ADM / PAY |
| P16c | DANA_DITAHAN | Admin melepas tahanan / menetapkan lain | Alasan tercatat di log admin | Lepas: ledger `refund:{peserta_id}` (atau `bayar_terlambat:{pembayaran_id}`) dalam satu transaksi; lainnya sesuai keputusan F-10 | DIREFUND / status akhir | ADM |
| P17 | KEDALUWARSA / BATAL, atau grup dengan `evaluasi_dimulai_pada` terisi / ≥ HARGA_TERKUNCI | Webhook PAID terlambat | Dicek di dalam kunci grup (P4 tidak lolos) | Satu transaksi: ledger `bayar_terlambat:{pembayaran_id}` sebesar **seluruh** nominal pembayaran (kecuali akun dibekukan → P16b); outbox WA-15; tidak menghidupkan peserta, tidak menghitung ulang grup | (tetap) | PAY |
| P18 | TERKUNCI / DIPROSES / DIKIRIM / SIAP_DIAMBIL | Akun dibekukan setelah harga dikunci | — | Set flag `dana_ditahan = true`: kredit cut-off peserta ini tidak ditulis (atau ditahan bila belum); **status pengiriman tidak berubah**. Barang tetap dikirim atau tidak = pertanyaan F-10 | (tetap) | ADM |

---

## 5. Flow per cabang

Format: langkah bernomor; `→` berarti lanjut; `⟂` berarti cabang gagal.

### B-01 Happy path (grup aktif, tier tercapai)
1. USR memilih zona tanpa login (izin lokasi / pilih manual) → FE menyimpan zona sesi.
2. USR membuka detail produk → FE meminta GE: progress grup untuk kunci (produk, zona, slot terdekat) dan PE: harga per tier. Kartu & detail menampilkan harga yang sama.
3. USR menekan "Ikut grup", memilih kuantitas, cara kirim, slot (default slot terdekat), dan pilihan bila grup gagal [F-02].
4. Belum login → B-03. Sudah login & S&K versi terkini disetujui → lanjut.
5. GE: buat grup bila belum ada (G1), cek guard P1, reservasi stok `qty_pesan` di RSV di atas snapshot lokal (A-07), dalam transaksi yang sama dengan pembuatan peserta.
6. Checkout: PE menghitung harga satuan × qty + ongkir (T-031) − diskon (T-032), pagar ≥ modal. FE menampilkan "Bayar sekarang" dan "Perkiraan kembali ke saldo bila grup tercapai" [F-01].
7. USR memilih QRIS / VA / e-wallet → fase 1: transaksi membuat peserta MENUNGGU_BAYAR + pembayaran + reservasi → fase 2: PAY memanggil Xendit di luar transaksi (P1).
8. Webhook PAID → P4 → LUNAS → G2/G3. Saat akun ke-3 lunas → AKTIF, WA-04 ke semua peserta.
9. Peserta lain bergabung lewat link (B-02) → qty naik → G6 tier tercapai → WA-06.
10. Cut-off → §6 → HARGA_TERKUNCI, kredit cut-off ke saldo (B-05) → WA-07.
11. Outbox `picking:{grup_id}` → INV menerima picking → DIPROSES → DIKIRIM/SIAP_DIAMBIL → DITERIMA → grup SELESAI.

### B-02 Grup dibuka dari link unik `/g/XXXXXX`
1. USR membuka link. Native terpasang → buka halaman grup; belum terpasang → halaman install lalu kembali ke grup yang sama (deferred deep link, Fase 5 / H11). PWA → halaman grup di browser + banner "Tambah ke layar utama".
2. FE meminta GE `resolveKode(kode)`. ⟂ Kode tidak ada / format salah → "Link grup tidak ditemukan" + tombol ke katalog. Tidak membocorkan apakah kode pernah ada.
3. Tampilkan halaman grup: produk, slot, cut-off (hitung mundur), jumlah peserta + nama samaran ("Bu S***, RW 05", Kebijakan Privasi §3), progress "X/Y di zona kamu · Z lagi → harga". Tidak ada nomor HP/alamat.
4. Zona USR belum diketahui → minta lokasi. ⟂ Zona USR ≠ zona grup → B-13.
5. Status grup:
   - DIBUKA / BELUM_AKTIF / AKTIF dan `pendaftaran_ditutup = false` → tombol "Ikut grup" → B-01 langkah 3.
   - `pendaftaran_ditutup = true` → "Stok untuk grup ini habis" + tawarkan grup produk sama di slot berikutnya.
   - CUT_OFF / DITAHAN / HARGA_TERKUNCI / GAGAL_LANJUT_SATUAN / DIPROSES / SELESAI / GAGAL / DIBATALKAN → "Grup ini sudah ditutup" + tombol "Ikut grup slot berikutnya" (buat/arahkan ke grup kunci berikutnya). Peserta grup tsb. melihat status pesanannya.
6. USR sudah peserta aktif grup ini → tampilkan status keikutsertaannya, bukan tombol ikut.
7. Parameter atribusi pengundang opsional dicatat bila ada [F-22]; tidak memengaruhi harga. Nilai `ref` harus **opaque** (token acak yang dipetakan server ke akun pengundang), **bukan** `akun_id` atau nomor HP, agar tidak membocorkan identitas dan tidak bisa dienumerasi.

### B-03 Pengguna belum login (OTP) & belum setuju S&K
1. USR menekan "Ikut grup" tanpa sesi → FE menyimpan niat (kode grup, qty, cara kirim) di sesi lokal.
2. Minta nomor HP → kirim OTP WhatsApp (T-016). ⟂ WA tidak tersedia → §7 M-05. ⟂ OTP salah/kedaluwarsa → pesan, kirim ulang dengan rate limit. Aturan OTP mengikuti ADR-0001 §4.3 (sekali pakai, kedaluwarsa, batas percobaan salah per kode dan per nomor per hari yang tidak di-reset oleh kirim ulang, rate limit per nomor & per IP, anggaran biaya kirim global); respons tidak membedakan nomor terdaftar/belum.
3. OTP valid → akun dibuat/ditemukan (unik per nomor). ⟂ Akun dibekukan → "Akun tidak dapat ikut grup, hubungi CS".
4. Cek persetujuan S&K + Kebijakan Privasi versi terkini. Belum ada / versi lama [F-23] → tampilkan teks persetujuan (`docs/legal/kebijakan-privasi.md` bagian akhir). Kotak wajib dicentang; kotak promo opsional.
5. ⟂ USR tidak menyetujui → tidak bisa ikut grup; boleh tetap melihat katalog. Tidak ada peserta dibuat.
6. Setuju → simpan (akun, versi S&K, versi privasi, waktu, persetujuan promo) → kembali ke niat tersimpan → B-01 langkah 5. Guard dicek ulang (grup bisa saja sudah cut-off selama login).

### B-04 Grup belum aktif (< 3 akun)
1. Progress menampilkan "X dari 3 orang · ajak N lagi agar harga grup berlaku" dan tombol "Ajak tetangga via WhatsApp" (teks + link grup).
2. Harga yang berlaku = harga satuan; harga tier ditampilkan sebagai "harga bila grup aktif".
3. Pengguna tetap bisa ikut & bayar (bayar harga satuan [F-01]).
4. Pengingat "kurang X orang" (WA-05) dikirim ke peserta terhitung sesuai batas frekuensi [F-17].
5. Bila sampai cut-off tetap < 3 → B-06.

### B-05 Tier lebih murah tercapai → selisih ke saldo
1. Saat cut-off (§6), GE menghitung tier tercapai dan PE mengembalikan harga tier dengan modal saat cut-off.
2. Per peserta: harga final dihitung `hitungHargaFinal` engine-harga §5.3 (min dari harga dibayar dan kandidat tier/G0/Mitra yang valid), dengan syarat lolos nilai bersih §5.4 (gagal → G10 DITAHAN). Peserta dengan alokasi 0 tidak punya harga final dan seluruh nilai bersihnya kembali sebagai kredit cut-off.
3. Kredit cut-off (selisih harga + refund stok, nilai bersih engine-harga §5.4). Bila > 0 → baris ledger `SELISIH_HARGA` dengan kunci `selisih:{grup_id}:{peserta_id}`, ditulis **langsung** di transaksi langkah 9 (bukan outbox).
4. Peserta COD: tidak ada dana di muka → tidak ada kredit; jumlah tagih saat antar = `tagihanBarangCod` (T' dari engine-harga §5.4, sudah memperhitungkan promo) + ongkir.
5. WA-07: "Harga final Rp… · Rp… masuk saldo NEKAT kamu".
6. Bila harga tier saat cut-off > harga dibayar (modal naik / tier turun) → peserta tidak ditagih tambahan (harga_final = harga_dibayar) selama ≥ modal [P-19, F-08].

### B-06 Grup gagal (< 3 akun saat cut-off)
1. §6 langkah 4: akun_terhitung < 3 → harga grup tidak berlaku. Peserta terhitung dipisah sesuai `jika_grup_gagal` [F-02].
2. Tidak ada peserta LANJUT_SATUAN (semua REFUND, atau tidak ada peserta terhitung) → G8 **GAGAL** dalam satu transaksi di bawah kunci grup: status grup + peserta LUNAS → DIREFUND (P10) + baris ledger `refund:{peserta_id}` langsung (peserta COD → BATAL tanpa dana, tanpa ledger) + outbox WA-08. Tidak ada picking.
3. Ada ≥1 peserta LANJUT_SATUAN → peserta lanjut menjalani **langkah yang sama dengan grup aktif** (§6 langkah 5–9):
   1. INV mengonfirmasi stok riil untuk total qty peserta lanjut; alokasi FIFO bila kurang (B-09).
   2. PE menghitung harga satuan (dan harga Mitra bila syarat) dengan **modal saat cut-off**; `harga_final` per engine-harga §5.3.
   3. Pagar: harga dibayar ≥ modal saat cut-off dan nilai bersih ≥ modal (engine-harga §5.4) untuk **setiap** peserta lanjut. Ada yang gagal → **G10 DITAHAN** untuk admin [P-09]; tidak ada kredit, refund, atau picking sampai diselesaikan (G11b / G12). Barang **tidak** dikirim di bawah modal.
   4. INV/PE tidak tersedia setelah retry → G10 DITAHAN.
   5. Semua lolos → satu transaksi langkah 9 (kunci ulang grup `WHERE status = 'CUT_OFF'`, verifikasi himpunan terhitung): peserta lanjut → P9 TERKUNCI (`jenis_harga = SATUAN`), peserta REFUND → P10, ledger kredit cut-off & refund ditulis langsung, outbox `picking:{grup_id}` + WA → G8b **GAGAL_LANJUT_SATUAN**.
4. GAGAL_LANJUT_SATUAN → INV menerima picking (G13) → DIPROSES → alur kirim biasa → SELESAI.
5. Grup DIBUKA tanpa peserta terhitung → GAGAL tanpa notifikasi.
6. WA-08 berisi hasil sesuai pilihan peserta + ajakan ikut grup di slot berikutnya; bila DITAHAN, WA-09 lebih dulu.
7. Ongkir pesanan yang semua barisnya di-refund ikut dikembalikan (`refund_ongkir:{pesanan_id}`) [F-20].

### B-07 Refund (semua jalur)
1. Sumber refund: batal sebelum cut-off (P7), grup gagal + REFUND (P10), grup DIBATALKAN (G15), DITAHAN → GAGAL (G12). Jalur kredit lain dengan kunci sendiri: refund stok saat alokasi 0/parsial (bagian kredit cut-off `selisih:{grup_id}:{peserta_id}`, §1), pembayaran terlambat (`bayar_terlambat:{pembayaran_id}`, P17), ongkir (`refund_ongkir:{pesanan_id}`, F-20), keluhan barang (koreksi admin, [F-24]).
2. Tujuan refund: **selalu saldo** (keputusan #9) [F-03]. Tidak ada refund ke metode asal di Fase 1.
3. Nominal = nilai bersih yang benar-benar dibayar untuk baris itu (Xendit + saldo yang dipakai), dengan diskon & subsidi ongkir per baris dihitung memakai **rumus nilai bersih engine-harga §5.4** (`B = D × q − P`). Ongkir mengikuti F-20.
4. Baris ledger `refund:{peserta_id}` (satu per peserta) ditulis **langsung** di transaksi yang membatalkan peserta, dengan kunci baris grup → stok SKU → peserta → akun_saldo (ADR §3.2). Entri ganda ditolak constraint unik dan dianggap sukses. Alasan disimpan sebagai kolom, bukan bagian kunci.
5. Peserta → DIREFUND; outbox WA-10/11/15 sesuai alasan; riwayat saldo menampilkan alasan + nama produk + tanggal.
6. Akun dibekukan (`dana_ditahan = true`) → **tidak** ada kredit; peserta → DANA_DITAHAN (P16b) sampai admin memutuskan (P16c) [F-10].
7. ⟂ Penulisan ledger gagal → **rollback seluruh transaksi** (status peserta pun tidak berubah); pengguna melihat "Coba lagi" atau job mengulang operasi dari awal. Tidak ada status refund tertunda.

### B-08 Stok habis sebelum cut-off
1. INV (sinkron Gudang atau stok lokal turun) memperbarui snapshot lokal; stok tersedia untuk reservasi = snapshot − reservasi aktif (A-07).
2. Reservasi RSV untuk peserta baru gagal → USR melihat "Stok tidak cukup, tersisa N" dan boleh mengurangi qty.
3. Stok tersedia = 0 → GE set `pendaftaran_ditutup = true`; tombol "Ikut grup" nonaktif; progress tetap tampil.
4. Peserta yang sudah MENUNGGU_BAYAR/LUNAS **tidak** dibatalkan otomatis; kekurangan diselesaikan saat alokasi (B-09).
5. Stok kembali > 0 sebelum cut-off → `pendaftaran_ditutup = false`.
6. Reservasi kedaluwarsa (P5) atau batal (P6/P7) melepas stok → dapat membuka pendaftaran lagi.

### B-09 Stok habis/kurang sesudah cut-off (alokasi parsial)
1. §6 langkah 5: INV mengonfirmasi stok riil untuk total `qty_pesan` peserta terkunci.
2. Stok ≥ total → semua `qty_teralokasi = qty_pesan`.
3. Stok < total → alokasi per urutan `waktu_bayar` paling awal (COD: waktu konfirmasi), unit utuh [F-09].
4. Tier & harga final dihitung dari qty terhitung **sebelum** alokasi; harga tidak dinaikkan karena alokasi [F-09].
5. Bagian tidak teralokasi = **refund stok** (§1), digabung dengan selisih harga dalam satu kredit cut-off `selisih:{grup_id}:{peserta_id}` (nilai bersih engine-harga §5.4); WA-11 "Maaf, X dari Y pcs tidak tersedia".
6. `qty_teralokasi = 0` → P11 BATAL → DIREFUND.
7. Grup tetap HARGA_TERKUNCI walau peserta penerima barang tersisa < 3 [F-09].
8. Alokasi yang sama berlaku untuk peserta lanjut satuan di grup GAGAL_LANJUT_SATUAN (B-06).

### B-10 Pembatalan oleh pengguna
1. USR membuka status pesanan → "Batalkan" tersedia hanya bila status ∈ {MENUNGGU_BAYAR, LUNAS, COD_TERKONFIRMASI} dan sekarang < cut-off [F-07].
2. Konfirmasi dua langkah, menampilkan dampak: "Dana Rp… masuk saldo" dan "grup jadi kurang N orang" bila relevan.
3. GE update bersyarat (status asal, sebelum cut-off). ⟂ Kalah balapan dengan cut-off → "Grup sudah ditutup, pesanan tidak bisa dibatalkan" (S&K §7.2).
4. Aksi P6/P7; grup dievaluasi ulang (G4/G5/G6) → peserta lain dapat WA-05 bila grup turun ke < 3.
5. Kurangi kuantitas sebagian: tidak tersedia di Fase 1 (batal lalu ikut lagi) [F-07].
6. Pesanan multi-baris: pembatalan per baris hanya untuk baris LUNAS/COD (P7); pesanan MENUNGGU_BAYAR dibatalkan utuh (P6); ongkir tidak dihitung ulang kecuali semua baris batal (`refund_ongkir:{pesanan_id}`) [F-20].
7. Setelah cut-off: tidak ada tombol batal; hanya kanal CS untuk kesalahan NEKAT (S&K §7.2).

### B-11 Pembayaran terlambat / kedaluwarsa
1. Invoice dibuat dengan kedaluwarsa = min(TTL bayar [F-26], cut-off) (A-05).
2. FE menampilkan hitung mundur batas bayar; WA-03a pengingat sebelum kedaluwarsa [F-17].
3. Kedaluwarsa sebelum cut-off → P5 KEDALUWARSA; stok & debit saldo sementara dikembalikan. Invoice yang masih terbuka saat cut-off hanya dikedaluwarsakan di Xendit (§6 langkah 2); peserta baru menjadi KEDALUWARSA di transaksi §6 langkah 4, setelah masa tenggang.
4. Webhook PAID tiba saat peserta KEDALUWARSA/BATAL, atau grup sudah melewati masa tenggang → P17: seluruh nominal pembayaran ke saldo (`bayar_terlambat:{pembayaran_id}`), WA-15, tidak menghitung ulang grup [F-11].
5. Masa tenggang (balapan webhook vs evaluasi cut-off): webhook mengunci grup FOR UPDATE (ADR §3.2) lalu memeriksa di dalam kunci:
   - grup CUT_OFF, `evaluasi_dimulai_pada IS NULL`, `waktu_bayar` ≤ cut-off → P4 LUNAS (masih terhitung);
   - `evaluasi_dimulai_pada` terisi (langkah 4 sudah mulai) atau status grup > CUT_OFF → P17.
   Karena langkah 4 mengisi `evaluasi_dimulai_pada` di bawah kunci yang sama, setiap webhook jatuh tepat di satu sisi. Langkah 9 memverifikasi ulang himpunan terhitung (§6) sebagai pagar kedua [F-11].

### B-12 Webhook ganda / tidak berurutan
1. PAY memverifikasi callback token (T-030). ⟂ Token salah → 401, tidak ada efek, log keamanan. PAID dikonfirmasi lewat GET status ke Xendit **sebelum** transaksi dibuka (ADR §4.2); gagal → 5xx agar Xendit mengulang.
2. **Satu transaksi**: insert `webhook_event` (`UNIQUE(gateway, external_id, status)`) + pemrosesan (kunci grup → peserta → akun_saldo, ubah status, tulis ledger, tulis outbox WA). Insert duplikat → 200 tanpa efek. Error lain → rollback + 5xx (tidak ada event "tercatat tapi tidak diproses").
3. Transisi peserta via update bersyarat; PAID untuk peserta yang sudah LUNAS → no-op.
4. EXPIRED setelah PAID → diabaikan (status maju tidak boleh mundur).
5. PAID untuk invoice yang tidak dikenal → simpan sebagai "yatim", alert admin, tidak ada kredit otomatis.
6. Nominal PAID ≠ nominal invoice → peserta tetap MENUNGGU_BAYAR, alert admin (jangan anggap lunas).

### B-13 Pengguna di luar zona
1. Lokasi USR tidak masuk radius drop point mana pun → "Maaf, NEKAT belum melayani lokasimu" [F-18]; katalog boleh dilihat tanpa tombol ikut/checkout.
2. USR dalam zona lain dari grup di link → "Grup ini untuk zona {nama zona}. Di zonamu ada grup produk yang sama" + tombol ke grup kunci (produk, zona USR, slot sama) [F-19].
3. Zona ditentukan **alamat kirim** pesanan (antar) atau drop point yang dipilih; alamat dikunci per pesanan. Ganti alamat ke zona lain setelah ikut = batal + ikut grup lain [F-25].

### B-14 Perubahan harga modal saat grup berjalan
1. INV melaporkan modal baru → PE menghitung ulang harga semua tier (live) [F-08].
2. Peserta baru membayar harga satuan terbaru; `harga_dibayar` peserta lama tidak berubah.
3. MOQ tier memakai `snapshot_moq` saat grup dibuka; perubahan MOQ oleh admin berlaku untuk grup baru [F-08].
4. Modal baru membuat harga yang tampil berubah → kartu & detail diperbarui bersamaan (satu sumber dari PE).
5. Saat cut-off, modal yang dipakai = modal terkini dari INV (snapshot dicatat). Bila `harga_dibayar` peserta < modal saat cut-off → grup DITAHAN (G10) untuk keputusan admin [P-09].
6. Data modal lebih tua dari batas usia [P-10] → perlakukan sebagai INV tidak tersedia (§7 M-03).

### B-15 Ambil di drop point (= tingkat Mitra)
1. Di checkout USR memilih "Ambil di drop point" → ongkir ke rumah 0.
2. PE menentukan apakah total pesanan memenuhi syarat Mitra [P-05]. Ya → `jenis_harga = MITRA`, `harga_dibayar` = harga Mitra; tidak → harga satuan.
3. Peserta drop point ikut grup yang sama dengan peserta antar rumah dan dihitung ke akun & qty [F-12].
4. Saat cut-off: `harga_final = min(harga_dibayar, harga tier grup, harga Mitra bila syarat terpenuhi)`; pagar harga grup individu ≥ Mitra tetap dijaga oleh PE.
5. Pembatalan baris membuat total turun di bawah syarat Mitra → kandidat harga Mitra hilang; baris tersisa tidak ditagih tambahan (`harga_final ≤ harga_dibayar`) [F-12], **tetapi tetap melewati pagar modal saat cut-off**: bila harga dibayar (harga Mitra) < modal saat cut-off atau nilai bersih < modal (engine-harga §5.4) → grup DITAHAN (G10) untuk admin [P-09], bukan dikirim.
6. Barang tiba → SIAP_DIAMBIL, WA-13 berisi alamat drop point & jam ambil. Tidak diambil sampai batas waktu → kebijakan Operations (T-006, di luar dokumen ini). **Catatan terbuka untuk T-006:** tanpa status akhir untuk barang tidak diambil, peserta tetap SIAP_DIAMBIL dan grup tidak pernah SELESAI (G14); T-006 perlu menetapkan status akhir (mis. `TIDAK_DIAMBIL`) dan perlakuan dananya.

### B-16 Pembayaran memakai saldo
1. Saldo ≥ total → P2 langsung LUNAS (tanpa Xendit), debit `debit:{pesanan_id}`.
2. Saldo < total → debit sementara saldo (`debit:{pesanan_id}`) di transaksi fase 1 + invoice Xendit untuk sisa di fase 2. Kedaluwarsa/batal → debit dikembalikan (kunci `saldo-balik:{pesanan_id}`).
3. Refund atas baris ini mengembalikan bagian saldo + bagian Xendit ke saldo.

### B-17 Akun ganda / curang terdeteksi
1. ADM membekukan akun dengan alasan tercatat (S&K §2.3).
2. Sebelum cut-off (atau saat grup CUT_OFF sebelum langkah 9): satu transaksi grup → stok SKU → peserta; peserta akun itu → BATAL (alasan `akun_dibekukan`) → DANA_DITAHAN (P16b), dikeluarkan dari hitungan (G4 bila turun < 3); reservasi dilepas; **tidak** ada kredit [F-10]. Bila terjadi saat grup CUT_OFF, langkah 9 mendeteksi himpunan terhitung berubah dan mengulang dari langkah 4.
3. Setelah harga dikunci (P18): hanya flag `dana_ditahan = true` yang menahan kredit cut-off peserta itu; **status pengiriman tidak berubah**; tidak ada evaluasi ulang grup. Apakah barang tetap dikirim = pertanyaan F-10 (default sementara: tetap dikirim).
4. Admin melepas atau menetapkan lain (P16c), dengan alasan tercatat; pelepasan menulis ledger (`refund:{peserta_id}` atau `selisih:{grup_id}:{peserta_id}`) dalam satu transaksi.
5. Deteksi (bantuan admin, bukan pembekuan otomatis): syarat "3 akun" bisa dipenuhi satu orang dengan beberapa SIM. GE menandai grup untuk review bila ≥2 akun terhitung berbagi alamat kirim yang sama persis, drop point + nama penerima sama, sidik perangkat/sesi yang sama, atau metode bayar yang sama (mis. akun e-wallet sumber dari callback Xendit). Tanda ini hanya membuat tugas review di panel T-039; keputusan tetap oleh admin (B-17.1). Sinyal perangkat tunduk pada Kebijakan Privasi.

---

## 6. Prosedur job cut-off (per slot)

Pemicu: **satu cron tiap menit** memproses setiap slot dengan `cut_off ≤ sekarang` yang `job_run(cutoff, slot_id)`-nya belum SELESAI (ADR-0001 §3.3). `job_run` berstatus (BERJALAN/SELESAI/GAGAL) dengan `lease_sampai` + heartbeat; run baru mengambil alih bila lease habis. `job_run` hanya mencegah dua run bersamaan; pencegah efek ganda adalah update bersyarat status grup dan kunci idempotensi unik di ledger/outbox. Kunci job: `cutoff:{slot_id}`.

Transaksi mengikuti peta kunci ADR-0001 §3.2 (grup FOR UPDATE urut `grup_id` → stok SKU → peserta → pesanan → akun_saldo). Panggilan ke INV (HTTP) dilakukan di luar transaksi. Ledger ditulis **langsung** di transaksi; outbox hanya untuk WA & picking.

Langkah 5–9 dijalankan untuk **dua** jenis grup: grup dengan akun ≥ 3 (target HARGA_TERKUNCI) dan grup dengan akun < 3 yang punya peserta LANJUT_SATUAN (target GAGAL_LANJUT_SATUAN; langkah 5–8 hanya untuk peserta lanjut). Tidak ada jalur pengiriman yang melewati langkah stok, harga, dan pagar modal.

| Langkah | Aksi | Gagal → |
|---|---|---|
| 1 | Update bersyarat semua grup slot (kunci grup urut `grup_id`): status ∈ {DIBUKA, BELUM_AKTIF, AKTIF} → CUT_OFF. Sejak ini API ikut/batal menolak (guard waktu juga berlaku tanpa job). | DB gagal → retry; job tidak lanjut ke langkah 2 sebelum sukses |
| 2 | Minta PAY mengedaluwarsakan invoice terbuka grup slot ini **di Xendit saja** (di luar transaksi). Status peserta **tidak** diubah: peserta tetap MENUNGGU_BAYAR agar PAID tepat waktu yang webhooknya tiba di masa tenggang masih lolos P4(b). | Xendit tidak tersedia → lanjut ke langkah 3; peserta tetap dipindah ke KEDALUWARSA di langkah 4; webhook PAID setelah langkah 4 → P17 |
| 3 | Tunggu masa tenggang webhook (konfigurasi teknis) agar PAID dengan `waktu_bayar` ≤ cut-off sempat diproses lewat P4(b) [F-11]. | — |
| 4 | Per grup, **satu transaksi** dengan grup FOR UPDATE → stok SKU → peserta → akun_saldo (setelah masa tenggang): isi `evaluasi_dimulai_pada` (bila null); peserta yang **masih** MENUNGGU_BAYAR → P5 KEDALUWARSA (lepas reservasi, `saldo-balik:{pesanan_id}`, outbox WA-03); catat `himpunan_terhitung` (peserta_id + akun_id terhitung). Sejak commit, webhook PAID untuk grup ini → P17. Lalu: ≥ 3 akun → langkah 5 (semua peserta). < 3 dan tidak ada peserta LANJUT_SATUAN → **G8 di transaksi yang sama** (status grup GAGAL + peserta LUNAS DIREFUND + ledger `refund:{peserta_id}` langsung; peserta COD BATAL tanpa ledger + outbox WA-08), grup berikutnya. < 3 dan ada peserta LANJUT_SATUAN → langkah 5 hanya untuk peserta lanjut; peserta REFUND diproses di langkah 9. | Rollback; ulang langkah 4 |
| 5 | INV: konfirmasi stok riil untuk total qty peserta yang akan dikirim. | Retry dengan backoff; habis → G10 DITAHAN |
| 6 | Alokasi FIFO (B-09). | — |
| 7 | PE: harga tier tercapai (grup aktif) / harga satuan (lanjut satuan) / harga Mitra, dengan modal saat cut-off; catat snapshot modal & id versi harga. | Retry; habis → G10 DITAHAN |
| 8 | Hitung `harga_final` (engine-harga §5.3) & nilai bersih (engine-harga §5.4) per peserta **dengan alokasi > 0**; cek harga dibayar ≥ modal dan nilai bersih ≥ modal. Peserta alokasi 0 tidak diuji pagar (→ P11). | Ada peserta gagal pagar → G10 DITAHAN (tidak ada kredit/refund/picking) [P-09] |
| 9 | **Satu transaksi**: kunci ulang grup `FOR UPDATE ... WHERE status = 'CUT_OFF'` → stok SKU → peserta → akun_saldo. Verifikasi himpunan peserta/akun terhitung **sama** dengan `himpunan_terhitung` langkah 4; beda (mis. akun dibekukan di antaranya) → rollback dan **ulang dari langkah 4**. Lolos → tulis harga_final, qty_teralokasi, peserta TERKUNCI (P8/P9), peserta REFUND → DIREFUND (P10), status grup HARGA_TERKUNCI atau GAGAL_LANJUT_SATUAN, **baris ledger langsung** (kredit cut-off `selisih:{grup_id}:{peserta_id}`, refund `refund:{peserta_id}`, `refund_ongkir:{pesanan_id}` bila berlaku), dan outbox hanya untuk WA-07/08/11 + `picking:{grup_id}`. Peserta `dana_ditahan` tidak mendapat baris kredit. | Rollback; ulang langkah 9 (grup bukan lagi CUT_OFF → sudah diproses run lain, lewati) |
| 10 | Pekerja outbox: WA-07/08/11 dan permintaan picking per grup ke INV (T-040) — hanya untuk grup HARGA_TERKUNCI / GAGAL_LANJUT_SATUAN dengan total `qty_teralokasi` > 0 (langkah 9 tidak menulis outbox `picking` bila total alokasi = 0), setelah harga dikunci & stok dialokasikan; tidak pernah saat pesanan lunas. Tidak ada ledger di outbox. | Retry per item, idempoten (§7) |
| 11 | Laporan job: jumlah grup per hasil (HARGA_TERKUNCI / GAGAL_LANJUT_SATUAN / GAGAL / DITAHAN) ke log & laporan harian. | — |

Grup DITAHAN tidak masuk picking list sampai diselesaikan admin; batas waktu tahan & default bila tidak diselesaikan [F-13].

---

## 7. Mode gagal & pemulihan

| # | Mode gagal | Deteksi | Dampak | Pemulihan | Idempotensi |
|---|---|---|---|---|---|
| M-01 | Job cut-off tidak jalan (server mati / penjadwal gagal) | Cron tiap menit menemukan slot `cut_off ≤ sekarang` dengan `job_run` belum SELESAI (menggantikan watchdog); alert bila tertunda > ambang | Pengguna masih bisa ikut setelah cut-off | API ikut/batal **sendiri** menolak bila sekarang ≥ cut-off (guard waktu, tak bergantung job); cron berikutnya menjalankan job; alert DevOps | Kunci `cutoff:{slot_id}` + update bersyarat |
| M-02 | Job cut-off mati di tengah | Lease `job_run` habis tanpa heartbeat | Sebagian grup terkunci, sebagian belum | Run berikutnya mengambil alih lease (update bersyarat); langkah per grup melewati grup yang statusnya sudah > CUT_OFF; grup dengan `evaluasi_dimulai_pada` terisi diulang dari langkah 4 | Status grup sebagai checkpoint + kunci ledger unik |
| M-03 | INV/Gudang tidak tersedia | Timeout/5xx setelah retry; umur snapshot (`sekarang − disinkron_pada`) | Sinkron stok/modal berhenti; cut-off tidak bisa konfirmasi stok | Sebelum cut-off: **tetap terima ikut grup** memakai snapshot lokal + reservasi RSV selama umur snapshot di bawah batas [P-10]; lewat batas → tolak ikut baru ("Stok sedang diperbarui, coba lagi"). Saat cut-off: grup DITAHAN; permintaan picking di-outbox dan diulang | Kunci `picking:{grup_id}` dikirim ke Gudang |
| M-05 | WhatsApp tidak tersedia | Error/timeout adapter | OTP & notifikasi tertunda | OTP: tampilkan pesan & coba lagi; kanal cadangan menunggu H2. Notifikasi: antre di outbox & retry; status di aplikasi tetap jadi sumber kebenaran. Notifikasi basi (mis. pengingat setelah cut-off) dibuang | `wa:{template}:{ref_jenis}:{ref_id}:{akun_id}[:{periode_WIB}]` (periode untuk pesan berulang, mis. pengingat) |
| M-06 | Xendit tidak tersedia / timeout saat checkout (fase 2 P1) | Timeout/5xx | Peserta MENUNGGU_BAYAR & reservasi sudah ada, invoice belum pasti | Ulang/cek status dengan `external_id` yang sama (tidak membuat invoice ganda); peserta dikedaluwarsakan (P5, lepas reservasi & debit saldo) **hanya bila invoice terbukti tidak ada** di Xendit; "Pembayaran sedang gangguan"; saldo penuh tetap bisa | `external_id` = `pembayaran_id` NEKAT (satu pembayaran per pesanan di Fase 1) |
| M-07 | Webhook Xendit tidak datang | Peserta MENUNGGU_BAYAR mendekati kedaluwarsa | Pengguna sudah bayar tapi status belum lunas | Job rekonsiliasi menanyakan status invoice ke Xendit sebelum cut-off & sebelum menandai KEDALUWARSA | Sama dengan jalur webhook (B-12) |
| M-08 | PE gagal / harga tidak tersedia | Error | Tidak bisa tampil/checkout | Produk tidak tayang (aturan "tanpa harga tidak tayang"); saat cut-off → DITAHAN | — |
| M-09 | Balapan: dua webhook PAID bersamaan (akun ke-2 & ke-3), batal vs cut-off, webhook vs evaluasi cut-off | — | Hitungan salah, grup aktif dua kali, peserta terlewat | Semua jalur mengunci grup FOR UPDATE dulu (ADR §3.2) sehingga diserialkan; akun dihitung ulang dari data peserta (bukan counter inkremental) di dalam kunci; transisi G3 bersyarat → `GrupAktif`/WA-04 tepat sekali. Webhook vs evaluasi: `evaluasi_dimulai_pada` + verifikasi `himpunan_terhitung` di langkah 9 (§6, B-11) | Update bersyarat + kunci WA |
| M-10 | Grup ganda untuk kunci sama (dua pengguna buat bersamaan) | Constraint unik | — | Insert kedua gagal → ambil grup yang ada | Constraint unik (produk, zona, slot) |
| M-11 | Tabrakan kode link | Constraint unik kode | — | Bangkitkan ulang kode | Constraint unik |

M-04 dihapus di v0.3: ledger ditulis langsung di transaksi bisnis, jadi kegagalan ledger = rollback seluruh transaksi lalu operasi diulang (tidak ada refund "tertunda"). Rekonsiliasi harian `akun_saldo` vs `SUM(ledger)` dan Xendit vs ledger tetap berjalan (ADR-0001 §4.2, §5.2).

Usulan timeout teknis (bisa diubah Software Architect, bukan angka bisnis): panggilan sinkron ke INV/PE/Xendit masing-masing punya timeout terkonfigurasi dan retry berbatas dengan backoff; habis retry = gagal sesuai tabel.

---

## 8. Kontrak handoff antar komponen

Semua event membawa: `id_event` (UUID), `waktu` (ISO-8601 **dengan offset**, mis. `2026-11-10T10:00:00Z`; disimpan UTC, `+07:00` hanya di tampilan — A-06), `versi_skema`, `kunci_idempotensi`. Penamaan id mengikuti ADR-0001: `grup_id`, `peserta_id`, `slot_id`, `pesanan_id`, `pembayaran_id`, `akun_id`.

- Efek eksternal (WhatsApp, permintaan picking) ditulis ke **outbox** dalam transaksi yang sama dengan perubahan status, lalu dikirim worker.
- **Ledger saldo tidak pernah lewat outbox**: `kredit`/`debit` adalah panggilan fungsi modul SAL **di dalam** transaksi pemanggil (urutan kunci ADR §3.2, `akun_saldo` terakhir).
- Event domain (`GrupAktif`, dst.) adalah catatan internal/laporan; tidak ada konsumen yang menulis ledger dari event.

| Arah | Event / panggilan | Data minimal | Respons sukses | Gagal |
|---|---|---|---|---|
| FE → GE | `GET grup/{kode}` | kode | status, produk, zona, slot, cut_off, akun_terhitung, qty_terhitung, tier_tercapai, tier berikut + "Z lagi", nama samaran peserta, `pendaftaran_ditutup` | 404 `GRUP_TIDAK_DITEMUKAN` |
| FE → GE | `POST ikut` | id_produk (atau kode grup), id_slot, qty, cara_kirim, jika_grup_gagal, id_alamat? / id_drop_point?, ref? — **tanpa** id_akun & id_zona (§8.1) | id_peserta, id_pesanan, ringkasan harga | 409 `SUDAH_PESERTA`, 409 `GRUP_TUTUP`, 422 `STOK_KURANG` (+tersisa), 403 `LUAR_ZONA`, 403 `BELUM_SETUJU_SK`, 403 `AKUN_DIBEKUKAN`, 409 `QTY_MELEBIHI_BATAS` [F-06] |
| GE → PE | `hargaUntuk` | id_produk, id_zona, level (INDIVIDU/MITRA), tier, qty, waktu | harga_per_unit, modal_snapshot, id_versi_harga | `HARGA_TIDAK_TERSEDIA`, `DI_BAWAH_MODAL` |
| GE → RSV (modul NEKAT) | `reservasi` / `lepasReservasi` | peserta_id, sku, qty, kedaluwarsa; dihitung dari snapshot lokal − reservasi aktif, satu transaksi dengan pembuatan peserta | id_reservasi, stok_tersisa | `STOK_KURANG`, `SNAPSHOT_KEDALUWARSA` (umur > batas P-10) |
| GE → INV | `konfirmasiStok` (cut-off) | grup_id, sku, qty_total | qty_tersedia | `TIDAK_TERSEDIA` (retryable) |
| GE → INV | `kirimPermintaanPicking` (per grup, hanya setelah HARGA_TERKUNCI / GAGAL_LANJUT_SATUAN & alokasi) | grup_id, slot_id, sku, daftar (peserta_id, qty_teralokasi, cara_kirim) | id_picking | retryable, kunci `picking:{grup_id}` |
| INV → GE/PE | `ModalBerubah`, `StokBerubah` (snapshot diperbarui) | sku, nilai baru, `disinkron_pada` | — | — |
| GE → PAY | `buatPembayaran` (invoice Xendit; fase 2 P1, di luar transaksi) | pembayaran_id (= `external_id` Xendit, sudah tersimpan di fase 1), pesanan_id, nominal, metode, kedaluwarsa | id_invoice, instruksi bayar | `GATEWAY_TIDAK_TERSEDIA` / timeout → cek ulang dengan `external_id` sama (M-06) |
| PAY → GE | `PembayaranLunas` | pembayaran_id (`external_id`), pesanan_id, id_invoice, nominal, waktu_bayar, id_event_gateway | — | — |
| PAY → GE | `PembayaranKedaluwarsa` | pembayaran_id, pesanan_id, id_invoice | — | — |
| GE → SAL (dalam transaksi) | `kredit` | akun_id, nominal (nilai bersih engine-harga §5.4), jenis (SELISIH_HARGA = kredit cut-off / REFUND / BAYAR_TERLAMBAT / REFUND_ONGKIR), rincian (selisih_harga, refund_stok), referensi (peserta_id / pembayaran_id / pesanan_id), alasan, kunci_idempotensi (`selisih:{grup_id}:{peserta_id}` / `refund:{peserta_id}` / `bayar_terlambat:{pembayaran_id}` / `refund_ongkir:{pesanan_id}`) | id_entri, saldo_baru | `DUPLIKAT` (anggap sukses); error lain → rollback transaksi pemanggil. Tidak dipanggil bila `dana_ditahan = true` |
| GE → SAL (dalam transaksi) | `debit` / `batalkanDebit` | akun_id, nominal, pesanan_id, kunci (`debit:{pesanan_id}` / `saldo-balik:{pesanan_id}`) | id_entri | `SALDO_KURANG` → rollback |
| GE → WA (outbox) | `kirimNotifikasi` | akun_id, template (WA-xx), variabel, ref_jenis, ref_id, kunci_idempotensi `wa:{template}:{ref_jenis}:{ref_id}:{akun_id}[:{periode_WIB}]`, `kedaluwarsa_pesan` | id_pesan | retryable; dibuang bila basi |
| GE → (semua) | `GrupAktif`, `GrupTidakAktif`, `TierBerubah`, `GrupHargaDikunci`, `GrupGagal` (+ `ada_lanjut`), `GrupDitahan`, `GrupDibatalkan`, `PesertaTerhitung`, `PesertaKeluar`, `DanaDitahan` | grup_id, kunci grup, status, akun_terhitung, qty_terhitung, tier, harga_final? | — | — |

Data pribadi dalam event dibatasi id; nomor HP hanya diambil adapter WA dari tabel akun.

### 8.1 Aturan kepercayaan input (wajib)

- `akun_id` **selalu** diambil dari sesi terautentikasi, tidak pernah dari body/query/path. Field `id_akun` yang dikirim klien diabaikan atau ditolak 400 (CWE-639). Hal yang sama untuk pemakaian saldo: saldo yang didebit selalu saldo akun sesi.
- Zona **diturunkan server**: dari alamat kirim milik akun sesi (antar) atau dari drop point yang dipilih (B-13.3); `id_alamat` harus milik akun sesi; `id_drop_point` harus ada, aktif, dan berada di zona grup → selain itu 403 `LUAR_ZONA` / 422.
- Harga, diskon, ongkir, dan nominal tidak pernah diterima dari klien; semua dihitung server (PE, T-031, T-032). Ringkasan harga di respons hanya untuk tampilan.
- Setiap resource pengguna (pesanan, peserta, saldo, status) difilter `akun_id` sesi; akses lintas akun → 404. Tes API (T-044) wajib mencoba akses lintas akun.

---

## 9. Status terlihat pengguna & notifikasi WhatsApp

### 9.1 Teks UI per status

| Status internal | Teks UI singkat (Bahasa Indonesia) |
|---|---|
| Grup DIBUKA | "Grup baru dibuka · ajak 3 orang agar harga grup berlaku" |
| Grup BELUM_AKTIF | "{X} dari 3 orang · ajak {N} lagi agar harga grup berlaku" |
| Grup AKTIF, belum ada tier | "Grup aktif · {Z} lagi → Rp{harga tier}" |
| Grup AKTIF, `tier_tercapai` terisi | "Harga grup Rp{harga} tercapai · {Z} lagi → Rp{tier berikut}" |
| `pendaftaran_ditutup` | "Stok grup ini habis · coba slot berikutnya" |
| Grup CUT_OFF / DITAHAN | "Grup ditutup · harga final sedang dihitung" |
| Grup HARGA_TERKUNCI | "Harga final Rp{harga} · dikunci {waktu}" |
| Grup GAGAL | "Grup tidak tercapai (kurang dari 3 orang)" |
| Grup GAGAL_LANJUT_SATUAN | "Grup tidak tercapai · pesanan lanjut dengan harga satuan Rp{harga}" (peserta REFUND melihat teks DIREFUND) |
| Peserta DANA_DITAHAN | "Pesanan dibatalkan · dana sedang ditinjau, hubungi CS" |
| Grup DIBATALKAN | "Grup dibatalkan oleh NEKAT · dana masuk saldo" |
| Peserta MENUNGGU_BAYAR | "Menunggu pembayaran · bayar sebelum {waktu}" |
| Peserta LUNAS | "Sudah dibayar · menunggu grup ditutup {waktu cut-off}" |
| Peserta COD_TERKONFIRMASI | "Bayar di tempat · menunggu grup ditutup" |
| Peserta KEDALUWARSA | "Pembayaran kedaluwarsa · pesanan dibatalkan" |
| Peserta BATAL / DIREFUND | "Dibatalkan · Rp{nominal} masuk saldo" (tanpa dana: "Dibatalkan") |
| Peserta TERKUNCI | "Harga final Rp{harga} · sedang disiapkan" (+ "{qty_teralokasi} dari {qty} pcs tersedia" bila parsial) |
| Peserta DIKIRIM / SIAP_DIAMBIL | "Sedang diantar" / "Siap diambil di {drop point}" |
| Peserta DITERIMA | "Pesanan diterima" |

### 9.2 Notifikasi WhatsApp per transisi

Template final & batas frekuensi ditetapkan di T-010 [F-17]. Kode di bawah menjadi acuan.

| Kode | Transisi | Penerima | Isi ringkas |
|---|---|---|---|
| WA-01 | OTP | pemohon | Kode OTP |
| WA-02 | P4 / P2 / P3 (konfirmasi) | peserta | "Pesananmu di grup {produk} tercatat · cut-off {waktu} · link grup" |
| WA-03a | Sebelum kedaluwarsa bayar | peserta MENUNGGU_BAYAR | "Bayar sebelum {waktu} agar tetap ikut grup" |
| WA-03 | P5 | peserta | "Pembayaran kedaluwarsa, pesanan dibatalkan" |
| WA-04 | G3 | semua peserta terhitung | `tier_tercapai` null: "Grup {produk} aktif! {Z} lagi → Rp{harga tier}"; `tier_tercapai` terisi: "Grup {produk} aktif! Harga grup Rp{harga} berlaku · {Z} lagi → Rp{tier berikut}" (sejalan F-04: grup aktif tanpa tier tetap harga satuan) |
| WA-05 | G4, pengingat "kurang X orang" | peserta terhitung | "Kurang {X} orang lagi · bagikan link" |
| WA-06 | G6 naik tier | peserta terhitung | "Harga turun ke Rp{harga} · {Z} lagi → Rp{berikut}" |
| WA-06b | Pengingat cut-off | peserta [F-17] | "Grup ditutup {waktu}" |
| WA-07 | G9/G11 → P8 | peserta | "Harga final Rp{harga} · Rp{selisih} masuk saldo" |
| WA-08 | G8 / G8b / G11b | peserta terhitung | "Grup tidak tercapai · pesanan lanjut harga satuan Rp{harga} (+Rp{kredit} masuk saldo bila ada) / Rp{nominal} masuk saldo" |
| WA-09 | G10 | peserta | "Pesanan sedang kami periksa, kabar paling lambat {waktu}" |
| WA-10 | G15 / G12 / P7 | peserta | "Pesanan dibatalkan · Rp{nominal} masuk saldo" |
| WA-11 | B-09 parsial / P11 | peserta | "Maaf, {n} dari {qty} pcs tidak tersedia · Rp{nominal} masuk saldo" |
| WA-12 | P13 antar | peserta | "Pesanan sedang diantar" |
| WA-13 | P13 drop point | peserta | "Siap diambil di {drop point}, {jam}" |
| WA-14 | P14 | peserta | "Pesanan diterima, terima kasih" |
| WA-15 | P17 | pembayar | "Pembayaranmu masuk setelah batas waktu · Rp{nominal} masuk saldo" |

Pesan promo hanya untuk akun yang mencentang persetujuan promo; pesan transaksi di atas bukan promo.

---

## 10. Kasus uji

Data uji tanpa harga asli: gunakan harga fiktif dari fixture T-011. `t0` = waktu cut-off.

| ID | Langkah | Hasil yang diharapkan |
|---|---|---|
| TC-GO-01 | Akun A ikut produk P (zona Z, slot S) pertama kali | Grup DIBUKA dibuat dengan kode 6 karakter; A MENUNGGU_BAYAR |
| TC-GO-02 | A, B, C bayar (webhook PAID) | Grup BELUM_AKTIF (1, 2) lalu AKTIF di akun ke-3; WA-04 ke A, B, C |
| TC-GO-03 | A & B bersamaan membuat grup untuk kunci sama | Hanya satu grup; keduanya peserta grup yang sama |
| TC-GO-04 | 3 peserta dengan nomor HP sama (satu akun) mencoba ikut 3 kali | Ikut kedua & ketiga ditolak `SUDAH_PESERTA`; akun terhitung = 1 |
| TC-GO-05 | 3 akun ikut tapi hanya 2 yang lunas | Grup BELUM_AKTIF; akun MENUNGGU_BAYAR tidak dihitung [F-05] |
| TC-GO-06 | qty terhitung melewati MOQ tier 1 lalu tier 2 | `tier_tercapai` naik dua kali; WA-06 dua kali; progress "Z lagi" benar |
| TC-GO-07 | Grup AKTIF tier 2, cut-off | Harga final = harga tier 2; selisih per peserta = (harga dibayar − final) × qty masuk saldo; WA-07 |
| TC-GO-08 | Jalankan job cut-off dua kali | Ledger tidak ganda; notifikasi tidak ganda; status sama |
| TC-GO-09 | Cut-off dengan 2 akun terhitung, A=LANJUT_SATUAN, B=REFUND, stok cukup, modal tidak berubah | Grup GAGAL_LANJUT_SATUAN; A TERKUNCI jenis SATUAN; B DIREFUND penuh ke saldo; satu permintaan `picking:{grup_id}` berisi A saja; WA-08 |
| TC-GO-09b | Cut-off dengan 2 akun terhitung, keduanya REFUND | Grup GAGAL; keduanya DIREFUND; **tidak** ada permintaan picking |
| TC-GO-10 | Grup DIBUKA tanpa peserta terhitung saat cut-off | GAGAL, tanpa notifikasi |
| TC-GO-11 | Buka `/g/KODE` valid tanpa login, tekan Ikut | Diarahkan OTP → S&K → kembali ke grup yang sama dengan niat tersimpan |
| TC-GO-12 | Buka `/g/ZZZZZZ` tidak ada | "Link grup tidak ditemukan", tidak ada info lain |
| TC-GO-13 | Buka link grup yang sudah HARGA_TERKUNCI | "Grup ini sudah ditutup" + tombol slot berikutnya |
| TC-GO-14 | Login sukses, tolak S&K | Tidak ada peserta dibuat; katalog tetap bisa dilihat |
| TC-GO-15 | S&K versi baru terbit, akun lama ikut grup | Diminta setuju versi baru sebelum ikut [F-23] |
| TC-GO-16 | Lokasi di luar semua zona | Pesan di luar zona; tombol ikut/checkout tidak ada; API `ikut` → 403 `LUAR_ZONA` |
| TC-GO-17 | Pengguna zona Z2 membuka link grup zona Z1 | Tidak bisa ikut; ditawari grup produk sama di Z2 |
| TC-GO-18 | Stok tersisa 2, pengguna minta 5 | 422 `STOK_KURANG` tersisa 2 |
| TC-GO-19 | Stok jadi 0 sebelum cut-off | `pendaftaran_ditutup = true`; peserta lama tetap; stok kembali → dibuka lagi |
| TC-GO-20 | Stok riil saat cut-off 10, pesanan total 14 (A 6 lunas lebih dulu, B 4, C 4) | Alokasi A 6, B 4, C 0; C DIREFUND penuh; harga final dari qty 14 [F-09]; WA-11 ke C |
| TC-GO-21 | Alokasi parsial B 3 dari 4 (tanpa promo) | B TERKUNCI qty 3; saldo += harga dibayar × 1 + selisih harga × 3 |
| TC-GO-22 | Batal LUNAS sebelum cut-off | DIREFUND penuh ke saldo; grup dievaluasi ulang |
| TC-GO-23 | Batal tepat setelah job cut-off mulai (balapan) | Ditolak "Grup sudah ditutup"; tidak ada refund |
| TC-GO-24 | Peserta ke-3 batal saat AKTIF | Grup → BELUM_AKTIF; WA-05 ke 2 peserta lain |
| TC-GO-25 | Invoice kedaluwarsa | KEDALUWARSA; reservasi dilepas; debit saldo sementara kembali |
| TC-GO-26 | PAID tiba setelah KEDALUWARSA | Seluruh nominal pembayaran ke saldo, satu entri `bayar_terlambat:{pembayaran_id}`; WA-15; grup tidak berubah |
| TC-GO-26b | PAID terlambat untuk akun yang dibekukan | KEDALUWARSA → DANA_DITAHAN; tidak ada entri saldo |
| TC-GO-27 | Webhook PAID sama dikirim 3 kali | Satu transisi, satu WA-02 |
| TC-GO-28 | EXPIRED datang setelah PAID | Diabaikan; tetap LUNAS |
| TC-GO-29 | Webhook token salah | 401; tidak ada efek |
| TC-GO-30 | Nominal PAID ≠ invoice | Tetap MENUNGGU_BAYAR; alert admin |
| TC-GO-31 | Modal naik saat grup berjalan, masih di bawah harga dibayar | Peserta baru bayar harga baru; peserta lama tidak ditagih tambahan; harga final ≥ modal |
| TC-GO-32 | Modal naik di atas harga dibayar peserta lama sebelum cut-off, lalu cut-off berjalan | Grup DITAHAN; alert admin; WA-09 |
| TC-GO-33 | Admin menyelesaikan grup DITAHAN | HARGA_TERKUNCI; alur seperti TC-GO-07 |
| TC-GO-34 | Grup DITAHAN melewati batas waktu tahan | GAGAL; semua peserta LUNAS DIREFUND; peserta COD BATAL tanpa entri saldo [F-13] |
| TC-GO-35 | Ambil di drop point, total memenuhi syarat Mitra | Ongkir rumah 0; harga dibayar = harga Mitra; dihitung ke akun & qty grup |
| TC-GO-36 | Drop point vs antar dalam grup sama, cut-off | Harga final drop point = min(dibayar, tier, Mitra); pagar grup ≥ Mitra terjaga |
| TC-GO-37 | Pengguna COD lolos KPI, total ≤ Rp500.000 | COD_TERKONFIRMASI; dihitung ke akun; tagih saat antar = `tagihanBarangCod` (engine-harga §5.4, sudah memperhitungkan promo) + ongkir |
| TC-GO-38 | Pengguna COD, total > Rp500.000 / belum lolos KPI | Opsi COD tidak tampil; API menolak |
| TC-GO-39 | COD ditolak saat diantar | DITOLAK; tercatat untuk KPI COD; harga peserta lain tidak berubah |
| TC-GO-40 | Bayar penuh dengan saldo | Langsung LUNAS tanpa Xendit; dihitung ke akun |
| TC-GO-41 | INV mati saat cut-off | Grup DITAHAN; tidak ada picking; job ulang setelah pulih sukses tanpa duplikat |
| TC-GO-42 | WA mati saat cut-off | Harga tetap dikunci; notifikasi antre lalu terkirim sekali |
| TC-GO-43 | Job cut-off tidak berjalan | API ikut tetap menolak setelah `t0`; cron tiap menit berikutnya menjalankan job (`job_run` belum SELESAI) |
| TC-GO-44 | Penulisan ledger gagal (error DB disuntikkan) di transaksi langkah 9 | Seluruh transaksi rollback: grup tetap CUT_OFF, peserta tidak TERKUNCI, tidak ada outbox; run ulang mengkredit tepat sekali |
| TC-GO-45 | Admin membekukan akun peserta ke-3 (LUNAS) sebelum cut-off | Grup → BELUM_AKTIF; peserta itu BATAL → DANA_DITAHAN, `dana_ditahan = true`; **tidak** ada entri saldo [F-10] |
| TC-GO-45b | Admin melepas tahanan peserta TC-GO-45 | Satu entri `refund:{peserta_id}` (alasan `akun_dibekukan` di kolom alasan); DIREFUND; alasan tercatat di log admin |
| TC-GO-46 | Admin membatalkan grup AKTIF (peserta LUNAS + COD + MENUNGGU_BAYAR) | LUNAS DIREFUND; COD BATAL tanpa entri saldo; MENUNGGU_BAYAR BATAL + `saldo-balik`; WA-10; grup DIBATALKAN |
| TC-GO-47 | Harga di kartu vs detail vs halaman grup | Identik pada waktu yang sama; promo ditampilkan **terpisah** dari harga (tidak dilebur ke angka harga) di ketiga tempat |
| TC-GO-48 | Halaman grup sebagai pengguna lain | Hanya jumlah & nama samaran; tidak ada nomor HP/alamat |
| TC-GO-49 | Grup 2 akun, A=LANJUT_SATUAN; modal naik di atas harga dibayar A sebelum cut-off | Grup DITAHAN (bukan GAGAL_LANJUT_SATUAN); tidak ada kredit, refund, atau picking; WA-09; alert admin |
| TC-GO-50 | Admin menyelesaikan grup TC-GO-49 setelah modal dikoreksi | G11b → GAGAL_LANJUT_SATUAN; harga final ≥ modal; picking dikirim sekali |
| TC-GO-51 | Grup 2 akun, A=LANJUT_SATUAN qty 5, stok riil 3 | Alokasi A 3; kredit cut-off = refund stok 2 unit (+ selisih harga bila harga satuan turun); satu entri `selisih:{grup_id}:{peserta_id}` |
| TC-GO-52 | Grup GAGAL_LANJUT_SATUAN, job cut-off diulang | Status tetap; tidak ada kredit/picking ganda |
| TC-GO-53 | Peserta drop point harga Mitra membatalkan baris lain sehingga syarat Mitra hilang; modal saat cut-off > harga dibayar | Grup DITAHAN, tidak dikirim di bawah modal |
| TC-GO-54 | Gudang mati, snapshot lebih muda dari batas [P-10] | Ikut grup diterima; reservasi RSV dari snapshot |
| TC-GO-55 | Gudang mati, snapshot lebih tua dari batas | Ikut baru ditolak `SNAPSHOT_KEDALUWARSA`; peserta lama tidak terpengaruh |
| TC-GO-56 | Refund batal untuk baris dengan diskon | Nominal = nilai bersih sesuai engine-harga §5.4 (bukan harga dibayar × qty) |
| TC-GO-57 | Event & kolom waktu | Disimpan UTC; event ISO-8601 dengan offset; tampilan WIB |
| TC-GO-58 | Webhook PAID untuk pembayaran satu pesanan berisi 3 baris (3 grup) | Satu `external_id` = pembayaran_id; ketiga grup dikunci urut `grup_id`; ketiga peserta LUNAS; masing-masing grup dihitung ulang |
| TC-GO-59 | Dua webhook PAID paralel untuk akun ke-2 dan ke-3 grup yang sama | Diserialkan oleh kunci grup; grup → AKTIF **tepat sekali**; satu `GrupAktif`; WA-04 sekali per peserta |
| TC-GO-60 | PAID dengan `waktu_bayar` ≤ cut-off tiba saat job di langkah 5–8 (setelah `evaluasi_dimulai_pada` terisi) | Webhook → P17 (`bayar_terlambat:{pembayaran_id}` ke saldo, WA-15); langkah 9 lolos verifikasi himpunan; harga & alokasi tidak memuat peserta itu |
| TC-GO-61 | PAID dengan `waktu_bayar` ≤ cut-off tiba saat masa tenggang (setelah langkah 2 mengedaluwarsakan invoice di Xendit, `evaluasi_dimulai_pada` null) | Peserta masih MENUNGGU_BAYAR → P4 LUNAS; peserta masuk `himpunan_terhitung` langkah 4 |
| TC-GO-61b | Peserta masih MENUNGGU_BAYAR setelah masa tenggang | Langkah 2 tidak mengubah statusnya; transaksi langkah 4 memindahkannya ke KEDALUWARSA (reservasi dilepas, `saldo-balik:{pesanan_id}`); PAID sesudahnya → P17 |
| TC-GO-62 | Akun peserta terhitung dibekukan saat grup CUT_OFF antara langkah 4 dan 9 | Langkah 9 mendeteksi himpunan berubah → rollback → ulang dari langkah 4; hasil akhir konsisten, tanpa kredit ganda |
| TC-GO-63 | Xendit timeout di fase 2 checkout, invoice ternyata sudah dibuat | Cek ulang dengan `external_id` sama menemukan invoice; tidak ada invoice ganda; peserta tetap MENUNGGU_BAYAR |
| TC-GO-64 | Xendit timeout di fase 2, invoice terbukti tidak ada | Peserta KEDALUWARSA, reservasi & `debit:{pesanan_id}` dikembalikan (`saldo-balik:{pesanan_id}`) |
| TC-GO-65 | Akun dibekukan setelah HARGA_TERKUNCI | Flag `dana_ditahan`; tidak ada `selisih:{grup_id}:{peserta_id}`; status pengiriman tidak berubah |
| TC-GO-66 | Job cut-off mati di tengah, lease habis | Run berikutnya mengambil alih `job_run`; grup yang sudah > CUT_OFF dilewati; tidak ada efek ganda |
| TC-GO-67 | Semua baris satu pesanan di-refund saat grup GAGAL | Satu entri `refund_ongkir:{pesanan_id}` di samping `refund:{peserta_id}` per baris |
| TC-GO-68 | `POST ikut` dengan `id_akun` akun lain di body | Diabaikan/400; peserta dibuat untuk akun sesi saja; saldo akun lain tidak berubah |
| TC-GO-69 | `POST ikut` dengan `id_drop_point` di zona lain / alamat milik akun lain | 403 `LUAR_ZONA` / 422; tidak ada peserta |
| TC-GO-70 | Akun A membuka `GET pesanan/{id}` milik akun B | 404; tidak ada data B |
| TC-GO-71 | Grup GAGAL berisi 2 peserta: A LUNAS (REFUND), B COD | A DIREFUND + `refund:{peserta_id}`; B BATAL tanpa entri saldo |
| TC-GO-72 | Grup aktif, stok riil saat cut-off 0 | Semua peserta P11; tidak ada outbox `picking:{grup_id}`; grup SELESAI |
| TC-GO-73 | Grup aktif, peserta X alokasi 0 dengan harga dibayar < modal baru; peserta lain lolos pagar | Grup HARGA_TERKUNCI (X tidak diuji pagar, X → P11); tidak macet di CUT_OFF |
| TC-GO-74 | Pesanan MENUNGGU_BAYAR 2 baris dengan debit saldo sementara; pengguna batal; pembatalan invoice Xendit gagal lalu pengguna tetap membayar | Kedua baris BATAL + `saldo-balik`; PAID → P17 seluruh nominal ke saldo; tidak ada baris LUNAS |
| TC-GO-75 | Produk kategori rokok/bir dicoba dibuat grup | Ditolak; tidak ada grup |
| TC-GO-76 | Pesanan MENUNGGU_BAYAR berisi baris di grup X dan grup Y; admin membatalkan grup X (G15) | Baris X dan Y sama-sama BATAL, reservasi keduanya lepas, satu `saldo-balik:{pesanan_id}`, pembayaran `dibatalkan`; PAID yang masuk sesudahnya → P17 (seluruh nominal ke saldo); tidak ada baris Y yang tertinggal MENUNGGU_BAYAR |

---

## 11. Temuan ketidaksesuaian dokumen sumber

| # | Temuan | Dokumen | Tindakan |
|---|---|---|---|
| R-01 | Keputusan #3 menyebut grup "terbuka" pada ≥3 akun; S&K §4.2 & fase-1 menyebut "aktif" | keputusan.md, S&K | Dokumen ini memakai "dibuka" = dibuat, "aktif" = ≥3 [F-15] |
| R-02 | S&K §7.1 masih "[pilih]" saldo atau metode asal; keputusan #9 menyebut refund/selisih masuk saldo | S&K | Default: semua ke saldo [F-03]; S&K perlu disesuaikan (#5) |
| R-03 | S&K §4.5 menjamin pesanan dikirim dengan harga yang dibayar; tidak menjelaskan nasib bila grup gagal / modal naik | S&K | Lihat F-01, F-02, P-19 |
| R-04 | Fase-1 "pilih satuan jual (1 pcs, grup 6+, grup 12+)" ambigu: satuan beli per orang atau ambang grup | fase-1-mvp | F-04 / P-03 |
| R-05 | T-023 menyebut "stok habis → refund parsial ke saldo" tetapi tidak urutan alokasi | backlog | F-09 |
| R-06 | Fase-1 penomoran fitur loncat (8, 10, 11, 9) | fase-1-mvp | Kosmetik, tidak memengaruhi flow |
| R-07 | **Catatan untuk T-004/T-021:** `refund_ongkir:{pesanan_id}` hanya ditulis bila baris yang dibatalkan adalah baris **terakhir** pesanan yang belum batal. Pesanan multi-grup bisa dibatalkan dari beberapa transaksi grup sekaligus (G8 / langkah 9 di grup berbeda, P7), jadi pengecekan "baris terakhir" harus mengunci **baris pesanan** setelah peserta (urutan grup → stok SKU → peserta → pesanan → akun_saldo) dan membaca status semua baris di dalam kunci itu. Kunci ledger unik tetap pagar kedua bila dua transaksi sama-sama menganggap dirinya terakhir. | ADR-0001 §3.2 (urutan kunci sudah memuat `pesanan`) | T-004 merinci penguncian `pesanan` di model data; T-021 menguji dua grup gagal bersamaan untuk satu pesanan |

---

## 12. Keputusan terbuka untuk manusia

Semua **DEFAULT SEMENTARA** di bawah adalah **asumsi kerja dokumen ini, bukan keputusan**. Developer membangunnya sebagai konfigurasi/cabang yang bisa diganti. Keputusan final ditulis manusia di `project-specs/keputusan.md`.

### Butir lama (ID sudah ada di `keputusan-terbuka.md`)

| ID | Topik | Opsi | Rekomendasi | DEFAULT SEMENTARA (asumsi) |
|---|---|---|---|---|
| F-01 | Harga yang dibayar di muka & bila harga final lebih tinggi (terkait S&K §4.5, P-04, P-19) | A) bayar harga satuan, selisih kembali ke saldo saat cut-off; B) bayar harga tier yang tercapai saat ini, NEKAT menanggung bila final lebih tinggi (≥ modal); C) bayar tier saat ini, tagih kekurangan saat cut-off | A untuk pilot: tidak pernah menagih tambahan, tidak ada kerugian, sesuai S&K §4.4–4.5. Risiko: konversi turun karena bayar lebih besar di muka → uji oleh UX Researcher; B bisa diaktifkan lewat konfigurasi | **A**. FE wajib menampilkan "Bayar sekarang" + "Perkiraan kembali ke saldo" |
| F-02 | Grup gagal: lanjut harga satuan atau refund; default bila pengguna diam | A) pilihan saat ikut; B) jendela pilihan setelah cut-off; C) selalu refund; D) selalu lanjut | A: tidak menunda picking. Dengan F-01=A, lanjut tidak menagih tambahan | **A**, pilihan bawaan **LANJUT_SATUAN** (bisa diubah pengguna saat ikut). Peserta lanjut tetap melewati stok, engine harga, dan pagar modal saat cut-off; gagal pagar → DITAHAN (G10), bukan dikirim |
| F-03 | Semua refund & selisih ke saldo? Bisa dicairkan? (= H5) | A) semua ke saldo, tak bisa dicairkan; B) refund ke metode asal, selisih ke saldo; C) saldo bisa dicairkan dengan syarat | Perlu tinjauan hukum aturan uang elektronik BI | **A** di Fase 1 |
| F-04 | Satuan MOQ tier & harga grup dasar sebelum 6+ (= P-03) | A) total pcs semua peserta terhitung; B) pcs per orang; ada/tidak tier "grup dasar" saat ≥3 akun | A sesuai konsep pembelian bersama | **A**. Grup aktif tapi belum capai tier terendah → harga satuan, kecuali admin mengisi tier dasar (opsional) |
| F-05 | Siapa dihitung ke 3 akun; perlakuan COD | A) hanya LUNAS + COD_TERKONFIRMASI; B) termasuk MENUNGGU_BAYAR | A mencegah grup "palsu" | **A** |
| F-06 | Batas kuantitas per akun per grup | Tanpa batas / batas per produk | Batas per produk (field admin) | Field `maks_qty_per_akun` **kosong = tanpa batas** (dibatasi stok). **Catatan risiko keamanan (QA 11 Nov):** gabungan F-06 kosong + F-26 kosong memungkinkan satu akun mereservasi seluruh stok tanpa membayar sampai cut-off, sehingga `pendaftaran_ditutup` berlaku untuk semua orang (penimbunan, CWE-770). Rekomendasi agen (bukan keputusan): isi batas per produk, **dan** tambahkan batas teknis jumlah/qty reservasi belum dibayar per akun |
| F-07 | Batas pembatalan, kurangi qty, admin memajukan cut-off | Batal sampai cut-off / sampai X sebelum cut-off; kurangi qty ya/tidak; cut-off boleh dimajukan ya/tidak | Sampai cut-off (S&K §7) | Batal sampai cut-off; kurangi qty **tidak**; admin **tidak** boleh memajukan cut-off slot yang sudah punya peserta |
| F-08 | Modal berubah saat grup berjalan; snapshot MOQ (= P-08) | A) harga live, harga dibayar jadi batas atas; B) harga dibekukan sejak grup dibuka; C) grup ditahan | A + ambang margin menipis (P-08) | **A**; MOQ di-snapshot saat grup dibuka; harga dibayar < modal saat cut-off → DITAHAN |
| F-09 | Stok parsial: urutan alokasi, harga, bila tersisa <3 akun | Urutan bayar / proporsional; harga dihitung sebelum/sesudah alokasi | Urutan bayar (adil & mudah dijelaskan) | FIFO `waktu_bayar`, unit utuh; tier dari qty sebelum alokasi; grup tetap terkunci walau penerima < 3 |
| F-10 | Dana akun ganda/curang & evaluasi ulang grup | Ditahan / dikembalikan ke saldo / disita sesuai S&K | Ditahan sampai review admin | Sebelum harga dikunci: dikeluarkan dari hitungan; dana **ditahan** (status DANA_DITAHAN dari BATAL/KEDALUWARSA), **tidak** otomatis ke saldo; admin melepas/menetapkan dengan alasan tercatat. Setelah harga dikunci: hanya flag `dana_ditahan` yang menahan kredit cut-off; status pengiriman tidak berubah; tanpa evaluasi ulang grup. **Pertanyaan tambahan:** apakah barang untuk akun yang dibekukan setelah harga dikunci tetap dikirim? Default sementara: **tetap dikirim** |
| F-11 | Basis waktu pembayaran terlambat | `waktu_bayar` gateway / waktu webhook diterima | `waktu_bayar` + masa tenggang job | Lunas jika `waktu_bayar` ≤ cut-off dan diproses dalam masa tenggang; selain itu → saldo |
| F-12 | Drop point & antar rumah satu grup atau terpisah | Satu grup / grup terpisah per cara kirim | Satu grup (lebih cepat mencapai 3 akun) | Satu grup; harga per peserta = min(dibayar, tier, Mitra bila syarat); turun syarat Mitra karena batal → tidak ditagih tambahan |
| F-13 | Grup yang masih DITAHAN saat cut-off | Batas waktu tahan lalu gagal / pindah slot / tunggu admin | Batas waktu konfigurasi | Tidak diselesaikan sebelum batas (konfigurasi, kosong = sebelum picking slot) → **GAGAL + refund ke saldo** |
| F-14 | Satu atau beberapa grup per kunci | Satu / pecah bila penuh | Satu | **Satu** grup per produk × zona × slot |
| F-15 | Istilah ≥3 akun | "terbuka" / "aktif" | "aktif" (S&K) | Status `AKTIF`, teks "aktif"; "dibuka" = grup dibuat |
| F-16 | Produk sama di slot berbeda | Boleh / tidak | Boleh | **Boleh** (grup berbeda); satu peserta per grup |
| F-17 | Penerima pengingat & batas frekuensi WA | — | Batasi agar tidak dianggap spam | Pengingat cut-off & bayar ke semua peserta termasuk MENUNGGU_BAYAR; "kurang X orang" hanya ke terhitung; maks 1 per jenis per grup per hari (konfigurasi) |
| F-18 | Daftar tunggu di luar zona | Ada (perlu persetujuan data) / tidak | Tidak di Fase 1 | Hanya pesan "belum melayani"; tidak menyimpan data |

### Butir baru

| ID | Topik | Opsi | Rekomendasi | DEFAULT SEMENTARA (asumsi) | Pemilik usulan |
|---|---|---|---|---|---|
| F-19 | Pengguna zona lain membuka link grup | A) arahkan ke grup produk sama di zonanya; B) boleh ikut dengan antar lintas zona | A (zona = basis harga & ongkir) | **A** | Randy |
| F-20 | Ongkir saat sebagian baris batal / gagal / alokasi parsial | Tidak dihitung ulang / dihitung ulang & selisih ke saldo | Tidak dihitung ulang kecuali semua baris batal | Ongkir dikembalikan ke saldo hanya bila **semua** baris pesanan batal/refund | Efan + Operations |
| F-21 | Slot kirim dibatalkan operasional setelah harga dikunci (armada, cuaca) | Pindah ke slot berikut dengan harga terkunci / refund / pilihan pengguna | Pindah slot + boleh batal ke saldo | Admin memindahkan; harga tetap terkunci; pengguna boleh batal → saldo | Randy + Operations |
| F-22 | Atribusi pengundang pada link grup (Kebijakan Privasi §1) | Kode link sama untuk semua + parameter ref / tanpa atribusi | Parameter ref opsional (untuk Growth) | Parameter ref dicatat bila ada; **tidak** memengaruhi harga & tidak ada hadiah di Fase 1 | Randy + Growth |
| F-23 | Versi S&K / Kebijakan Privasi berubah saat pengguna sudah pernah setuju | Persetujuan ulang wajib sebelum ikut grup berikutnya / pemberitahuan saja | Persetujuan ulang wajib (perubahan penting, S&K §11) | Persetujuan ulang wajib sebelum ikut berikutnya; keikutsertaan yang sudah berjalan tetap pada versi yang disetujui saat ikut | Randy |
| F-24 | Keluhan barang rusak/kurang setelah diterima (S&K §6.3) | Kompensasi saldo / ganti barang di slot berikut | Pilihan admin per kasus | Admin memutuskan; kompensasi uang selalu ke saldo; tidak memengaruhi harga grup | Randy |
| F-25 | Ganti alamat / zona setelah ikut grup | Dikunci per pesanan / boleh ganti dalam zona yang sama | Boleh ganti dalam zona sama sebelum cut-off | Ganti alamat dalam zona sama boleh sebelum cut-off, ongkir tidak dihitung ulang (sejalan F-20); lintas zona = batal & ikut grup lain | Randy + Operations |
| F-26 | Lama batas bayar (TTL invoice Xendit) | Satu TTL untuk semua metode / TTL per metode (QRIS, VA, e-wallet); tutup pendaftaran sebelum cut-off agar ada waktu bayar | TTL per metode, tetap dipotong di cut-off (A-05) | TTL dari konfigurasi, **kosong = sampai cut-off**; pendaftaran tetap dibuka sampai cut-off. **Catatan risiko keamanan:** lihat F-06 — rekomendasi agen: TTL pendek per metode agar reservasi tidak dibayar cepat dilepas | Randy + Joseph |
| F-27 | Ada/tidaknya jalur "beli biasa" di luar grup (dulu asumsi A-03) | A) setiap pembelian produk bergrup di zona × slot otomatis menjadi peserta grup tsb.; B) ada jalur pembelian satuan terpisah yang tidak ikut grup | A (sederhana, setiap pembeli menambah progres grup) | **A**: tidak ada jalur beli biasa terpisah di Fase 1 | Randy |

Butir terkait di dokumen lain yang dipakai di sini: P-05 (syarat Mitra), P-09 (modal melewati harga saat cut-off), P-10 (usia data modal), P-18 (batas COD sebelum/sesudah saldo), P-19 (siapa menanggung bila final > dibayar), H2 (kanal cadangan OTP), H5 (pencairan saldo), H11 (deferred deep link).

---

## 13. Catatan revisi v0.4–v0.5 (sesi QA & perbaikan otomatis, 11 Nov 2026)

| Sumber | Temuan | Perbaikan |
|---|---|---|
| Code Reviewer 1 | Guard G9 vs G10 tidak simetris → grup bisa macet di CUT_OFF | G8b/G9/langkah 8 menguji pagar hanya untuk peserta alokasi > 0; TC-GO-73 |
| Code Reviewer 2 | WA-04 "harga grup berlaku" bertentangan dengan default F-04 | Teks WA-04 bergantung `tier_tercapai` |
| Code Reviewer 3 | Peserta COD diperlakukan seolah sudah bayar (G8, P10, P11, G12, TC-GO-34/46) | COD → BATAL tanpa dana, tanpa ledger; TC-GO-71 |
| Code Reviewer 4 | TC-GO-37 mengabaikan promo | Pakai `tagihanBarangCod` |
| Code Reviewer 5 | Rujukan ke dokumen yang belum di `main` | Baris "Urutan merge" di header |
| Code Reviewer 6, 10 | Istilah DIBUKA; grup tidak pernah SELESAI bila barang tidak diambil | Catatan istilah di §2; catatan terbuka untuk T-006 di B-15.6 |
| Code Reviewer 7 | Pembekuan akun belum di diagram peserta | Ditambah untuk MENUNGGU_BAYAR & COD_TERKONFIRMASI |
| Code Reviewer 8 | Picking kosong bila total alokasi 0 | G13/G14/langkah 10; TC-GO-72 |
| Code Reviewer 9, 11 | TC-GO-21/32 ambigu; guard rokok/bir & promo terpisah belum tersurat | Teks kasus uji diperjelas; prasyarat §2; TC-GO-47, TC-GO-75 |
| Security Auditor (BLOCKER) | `POST ikut` menerima `id_akun`/`id_zona` dari klien (IDOR, CWE-639) | §8.1 aturan kepercayaan input; guard P1; TC-GO-68–70 |
| Security Auditor 2 | Batal per baris saat MENUNGGU_BAYAR + `saldo-balik` seluruh pesanan → barang dibayar kurang bila invoice tetap dibayar (CWE-841) | P6: batal saat MENUNGGU_BAYAR = seluruh pesanan; P4 memeriksa pembayaran tidak dibatalkan & debit saldo masih aktif; TC-GO-74 |
| Security Auditor 3 | Penimbunan reservasi (F-06 + F-26 kosong, CWE-770) | Catatan risiko & rekomendasi di §12 (tidak diputuskan agen) |
| Security Auditor 4, saran | Aturan OTP; multi-SIM; `ref` opaque | B-03.2 merujuk ADR-0001 §4.3; B-17.5 sinyal deteksi; B-02.7 `ref` opaque |
| Code Reviewer putaran 2 | G15 untuk peserta MENUNGGU_BAYAR membatalkan invoice seluruh pesanan tetapi baris di grup lain tertinggal MENUNGGU_BAYAR | G15 membatalkan seluruh pesanan seperti P6 (kunci multi-grup); TC-GO-76 |
| Code Reviewer putaran 2 | Istilah `paid_at` vs `waktu_bayar` (ADR §3.2) | Diseragamkan `waktu_bayar` (= `paid_at` dari gateway) |

