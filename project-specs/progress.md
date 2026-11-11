# Progress

Terakhir diperbarui: sesi QA & perbaikan otomatis, Rabu 11 Nov 2026 (09.13–09.35 WIB).

## Selesai
- Backlog Fase 1 dipecah menjadi 46 task (Senior PM, 10 Nov).
- T-001, T-002, T-003 dikerjakan agen (sesi Build A 11 Nov).
- **Sesi QA 11 Nov 09.13:** ketiga PR direview ulang secara independen oleh Code Reviewer dan AI-Generated Code Security Auditor, diperbaiki langsung di branch PR (maks. 3 putaran), dan **lulus review agen**. Ringkasan sudah ditulis sebagai komentar di tiap PR.
  - Tes otomatis: belum ada (repo belum punya kode). API Tester / Test Automation Engineer tidak dijalankan karena PR hanya berisi dokumen.
  - Pindai rahasia di isi PR & riwayat commit: bersih.

## Sedang jalan (PR terbuka, menunggu persetujuan & merge oleh manusia)
| Task | PR | Versi | Hasil QA 11 Nov | Temuan utama yang diperbaiki |
|---|---|---|---|---|
| T-001 ADR tech stack | #1 `task/T-001-adr-tech-stack` @ `e716192` | v0.5 | LULUS (2 putaran) | Webhook Xendit GET pakai ID invoice dari DB; aturan OTP lengkap; IDOR `akun_id` dari sesi; rotasi sesi; label default sementara H14/F-11/H6; peta kunci batal multi-grup; izin `harga.ubah` |
| T-002 Peta flow group order | #2 `task/T-002-flow-group-order` @ `a5ec5fa` | v0.5 | LULUS (3 putaran) | BLOCKER keamanan IDOR di `POST ikut`; grup bisa macet di CUT_OFF (G9 vs G10); COD diperlakukan seolah sudah bayar; batal saat MENUNGGU_BAYAR = seluruh pesanan (P6/G15); TC-GO-68–76 |
| T-003 Spesifikasi engine harga | #3 `task/T-003-spec-engine-harga` @ `63cc72d` | v0.5 | LULUS (3 putaran), butuh keputusan P-22/P-28 | BLOCKER pagar harga: mode `PER_TIER` melanggar CLAUDE.md → pagar KETAT wajib; default P-28 = harga Mitra hanya di checkout; izin `harga.ubah`; reservasi kuota diskon; netralisasi CSV |

Catatan: ketiga PR saling merujuk → merge bersama (urutan #1, #3, #2 atau sekaligus).
Catatan repo: GitHub melaporkan repo pindah ke `nirmalaniskalanalakamoirai-ai/Nekat-App`; push & komentar tetap berhasil lewat redirect.

## Blocked
- Tidak ada task blocked.
- Semua task kode (T-012 dst.) menunggu ADR T-001 di-merge (keputusan H10).

## Butuh keputusan manusia
Daftar lengkap di `keputusan-terbuka.md`. Paling mendesak:
1. **H10 / H1 (Joseph)** — setujui ADR-0001 (merge PR #1) → membuka semua task kode.
2. **F-01 / P-04** — harga apa yang dibayar di muka saat ikut grup.
3. **F-02** — grup gagal (<3 akun): lanjut harga satuan atau refund.
4. **P-22 (Efan)** — pagar KETAT kini wajib; tinggal pilih apakah ditambah pemeriksaan per tier.
5. **P-28 (Randy + Efan, baru)** — info harga Mitra drop point di halaman detail (default sementara: hanya di checkout).
6. **F-06 / F-26** — auditor menandai risiko penimbunan reservasi bila batas reservasi & TTL invoice kosong.
7. **P-05** — syarat harga Mitra di drop point; WAJIB sebelum pilot. **H2** — gateway WhatsApp. **H9** — TOTP admin (rekomendasi: wajib).
8. Butir baru sesi QA: **F-28** (barang tidak diambil di drop point), **P-28**; teks **P-22** diperbarui.

## Berikutnya
- 12.31 sesi Laporan (`laporan/2026-11-11.md`).
- Setelah merge PR #1–#3: T-004, T-005, T-006, T-007, T-009 (gelombang 1).
