import { useEffect, useSyncExternalStore } from "react";
import { MedLoading } from "@/lib/med-loading";

const ECG_PATH =
  "M803 1098.5H1262.6L1349.4 1185.4L1422.6 1003L1500.4 1098L1643 891L1820.4 1200.8L2022 531L2194.6 1628.4L2335 954.6L2443 1124.4L2525.4 1019L2591 1098.5H3036";

/** Overlay do loading ECG. Montado uma vez na raiz; controlado por MedLoading. */
export function MedLoader() {
  const active = useSyncExternalStore(MedLoading.subscribe, MedLoading.isActive, () => false);
  return (
    <div
      className={`med-loader${active ? " is-active" : ""}`}
      role="status"
      aria-live="polite"
      aria-hidden={!active}
    >
      <svg viewBox="803 480 2233 1180" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient
            id="ml-grad"
            gradientUnits="userSpaceOnUse"
            x1="803"
            y1="0"
            x2="3036"
            y2="0"
          >
            <stop offset="0" style={{ stopColor: "var(--ml-c1)" }} />
            <stop offset=".55" style={{ stopColor: "var(--ml-c2)" }} />
            <stop offset="1" style={{ stopColor: "var(--ml-c3)" }} />
          </linearGradient>
        </defs>
        <path className="ml-track" pathLength={100} d={ECG_PATH} />
        <path className="ml-run" pathLength={100} d={ECG_PATH} />
      </svg>
      <span className="sr-only">Carregando…</span>
    </div>
  );
}

/** Mantém o loading ligado enquanto `active` for true (ex.: carregamento da tela). */
export function useMedLoading(active: boolean) {
  useEffect(() => {
    if (!active) return;
    MedLoading.show();
    return () => MedLoading.hide();
  }, [active]);
}

export default MedLoader;
