// CLI pembuatan admin (T-036). Dijalankan operator di server, BUKAN endpoint publik:
//
//   node dist/cli-admin.js buat --nama "Nama Admin" --hp +628xxxxxxxxxx --peran owner
//
// Kata sandi diketik tersembunyi (2x) bila terminal interaktif; tanpa TTY dibaca dari stdin
// (baris 1 = kata sandi, baris 2 = kode authenticator). Rahasia TOTP & kode pemulihan
// DITAMPILKAN SEKALI dan tidak disimpan dalam bentuk terbaca. Env: DATABASE_URL, ADMIN_TOTP_KUNCI,
// ADMIN_HMAC_KUNCI (lihat .env.example).
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { buatDb, buatRepoAuthAdmin } from "@nekat/db";
import { buatAdminBaru, GalatBuatAdmin, PERAN_ADMIN, type PeranAdmin } from "./admin/buat-admin.js";
import { bacaKonfigAdmin } from "./admin/konfig.js";
import { base32, buatRahasiaTotp, uriOtpauth } from "./admin/kripto.js";

function keluarGalat(pesan: string): never {
  console.error(pesan);
  process.exit(1);
}

/** Baca satu baris tanpa menampilkan ketikan (TTY). */
function tanyaTersembunyi(tanya: string): Promise<string> {
  return new Promise((selesai) => {
    const stdin = process.stdin;
    process.stdout.write(tanya);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let isi = "";
    const saat = (c: string) => {
      for (const ch of c) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", saat);
          process.stdout.write("\n");
          selesai(isi);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") isi = isi.slice(0, -1);
        else isi += ch;
      }
    };
    stdin.on("data", saat);
  });
}

/** Pembaca baris untuk stdin non-TTY (otomasi). */
function pembacaBaris(): () => Promise<string> {
  const rl = createInterface({ input: process.stdin });
  const antre: string[] = [];
  const tunggu: ((s: string) => void)[] = [];
  rl.on("line", (l) => {
    const t = tunggu.shift();
    if (t) t(l);
    else antre.push(l);
  });
  rl.on("close", () => {
    for (const t of tunggu.splice(0)) t("");
  });
  return () => {
    const ada = antre.shift();
    return ada !== undefined ? Promise.resolve(ada) : new Promise((s) => tunggu.push(s));
  };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    nama: { type: "string" },
    hp: { type: "string" },
    peran: { type: "string", default: "owner" },
  },
});

if (positionals[0] !== "buat" || !values.nama || !values.hp) {
  keluarGalat(
    'Pemakaian: cli-admin.js buat --nama "Nama" --hp +628xxxxxxxxxx [--peran owner|admin]',
  );
}
const peran = values.peran;
if (!(PERAN_ADMIN as readonly string[]).includes(peran))
  keluarGalat("--peran wajib owner atau admin.");

const url = process.env["DATABASE_URL"];
if (!url) keluarGalat("DATABASE_URL belum diatur.");
let konfig;
try {
  konfig = bacaKonfigAdmin(process.env);
} catch (err) {
  keluarGalat((err as Error).message);
}
if (!konfig) keluarGalat("ADMIN_TOTP_KUNCI dan ADMIN_HMAC_KUNCI wajib diatur.");

// Cek awal sebelum meminta kata sandi / menampilkan rahasia (diulang lagi saat menyimpan).
const db = buatDb(url);
const repo = buatRepoAuthAdmin(db);
const galatAwal =
  (await repo.jumlahAdmin()) === 0 && peran !== "owner"
    ? "Admin pertama wajib berperan owner."
    : (await repo.adaNomorHp(values.hp))
      ? "Nomor HP sudah dipakai admin lain."
      : null;
if (galatAwal) {
  await db.$client.end();
  keluarGalat(galatAwal);
}

const tty = process.stdin.isTTY;
const bacaBaris = tty ? null : pembacaBaris();
const minta = (tanya: string) => (bacaBaris ? bacaBaris() : tanyaTersembunyi(tanya));

const sandi = await minta("Kata sandi (min. 12 karakter): ");
if (tty) {
  const ulang = await tanyaTersembunyi("Ulangi kata sandi: ");
  if (ulang !== sandi) keluarGalat("Kata sandi tidak sama.");
}

const rahasia = buatRahasiaTotp();
// Ditampilkan SEKALI. Jangan salin ke chat/tiket; masukkan langsung ke aplikasi authenticator.
console.log("\n=== Rahasia TOTP (tampil sekali) ===");
console.log(
  `Kunci manual : ${base32(rahasia)
    .replace(/(.{4})/g, "$1 ")
    .trim()}`,
);
console.log(`URI otpauth  : ${uriOtpauth(rahasia, values.nama)}`);
console.log("Tambahkan ke aplikasi authenticator, lalu masukkan kode 6 digit.\n");
const kode = (await minta("Kode authenticator: ")).trim();

try {
  const hasil = await buatAdminBaru(repo, konfig, {
    nama: values.nama,
    nomorHpE164: values.hp,
    peran: peran as PeranAdmin,
    kataSandi: sandi,
    rahasiaTotp: rahasia,
    kodeKonfirmasi: kode,
  });
  console.log(`\nAdmin dibuat (id ${hasil.id}, peran ${peran}).`);
  console.log("=== Kode pemulihan (tampil sekali, simpan di password manager tim) ===");
  for (const k of hasil.kodePemulihan) console.log(`  ${k}`);
} catch (err) {
  if (err instanceof GalatBuatAdmin) keluarGalat(err.message);
  throw err;
} finally {
  rahasia.fill(0);
  await db.$client.end();
  if (bacaBaris) process.stdin.destroy();
}
