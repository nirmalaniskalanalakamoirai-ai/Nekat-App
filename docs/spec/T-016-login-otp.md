# T-016 — Gateway WhatsApp & login OTP pembeli

Status: v0.1 (28 Nov 2026) · Squad: Build & QA (Joseph) · Penyusun: Backend Architect + Frontend Developer
Dasar: `keputusan.md` §3 (1 akun per nomor HP terverifikasi), §11 H2/H9/K-04, K-35, F-23, H12/K-43; ADR-0001 §4.3, §7;
T-004 §3.1 (`akun`, `otp_permintaan`, `otp_gagal_harian`, `sesi`); T-010 §3 (port, mode, §3.3a OTP di luar outbox, N-03, N-13);
T-007 H-07. Tanpa angka harga. Tanpa migrasi (skema T-004 sudah cukup).

## 1. Komponen

| Lapis | File | Isi |
|---|---|---|
| shared | `packages/shared/src/nomor-hp.ts`, `lingkungan.ts` | Normalisasi `0812…`/`62…`/`+62 …`/`812…` → E.164 `+628…` (satu sumber API & web), samaran `+62 812•••• 34`, daftar NODE_ENV sah |
| domain | `packages/domain/src/notifikasi/` | Port `WhatsAppGateway`, `WaGalat`/`KelasGalatWa` (T-010 §3.1), `KebijakanOtp` + DEFAULT, tanggal WIB |
| adapters | `packages/adapters/src/whatsapp/` | `bacaKonfigWhatsApp` (penjaga start), `LogGateway`, `MetaCloudGateway` (sandbox/meta, **kerangka**), pabrik |
| db | `packages/db/src/repo/masuk-pembeli.ts` | Transaksi kirim & verifikasi OTP, akun, sesi, `log_audit` |
| api | `apps/api/src/masuk/` | Konfigurasi env, kripto, layanan, rute, hook autentikasi pembeli |
| web | `apps/web/src/masuk/` | Layar H-07 `/masuk` |

## 2. Gateway WhatsApp & penjaga start

| NODE_ENV | WA_MODE boleh | Kosong |
|---|---|---|
| development, test | `log`, `sandbox` | `log` |
| staging | `log`, `sandbox` | gagal start |
| production | **hanya `meta`** | gagal start |
| lain / kosong | — | gagal start |

- `log`: tidak mengirim apa pun. Kode OTP terakhir per nomor hanya di memori proses (TTL = umur OTP). Endpoint dev
  `POST /api/dev/otp-terakhir {nomorHp}` **hanya didaftarkan** bila mode log **dan** NODE_ENV development/test.
- `sandbox`: Cloud API, hanya ke nomor di `WA_SANDBOX_NOMOR_IZIN` (`v{versi}:{hex}` = HMAC-SHA256 kunci HMAC HP versi itu,
  nomor E.164). Nomor lain → `WaGalat(PENERIMA, DIBLOKIR_SANDBOX)`, tidak dikirim. Versi entri tidak dikenal → gagal start.
- `meta`: production saja; URL Graph API dikunci ke `https://graph.facebook.com`. **Belum diuji ke Meta nyata** (W-04).
- Log/galat tidak pernah memuat nomor, kode, token, atau isi respons penyedia.

## 3. OTP

Kirim (`POST /api/masuk/otp {nomorHp}` → `200 {kedaluwarsaDetik, kirimUlangDetik}`):
1. Batas laju per IP di memori (IPv6 per /64; `req.ip` hanya membaca XFF dari `TRUST_PROXY`).
2. Satu transaksi di bawah advisory lock global OTP: jeda kirim ulang (OTP hidup yang lebih muda dari jeda → `429
   TERLALU_CEPAT` + `tungguDetik`) → anggaran global jam/hari (habis → `503` + log `alert: OTP_ANGGARAN`) → batas kirim harian
   per nomor (`otp_gagal_harian.kirim`) → OTP lama `digantikan_pada` → insert (hanya `hp_hmac` & `kode_hmac`).
3. Setelah commit, kirim sinkron lewat gateway (kunci idempotensi `otp:{otp_permintaan_id}`), maks 3 percobaan untuk
   `SEMENTARA`/`BATAS`, total ≤ 12 dtk. Gagal → OTP dibatalkan, jatah kirim harian dikembalikan, `503 KODE_BELUM_TERKIRIM`.
4. Tidak pernah membaca tabel `akun` → respons & waktu sama untuk nomor terdaftar/belum (tes enumerasi).

Kode: 6 digit `crypto.randomInt`; disimpan `HMAC-SHA256(OTP_KODE_KUNCI, "otp|" + hex(hp_hmac) + "|" + kode)`.

Verifikasi (`POST /api/masuk/verifikasi {nomorHp, kode, waOptin=false}`), satu transaksi:
1. `UPDATE otp_permintaan SET percobaan = percobaan + 1 WHERE hidup AND belum kedaluwarsa AND percobaan < maks RETURNING …`
   — jatah dipesan **sebelum** kode dibandingkan; baris terkunci sampai commit (tebakan paralel diserialkan).
2. Jatah gagal harian per nomor (`otp_gagal_harian.gagal`, tidak di-reset kirim ulang); habis → rollback (kode tidak
   dibandingkan) → `429` + `log_audit OTP_PEMBELI_BATAS_HARIAN`.
3. Bandingkan HMAC constant-time. Salah → `401 KODE_SALAH {sisaPercobaan}`; sisa 0 → hangus (`log_audit OTP_PEMBELI_HANGUS`).
4. Benar → `terpakai_pada`, jatah gagal dikembalikan, akun dicari dengan HMAC semua versi kunci **atau** nomor
   (`FOR UPDATE`); belum ada → dibuat (`hp_hmac` UK = 1 akun per nomor); versi kunci lama → di-HMAC ulang.
   Akun `DIHAPUS`/dianonimkan → `403 AKUN_TIDAK_AKTIF` (W-03). Sesi lama di cookie yang sama dicabut, sesi baru dibuat
   (`reauth_pada` = sekarang), `log_audit LOGIN_PEMBELI_BERHASIL`; `waOptin=true` → `log_audit WA_OPTIN {sumber: LOGIN_OTP}`.

## 4. Sesi & CSRF

- Cookie `__Host-nekat_sesi`: `HttpOnly; Secure; SameSite=Lax; Path=/` (Lax: link WhatsApp → halaman grup tetap masuk).
  DB menyimpan `sha256(token)`; umur 30 hari, idle 14 hari (env).
- CSRF: `HMAC(SESI_PEMBELI_KUNCI, "csrf-pembeli|" + token)`, dikirim di body login & `GET /api/saya`, wajib di header
  `x-csrf-token` untuk mutasi yang memakai sesi. Login sendiri dilindungi: wajib `content-type: application/json`, tolak
  `Sec-Fetch-Site: cross-site` & Origin selain `APP_BASE_URL` (atau Host bila kosong).
- `POST /api/keluar`: sesi hidup tanpa CSRF benar → 403; selain itu cabut + hapus cookie (204).
- `GET /api/saya`: `{akun: {id, nomorHpSamar, jenisPelanggan, status}, csrfToken, sesiBerakhir}` (tanpa nama/nomor utuh).

## 5. Hook autentikasi untuk rute pembeli lain

`apps/api/src/masuk/autentikasi.ts`:
- `buatAutentikasiPembeli(layanan): AutentikasiPembeli` — tipe **sama** dengan `tolakSemuaSampaiT016` di PR T-021
  (`saldo/rute.ts`) & T-029 (`pembeli/autentikasi.ts`): `(req) => Promise<{akunId} | null>`; deklarasi
  `FastifyRequest.akunSesi?: { akunId: string }` identik. Mutasi tanpa `x-csrf-token` benar → `null` (401).
- `hookWajibMasuk(layanan)` — untuk rute baru: 401 / 403 CSRF / 503, mengisi `req.akunSesi`.

Pemasangan setelah PR #36 (T-021) & #39 (T-029) di-merge, di `server.ts`:

```ts
const autentikasi = masuk?.layanan ? buatAutentikasiPembeli(masuk.layanan) : undefined;
const app = buatApp({ …, masuk, saldo: { repo: repoSaldo, autentikasi }, tagihan: { …tagihan, autentikasi } });
```

Klien web untuk rute itu wajib mengirim `credentials: "same-origin"` dan header `x-csrf-token` (dari
`ambilCsrfPembeli()` di `apps/web/src/masuk/api.ts`) untuk POST. Duplikat tipe `AutentikasiPembeli` di tiga file boleh
disatukan ke `masuk/autentikasi.ts` saat merge (deklarasi modul identik, tidak konflik tipe).

## 6. Environment (nama saja; nilai di secret store)

`NODE_ENV` (wajib dikenal) · `WA_MODE`, `WA_API_VERSI`, `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`[rahasia], `WA_TEMPLATE_OTP`,
`WA_TIMEOUT_MS`, `WA_API_URL`, `WA_SANDBOX_NOMOR_IZIN` · `HP_HMAC_KUNCI`[rahasia], `HP_HMAC_KUNCI_VERSI`,
`HP_HMAC_KUNCI_LAMA`[rahasia], `OTP_KODE_KUNCI`[rahasia], `OTP_KODE_KUNCI_VERSI`, `SESI_PEMBELI_KUNCI`[rahasia] ·
`OTP_KEDALUWARSA_MENIT`(5), `OTP_MAKS_PERCOBAAN`(5), `OTP_JEDA_KIRIM_ULANG_DETIK`(60), `OTP_MAKS_KIRIM_PER_HARI`(8),
`OTP_MAKS_GAGAL_PER_HARI`(15), `OTP_MAKS_KIRIM_PER_IP_PER_JAM`(30), `OTP_MAKS_VERIFIKASI_PER_IP_PER_MENIT`(30),
`OTP_ANGGARAN_JAM`(600), `OTP_ANGGARAN_HARI`(5000), `SESI_PEMBELI_HARI`(30), `SESI_PEMBELI_IDLE_HARI`(14).
Dev lokal dengan Vite: `APP_BASE_URL=http://localhost:5173` (Origin dari proxy Vite).

## 7. Belum di T-016 (handoff)

- Tabel T-010 §3.5 (`akun_notifikasi`, `pesan_wa`, `template_wa`, `wa_laju`, …), antrean `wa-kirim`, webhook WA → migrasi
  terpisah setelah PR #36/#39 (nomor 0009+). Sampai itu opt-in WA tercatat di `log_audit WA_OPTIN` (backfill ke
  `akun_notifikasi.wa_optin_pada`), dan status kirim OTP hanya di log terstruktur.
- Penjaga start WA di worker (dipasang saat worker mulai mengirim WA, T-035).
- H-08 persetujuan S&K (T-017): setelah login, arahkan ke `/persetujuan` bila versi berlaku belum disetujui (F-23).
- Batas laju per IP di memori proses (1 VPS, H3). API diskalakan horizontal → pindah ke penyimpanan bersama.
