// CLI: `node dist/cli.js migrasi` | `node dist/cli.js seed`. DATABASE_URL dari environment.
import { buatDb, jalankanMigrasi } from "./koneksi.js";
import { jalankanSeed } from "./seed.js";

const perintah = process.argv[2];
const url = process.env["DATABASE_URL"];

if (!url) {
  console.error("DATABASE_URL belum diatur.");
  process.exit(1);
}
if (perintah !== "migrasi" && perintah !== "seed") {
  console.error("Pemakaian: cli.js migrasi | seed");
  process.exit(1);
}

const db = buatDb(url);
try {
  if (perintah === "migrasi") {
    await jalankanMigrasi(db);
    console.log("Migrasi selesai.");
  } else {
    await jalankanSeed(db);
    console.log("Seed selesai.");
  }
} finally {
  await db.$client.end();
}
