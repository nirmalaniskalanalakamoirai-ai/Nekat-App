import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router";
import { Beranda } from "./halaman/Beranda";
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
};

const anak: RouteObject[] = RUTE_PEMBELI.map((r) =>
  r.path === "/"
    ? { index: true, element: <Beranda />, handle: { judul: r.judul } }
    : {
        path: r.path,
        element: HALAMAN_JADI[r.path] ?? <Segera judul={r.judul} kodeHalaman={r.kodeHalaman} />,
        handle: { judul: r.judul },
      },
);

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
