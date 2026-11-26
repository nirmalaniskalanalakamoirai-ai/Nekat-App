# Spesifikasi Komponen UI — NEKAT Fase 1

| Atribut | Nilai |
|---|---|
| Task | T-008 (`task/T-008-komponen-ui`) |
| Versi | 0.2 — Draf (perbaikan review Code Reviewer, 15 temuan) |
| Tanggal | 26 Nov 2026 |
| Penyusun | UI Designer (squad Produk & flow, pemilik: Randy) |
| Sumber wajib | `project-specs/keputusan.md` (menang bila bertentangan); `docs/spec/T-007-ux-halaman.md` + `T-007-tokens.css`; `docs/spec/engine-harga.md` §5.1, §7; `docs/flow/group-order.md` §1, B-01, B-02, §8; `docs/spec/T-004-model-data.md` (`slot_kirim`); `keputusan-terbuka.md` (F-15, F-16, F-22, F-27, P-17, K-20, K-27, K-38 per 26 Nov) |
| Dipakai oleh | T-026 (katalog), T-027 (kartu produk), T-028 (detail), T-024 (link grup + PWA), T-033 (checkout), T-043 (E2E) |
| Di luar cakupan | Angka harga, margin, tarif, biaya admin (semua `Rp —` atau contoh **FIKTIF**); kode aplikasi |

Notasi: `{x}` = nilai dari server/konfigurasi. `Rp —` = nominal dari server. **DEFAULT SEMENTARA (U-xx)** = perilaku yang dipakai sampai keputusan terbuka baru (§8) dijawab. Contoh data bertanda `FIKTIF` hanya untuk Storybook/tes; angkanya sengaja tidak realistis dan bukan harga produk.

---

## 0. Aturan yang mengikat semua komponen

| # | Aturan (sumber) | Akibat di komponen |
|---|---|---|
| R1 | Grup **per keranjang**, campur produk (G-01, F-14) | Tidak ada progres per produk. Progres = syarat **grup milik pengguna** (akun berbarang & total grup). |
| R2 | Kartu & detail menampilkan **"Harga Belanja Bareng"**; kata **"Mitra"** dan info **drop point** hanya di checkout (K-38, P-28) | String "Mitra" / "drop point" dilarang di kartu, detail, pemilih satuan, pemilih slot, pesan WhatsApp, banner. |
| R3 | Harga coret = **harga satuan riil** (P-17) = `H(s, INDIVIDU)`, hanya bila `> hargaAktif` (engine-harga §5.1) | Tidak ada "harga coret" karangan. Di katalog tanpa grup, `hargaCoret` biasanya `null`. |
| R4 | Harga kartu = harga detail = halaman grup untuk satuan & konteks sama; promo **terpisah** (CLAUDE.md, PG-6) | Satu komponen `Harga` dipakai di semua tempat; input hanya `TampilanHarga` dari server; promo selalu chip sendiri. |
| R5 | Produk tanpa harga tidak tayang (keputusan #6) | `hargaAktif = null` di konteks katalog → kartu **tidak dirender** (defensif) + log tanpa PII. |
| R6 | Stok habis: tampil "Stok habis, segera distok", tombol nonaktif, tidak bisa masuk keranjang/grup (K-20) | Lihat state "stok habis" tiap komponen. |
| R7 | Satuan jual hanya `PCS_1`, `PCS_3`, `LUSIN`, `DUS`, `KOLI`, yang tersedia per produk (P-03) | Pemilih satuan maks 5 opsi, urutan tetap kecil → besar. |
| R8 | Satuan tanpa harga Mitra Grosir → di grup memakai harga satuan (K-27) | Opsi/kartu tanpa `hargaGrup`: tanpa baris Belanja Bareng; di grup diberi keterangan "Tidak dapat Harga Belanja Bareng". |
| R9 | Tanpa pembulatan (H6, K-28) | Rupiah selalu integer penuh "Rp12.345". Dilarang "Rp12rb", "Rp12,3 rb", "±". Format: `"Rp" + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n)` (tanpa spasi). |
| R10 | Istilah grup ≥ 3 akun = **"terbuka"** (F-15) | Kata "terbuka" hanya untuk grup ≥ 3 akun berbarang. Grup < 3 akun: "Kurang {x} orang" (lihat U-08). |
| R11 | Boleh ikut produk yang sama di slot berbeda (F-16) | Satu akun bisa punya > 1 grup aktif (beda slot) → target tombol "+" perlu aturan (U-03). |
| R12 | Deferred deep link iOS ditunda ke Fase 5 (H11) | Banner pasang di iOS hanya petunjuk manual; tidak menjanjikan "kembali otomatis ke grup". |
| R13 | Harga tidak dihitung di klien (ADR-0001, T-007 A20); offline = harga disembunyikan | Semua harga dari `TampilanHarga`. Pengecualian terbatas: U-04. |
| R14 | Setelah tagihan terbit tidak bisa tambah anggota/barang (K-22) | "+" ke grup itu & tombol ajak disembunyikan/nonaktif setelah tagihan terbit. |

**Temuan judul task:** judul T-008/T-027 "progress grup *X/Y di zona kamu · Z lagi → harga*" dan T-028 "pilih satuan jual (1 pcs, grup 6+, grup 12+)" **tidak cocok lagi** dengan G-01/K-09/K-14: tidak ada tangga kuantitas dan tidak ada progres per produk per zona (satu zona × slot bisa punya banyak grup). Pengganti di dokumen ini: `ProgresGrupRingkas` "Grup {nama}: {n}/{minAkun} orang · Rp — dari {min_grup}" (§1.6) dan pemilih satuan P-03 (§2). Judul backlog T-027/T-028 perlu diselaraskan PM (U-02).

**Token:** semua komponen hanya memakai token `T-007-tokens.css` (`apps/web/src/styles/tokens.css`). **Tidak ada warna baru.** Pemetaan warna per komponen ada di masing-masing bagian.

**Lokasi kode (usulan T-014/T-027):** `apps/web/src/komponen/<Nama>/<Nama>.tsx` + `<Nama>.module.css` (hanya membaca token). Semua teks di berkas string tunggal `apps/web/src/teks/id.ts` dengan kunci di kolom "Kunci" tabel teks.

---

## 1. `KartuProduk` (+ subkomponen `Harga`, `ProgresGrupRingkas`)

### 1.1 Tujuan
Membuat pembeli bisa memutuskan dan menambah barang dengan satu ketukan dari grid katalog, sambil melihat harga yang **sama persis** dengan halaman detail dan manfaat Belanja Bareng.

### 1.2 Anatomi (urut DOM)
```
article.kartu  (aria-labelledby = nama)
├─ a.kartu__tautan → /p/{slug}  (membungkus foto + nama; satu target)
│  ├─ figure.kartu__foto  (1:1, loading=lazy, width/height tetap)
│  │  └─ span.chip  "Stok habis, segera distok"     [hanya state habis]
│  └─ h3.kartu__nama  (maks 2 baris, line-clamp)
├─ p.kartu__satuan   "per {labelSatuan}"
├─ Harga varian="kartu"
│  ├─ s.price--strike  hargaCoret                    [bila ada]
│  ├─ span.price.price--card  hargaAktif + "/{satuanPendek}"
│  └─ span.chip.chip--group  "Harga Belanja Bareng Rp —"   [konteks katalog, hargaGrup ≠ null]
├─ span.chip.chip--promo  promo.label (+ nominal, U-09)   [bila promo ≠ null]
├─ ProgresGrupRingkas varian="chip"                   [konteks grup, U-02]
├─ p.kartu__stok  "Sisa {n} {satuanPendek}"            [stok TERBATAS]
└─ TombolTambah  ("+" 48 px  ↔  Stepper − n +)        [pojok kanan bawah foto]
```
Tombol "+" **di luar** tautan (tidak bersarang dalam `<a>`), diposisikan absolut di atas foto.

### 1.3 Props / data
Sumber: respons katalog (T-025/T-026) — usulan bentuk, skema final milik Backend Architect. `TampilanHarga` = antarmuka engine-harga §7 (tidak diubah).

```ts
type Rupiah = number;                       // integer ≥ 0 dari server
type KodeSatuan = 'PCS_1' | 'PCS_3' | 'LUSIN' | 'DUS' | 'KOLI';

interface KartuProdukData {                 // GET /katalog?zona=&kategori=&q=&halaman=
  idProduk: string; slug: string; nama: string;
  foto: { url: string; alt: string } | null;
  satuanDefault: { idSatuanJual: string; kode: KodeSatuan; isi: number };  // satuan terkecil yang tersedia
  jumlahSatuan: number;                     // >1 → snackbar "Ganti satuan"
  tampilanHarga: TampilanHarga;             // untuk satuanDefault & konteks sesi (KATALOG / GRUP)
  keteranganHarga: KeteranganHarga;         // turunan SERVER (usulan §7), lihat §1.4
  promoPerProduk: boolean;                  // SERVER: true bila promo berlaku per produk (nominal boleh tampil, U-09)
  stok: { status: 'TERSEDIA' | 'TERBATAS' | 'HABIS'; sisa: number | null };  // sisa dalam satuanDefault
  bebasPpn: boolean;                        // tidak ditampilkan di kartu (detail saja)
}
type KeteranganHarga =
  | 'GRUP_BERLAKU'                          // konteks GRUP, syarat terpenuhi, hargaAktif = harga Mitra Grosir
  | 'GROSIR_TIDAK_TERSEDIA'                 // konteks GRUP, syarat terpenuhi, satuan tanpa sel Mitra Grosir (K-27) → harga satuan
  | null;                                   // lainnya (KATALOG, GRUP belum terpenuhi, setelah tagihan)
interface KonteksBelanja {                  // GET /sesi/konteks (usulan) — satu kali per halaman, bukan per kartu
  grupAktif: Array<{
    kode: string; nama: string; status: StatusGrup;
    syarat: StatusSyaratGrup;               // engine-harga §7
    minAkun: number;                        // konfigurasi grup.min_akun — JANGAN hardcode 3
    minTotal: Rupiah; tagihanTerbit: boolean; slot: RingkasSlot;
  }>;                                       // bisa > 1 (F-16)
  qtyDiKeranjang: Record<string /*idSatuanJual*/, number>;
  online: boolean; dalamZona: boolean;
}
interface KartuProdukProps {
  data: KartuProdukData; konteks: KonteksBelanja;
  // Respons server setelah tambah/ubah = KonteksBelanja terbaru (qty terkonfirmasi + syarat grup)
  onTambah(idSatuanJual: string): Promise<KonteksBelanja>;
  onUbahQty(idSatuanJual: string, qty: number): Promise<KonteksBelanja>;
}
```
Label satuan: `PCS_1` "1 pcs" (pendek "pcs") · `PCS_3` "3 pcs" ("3 pcs") · `LUSIN` "lusin (isi {isi})" ("lusin") · `DUS` "dus (isi {isi})" ("dus") · `KOLI` "koli (isi {isi})" ("koli").

### 1.4 Komponen `Harga` (dipakai kartu, detail, pemilih satuan, halaman grup)
| Prop | Tipe | Catatan |
|---|---|---|
| `tampilan` | `TampilanHarga` | satu-satunya sumber angka |
| `satuan` | `{ kode, isi }` | untuk "/pcs", "/dus" |
| `varian` | `'kartu' \| 'detail' \| 'opsi' \| 'baris'` | ukuran: `.price--card` (18 px) / `.price--detail` (24 px) / `--text-base` / `--text-base` |
| `keterangan` | `KeteranganHarga` | field turunan server per satuan (§1.3); `Harga` **tidak** menebak dari `syarat`/`peringatan` |

Aturan tampil (hanya membaca `tampilan` + `keterangan`):
1. `hargaCoret` ≠ null → `<s class="price--strike">` (P-17). Ditaruh **sebelum** harga aktif.
2. `hargaAktif` ≠ null → `.price` + satuan pendek. `hargaAktif` = null → hanya teks `teksStatus` (tabel 1.8), tanpa angka.
3. `teksStatus` ≠ null dan `hargaAktif` ≠ null → **keduanya** tampil: angka harga lalu baris kecil `--color-text-muted` teks status (mis. "Harga final").
4. `hargaGrup` ≠ null (artinya KATALOG atau GRUP belum terpenuhi, engine-harga §5.1) → chip `.chip--group` "Harga Belanja Bareng Rp —" (K-38). `hargaGrup` = null → tanpa chip.
5. `keterangan = 'GRUP_BERLAKU'` → label kecil `--color-price-group` "Harga Belanja Bareng" di atas angka; coret (bila ada) = harga satuan.
6. `keterangan = 'GROSIR_TIDAK_TERSEDIA'` (K-27) → keterangan `--color-text-muted` "Tidak dapat Harga Belanja Bareng"; tanpa label grup; `hargaCoret` = null (harga aktif = harga satuan) sehingga tanpa `<s>`.
7. Promo **tidak pernah** di dalam `Harga`; induk merender chip promo terpisah.
8. Sebelum tagihan terbit, varian `detail` menambah catatan "Harga bisa berubah sampai tagihan terbit" (T-007 A10). Kartu tidak (ruang sempit).

### 1.5 State
| State | Pemicu | Tampilan | Tombol "+" |
|---|---|---|---|
| Default (katalog) | `stok.status = TERSEDIA`, online | Harga aktif + chip Belanja Bareng bila ada | aktif |
| Memuat | data belum ada | Skeleton seukuran kartu: kotak 1:1, 2 baris nama, 1 baris harga (`.skeleton`, statis bila reduced-motion) | tidak dirender |
| Tanpa promo | `promo = null` | Chip promo tidak dirender, **tanpa ruang kosong**; tinggi kartu disamakan oleh grid (`align-items: stretch`, blok harga menempel bawah) | aktif |
| Dengan promo | `promo ≠ null` | Chip `.chip--promo` di baris sendiri di bawah `Harga`: `promo.label` (+ "s.d. {tanggal}" bila `berlakuSampai`); nominal `hargaSetelahPromo` **hanya** bila `promoPerProduk = true` (U-09) | aktif |
| Tanpa harga grup (K-27), katalog | `hargaGrup = null`, `keteranganHarga = null` | Tanpa chip Belanja Bareng | aktif |
| Stok terbatas | `TERBATAS`, `sisa` | "Sisa {n} {satuanPendek}" `--color-warning` | aktif; stepper maks `sisa` |
| **Stok habis** (K-20) | `HABIS`, `qtyDiKeranjang = 0` | Foto `filter: grayscale(1)` (gambar saja, teks tetap kontras penuh, **bukan** `opacity` pada teks); chip netral `.chip` "Stok habis, segera distok" di atas foto; harga tetap tampil | **tidak ada tombol**: diganti teks biasa `<p>` "Stok habis" di kotak 48 px (tidak fokusable, tidak bisa ditekan) |
| Stok habis, barang sudah di keranjang | `HABIS`, `qtyDiKeranjang > 0` | Seperti stok habis + stepper tetap tampil | "+" `<button disabled>` (label "Stok habis"); "−"/hapus **tetap aktif** agar pembeli bisa mengurangi/menghapus |
| Konteks grup, syarat belum | grup DIBUKA, `syarat.terpenuhi = false` | Harga satuan + chip Belanja Bareng (`hargaGrup`) + `ProgresGrupRingkas` chip | aktif → ke grup (U-03) |
| Konteks grup, syarat terpenuhi | `keteranganHarga = GRUP_BERLAKU` | Label "Harga Belanja Bareng", harga grup, coret harga satuan | aktif |
| Grup terpenuhi, satuan tanpa Mitra Grosir (K-27) | `keteranganHarga = GROSIR_TIDAK_TERSEDIA` | Harga satuan + "Tidak dapat Harga Belanja Bareng"; tanpa `<s>`, tanpa chip grup | aktif |
| Tagihan grup terbit (K-22) | `tagihanTerbit = true` | Harga `D` + teks status (`MENUNGGU_PELUNASAN` / `MENUNGGU_CUTOFF`) | ke grup: tidak; DEFAULT SEMENTARA U-03: ke keranjang biasa + snackbar |
| Harga final | `HARGA_FINAL_TERKUNCI` / `GRUP_DIPROSES` | Harga `F` + teks status | ke grup: tidak (seperti baris atas) |
| Harga tidak tersedia | `hargaAktif = null` di konteks GRUP (DITAHAN/BATAL) | Teks `teksStatus` saja | nonaktif |
| Syarat grup berubah | respons `onTambah`/`onUbahQty` membawa `syarat.terpenuhi` berbeda dari sebelumnya (mis. akun ke-3 menambah barang) | Katalog & detail yang terbuka **memuat ulang** `tampilanHarga` + `keteranganHarga` dari server; selama memuat, angka harga diganti skeleton baris harga (bukan angka lama) | aktif |
| Error tambah | API `onTambah`/`onUbahQty` gagal | Stepper kembali ke **qty terakhir yang dikonfirmasi server** (bukan nilai optimistis antara); snackbar `role="alert"` "Gagal menambah. Coba lagi." | aktif |
| Offline | `online = false` | Harga diganti "—", chip promo & Belanja Bareng disembunyikan, stok disembunyikan | nonaktif, `aria-describedby` → pita offline |
| Di luar zona | `dalamZona = false` | Harga tampil (mode lihat) | nonaktif + "NEKAT belum melayani lokasimu" (sekali di atas grid, bukan per kartu) |
| Tidak tayang (defensif) | `hargaAktif = null` di KATALOG | Kartu tidak dirender | — |

### 1.6 `ProgresGrupRingkas`
Pengganti "X/Y di zona kamu · Z lagi → harga" (R1). Data: `grupAktif[i].syarat` + `minAkun` + `minTotal` (angka "3" di teks di bawah = `{minAkun}`, tidak di-hardcode). Satu sumber untuk semua kartu; dirender **lengkap sekali** di pita grup aktif di atas grid, dan sebagai **chip pendek** di kartu (DEFAULT SEMENTARA U-02).

| Kondisi (`syarat`) | Pita (lengkap) | Chip kartu |
|---|---|---|
| `kurangAkun > 0`, `kurangRupiah > 0` | "Grup {nama}: {n}/{minAkun} orang · Rp — dari {min_grup} · kurang {kurangAkun} orang dan Rp — lagi" | "Kurang {kurangAkun} orang" |
| `kurangAkun > 0`, `kurangRupiah = 0` | "Grup {nama}: {n}/{minAkun} orang · kurang {kurangAkun} orang lagi. Ajak tetangga!" | "Kurang {kurangAkun} orang" |
| `kurangAkun = 0`, `kurangRupiah > 0` | "Grup {nama} terbuka · tambah belanja Rp — lagi agar dapat Harga Belanja Bareng" | "Tambah Rp — lagi" |
| terpenuhi | "Grup {nama} terbuka · Harga Belanja Bareng berlaku untuk semua barang" | "Harga Belanja Bareng berlaku" (`.chip--success` + ikon centang) |

Pita memakai `.progress` dua batang: orang (`n/minAkun`) dan total (`totalGrup/minTotal`, maks 100%), masing-masing `role="progressbar"` dengan `aria-valuenow/min/max` dan `aria-valuetext` = teks lengkap. Nominal Rupiah dari server (`kurangRupiah`, `totalGrup`); klien tidak mengurangkan.

### 1.7 Perilaku & interaksi
- Ketuk foto/nama → `/p/{slug}` dengan satuan default terpilih.
- "+" → `onTambah(satuanDefault)` optimistis: tombol jadi stepper `− 1 +` (tiap tombol 44 px, jarak 8 px), `aria-live="polite"` "{nama} ditambahkan, jumlah 1". Gagal → rollback ke qty terakhir terkonfirmasi server.
- Respons `onTambah`/`onUbahQty` = `KonteksBelanja` terbaru. Klien menyimpan `qtyDiKeranjang` dari respons itu sebagai nilai terkonfirmasi. Bila `syarat.terpenuhi` salah satu grup berubah (mis. akun ke-3 menambah barang, atau total melewati `minTotal`), halaman yang terbuka (katalog/detail) memuat ulang `tampilanHarga` + `keteranganHarga` dari server. Klien **tidak** mengganti harga sendiri.
- `jumlahSatuan > 1` → snackbar "Ditambahkan 1 {satuanPendek} · Ganti satuan" (tautan ke detail).
- Stepper "−" di qty 1 berubah ikon tempat sampah, label "Hapus {nama} dari keranjang"; hapus memberi "Urungkan" 5 detik.
- Ketukan beruntun digabung (debounce 300 ms) jadi satu `onUbahQty`.
- Target "+" saat punya grup: U-03.

### 1.8 Teks persis
| Kunci | Teks |
|---|---|
| `kartu.per` | "per {labelSatuan}" |
| `harga.belanjaBareng` | "Harga Belanja Bareng" |
| `harga.belanjaBarengNominal` | "Harga Belanja Bareng Rp{nominal}" |
| `harga.tidakDapatGrup` | "Tidak dapat Harga Belanja Bareng" |
| `harga.srCoret` | "Harga satuan" |
| `harga.berubahSampaiTagihan` | "Harga bisa berubah sampai tagihan terbit" |
| `harga.status.MENUNGGU_PELUNASAN` | "Harga sudah terkunci di tagihan" |
| `harga.status.MENUNGGU_CUTOFF` | "Harga di tagihan · menunggu grup tutup" |
| `harga.status.HARGA_FINAL_TERKUNCI` | "Harga final" |
| `harga.status.GRUP_DIPROSES` | "Harga final · pesanan sedang disiapkan" |
| `harga.status.DIPERIKSA` | "Harga sedang kami periksa" |
| `harga.status.GRUP_BATAL` | "Grup batal" |
| `harga.status.HARGA_TIDAK_TERSEDIA` | "Harga belum tersedia" |
| `harga.status.*` lain (kode tak dikenal) | tidak menampilkan teks; log peringatan (tanpa PII) |

Kode `teksStatus` di atas = semua nilai yang dipakai engine-harga §5.1 / TC-HE-38. `MENUNGGU_PELUNASAN`, `MENUNGGU_CUTOFF`, `HARGA_FINAL_TERKUNCI`, `GRUP_DIPROSES` datang **bersama** `hargaAktif` (D atau F) → tampil berdua (aturan §1.4 no. 3). `DIPERIKSA`, `GRUP_BATAL`, `HARGA_TIDAK_TERSEDIA` datang dengan `hargaAktif = null` → teks saja.
| `stok.habis` | "Stok habis, segera distok" |
| `stok.habisPendek` | "Stok habis" |
| `stok.sisa` | "Sisa {n} {satuanPendek}" |
| `kartu.tambahAria` | "Tambah 1 {satuanPendek} {nama} ke keranjang" |
| `kartu.kurangiAria` / `kartu.hapusAria` | "Kurangi 1 {nama}" / "Hapus {nama} dari keranjang" |
| `kartu.ditambahkan` | "Ditambahkan 1 {satuanPendek}" · tautan "Ganti satuan" |
| `kartu.gagalTambah` | "Gagal menambah. Coba lagi." |
| `umum.offline` | "Kamu sedang offline. Harga akan muncul lagi saat tersambung." |

### 1.9 Aksesibilitas
- `article` + `h3` nama; satu tautan (foto + nama) agar pembaca layar tidak membaca dua tautan sama.
- Harga dibaca utuh lewat **satu** `<span class="sr-only">` di awal blok `Harga` berisi kalimat lengkap, mis. "Harga satuan Rp2.222, sekarang Rp1.111 per pcs, Harga Belanja Bareng." (contoh FIKTIF). Semua angka & label visual di blok itu (`<s>`, `.price`, label grup) diberi `aria-hidden="true"` agar tidak dibaca dua kali. Tidak memakai `aria-label` pada elemen non-interaktif. Chip "Harga Belanja Bareng Rp —" (katalog) ikut masuk kalimat sr-only yang sama.
- "+" `<button>` 48 × 48 px (`--tap-comfort`); stepper `role="group"` `aria-label="Jumlah {nama}"`, angka `aria-live="polite"`.
- Kontras (T-007 §8.2): harga `--color-price` 16.9:1; coret `--color-price-strike` (= muted) 7.9:1; chip grup 5.6:1; chip promo 6.9:1; peringatan stok `--color-warning` di `--color-surface` 6.8:1 (terang) / 9.2:1 (gelap), dihitung WCAG 2.1.
- Stok habis tidak hanya abu: ada teks. Chip status pakai ikon + teks (AX7).
- Nama 2 baris dipotong visual saja; `title` tidak dipakai (tidak terbaca di HP), nama penuh ada di DOM.

### 1.10 Contoh data FIKTIF
```json
{
  "_catatan": "FIKTIF — bukan produk/harga nyata",
  "idProduk": "prd_fiktif_01", "slug": "minyak-contoh-1l", "nama": "Minyak Goreng Contoh 1 L",
  "foto": { "url": "/fiktif/minyak.webp", "alt": "Botol minyak goreng contoh 1 liter" },
  "satuanDefault": { "idSatuanJual": "sj_f01", "kode": "PCS_1", "isi": 1 },
  "jumlahSatuan": 3,
  "tampilanHarga": { "idVersiHarga": "v-fiktif", "hargaAktif": 2222, "hargaGrup": 1111,
                     "hargaCoret": null, "teksStatus": null, "promo": null },
  "keteranganHarga": null, "promoPerProduk": false,
  "stok": { "status": "TERBATAS", "sisa": 4 }, "bebasPpn": true
}
```

### 1.11 Kriteria terima / kasus uji
| ID | Kasus | Hasil yang diharapkan |
|---|---|---|
| TC-UI-01 | Kartu & detail, satuan default & konteks sama | E2E mencegat respons API katalog & detail: `idVersiHarga`, `hargaAktif`, `hargaCoret`, `hargaGrup`, `keteranganHarga` identik (sejalan TC-HE-14); teks harga yang tampil (nama aksesibel blok `Harga`) identik. `idVersiHarga` **tidak** dirender di DOM |
| TC-UI-02 | `promo = null` | Tidak ada elemen chip promo; tidak ada ruang kosong |
| TC-UI-03 | `promo ≠ null` | Chip promo di luar elemen `Harga`; angka harga aktif tidak berubah |
| TC-UI-04 | Katalog, `hargaCoret = null` | Tidak ada `<s>` |
| TC-UI-05 | Grup terpenuhi, `hargaCoret` = harga satuan | `<s>` (aria-hidden) berisi harga satuan; kalimat `.sr-only` diawali "Harga satuan Rp…" |
| TC-UI-06 | `stok.status = HABIS`, belum di keranjang | Teks "Stok habis, segera distok" + teks "Stok habis" di posisi "+"; tidak ada `<button>` tambah; tidak ada elemen `aria-disabled` palsu; API tambah tidak dipanggil |
| TC-UI-06b | `HABIS`, `qtyDiKeranjang = 2` | "+" `disabled`; "−" aktif → qty 1; hapus aktif |
| TC-UI-07 | `hargaGrup = null` | Tidak ada teks "Harga Belanja Bareng" di kartu katalog |
| TC-UI-08 | Seluruh DOM kartu/detail | Tidak mengandung "Mitra", "drop point", "modal", "tier", "MOQ" |
| TC-UI-09 | `hargaAktif = null` di katalog | Kartu tidak dirender |
| TC-UI-10 | Offline | Semua harga "—", "+" nonaktif, pita offline tampil |
| TC-UI-11 | Nominal 9999999 (FIKTIF) | Tampil "Rp9.999.999", bukan "Rp10 jt" / "Rp9,9 jt" |
| TC-UI-12 | "+" gagal (500) | Stepper kembali ke qty terkonfirmasi server, snackbar `role="alert"` |
| TC-UI-12b | Qty terkonfirmasi 2; ketuk "+" 3× cepat (≤ 300 ms antar ketukan) | Tepat **satu** `onUbahQty(…, 5)`; bila gagal → stepper kembali ke 2 (bukan 3/4) |
| TC-UI-12c | Grup 2/{minAkun} orang; akun ke-3 menambah barang (respons `syarat.terpenuhi` jadi true) | Katalog memuat ulang harga; kartu & detail produk yang sama sama-sama menampilkan label "Harga Belanja Bareng" + harga grup + coret harga satuan |
| TC-UI-12d | `keteranganHarga = GROSIR_TIDAK_TERSEDIA` (grup terpenuhi) | "Tidak dapat Harga Belanja Bareng" tampil; tidak ada `<s>`; tidak ada label "Harga Belanja Bareng" |
| TC-UI-12e | `teksStatus` = `MENUNGGU_PELUNASAN` / `MENUNGGU_CUTOFF` / `HARGA_FINAL_TERKUNCI` / `GRUP_DIPROSES`, `hargaAktif` ≠ null | Per kode: angka harga **dan** teks status persis (§1.8) tampil bersama |
| TC-UI-12f | `teksStatus` = `DIPERIKSA` / `GRUP_BATAL` / `HARGA_TIDAK_TERSEDIA`, `hargaAktif = null` | Per kode: hanya teks status; tidak ada angka; "+" nonaktif |
| TC-UI-12g | `grupAktif[0].minAkun = 4` (konfigurasi FIKTIF) | Teks "{n}/4 orang"; tidak ada "/3" |
| TC-UI-12h | Pembaca layar pada blok `Harga` | Harga dibaca tepat satu kali (satu `.sr-only`, angka visual `aria-hidden`) |
| TC-UI-13 | Lebar 320 px, zoom 200% | Tidak ada scroll horizontal; "+" tetap 48 px dan tidak menutupi harga |
| TC-UI-14 | Grup ≥ 3 akun | Kata "terbuka" muncul; grup < 3 akun tidak memakai kata "terbuka" |

---

## 2. `PemilihSatuan` (pilih satuan jual)

### 2.1 Tujuan
Di detail produk (H-03), memilih satu satuan jual P-03 yang tersedia dan melihat harganya, termasuk harga Belanja Bareng per satuan.

### 2.2 Anatomi
```
fieldset.pilih-satuan
├─ legend  "Pilih satuan"
└─ div[role=radiogroup] (daftar vertikal, 1 kolom; ≥ 600 px: 2 kolom)
   └─ label.opsi (kartu, min-height 56 px) × n  ← input[type=radio] tersembunyi visual
      ├─ span.opsi__nama     "Dus (isi 24)"
      ├─ Harga varian="opsi" (coret? + aktif "/dus")
      ├─ span.opsi__setara   "setara Rp — /pcs"        [U-01]
      ├─ span.opsi__grup     "Harga Belanja Bareng Rp —" | "Tidak dapat Harga Belanja Bareng"
      └─ span.opsi__stok     "Stok habis" | "Sisa {n}"   [bila perlu]
```
Satu satuan saja → tidak ada radiogroup; tampil teks statis "Dijual per {labelSatuan}" + `Harga`.

### 2.3 Props / data
```ts
interface OpsiSatuan {                      // GET /produk/{slug} → satuan[] (T-025/T-028)
  idSatuanJual: string; kode: KodeSatuan; isi: number;
  tampilanHarga: TampilanHarga;
  keteranganHarga: KeteranganHarga;         // §1.3; per satuan (K-27 bisa beda antar satuan)
  setaraPerPcs: Rupiah | null;              // dihitung SERVER; null bila tidak habis dibagi (U-01)
  stok: { status: 'TERSEDIA' | 'TERBATAS' | 'HABIS'; sisa: number | null };  // dalam satuan ini (U-07)
}
interface PemilihSatuanProps {
  opsi: OpsiSatuan[];                       // hanya satuan yang tayang; server sudah membuang yang tanpa harga/pecahan (K-01, K-28)
  terpilih: string | null; onPilih(idSatuanJual: string): void;
  konteks: 'KATALOG' | 'GRUP'; online: boolean;
}
```
Urutan tampil **selalu** `PCS_1, PCS_3, LUSIN, DUS, KOLI` (klien mengurutkan ulang, tidak percaya urutan respons). Bawaan terpilih: satuan terkecil yang tidak HABIS.

### 2.4 State
| State | Tampilan |
|---|---|
| Default | Opsi bawaan terpilih: border 2 px `--color-primary`, latar `--color-primary-soft`, ikon centang (tidak hanya warna) |
| Memuat | 2 skeleton opsi setinggi 56 px |
| Opsi stok habis (U-07) | Opsi `disabled`, teks "Stok habis" `--color-text-muted`, tetap terbaca & fokus dilewati |
| Semua opsi habis (K-20) | Seluruh fieldset nonaktif + teks "Stok habis, segera distok"; CTA detail nonaktif |
| Tanpa harga grup (K-27) | Katalog/grup belum terpenuhi (`hargaGrup = null`): opsi tanpa baris Belanja Bareng. Grup terpenuhi (`keteranganHarga = GROSIR_TIDAK_TERSEDIA`): opsi menampilkan "Tidak dapat Harga Belanja Bareng" |
| Tanpa promo | Tidak ada chip promo pada opsi; promo (bila ada) tampil sekali di detail, di luar pemilih |
| `setaraPerPcs = null` | Baris "setara" tidak dirender (U-01) |
| Offline | Harga "—"; pilihan tetap bisa diganti (tidak memanggil API), CTA nonaktif |
| Error memuat | Kartu error halaman detail (T-007 §4.1), bukan di dalam pemilih |
| Satuan terpilih jadi habis setelah refresh | Pilihan pindah ke satuan terkecil yang tersedia + `aria-live` "Dus habis. Pilihan diganti ke 1 pcs." |

### 2.5 Perilaku
- Ganti opsi → `Harga` detail, total stepper, dan kartu Belanja Bareng ikut berganti (satu `tampilanHarga` milik opsi terpilih).
- Ganti satuan saat produk sudah di keranjang → baris keranjang terpisah per satuan (T-007 H-03).
- Qty stepper dibatasi `stok.sisa` opsi terpilih; ketik angka > sisa → dikoreksi + "Tinggal {n} {satuanPendek}".
- Total di bawah stepper: U-04.

### 2.6 Teks persis
| Kunci | Teks |
|---|---|
| `satuan.legend` | "Pilih satuan" |
| `satuan.tunggal` | "Dijual per {labelSatuan}" |
| `satuan.label.PCS_1` / `PCS_3` | "1 pcs" / "3 pcs" |
| `satuan.label.LUSIN` / `DUS` / `KOLI` | "Lusin (isi {isi})" / "Dus (isi {isi})" / "Koli (isi {isi})" |
| `satuan.setara` | "setara Rp{nominal} /pcs" |
| `satuan.habis` | "Stok habis" |
| `satuan.diganti` | "{satuanLama} habis. Pilihan diganti ke {satuanBaru}." |
| `satuan.tinggal` | "Tinggal {n} {satuanPendek}" |

### 2.7 Aksesibilitas
- `fieldset` + `legend`; radio native (panah atas/bawah memindah pilihan, Spasi memilih).
- Nama aksesibel tiap opsi: "Dus isi 24, Rp— per dus, setara Rp— per pcs, Harga Belanja Bareng Rp—" (gabungan `aria-describedby`).
- Seluruh kartu opsi adalah `<label>` → area sentuh ≥ 56 × lebar penuh (≥ 44 px wajib).
- Fokus: `:focus-visible` pada kartu opsi (outline 3 px `--color-focus`), bukan pada radio tersembunyi.
- Kontras opsi nonaktif: teks muted 7.9:1 (bukan `opacity`).

### 2.8 Contoh data FIKTIF
```json
[
  { "_catatan": "FIKTIF", "idSatuanJual": "sj_f01", "kode": "PCS_1", "isi": 1,
    "tampilanHarga": { "idVersiHarga": "v-f1", "hargaAktif": 2222, "hargaGrup": 1111, "hargaCoret": null, "teksStatus": null, "promo": null },
    "keteranganHarga": null, "setaraPerPcs": null, "stok": { "status": "TERSEDIA", "sisa": null } },
  { "_catatan": "FIKTIF", "idSatuanJual": "sj_f02", "kode": "DUS", "isi": 24,
    "tampilanHarga": { "idVersiHarga": "v-f2", "hargaAktif": 99999, "hargaGrup": null, "hargaCoret": null, "teksStatus": null, "promo": null },
    "keteranganHarga": null, "setaraPerPcs": null, "stok": { "status": "HABIS", "sisa": 0 } }
]
```

### 2.9 Kriteria terima / kasus uji
| ID | Kasus | Hasil |
|---|---|---|
| TC-UI-20 | Respons urutan `KOLI, PCS_1, DUS` | Tampil `1 pcs, Dus, Koli` |
| TC-UI-21 | Opsi `PCS_1` habis, `PCS_3` tersedia | Bawaan terpilih `3 pcs`; `1 pcs` disabled |
| TC-UI-22 | Semua opsi habis | "Stok habis, segera distok", CTA nonaktif |
| TC-UI-23 | Grup terpenuhi, `DUS` `keteranganHarga = GROSIR_TIDAK_TERSEDIA`, `PCS_1` `GRUP_BERLAKU` | Opsi dus: "Tidak dapat Harga Belanja Bareng", tanpa `<s>`; opsi 1 pcs: label "Harga Belanja Bareng" |
| TC-UI-23b | Katalog, `DUS` `hargaGrup = null` | Opsi dus tanpa teks Belanja Bareng apa pun |
| TC-UI-24 | Satu opsi saja | Tidak ada `role="radiogroup"`; teks "Dijual per 1 pcs" |
| TC-UI-25 | Harga opsi `PCS_1` = harga kartu produk yang sama | Identik (PG-6) |
| TC-UI-26 | `setaraPerPcs = null` | Tidak ada teks "setara" |
| TC-UI-27 | Keyboard saja | Bisa memilih semua opsi aktif dengan panah; opsi disabled dilewati |
| TC-UI-28 | Kode satuan di luar P-03 dari server | Opsi dibuang + log error (tidak dirender) |

---

## 3. `PemilihSlotKirim`

### 3.1 Tujuan
Memilih jadwal kirim (tanggal + jam) dan menampilkan jam tutupnya. Dipakai di: layar **Buat Grup** (host, H-04), **Checkout "Beli sendiri"** (H-09, F-27). Anggota grup tidak memilih slot: slot mengikuti grup (varian `tampil`).

### 3.2 Anatomi
```
fieldset.pilih-slot
├─ legend  "Pilih jadwal kirim"
├─ h3 per hari  "Hari ini" | "Besok" | "Kamis, 28 Nov"
│  └─ label.opsi × n  (radio kartu, min-height 64 px)
│     ├─ span.opsi__jam    "09.00–12.00 WIB"
│     ├─ span.opsi__tutup  "Grup tutup hari ini 20.00 WIB"  | "Pesan sebelum …" (beli sendiri)
│     └─ span.chip         "Penuh" | "Sudah lewat batas" | "Dibatalkan"   [bila tidak bisa dipilih]
└─ p.catatan  "Jadwal tidak bisa diubah setelah grup dibuat."   [varian host]
```
Varian `tampil` (anggota / checkout grup): satu baris kartu tanpa radio "Dikirim {hari}, {jam} WIB · Grup tutup {hari} {jam} WIB".

### 3.3 Props / data
```ts
interface SlotKirim {                       // GET /zona/{id}/slot-kirim?untuk=GRUP|SENDIRI (usulan; tabel slot_kirim T-004)
  idSlot: string; tanggal: string /*YYYY-MM-DD WIB*/;
  mulai: string; selesai: string;           // API "HH:mm" (titik dua, mis. "09:00"); TAMPILAN pakai titik "09.00"
  kodeGrupSaya: string | null;              // kode grup DIBUKA milik akun sesi di slot ini (F-16, U-03); null bila tidak ada
  cutOffPada: string;                       // ISO-8601 dengan offset
  bisaDipilih: boolean;                     // server: status DIBUKA ∧ kapasitas ∧ cut_off > sekarang + TTL (A-04)
  alasan: 'PENUH' | 'LEWAT_BATAS' | 'DIBATALKAN' | null;
}
interface PemilihSlotKirimProps {
  varian: 'pilih' | 'tampil'; untuk: 'GRUP' | 'SENDIRI';
  slot: SlotKirim[]; terpilih: string | null; onPilih(idSlot: string): void;
  waktuServer: string;                      // untuk "Hari ini/Besok" & penyesuaian jam HP (T-007 §4.5)
  online: boolean;
}
```
Klien **tidak** menilai kelayakan slot (kapasitas, A-04); hanya membaca `bisaDipilih`/`alasan`.

### 3.4 State
| State | Tampilan |
|---|---|
| Default | Slot `bisaDipilih` paling awal terpilih otomatis (satu-klik) |
| Hanya 1 slot bisa dipilih | Tetap radio (agar jelas), terpilih otomatis |
| Memuat | 3 skeleton opsi 64 px |
| Kosong | "Belum ada jadwal kirim di zonamu. Coba lagi nanti." + tombol "Muat ulang" |
| Slot tidak bisa dipilih (U-06) | Opsi `disabled` + chip: "Penuh" / "Sudah lewat batas" / "Dibatalkan" |
| Slot penuh saat dikirim (409) | `role="alert"` "Jadwal ini baru saja penuh. Pilih jadwal lain." + muat ulang daftar, pilihan dikosongkan |
| Terlalu dekat cut-off (409 `SLOT_TERLALU_DEKAT_CUTOFF`) | "Jadwal ini sudah lewat batas untuk grup baru. Pilih jadwal lain." |
| Error | "Gagal memuat jadwal. Periksa sinyal lalu coba lagi." + "Coba lagi" |
| Offline | Daftar terakhir **tidak** dipakai untuk memilih; "Jadwal muncul lagi saat tersambung"; CTA nonaktif |

### 3.5 Perilaku
- Waktu tampil WIB, format "hari ini 14.35 WIB" / "besok" / "Kamis, 28 Nov" (T-007 §3.1). API mengirim "HH:mm" (`"09:00"`); klien hanya mengganti `:` menjadi `.` untuk tampilan ("09.00"), tanpa konversi zona waktu (sudah WIB).
- Host: slot dipilih sekali di Buat Grup; setelah grup dibuat tidak bisa diubah (flow B-01).
- F-16: daftar slot **tidak** menyembunyikan slot tempat pengguna sudah punya grup; slot dengan `kodeGrupSaya ≠ null` diberi keterangan "Kamu sudah punya grup di jadwal ini" dan memilihnya (varian host, `untuk: 'GRUP'`) membuka `/g/{kodeGrupSaya}`, bukan membuat grup baru (DEFAULT SEMENTARA U-03: maks 1 grup per akun per slot).
- Tidak ada nominal ongkir di pemilih (K-25: ongkir di tagihan). Tidak ada kata "drop point" (R2).

### 3.6 Teks persis
| Kunci | Teks |
|---|---|
| `slot.legend` | "Pilih jadwal kirim" |
| `slot.hariIni` / `slot.besok` | "Hari ini" / "Besok" |
| `slot.jam` | "{mulai}–{selesai} WIB" |
| `slot.tutupGrup` | "Grup tutup {hariRelatif} {jam} WIB" |
| `slot.tutupSendiri` | "Pesan sebelum {hariRelatif} {jam} WIB" |
| `slot.penuh` / `slot.lewat` / `slot.batal` | "Penuh" / "Sudah lewat batas" / "Dibatalkan" |
| `slot.sudahAdaGrup` | "Kamu sudah punya grup di jadwal ini" |
| `slot.tidakBisaUbah` | "Jadwal tidak bisa diubah setelah grup dibuat." |
| `slot.tampil` | "Dikirim {hariRelatif}, {mulai}–{selesai} WIB · Grup tutup {hariRelatif} {jam} WIB" |
| `slot.kosong` | "Belum ada jadwal kirim di zonamu. Coba lagi nanti." |
| `slot.barusPenuh` | "Jadwal ini baru saja penuh. Pilih jadwal lain." |
| `slot.terlaluDekat` | "Jadwal ini sudah lewat batas untuk grup baru. Pilih jadwal lain." |

### 3.7 Aksesibilitas
- `fieldset`/`legend`; tiap hari `h3`, opsi radio native dalam label kartu ≥ 64 px.
- Nama aksesibel: "Kamis 28 November, 09.00 sampai 12.00 WIB, grup tutup Rabu 27 November 20.00 WIB" (tanggal penuh, bukan singkatan).
- Opsi disabled tetap dibaca dengan alasan (`aria-describedby` ke chip).
- Chip status: `.chip--warning` "Penuh", `.chip` netral "Sudah lewat batas", `.chip--danger` "Dibatalkan" — semuanya teks (AX7).

### 3.8 Contoh data FIKTIF
```json
[
  { "_catatan": "FIKTIF", "idSlot": "slot_f1", "tanggal": "2030-01-10", "mulai": "09:00", "selesai": "12:00",
    "cutOffPada": "2030-01-09T20:00:00+07:00", "kodeGrupSaya": null, "bisaDipilih": true, "alasan": null },
  { "_catatan": "FIKTIF", "idSlot": "slot_f2", "tanggal": "2030-01-10", "mulai": "15:00", "selesai": "18:00",
    "cutOffPada": "2030-01-10T08:00:00+07:00", "kodeGrupSaya": null, "bisaDipilih": false, "alasan": "PENUH" }
]
```

### 3.9 Kriteria terima / kasus uji
| ID | Kasus | Hasil |
|---|---|---|
| TC-UI-30 | Daftar 3 slot, slot pertama `PENUH` | Slot kedua terpilih otomatis; slot pertama disabled + "Penuh" |
| TC-UI-31 | `cutOffPada` +07:00, HP di zona waktu lain | Teks tetap WIB dan benar |
| TC-UI-32 | Jam HP salah 2 jam | "Hari ini/Besok" dihitung dari `waktuServer`, bukan jam HP |
| TC-UI-33 | POST grup → 409 penuh | Pesan "Jadwal ini baru saja penuh…", daftar dimuat ulang |
| TC-UI-34 | Varian `tampil` | Tidak ada radio; teks `slot.tampil` |
| TC-UI-35 | DOM pemilih | Tidak ada nominal ongkir, "Mitra", "drop point" |
| TC-UI-36 | Daftar kosong | Teks kosong + "Muat ulang" |
| TC-UI-37 | `untuk: 'SENDIRI'` (checkout Beli sendiri) | Teks "Pesan sebelum {hari} {jam} WIB" (bukan "Grup tutup"); keterangan `kodeGrupSaya` tidak tampil |
| TC-UI-38 | Offline saat daftar sudah dimuat | Opsi tidak bisa dipilih, teks "Jadwal muncul lagi saat tersambung", CTA nonaktif; online lagi → daftar dimuat ulang |
| TC-UI-39 | API `"mulai": "09:00"` | Tampil "09.00"; nama aksesibel "09.00 sampai …" |
| TC-UI-39b | Slot dengan `kodeGrupSaya = "AB12CD"` (FIKTIF), varian host | Keterangan "Kamu sudah punya grup di jadwal ini"; memilih → navigasi ke `/g/AB12CD`, POST grup tidak dipanggil |

---

## 4. `TombolAjakWhatsApp` + `LembarBagikan`

### 4.1 Tujuan
Mengajak tetangga ikut grup milik pengguna lewat WhatsApp dengan link grup unik (keputusan #3, flow B-01), tanpa harga dan tanpa data pribadi.

### 4.2 Anatomi
```
button.btn.btn--primary|--secondary  [ikon chat generik] "Ajak tetangga lewat WhatsApp"
→ LembarBagikan (bottom sheet, --radius-xl, --shadow-3)
  ├─ h2 "Ajak tetangga"
  ├─ textarea.input  pratinjau pesan (bisa diubah, U-05)
  ├─ p.link  grup.link  (tampil terpisah; ditambahkan klien SEKALI di akhir pesan saat kirim, tidak ada di textarea/templat)
  ├─ button.btn--primary.btn--block  "Kirim lewat WhatsApp"
  ├─ button.btn--secondary.btn--block "Salin link"
  └─ button.btn--ghost.btn--block    "Bagikan lainnya"   [hanya bila navigator.share ada]
```
Teks tombol memakai "lewat" (sama dengan T-007 H-03); judul task "via" dianggap sinonim. Tanpa warna hijau merek WhatsApp (tidak ada warna baru); ikon chat generik, bukan logo.

Varian penempatan: `utama` (H-05 setelah ikut, layar sukses Buat Grup) = `btn--primary`; `sekunder` (H-03 detail, H-04 kepala grup "Undang") = `btn--secondary`.

### 4.3 Props / data
```ts
interface TombolAjakProps {                 // data dari GET grup/{kode} (flow §8) + POST grup → { grup_id, kode, link }
  grup: { kode: string; nama: string; link: string;       // link DIBANGUN SERVER dari konfigurasi base URL
          status: StatusGrup; tagihanTerbit: boolean; syarat: StatusSyaratGrup;
          cutOffPada: string; slot: { tanggal: string; mulai: string; selesai: string } } | null;
  templat: string | null;                   // Pengaturan > Template WhatsApp (admin); null → templat bawaan §4.5
  waktuServer: string; varian: 'utama' | 'sekunder';
  onBuatGrup(): void;                       // dipakai bila grup = null
}
```
**Link:** klien memakai `grup.link` apa adanya (server menyusun `{BASE_URL}/g/{kode}` dari konfigurasi; domain #6 menyusul). Bila parameter atribusi F-22 dipakai, server yang menambahkan `?ref={token_opaque}`; klien tidak membuat/mengubah ref dan **tidak** meng-hardcode domain. Cadangan hanya untuk pengembangan: `import.meta.env.VITE_BASE_URL_PUBLIK` + `/g/{kode}` (tanpa nilai bawaan di kode; kosong → tombol disembunyikan + log).

### 4.4 State
| State | Tampilan |
|---|---|
| Belum punya grup (`grup = null`) | Tombol tetap tampil di detail; ketuk → `onBuatGrup()` (alur Buat Grup → login/S&K → lembar bagikan) |
| Grup DIBUKA, belum tagihan | Aktif; pesan sesuai syarat (§4.5) |
| Tagihan terbit / grup tutup / batal / ditahan (K-22) | Tombol **tidak dirender** |
| Memuat | Tombol `aria-disabled` + spinner, label tetap |
| Salin berhasil | `aria-live` "Link disalin" (snackbar 3 detik) |
| Salin gagal (Clipboard API ditolak) | Link ditampilkan terpilih (select) + "Tekan lama untuk menyalin" |
| WhatsApp tidak terpasang | `wa.me` membuka WhatsApp Web/halaman unduh — perilaku wajar; tidak ada state khusus |
| Offline | Tombol nonaktif + "Sambungkan internet untuk mengajak tetangga" |
| Error (link kosong dari server) | Tombol disembunyikan; log error |

### 4.5 Format teks WhatsApp ajakan
Disusun klien dari data server; nominal Rupiah **tidak** dicantumkan (T-007: harga tampil di halaman grup; keranjang campur). Tanpa nama/HP anggota lain. Baris dipisah `\n`.

```
Yuk ikut Belanja Bareng di Grup {nama_grup} di NEKAT!
{baris_status}
Grup tutup {hari_relatif} {jam_tutup} WIB, dikirim {hari_kirim} {mulai}–{selesai} WIB.
Gabung dulu tanpa bayar, bayar setelah tagihan terbit.
```
Templat di atas = **isi textarea** (tanpa link). Saat kirim, klien menyusun `teksAkhir = isiTextarea.trimEnd() + "\n" + grup.link` — link hanya ditambahkan **di sini, satu kali**.

| Kondisi | `{baris_status}` |
|---|---|
| `kurangAkun > 0` | "Kurang {kurangAkun} orang lagi biar semua dapat Harga Belanja Bareng." |
| `kurangAkun = 0`, `kurangRupiah > 0` | "Grup sudah terbuka, tinggal tambah belanja sedikit lagi biar dapat Harga Belanja Bareng." |
| terpenuhi | "Harga Belanja Bareng sudah berlaku. Masih bisa ikut sebelum grup tutup." |

- `{hari_relatif}`: "hari ini" / "besok" / "Kamis, 28 Nov" (dari `waktuServer`).
- `{nama_grup}`: sudah difilter server (maks 30 huruf, kata kasar).
- Templat admin (bila ada) memakai placeholder yang sama: `{nama_grup}`, `{baris_status}`, `{hari_relatif}`, `{jam_tutup}`, `{hari_kirim}`, `{mulai}`, `{selesai}`. **Tidak ada placeholder `{link}`**; bila templat admin memuatnya, `{link}` dihapus dari teks (link tetap ditambahkan klien di akhir) dan dicatat sebagai peringatan. Placeholder tak dikenal lain dibiarkan apa adanya dan dicatat (tidak mengeksekusi apa pun).
- **URL WhatsApp:** `https://wa.me/?text=` + `encodeURIComponent(teksAkhir)`; dibuka dengan `window.location.href` (bukan `window.open`, agar tidak diblokir di in-app browser). `Bagikan lainnya`: `navigator.share({ text: isiTextarea, url: grup.link })` (link hanya di `url`, tidak di `text`).
- Panjang pesan bawaan < 400 karakter; textarea dibatasi 500 karakter.

Contoh FIKTIF hasil akhir:
```
Yuk ikut Belanja Bareng di Grup Bu Sari di NEKAT!
Kurang 1 orang lagi biar semua dapat Harga Belanja Bareng.
Grup tutup hari ini 20.00 WIB, dikirim besok 09.00–12.00 WIB.
Gabung dulu tanpa bayar, bayar setelah tagihan terbit.
https://contoh.invalid/g/AB12CD
```
(`contoh.invalid` = domain FIKTIF; nilai asli dari konfigurasi.)

### 4.6 Teks persis
| Kunci | Teks |
|---|---|
| `ajak.tombol` | "Ajak tetangga lewat WhatsApp" |
| `ajak.undang` | "Undang" (kepala grup H-04, nama aksesibel "Undang tetangga ke Grup {nama}") |
| `ajak.judul` | "Ajak tetangga" |
| `ajak.kirimWa` | "Kirim lewat WhatsApp" |
| `ajak.salin` / `ajak.disalin` | "Salin link" / "Link disalin" |
| `ajak.salinGagal` | "Tekan lama untuk menyalin" |
| `ajak.lainnya` | "Bagikan lainnya" |
| `ajak.offline` | "Sambungkan internet untuk mengajak tetangga" |
| `ajak.pesan.*` | lihat §4.5 |

### 4.7 Aksesibilitas
- Tombol 48 px tinggi, teks lengkap (tidak ikon saja).
- Lembar bawah: `role="dialog"` `aria-modal="true"` `aria-labelledby` judul; fokus pertama ke "Kirim lewat WhatsApp"; jebakan fokus; `Esc`/tombol kembali menutup dan fokus kembali ke pemicu (AX5).
- Textarea berlabel "Pesan ajakan (bisa diubah)"; penghitung karakter `aria-live="polite"` hanya saat ≤ 50 sisa.
- Kontras: tombol primer 6.4:1 (terang) / 8.1:1 (gelap).

### 4.8 Kriteria terima / kasus uji
| ID | Kasus | Hasil |
|---|---|---|
| TC-UI-40 | Grup `kurangAkun = 2` | Pesan berisi "Kurang 2 orang lagi…"; tanpa "Rp" |
| TC-UI-41 | Link dari server `https://contoh.invalid/g/AB12CD?ref=x9` (FIKTIF) | URL wa.me berisi link persis (ter-encode), ref tidak diubah |
| TC-UI-42 | Pengguna menghapus semua isi textarea | Link tetap terkirim di akhir |
| TC-UI-43 | `tagihanTerbit = true` | Tombol tidak ada di DOM |
| TC-UI-44 | Kode sumber web | Tidak ada string domain produksi hard-code (grep `nekat.id` di `apps/web/src` = 0) |
| TC-UI-45 | `navigator.share` tidak ada | "Bagikan lainnya" tidak dirender |
| TC-UI-46 | Pesan | Tidak memuat "Mitra", "drop point", "gratis", "Rp", nomor HP, nama anggota lain |
| TC-UI-48 | Kirim lewat WhatsApp dengan (a) templat bawaan, (b) templat admin yang memuat `{link}` | Pada (a) dan (b): `grup.link` muncul **tepat satu kali** di parameter `text` URL wa.me (setelah decode), di baris terakhir |
| TC-UI-49 | `navigator.share` | `url` = `grup.link`; `text` tidak memuat link |
| TC-UI-47 | Tutup lembar dengan Esc | Fokus kembali ke tombol pemicu |

---

## 5. `BannerPasang` (Tambah ke layar utama, H-06)

### 5.1 Tujuan
Mengajak memasang PWA setelah pengguna mendapat nilai (ikut grup / bayar lunas), agar mudah kembali mengecek grup (keputusan #3 untuk PWA).

### 5.2 Anatomi
```
section.card[role=region aria-label="Pasang aplikasi NEKAT"]   (di alur halaman, BUKAN fixed)
├─ p  "Pasang NEKAT di layar HP biar gampang cek grup."
├─ p.muted  (iOS) "Setelah terpasang, buka grupmu dari menu Pesanan."
└─ div.l-cluster
   ├─ button.btn--primary  "Pasang" (Android/Chrome)  |  "Lihat caranya" (iOS)
   └─ button.btn--ghost    "Nanti saja"
→ iOS: LembarPetunjukPasang (dialog): 2 langkah bergambar orisinal
   1. "Ketuk ikon Bagikan (kotak dengan panah ke atas) di bawah layar; di iPad, di kanan atas."
   2. "Pilih 'Tambah ke Layar Utama', lalu ketuk 'Tambah'."
   [Mengerti]
```

### 5.3 Props / data
```ts
interface BannerPasangProps {
  pemicu: 'IKUT_GRUP' | 'BAYAR_LUNAS';      // induk hanya merender setelah aksi ini (H-05, H-10/H-11)
}
// Data lingkungan (bukan API): event beforeinstallprompt, appinstalled,
// matchMedia('(display-mode: standalone)'), navigator.standalone (iOS),
// localStorage 'nekat:ajakan-pasang-ditutup' (try/catch).
```

### 5.4 State
| State | Kondisi | Tampilan |
|---|---|---|
| Tersembunyi | sudah terpasang (`standalone`) · ditutup < 7 hari · tidak ada prompt & bukan iOS · belum ada aksi bernilai | tidak dirender |
| Android siap | `beforeinstallprompt` tertangkap | Tombol "Pasang" |
| iOS | iPhone/iPad (termasuk iPadOS ber-UA desktop: `Macintosh` + `maxTouchPoints > 1`), belum standalone | Tombol "Lihat caranya" → lembar 2 langkah |
| Memasang | `prompt()` berjalan | Tombol `aria-disabled` |
| Terpasang | `appinstalled` / `userChoice = accepted` | Banner hilang + snackbar "NEKAT sudah terpasang" |
| Ditolak di dialog browser | `userChoice = dismissed` | Banner hilang, dicatat seperti "Nanti saja" |
| Penyimpanan diblokir | `localStorage` melempar | Tetap berfungsi; bisa muncul lagi di kunjungan berikutnya |
| Offline / error | — | Tidak relevan (tidak memanggil API); tetap boleh tampil |

### 5.5 Perilaku
- Tidak pernah muncul saat pertama buka halaman; maks 1× per 7 hari setelah ditutup.
- Tidak menutupi bilah CTA atau navigasi bawah (di alur konten, setelah blok status).
- H11: tidak ada janji "kembali otomatis ke grup" di iOS; di Android, link `/g/{kode}` dari WhatsApp bisa terbuka di PWA bila browser mendukung (scope manifest = `/`), tanpa jaminan.
- **Delta terhadap `apps/web/src/pwa/AjakanPasang.tsx` (sudah ada):** (1) tambah prop `pemicu` / tampilkan hanya setelah aksi; (2) dengarkan `appinstalled`; (3) deteksi iPadOS; (4) iOS: ganti paragraf satu baris dengan tombol "Lihat caranya" + lembar 2 langkah; (5) cek `navigator.standalone` untuk iOS; (6) snackbar terpasang. Teks utama dan kunci penyimpanan sudah sesuai.

### 5.6 Teks persis
| Kunci | Teks |
|---|---|
| `pasang.ajakan` | "Pasang NEKAT di layar HP biar gampang cek grup." |
| `pasang.iosCatatan` | "Setelah terpasang, buka grupmu dari menu Pesanan." |
| `pasang.tombol` / `pasang.iosTombol` | "Pasang" / "Lihat caranya" |
| `pasang.nanti` | "Nanti saja" |
| `pasang.iosJudul` | "Cara pasang di iPhone" |
| `pasang.iosLangkah1` | "Ketuk ikon Bagikan (kotak dengan panah ke atas) di bawah layar; di iPad, di kanan atas." |
| `pasang.iosLangkah2` | "Pilih 'Tambah ke Layar Utama', lalu ketuk 'Tambah'." |
| `pasang.mengerti` | "Mengerti" |
| `pasang.terpasang` | "NEKAT sudah terpasang" |

### 5.7 Aksesibilitas
- `role="region"` berlabel; tombol 48 px (`.btn`), jarak 8 px.
- Lembar iOS: `role="dialog"`, gambar langkah ber-`alt` deskriptif, langkah berupa `<ol>`.
- Animasi masuk dimatikan bila `prefers-reduced-motion`.

### 5.8 Kriteria terima / kasus uji
| ID | Kasus | Hasil |
|---|---|---|
| TC-UI-50 | Buka H-05 pertama kali tanpa ikut | Banner tidak ada |
| TC-UI-51 | Setelah ikut grup, Chrome Android dengan prompt | Banner + "Pasang" |
| TC-UI-52 | "Nanti saja", buka lagi 3 hari kemudian | Banner tidak ada; hari ke-8 muncul lagi |
| TC-UI-53 | `display-mode: standalone` | Tidak ada banner |
| TC-UI-54 | iPadOS (UA Macintosh, touch) | Varian iOS |
| TC-UI-55 | `localStorage` melempar | Tidak crash |
| TC-UI-56 | Lebar 320 px | Banner tidak menutupi CTA bawah |
| TC-UI-57 | iOS: ketuk "Lihat caranya" | Dialog terbuka, fokus ke judul "Cara pasang di iPhone"; Tab terjebak di dalam dialog; "Mengerti"/Esc menutup dan fokus kembali ke "Lihat caranya" |

---

## 6. Ringkasan pemetaan token (tanpa warna baru)

| Elemen | Token |
|---|---|
| Harga aktif | `--color-price`, `.price--card` / `.price--detail` |
| Harga coret (harga satuan) | `--color-price-strike`, `.price--strike` |
| Label & chip Belanja Bareng | `--color-price-group`, `.chip--group` |
| Chip "Harga Belanja Bareng berlaku" | `.chip--success` |
| Promo | `.chip--promo` (`--color-promo`, `--color-promo-soft`) |
| Stok habis | `.chip` netral (`--color-surface-2`, `--color-text`) + gambar grayscale |
| Stok terbatas, slot penuh | `--color-warning`, `.chip--warning` |
| Opsi terpilih (satuan/slot) | border 2 px `--color-primary`, latar `--color-primary-soft` |
| Opsi nonaktif | `--color-text-muted`, border `--color-border` |
| Progres | `.progress` |
| Kartu / lembar | `.card`, `--radius-lg`; lembar `--radius-xl`, `--shadow-3`, `--z-sheet` |
| Target sentuh | `--tap-min` 44, `--tap-comfort` 48, `--tap-gap` 8 |

---

## 7. Catatan untuk dokumen lain (bukan keputusan)

1. **T-007 H-05 tabel status** memakai "Terbuka, < 3 orang" — bertentangan dengan F-15 (terbuka = ≥ 3 akun). Ganti ke "Kurang {x} orang" (U-08).
2. **T-007 Layar Buat Grup butir 4** menyebut "ambil sendiri di drop point" di luar checkout — perlu dicek terhadap K-38 ("info drop point hanya di checkout").
3. **Backlog T-027/T-028** masih "X/Y di zona kamu · Z lagi → harga" dan "grup 6+, grup 12+" (lihat U-02).
4. **Istilah saldo**: T-007 "Saldo NEKAT" vs flow §1 "Poin NEKAT (1 poin = Rp1)". Komponen di dokumen ini tidak menampilkan saldo; diselaraskan di T-033/T-021.
5. Endpoint `GET /sesi/konteks`, `GET /zona/{id}/slot-kirim`, bentuk `KartuProdukData`/`OpsiSatuan` adalah **usulan** untuk Backend Architect (T-022/T-025); `TampilanHarga` dan `StatusSyaratGrup` tidak diubah.
6. **Usulan ke Backend Architect — field turunan per satuan:** respons katalog/detail menambah `keteranganHarga: 'GRUP_BERLAKU' | 'GROSIR_TIDAK_TERSEDIA' | null` (diturunkan server dari `jenisHargaBaris` + `peringatan` `GROSIR_TIDAK_TERSEDIA`, engine-harga §5.2), `promoPerProduk: boolean`, dan `minAkun` di konteks grup. Alasan: di engine-harga §7 `peringatan` hanya ada di `Hasil<T>`, bukan di `TampilanHarga`; dan pada grup terpenuhi `hargaGrup = null`, sehingga UI tidak bisa membedakan "harga grup berlaku" dari "K-27 harga satuan" tanpa field ini.
7. **Kontradiksi kecil engine-harga §7 / TC-HE-14:** `idVersiHarga` ada di `TampilanHarga` dan diuji "identik di kartu, detail, grup", sementara UI tidak boleh merender penanda internal itu. Penerapan di sini: `idVersiHarga` **dibawa di respons API saja**; TC-UI-01 membandingkannya dari respons yang dicegat E2E, DOM membandingkan teks harga. Mohon engine-harga §9 TC-HE-14 menyebut "di respons API", bukan "di tampilan".
8. **Refresh setelah syarat grup berubah:** API tambah/ubah keranjang perlu mengembalikan `KonteksBelanja` terbaru (qty terkonfirmasi + `syarat`), agar klien tahu kapan memuat ulang `tampilanHarga` (§1.7).

---

## 8. Keputusan terbuka baru

ID sementara; koordinator memberi ID resmi di `keputusan-terbuka.md`. Semua **DEFAULT SEMENTARA** sudah diterapkan di bagian terkait dan mudah diganti (teks di berkas string, aturan dari server).

| ID | Pertanyaan | Pemilik | Rekomendasi | DEFAULT SEMENTARA |
|---|---|---|---|---|
| U-01 | "Setara Rp — /pcs" untuk lusin/dus/koli bisa menghasilkan rupiah pecahan, padahal tanpa pembulatan (H6, K-28). Tampilkan bagaimana? | Efan | Server mengirim `setaraPerPcs` hanya bila habis dibagi `isi`; selain itu baris "setara" tidak tampil (tanpa "±"/pembulatan) | Sama dengan rekomendasi |
| U-02 | Judul T-008/T-027 "X/Y di zona kamu · Z lagi → harga" tidak cocok dengan G-01. Di mana progres grup tampil di katalog? | Randy | Progres lengkap ("Grup {nama}: {n}/{minAkun} orang · Rp — dari {min_grup}") hanya di pita grup aktif, keranjang & halaman grup; kartu cukup chip pendek ("Kurang 1 orang" / "Harga Belanja Bareng berlaku"); kata "di zona kamu" dihapus; PM menyelaraskan judul T-027/T-028 | Sama dengan rekomendasi |
| U-03 | F-16 membuat satu akun bisa punya > 1 grup (beda slot). Tombol "+" / "Belanja Bareng" memasukkan barang ke mana, dan bagaimana setelah tagihan grup terbit (K-22)? Bolehkah > 1 grup di slot yang sama? | Randy | 1 grup DIBUKA → langsung ke grup itu; > 1 → lembar bawah "Masukkan ke mana?" (daftar grup + jadwal + "Keranjang biasa"), pilihan diingat selama sesi; grup bertagihan tidak jadi pilihan → barang ke keranjang biasa + snackbar "Tagihan Grup {nama} sudah terbit. Barang masuk keranjang biasa."; maks 1 grup per akun per slot | Sama dengan rekomendasi |
| U-04 | Total di bawah stepper detail (harga × jumlah): boleh dikalikan di klien dari `hargaAktif` server, atau wajib dari server? | Joseph | Klien boleh mengalikan integer `hargaAktif × qty` (bukan menghitung harga; tanpa pembulatan hasilnya identik), **hanya** dari `tampilanHarga` terbaru; bila respons tambah/ubah mengubah `syarat.terpenuhi`, total disembunyikan (skeleton) sampai `tampilanHarga` dimuat ulang, agar tidak pernah mengalikan harga lama. Total keranjang, perbandingan grup vs sendiri, dan tagihan tetap dari server | Sama dengan rekomendasi |
| U-05 | Pesan ajakan WhatsApp: boleh diubah pengguna? Boleh memuat nominal harga? | Randy (+ Growth Hacker) | Boleh diubah (maks 500 karakter); link selalu ditambahkan otomatis di akhir dan tidak bisa dihapus; tanpa nominal harga; teks bawaan dari Pengaturan > Template WhatsApp | Sama dengan rekomendasi; templat bawaan §4.5 |
| U-06 | Pemilih slot: slot yang tidak bisa dipilih (penuh / lewat batas A-04 / dibatalkan) ditampilkan nonaktif atau disembunyikan? Tampilkan sisa kapasitas? Berapa hari ke depan? | Efan (+ Operations Manager) | Tampil nonaktif dengan alasan; tanpa angka sisa kapasitas (hanya "Penuh"); 7 hari ke depan | Sama dengan rekomendasi |
| U-07 | Stok cukup untuk pcs tetapi tidak untuk satu dus/koli. Teks & perilaku per satuan? | Efan + Randy | Opsi satuan itu nonaktif dengan "Stok habis"; label produk "Stok habis, segera distok" (K-20) hanya bila semua satuan tidak bisa dipenuhi | Sama dengan rekomendasi |
| U-08 | F-15: "terbuka" = grup ≥ 3 akun. Sebutan UI untuk grup < 3 akun? (T-007 H-05 & S&K §4.2 perlu diselaraskan) | Randy | < 3 akun: "Kurang {x} orang" (tanpa kata "terbuka"/"aktif"); ≥ 3 akun: "Grup terbuka" | Sama dengan rekomendasi |
| U-09 | Chip promo di kartu: tampilkan nominal "jadi Rp —" atau label saja? Diskon K-21 dihitung atas total tagihan, jadi harga per produk setelah promo bisa menyesatkan | Efan | Label saja (+ "s.d. {tanggal}"); nominal hanya bila server menandai `promoPerProduk = true`, tetap di chip terpisah | Label saja; server mengirim `promoPerProduk = false` sampai dijawab |

---

## 9. Hal yang tidak pasti
- Bentuk API katalog/konteks/slot belum ada di spesifikasi backend; tipe di sini usulan.
- Perilaku link `/g/{kode}` membuka PWA terpasang di Android bergantung browser (WebAPK Chrome); tidak bisa dijamin.
- Batas panjang URL `wa.me` di beberapa versi WhatsApp tidak terdokumentasi resmi; pesan dibuat < 500 karakter untuk aman.
- Kontras `.chip--group` / `.chip--promo` di tema gelap untuk teks 14 px sudah ada di T-007 §8.2; kontras gambar ilustrasi iOS (lembar pasang) baru bisa dicek saat aset dibuat.
