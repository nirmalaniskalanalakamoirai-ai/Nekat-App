# NEKAT App

Aplikasi one-klik toserba + grosir berbasis group order.

- Aturan kerja & tim agen: `CLAUDE.md`
- Keputusan bisnis final: `project-specs/keputusan.md`
- Spesifikasi Fase 1: `project-specs/fase-1-mvp.md`
- Tech stack & arsitektur: `docs/adr/0001-tech-stack.md`
- Jadwal agen otomatis: `project-specs/jadwal-otomatis.md`
- Draf S&K & Kebijakan Privasi: `docs/legal/`
- Laporan harian: `laporan/` dan `project-specs/progress.md`

## Menjalankan kode

Prasyarat: Node.js sesuai `.nvmrc` (`nvm use`) dan pnpm sesuai field `packageManager` di
`package.json` (`corepack enable` atau pasang pnpm versi itu).

```bash
pnpm install          # pasang dependensi (CI memakai --frozen-lockfile)
pnpm lint             # ESLint + aturan batas modul
pnpm format:check     # Prettier (perbaiki dengan: pnpm format)
pnpm typecheck        # TypeScript strict di semua paket
pnpm test             # Vitest (unit test)
pnpm build            # build semua paket & app ke dist/
```

Menjalankan app secara lokal:

```bash
pnpm --filter @nekat/web dev                   # PWA (Vite), http://localhost:5173
pnpm build && pnpm --filter @nekat/api start   # API, cek http://localhost:3000/health
DATABASE_URL=postgres://... pnpm --filter @nekat/worker start   # worker pg-boss
```

Daftar variabel ada di `.env.example`. Untuk dev lokal boleh salin ke `.env` (diabaikan git) lalu
muat ke shell; app belum membaca file `.env` sendiri.

## Struktur

```
apps/api       Fastify HTTP API
apps/worker    proses job pg-boss (terpisah dari API)
apps/web       React + Vite (PWA)
packages/domain    fungsi murni (harga, ledger, grup) — hanya boleh impor shared
packages/shared    skema Zod, tipe Rupiah, teks bersama
packages/db        skema Drizzle & migrasi (T-013)
packages/adapters  Xendit, WhatsApp, InventorySource, Clock
config/        konfigurasi non-rahasia (lokasi.example.json = contoh struktur)
```

Aturan batas modul (dicek `pnpm lint` di CI): `domain` → `shared` saja; `db`/`adapters` →
`domain`, `shared`; `web` → `shared` saja (tidak ada perhitungan harga di klien); `api`/`worker`
merangkai semuanya.

Paket `@nekat/*` dibaca langsung dari `src/` saat dev, tes, dan typecheck (kondisi export
`@nekat/source`); `pnpm build` menghasilkan `dist/` untuk runtime Node.

Rahasia hanya lewat environment variable; `.env.example` berisi nama variabel saja.

Agen di `.claude/agents/` berasal dari [agency-agents](https://github.com/msitarzewski/agency-agents) (MIT).
