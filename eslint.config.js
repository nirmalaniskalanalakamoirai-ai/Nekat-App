// ESLint flat config NEKAT (ADR-0001 §3, §3.1).
// - typescript-eslint strict + type-checked; `any` dilarang (no-explicit-any + no-unsafe-*).
// - Aturan batas modul lewat eslint-plugin-boundaries, sesuai aturan dependensi ADR §3.1.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const TS = ["**/*.ts", "**/*.tsx"];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/*.d.ts"],
  },

  js.configs.recommended,

  // ---- TypeScript: strict + type-aware ----
  {
    files: TS,
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },

  // ---- Batas modul (ADR-0001 §3.1) ----
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "shared", pattern: "packages/shared", partialMatch: false },
        { type: "domain", pattern: "packages/domain", partialMatch: false },
        { type: "db", pattern: "packages/db", partialMatch: false },
        { type: "adapters", pattern: "packages/adapters", partialMatch: false },
        { type: "api", pattern: "apps/api", partialMatch: false },
        { type: "worker", pattern: "apps/worker", partialMatch: false },
        { type: "web", pattern: "apps/web", partialMatch: false },
      ],
      "boundaries/files": [{ category: "test", pattern: "**/*.test.{ts,tsx}" }],
      // Paket workspace @nekat/* di-resolve ke src/ (kondisi "@nekat/source"), sehingga
      // dikenali sebagai elemen lokal, bukan paket eksternal.
      "import/resolver": {
        typescript: {
          project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
          conditionNames: ["@nekat/source", "types", "import", "node", "default"],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/no-unknown-dependencies": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          // Periksa juga impor paket npm & modul bawaan Node, bukan hanya impor lokal.
          checkAllOrigins: true,
          message:
            "Batas modul ADR-0001 §3.1: {{ from.element.type }} tidak boleh mengimpor {{ to.element.type }}{{ to.module.source }}",
          policies: [
            // shared: daun paling bawah. Tidak boleh impor paket NEKAT lain; npm boleh (zod), Node core tidak (dipakai web).
            {
              from: { element: { type: "shared" } },
              allow: { to: { module: { origin: "external" } } },
            },
            // domain: fungsi murni, HANYA boleh impor shared. Tanpa npm, tanpa Node core.
            {
              from: { element: { type: "domain" } },
              allow: { to: { element: { type: "shared" } } },
            },
            // db & adapters: boleh domain + shared + npm + Node core.
            {
              from: { element: { types: { anyOf: ["db", "adapters"] } } },
              allow: [
                { to: { element: { types: { anyOf: ["domain", "shared"] } } } },
                { to: { module: { origin: ["external", "core"] } } },
              ],
            },
            // api & worker: merangkai semuanya (bukan app lain).
            {
              from: { element: { types: { anyOf: ["api", "worker"] } } },
              allow: [
                { to: { element: { types: { anyOf: ["shared", "domain", "db", "adapters"] } } } },
                { to: { module: { origin: ["external", "core"] } } },
              ],
            },
            // web (PWA): hanya shared + npm. Tidak boleh domain (tidak ada perhitungan harga di klien,
            // ADR §3 & §5.3), db, adapters, atau Node core.
            {
              from: { element: { type: "web" } },
              allow: [
                { to: { element: { type: "shared" } } },
                { to: { module: { origin: "external" } } },
              ],
            },
            // File tes boleh memakai paket npm (vitest) & Node core di elemen mana pun.
            {
              from: { file: { categories: "test" } },
              allow: { to: { module: { origin: ["external", "core"] } } },
            },
          ],
        },
      ],
    },
  },

  // ---- React (web) ----
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
  },

  // ---- File konfigurasi JS di root (tanpa type-aware lint) ----
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Matikan aturan gaya yang bentrok dengan Prettier (harus terakhir).
  prettier,
);
