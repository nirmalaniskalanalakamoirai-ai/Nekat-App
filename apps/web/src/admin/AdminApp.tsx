// H-14 Panel admin (T-036, T-007 §6): login + TOTP wajib (H9), produk/SKU/satuan, stok, log.
// Dimuat lazy dari main.tsx agar tidak menambah bundle pembeli.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { apiAdmin, aturCsrf, aturSaatSesiHabis, type GalatAdmin, type Saya } from "./api";
import { HalamanLog } from "./Log";
import { Masuk } from "./Masuk";
import { DaftarProduk, FormProduk } from "./Produk";
import { HalamanStok } from "./Stok";
import "./admin.css";

const MENU = [
  { ke: "/admin/produk", label: "Produk", izin: "produk.ubah" },
  { ke: "/admin/stok", label: "Stok & Gudang", izin: "stok.ubah" },
  { ke: "/admin/log", label: "Log perubahan", izin: null },
] as const;

export function AdminApp() {
  const qc = useQueryClient();
  const [menuBuka, setMenuBuka] = useState(false);
  const saya = useQuery<Saya, GalatAdmin>({
    queryKey: ["admin", "saya"],
    queryFn: apiAdmin.saya,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    aturCsrf(saya.data?.csrfToken ?? null);
  }, [saya.data]);

  useEffect(() => {
    aturSaatSesiHabis(() => {
      aturCsrf(null);
      qc.removeQueries({ queryKey: ["admin"] });
      void qc.invalidateQueries({ queryKey: ["admin", "saya"] });
    });
    return () => {
      aturSaatSesiHabis(null);
    };
  }, [qc]);

  useEffect(() => {
    document.title = "Panel admin · NEKAT";
  }, []);

  if (saya.isPending) {
    return (
      <div className="adm-pusat" role="status">
        Memuat panel admin…
      </div>
    );
  }
  if (saya.error) {
    if (saya.error.status === 401) {
      return (
        <Masuk
          onMasuk={(csrf) => {
            aturCsrf(csrf);
            void qc.invalidateQueries({ queryKey: ["admin", "saya"] });
          }}
        />
      );
    }
    return (
      <div className="adm-pusat l-stack" role="alert">
        <p>{saya.error.message}</p>
        <button type="button" className="btn btn--secondary" onClick={() => void saya.refetch()}>
          Coba lagi
        </button>
      </div>
    );
  }

  const s = saya.data;
  const izin = new Set(s.admin.izin);
  const boleh = (i: string | null) => i === null || izin.has(i);

  async function keluar() {
    try {
      await apiAdmin.keluar();
    } finally {
      aturCsrf(null);
      qc.removeQueries({ queryKey: ["admin"] });
      void qc.invalidateQueries({ queryKey: ["admin", "saya"] });
    }
  }

  return (
    <div className="l-admin adm">
      <a className="skip-link btn btn--primary" href="#isi-admin">
        Lewati ke isi
      </a>
      <aside className={menuBuka ? "adm-sisi adm-sisi--buka" : "adm-sisi"} id="menu-admin">
        <p className="adm-merek">NEKAT Admin</p>
        <nav aria-label="Menu admin">
          <ul className="adm-menu">
            {MENU.filter((m) => boleh(m.izin)).map((m) => (
              <li key={m.ke}>
                <NavLink
                  to={m.ke}
                  className="adm-menu__item tap"
                  onClick={() => {
                    setMenuBuka(false);
                  }}
                >
                  {m.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="adm-utama">
        <header className="adm-atas">
          <button
            type="button"
            className="btn btn--ghost adm-atas__menu"
            aria-expanded={menuBuka}
            aria-controls="menu-admin"
            onClick={() => {
              setMenuBuka((b) => !b);
            }}
          >
            Menu
          </button>
          <p className="adm-atas__info">
            <span className="adm-atas__nama">{s.admin.nama}</span>
            <span className="chip">{s.admin.peran.join(", ")}</span>
            <span className="chip chip--group">
              Stok: {s.sumberInventori === "local" ? "Lokal" : "API Gudang"}
            </span>
          </p>
          <button type="button" className="btn btn--secondary" onClick={() => void keluar()}>
            Keluar
          </button>
        </header>
        <main id="isi-admin" className="adm-isi" tabIndex={-1}>
          <Routes>
            <Route index element={<Navigate to="/admin/produk" replace />} />
            <Route
              path="produk"
              element={
                <Jaga ok={boleh("produk.ubah")}>
                  <DaftarProduk />
                </Jaga>
              }
            />
            <Route
              path="produk/baru"
              element={
                <Jaga ok={boleh("produk.ubah")}>
                  <FormProduk />
                </Jaga>
              }
            />
            <Route
              path="produk/:id"
              element={
                <Jaga ok={boleh("produk.ubah")}>
                  <FormProduk sumber={s.sumberInventori} />
                </Jaga>
              }
            />
            <Route
              path="stok"
              element={
                <Jaga ok={boleh("stok.ubah")}>
                  <HalamanStok />
                </Jaga>
              }
            />
            <Route path="log" element={<HalamanLog />} />
            <Route path="*" element={<p>Halaman admin tidak ditemukan.</p>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/** State "tanpa izin" (T-007 §6). Server tetap menolak (403); ini hanya tampilan. */
function Jaga({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  if (!ok) return <p role="alert">Peranmu tidak punya akses ke menu ini.</p>;
  return <>{children}</>;
}
