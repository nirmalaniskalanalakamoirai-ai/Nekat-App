# Aturan sesi otomatis (tambahan untuk CLAUDE.md)

1. File catatan kerja boleh di-commit langsung ke `main`: hanya `project-specs/progress.md`, `project-specs/backlog.md`, `project-specs/keputusan-terbuka.md`, dan folder `laporan/`. Kode, spesifikasi lain, dan `keputusan.md` wajib lewat PR.
2. Tech stack belum ditetapkan. Software Architect mengusulkan lewat PR `docs/adr/0001-tech-stack.md` (pertimbangkan kecocokan dengan sistem Gudang dan Xendit). Task coding aplikasi menunggu ADR itu di-merge Joseph. Sambil menunggu, kerjakan task non-kode: peta flow, spesifikasi UX, spesifikasi engine harga, model data.
3. Jam 13.00–14.00 WIB adalah waktu cek tim manusia; tidak ada sesi agen yang berjalan.
4. Batas per sesi: maksimal 3 task dan maksimal 3 PR baru.
5. Agen tidak me-merge PR sendiri. Hanya sesi Tindak Lanjut (14.17) yang boleh merge, dan hanya PR yang sudah di-approve manusia di GitHub.
6. Jangan menulis ulang keputusan di `keputusan.md`; jika ada konflik, tulis di `keputusan-terbuka.md`.
