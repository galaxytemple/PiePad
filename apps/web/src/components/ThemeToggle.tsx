"use client";

import { useTheme } from "next-themes";

// CSS-only icon driven by the .dark class on <html>: always reflects the
// actually applied theme even when next-themes' hook value is briefly
// undefined right after a client-side navigation. Click reads the DOM
// directly so the toggle never disagrees with what the user sees.
//
// Plain <button> instead of HeroUI Button on purpose: react-aria-components
// caches focus/press handlers in a way that goes stale after browser back-
// navigation in this app, so the toggle silently stops responding.
export function ThemeToggle() {
  const { setTheme } = useTheme();

  const onClick = () => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Toggle theme"
      className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-divider bg-content1 text-base transition-colors hover:bg-content2"
    >
      <span className="dark:hidden" aria-hidden>
        ☀️
      </span>
      <span className="hidden dark:inline" aria-hidden>
        🌙
      </span>
    </button>
  );
}
