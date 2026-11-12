import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Beranda } from "./Beranda";

const akar = document.getElementById("root");
if (!akar) {
  throw new Error("Elemen #root tidak ditemukan");
}

const queryClient = new QueryClient();
const router = createBrowserRouter([{ path: "/", element: <Beranda /> }]);

createRoot(akar).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
