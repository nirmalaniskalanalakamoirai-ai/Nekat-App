// CLI @nekat/db. DATABASE_URL dari environment (tidak pernah dicetak).
//   node dist/cli.js migrasi
//   node dist/cli.js seed
//   node dist/cli.js sinkron-lokasi [--config <path>] [--kering] [--izinkan-uji] [--paksa]   (T-015b)
//     --config       default: $LOKASI_CONFIG atau config/lokasi.json (relatif ke direktori kerja)
//     --kering       pratinjau: tampilkan rencana perubahan, tidak menulis apa pun
//     --izinkan-uji  izinkan config bertanda "uji": true (koordinat fiktif; staging/uji saja)
//     --paksa        lepas/pindah gudang walau masih ada slot DIBUKA / grup belum final (Z-03; dicatat)
//   Exit 1 bila gagal atau (mode kering) ada konflik yang akan menolak sinkron.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { bacaKonfigLokasi } from "@nekat/shared";
import { buatDb, jalankanMigrasi } from "./koneksi.js";
import { jalankanSeed } from "./seed.js";
import { sidikIsiKonfig, sinkronLokasi, teksPerubahanLokasi } from "./sinkron-lokasi.js";

const PEMAKAIAN =
  "Pemakaian: cli.js migrasi | seed | sinkron-lokasi [--config <path>] [--kering] [--izinkan-uji] [--paksa]";

const [perintah, ...sisa] = process.argv.slice(2);
const url = process.env["DATABASE_URL"];

if (!url) {
  console.error("DATABASE_URL belum diatur.");
  process.exit(1);
}
if (perintah !== "migrasi" && perintah !== "seed" && perintah !== "sinkron-lokasi") {
  console.error(PEMAKAIAN);
  process.exit(1);
}

let argSinkron: { config: string; kering: boolean; izinkanUji: boolean; paksa: boolean } | null =
  null;
if (perintah === "sinkron-lokasi") {
  try {
    const { values } = parseArgs({
      args: sisa,
      options: {
        config: { type: "string" },
        kering: { type: "boolean", default: false },
        "izinkan-uji": { type: "boolean", default: false },
        paksa: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    argSinkron = {
      config: values.config ?? process.env["LOKASI_CONFIG"] ?? "config/lokasi.json",
      kering: values.kering,
      izinkanUji: values["izinkan-uji"],
      paksa: values.paksa,
    };
  } catch (e) {
    console.error(`${(e as Error).message}\n${PEMAKAIAN}`);
    process.exit(1);
  }
}

const db = buatDb(url);
try {
  if (perintah === "migrasi") {
    await jalankanMigrasi(db);
    console.log("Migrasi selesai.");
  } else if (perintah === "seed") {
    await jalankanSeed(db);
    console.log("Seed selesai.");
  } else if (argSinkron) {
    const isi = await readFile(argSinkron.config, "utf8");
    const konfig = bacaKonfigLokasi(JSON.parse(isi) as unknown);
    const hasil = await sinkronLokasi(db, konfig, {
      kering: argSinkron.kering,
      izinkanUji: argSinkron.izinkanUji,
      paksa: argSinkron.paksa,
      sidikKonfig: sidikIsiKonfig(isi),
    });
    const awalan = hasil.kering ? "[kering] " : "";
    for (const p of hasil.perubahan) console.log(awalan + teksPerubahanLokasi(p));
    for (const k of hasil.konflik) console.log(`${awalan}KONFLIK: ${k}`);
    for (const k of hasil.konflikPemakaian) {
      const label = argSinkron.paksa ? "DIPAKSA" : "KONFLIK (bisa --paksa)";
      console.log(`${awalan}${label}: ${k}`);
    }
    const ditolak =
      hasil.konflik.length > 0 || (hasil.konflikPemakaian.length > 0 && !argSinkron.paksa);
    if (hasil.kering && ditolak) {
      console.log(`${awalan}Sinkron akan DITOLAK karena konflik di atas.`);
      process.exitCode = 1;
    }
    console.log(
      hasil.perubahan.length === 0
        ? `${awalan}Sinkron lokasi: DB sudah sesuai ${argSinkron.config}.`
        : `${awalan}Sinkron lokasi: ${hasil.perubahan.length} perubahan${hasil.kering ? " (belum diterapkan)" : " diterapkan & dicatat di log_audit"}.`,
    );
  }
} catch (e) {
  console.error(`Gagal: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
