import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  applyResolvedTheme,
  DEFAULT_THEME,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  systemPrefersDark,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

/**
 * Preferência de aparência (Claro, Escuro ou Automático). Mantém o documento
 * sincronizado com o sistema operacional e com outras abas abertas.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME);
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const sync = () => {
      const next = readThemePreference();
      const theme = resolveTheme(next, systemPrefersDark());
      applyResolvedTheme(theme);
      setPreferenceState(next);
      setResolved(theme);
    };
    sync();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) sync();
    };
    media.addEventListener("change", sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setThemePreference(next);
  }, []);

  return { preference, resolved, setPreference };
}

function subscribeToDocumentTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function documentTheme(): ResolvedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Tema efetivo do documento, para bibliotecas que não leem CSS (ex.: ApexCharts). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeToDocumentTheme, documentTheme, () => "light");
}
