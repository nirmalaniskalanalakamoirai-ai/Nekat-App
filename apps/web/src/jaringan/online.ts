import { useSyncExternalStore } from "react";

/** id pita offline di AppShell; tombol yang nonaktif karena offline merujuknya (aria-describedby). */
export const ID_PITA_OFFLINE = "pita-offline";

function langganan(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    langganan,
    () => navigator.onLine,
    () => true,
  );
}
