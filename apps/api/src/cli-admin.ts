// CLI pembuatan admin (T-036). Dijalankan operator di server, BUKAN endpoint publik:
//
//   pnpm --filter @nekat/api admin:buat --peran owner      (nama & nomor HP ditanyakan)
//   node dist/cli-admin.js buat [--nama "Nama"] [--hp +628…] [--peran owner|admin]
//   node dist/cli-admin.js buka-kunci [--hp +628…]           (break-glass: lepas penguncian akun)
//
// Nama & nomor HP sebaiknya diketik saat ditanya (tidak tersimpan di riwayat shell / daftar proses).
// Kata sandi diketik tersembunyi (2x) bila terminal interaktif; tanpa TTY dibaca dari stdin per baris:
// [nama bila tak diberi] [hp bila tak diberi] kata sandi, kode authenticator. Rahasia TOTP & kode pemulihan
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

// pnpm meneruskan "--" apa adanya: buang agar `admin:buat -- --nama …` juga jalan.
const argumen = process.argv.slice(2);
while (argumen[0] === "--") argumen.shift();
const { positionals, values } = parseArgs({
  args: argumen,
  allowPositionals: true,
  options: {
    nama: { type: "string" },
    hp: { type: "string" },
    peran: { type: "string", default: "owner" },
  },
});

const perintah = positionals[0];
if (perintah !== "buat" && perintah !== "buka-kunci") {
  keluarGalat(
    "Pemakaian: cli-admin.js buat [--nama N] [--hp +62…] [--peran owner|admin] | buka-kunci [--hp +62…]",
  );
}
const peran = values.peran;
if (!(PERAN_ADMIN as readonly string[]).includes(peran)) {
  keluarGalat("--peran wajib owner atau admin.");
}

const url = process.env["DATABASE_URL"];
if (!url) keluarGalat("DATABASE_URL belum diatur.");

const tty = process.stdin.isTTY;
const bacaBaris = tty ? null : pembacaBaris();
const minta = (tanya: string) => (bacaBaris ? bacaBaris() : tanyaTersembunyi(tanya));
async function mintaTerlihat(tanya: string): Promise<string> {
  if (bacaBaris) return (await bacaBaris()).trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const jawab = await new Promise<string>((s) => {
    rl.question(tanya, s);
  });
  rl.close();
  return jawab.trim();
}
const selesaiStdin = () => {
  if (bacaBaris) process.stdin.destroy();
};

const db = buatDb(url);
const repo = buatRepoAuthAdmin(db);

if (perintah === "buka-kunci") {
  const hp = values.hp ?? (await mintaTerlihat("Nomor HP admin (+62…): "));
  const a = await repo.cariUntukMasuk(hp);
  if (!a) {
    await db.$client.end();
    selesaiStdin();
    keluarGalat("Admin tidak ditemukan.");
  }
  await repo.resetGagal(a.id);
  await repo.catatAudit("ADMIN_BUKA_KUNCI_CLI", { gagalSebelum: a.gagalBeruntun }, a.id);
  console.log(`Penguncian admin ${a.id} dilepas (tercatat di log_audit).`);
  await db.$client.end();
  selesaiStdin();
  process.exit(0);
}

let konfig;
try {
  konfig = bacaKonfigAdmin(process.env);
} catch (err) {
  keluarGalat((err as Error).message);
}
if (!konfig) keluarGalat("ADMIN_TOTP_KUNCI dan ADMIN_HMAC_KUNCI wajib diatur.");

const nama = values.nama ?? (await mintaTerlihat("Nama admin: "));
const hp = values.hp ?? (await mintaTerlihat("Nomor HP admin (+62…): "));

// Cek awal sebelum meminta kata sandi / menampilkan rahasia (diulang lagi saat menyimpan).
const galatAwal =
  (await repo.jumlahAdmin()) === 0 && peran !== "owner"
    ? "Admin pertama wajib berperan owner."
    : (await repo.adaNomorHp(hp))
      ? "Nomor HP sudah dipakai admin lain."
      : null;
if (galatAwal) {
  await db.$client.end();
  selesaiStdin();
  keluarGalat(galatAwal);
}

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
console.log(`URI otpauth  : ${uriOtpauth(rahasia, nama)}`);
console.log("Tambahkan ke aplikasi authenticator, lalu masukkan kode 6 digit.\n");
const kode = (await minta("Kode authenticator: ")).trim();

try {
  const hasil = await buatAdminBaru(repo, konfig, {
    nama,
    nomorHpE164: hp,
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
  selesaiStdin();
}
