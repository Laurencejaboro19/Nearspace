/**
 * Theme state, kept on the <html> element and readable from anywhere.
 *
 * Structure depictions have to know the theme to pick legible colours, and they are rendered deep
 * inside lists and drawers. Rather than drill a prop through every one of them, components
 * subscribe to the class on <html> directly — one source of truth, and it stays correct even for a
 * depiction rendered long after a theme change.
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setDark(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  try {
    localStorage.setItem("nearspace-theme", dark ? "dark" : "light");
  } catch {
    /* private browsing — the theme just will not persist */
  }
  emit();
}

/** Dark unless the visitor has previously chosen light. */
export function initialDark(): boolean {
  try {
    const saved = localStorage.getItem("nearspace-theme");
    if (saved === "light") return false;
    if (saved === "dark") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return !document.documentElement.classList.contains("light");
}

/** Server rendering has no DOM; the dark default matches the markup we ship. */
function getServerSnapshot(): boolean {
  return true;
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
