# Progress

Terakhir diperbarui: sesi Build A otomatis, Rabu 11 Nov 2026 (mulai 01.13 WIB).

## Selesai
- Backlog Fase 1 dipecah menjadi 46 task (Senior PM, 10 Nov).
- T-001, T-002, T-003 selesai dikerjakan agen dan lulus QA internal; menunggu persetujuan manusia (lihat "Sedang jalan").

## Sedang jalan (PR terbuka, menunggu persetujuan & merge oleh manusia)
| Task | PR | Isi | QA |
|---|---|---|---|
| T-001 ADR tech stack | #1 `task/T-001-adr-tech-stack` | `docs/adr/0001-tech-stack.md` — TypeScript/Node modular monolith, Fastify, PostgreSQL + Drizzle, pg-boss, React PWA | Evidence Collector PASS · Code Reviewer: 3 blocker diperbaiki (3 putaran) |
| T-002 Peta flow group order | #2 `task/T-002-flow-group-order` | `docs/flow/group-order.md` v0.3 — mesin status grup & peserta, cabang B-01–B-17, prosedur cut-off, ~70 kasus uji | Evidence Collector PASS · Code Reviewer: blocker diperbaiki (3 putaran) |
| T-003 Spesifikasi engine harga | #3 `task/T-003-spec-engine-harga` | `docs/spec/engine-harga.md` v0.3 — rumus, pagar PG-1–PG-7, siklus harga grup, signature fungsi, 65+ kasus uji | Evidence Collector PASS (hitung ulang program) · Code Reviewer: blocker diperbaiki (3 putaran) |

Catatan: PR #2 dan #3 saling merujuk dan merujuk ADR → sebaiknya ketiganya di-merge bersama.
Catatan proses: hasil sesi 10 Nov untuk T-001–T-003 tidak pernah ter-push (branch hilang, tidak ada PR), jadi dikerjakan ulang di sesi ini. ID keputusan terbuka lama (H1–H11, F-01–F-18, P-01–P-21) dipertahankan.
Catatan repo: GitHub melaporkan repo pindah ke `nirmalaniskalanalakamoirai-ai/Nekat-App` (beda huruf besar); push & PR tetap berhasil lewat redirect.

## Blocked
- Tidak ada.
- Semua task kode (T-012 dst.) menunggu ADR T-001 di-merge (keputusan H10).

## Butuh keputusan manusia
Daftar lengkap di `keputusan-terbuka.md`. Paling mendesak:
1. **H10 / H1** — setujui ADR-0001 (merge PR #1) → membuka semua task kode.
2. **F-01 / P-04** — harga apa yang dibayar di muka saat ikut grup (default dokumen: harga satuan, selisih kembali ke saldo saat cut-off).
3. **F-02** — grup gagal (<3 akun): lanjut harga satuan atau refund (default: lanjut harga satuan).
4. **P-05** — syarat harga Mitra di drop point; WAJIB diisi sebelum pilot.
5. **H2** — gateway WhatsApp untuk OTP & notifikasi.
6. Butir baru sesi ini: H12–H14, F-19–F-27, P-22–P-27.

## Berikutnya (sesi Build berikut)
Gelombang 1 non-kode yang tidak menunggu merge: T-005 (flow pembayaran), T-007 (spesifikasi UX), lalu T-006 / T-009 / T-004 setelah PR #1–#3 di-merge.
