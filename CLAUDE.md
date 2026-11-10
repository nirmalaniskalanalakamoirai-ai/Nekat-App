# NEKAT — Aplikasi Group Order Toserba

Aplikasi one-klik toserba + grosir dengan group order sebagai inti: makin banyak pembeli dalam satu zona radius membeli item yang sama untuk slot kirim yang sama, makin murah harganya.
Spesifikasi kerja ada di `project-specs/`. Bahasa UI: Bahasa Indonesia.

## Tim agen (di `.claude/agents/`)

Pemimpin pipeline: **Agents Orchestrator**. Penyusun task: **Project Manager Senior**.

| Squad (pemilik manusia) | Agen | Tugas |
|---|---|---|
| Produk & flow (Randy) | Product Manager | Prioritas fitur, PRD per fase |
| | Workflow Architect | Peta semua cabang flow: grup gagal, refund, stok habis, COD gagal |
| | UX Researcher | Uji dengan persona ibu rumah tangga, warung, franchise |
| | UX Architect | Struktur halaman, design token, fondasi CSS |
| | UI Designer | Komponen: kartu produk + progress grup, pilih satuan jual, slot kirim |
| | Finance Tracker | Budget, biaya per order, arus kas pilot |
| Harga & bisnis (Efan) | Pricing Analyst | Price tier per level, simulasi margin, aturan pagar harga |
| | Operations Manager | Slot kirim, kapasitas armada, droppoint, kurir lokal |
| | Growth Hacker | Loop "ajak tetangga", referral, poin |
| | Analytics Reporter | KPI harian: grup tercapai, repeat rate, biaya kirim/order |
| Build & QA (Joseph) | Software Architect | Arsitektur & keputusan teknis (ADR) |
| | Backend Architect | API, database, engine group order |
| | Frontend Developer | Web app / PWA mobile first |
| | Payments & Billing Engineer | Xendit (QRIS, VA, e-wallet), webhook, refund, saldo |
| | DevOps Automator | Server, CI/CD, staging/production, backup |
| | Automation Governance Architect | Bot WhatsApp & job otomatis (n8n): cut-off, picking list, laporan |
| | Test Automation Engineer | Tes end-to-end Playwright |
| | API Tester | Uji API & skenario harga |
| | Evidence Collector | QA per task dengan screenshot |
| | Code Reviewer | Review setiap PR |
| | AI-Generated Code Auditor | Cek rahasia bocor, akses data, celah keamanan |
| | Reality Checker | Gerbang akhir sebelum rilis; default "NEEDS WORK" |

Agen di `.claude/agents-later/` (Mobile App Builder, Mobile Release Engineer, SRE, App Store Optimizer) baru dipindah ke `.claude/agents/` di Fase 5.

## Aturan kerja otomatis

1. Satu task = satu branch = satu PR. Tidak pernah push langsung ke `main`.
2. Alur per task: Project Manager Senior → developer agent → Evidence Collector → Code Reviewer. Maksimal 3 putaran perbaikan; jika masih gagal, tandai `BLOCKED` dan tulis alasannya.
3. Rilis ke production hanya setelah Reality Checker lulus **dan** disetujui manusia pemilik squad.
4. Keputusan bisnis (harga, margin, aturan MOQ, model pendapatan) tidak diputuskan agen. Keputusan final di `project-specs/keputusan.md` (wajib diikuti). Hal baru yang butuh keputusan ditulis di `project-specs/keputusan-terbuka.md`.
5. Setiap sesi diakhiri dengan update `project-specs/progress.md`: selesai, sedang jalan, blocked, butuh keputusan.
6. Jangan menyimpan kunci API / password di kode. Pakai environment variable.

## Aturan harga (wajib di kode)

- Semua harga = harga modal + margin per level. Tidak ada harga di bawah modal.
- Pagar: harga grup individu ≥ harga Mitra Grosir ≥ harga Franchise.
- Harga final grup dikunci saat cut-off; jika tier lebih murah tercapai, selisih kembali sebagai saldo.
- Harga yang tampil di kartu produk dan halaman detail harus sama; promo ditampilkan terpisah.
