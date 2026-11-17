import { bukaKoneksi, jalankanMigrasi } from "./koneksi.js";
import { jalankanSeed } from "./seed.js";

// Pemakaian: DATABASE_URL=postgres://... node dist/cli.js migrasi|seed
// Migrasi memakai pengguna DB dengan hak DDL (terpisah dari pengguna aplikasi, ADR-0001 §7).

const perintah = process.argv[2];
const url = process.env["DATABASE_URL"];

if (!url) {
  console.error("DATABASE_URL belum diisi.");
  process.exit(1);
}
if (perintah !== "migrasi" && perintah !== "seed") {
  console.error("Perintah: migrasi | seed");
  process.exit(1);
}

const { db, tutup } = bukaKoneksi(url);
try {
  if (perintah === "migrasi") {
    await jalankanMigrasi(db);
    console.log("Migrasi selesai.");
  } else {
    await jalankanSeed(db);
    console.log("Seed selesai.");
  }
} finally {
  await tutup();
}
