// Teks UI Bahasa Indonesia (T-008 §0: satu berkas string). Kunci mengikuti tabel teks T-008/T-007.
// Teks stok berasal dari @nekat/shared agar sama dengan label server (K-20, IG-02).
import { LABEL_STOK_HABIS, LABEL_STOK_TIDAK_DIKETAHUI } from "@nekat/shared";

export const TEKS = {
  // T-008 §1.8
  kartuPer: (labelSatuan: string) => `per ${labelSatuan}`,
  stokHabis: LABEL_STOK_HABIS,
  stokHabisPendek: "Stok habis",
  stokDicek: LABEL_STOK_TIDAK_DIKETAHUI,
  stokDicekPendek: "Stok sedang dicek",
  tambahAria: (pendek: string, nama: string) => `Tambah 1 ${pendek} ${nama} ke keranjang`,
  kurangiAria: (nama: string) => `Kurangi 1 ${nama}`,
  tambahStepperAria: (nama: string) => `Tambah 1 ${nama}`,
  hapusAria: (nama: string) => `Hapus ${nama} dari keranjang`,
  jumlahAria: (nama: string) => `Jumlah ${nama}`,
  ditambahkanLive: (nama: string, qty: number) => `${nama} ditambahkan, jumlah ${qty}`,
  jumlahLive: (nama: string, qty: number) => `Jumlah ${nama} ${qty}`,
  dihapusLive: (nama: string) => `${nama} dihapus dari keranjang, Urungkan tersedia`,
  ditambahkan: (pendek: string) => `Ditambahkan 1 ${pendek}`,
  ditambahkanKeranjang: "Ditambahkan ke keranjang",
  keranjangPenuh: "Keranjang penuh. Hapus barang lain dulu untuk menambah barang baru.",
  offline: "Kamu sedang offline. Harga akan muncul lagi saat tersambung.",
  hargaOfflineSr: "Harga belum tampil karena offline.",

  // T-007 H-02
  cariPlaceholder: "Cari beras, minyak, sabun…",
  cariLabel: "Cari produk",
  cariMinimal: "Ketik minimal 2 huruf untuk mencari.",
  cariHasil: (q: string, n: number) => `${n} produk untuk "${q}"`,
  cariKosong: (q: string) => `Tidak ketemu '${q}'. Coba kata lain, mis. 'beras'`,
  kategoriPopuler: "Kategori populer",
  kategoriKosong: "Belum ada produk di kategori ini",
  katalogKosong: "Belum ada produk di zonamu. Coba lagi nanti.",
  semua: "Semua",
  belanja: "Belanja",
  lihatSemuaProduk: "Lihat semua produk",
  daftarProduk: "Daftar produk",
  gagalKategori: "Gagal memuat kategori.",
  jumlahProdukSr: (n: number) => `${n} produk`,
  kategoriLabel: "Kategori",
  subkategoriLabel: (kategori: string) => `Subkategori ${kategori}`,
  muatLagi: "Muat lagi",
  memuatLagi: "Memuat…",
  gagalMuat: "Gagal memuat. Periksa sinyal lalu coba lagi.",
  cobaLagi: "Coba lagi",
  zonaBelumDipilih: "Pilih zona pengiriman dulu agar stok dan keranjang sesuai lokasimu.",
  pilihZona: "Pilih zona",
  zonaTidakDikenal: "Zona yang tersimpan sudah tidak berlaku. Pilih zona lagi.",

  // Keranjang sementara (T-026; keranjang server/grup menyusul T-022)
  keranjangJudul: "Keranjang",
  keranjangSementara:
    "Keranjang sementara: tersimpan di HP ini saja dan belum masuk grup. Belanja Bareng dan checkout segera hadir.",
  keranjangKosong: "Keranjangmu masih kosong",
  mulaiBelanja: "Mulai belanja",
  keranjangZona: (zona: string) => `Untuk zona ${zona}`,
  totalNanti:
    "Total belanja dihitung oleh server saat checkout. Harga per barang di atas adalah harga terbaru.",
  daftarKeranjang: "Barang di keranjang",
  gagalHarga: "Gagal memuat harga terbaru.",
  barangTidakTersedia: "Produk ini sudah tidak tersedia",
  satuanTidakTersedia: "Satuan ini sudah tidak dijual",
  hapus: "Hapus",
  urungkan: "Urungkan",
  dihapus: (nama: string) => `${nama} dihapus`,
  jumlahBarangSr: (n: number) => `${n} barang di keranjang`,
} as const;
