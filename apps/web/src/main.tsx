import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router";
import { Katalog } from "./halaman/Katalog";
import { Keranjang } from "./halaman/Keranjang";
import { PilihZona } from "./halaman/PilihZona";
import { Segera, TidakDitemukan } from "./halaman/Segera";
import { AppShell } from "./layout/AppShell";
import { RUTE_PEMBELI, atributTema, type PilihanTema } from "./rute";
import "./styles/tokens.css";

function terapkanTema() {
  let pilihan: PilihanTema = "ikuti-hp";
  try {
    const simpan = localStorage.getItem("nekat:tema");
    if (simpan === "terang" || simpan === "gelap") pilihan = simpan;
  } catch {
    // Penyimpanan tidak tersedia: ikuti HP.
  }
  const attr = atributTema(pilihan);
  if (attr) document.documentElement.setAttribute("data-theme", attr);
}

terapkanTema();

const akar = document.getElementById("root");
if (!akar) {
  throw new Error("Elemen #root tidak ditemukan");
}

// Halaman yang sudah dibuat; sisanya "sedang disiapkan".
const HALAMAN_JADI: Record<string, ReactElement> = {
  "/zona": <PilihZona />,
  "/keranjang": <Keranjang />,
};

// H-02: `/`, `/k/:kategori/:sub?`, `/cari` memakai SATU elemen Katalog di route layout tanpa path,
// sehingga berpindah antar-ketiganya tidak me-mount ulang halaman (kolom cari tetap fokus).
const RUTE_KATALOG = new Set(["/", "/k/:kategori/:sub?", "/cari"]);

const anakKatalog: RouteObject[] = RUTE_PEMBELI.filter((r) => RUTE_KATALOG.has(r.path)).map((r) =>
  r.path === "/"
    ? { index: true, element: null, handle: { judul: r.judul } }
    : { path: r.path, element: null, handle: { judul: r.judul } },
);

const anak: RouteObject[] = [
  { element: <Katalog />, children: anakKatalog },
  ...RUTE_PEMBELI.filter((r) => !RUTE_KATALOG.has(r.path)).map((r) => ({
    path: r.path,
    element: HALAMAN_JADI[r.path] ?? <Segera judul={r.judul} kodeHalaman={r.kodeHalaman} />,
    handle: { judul: r.judul },
  })),
];

const router = createBrowserRouter([
  // H-14 Panel admin (T-036): kerangka sendiri (bukan AppShell pembeli), dimuat lazy.
  {
    path: "/admin/*",
    lazy: () => import("./admin/AdminApp").then((m) => ({ Component: m.AdminApp })),
  },
  {
    path: "/",
    element: <AppShell />,
    children: [
      ...anak,
      { path: "*", element: <TidakDitemukan />, handle: { judul: "Tidak ditemukan" } },
    ],
  },
]);

const queryClient = new QueryClient();

createRoot(akar).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
