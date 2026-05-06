"use client";

import { Button } from "@heroui/react";
import { useTheme } from "next-themes";

// CSS-only icon driven by the .dark class on <html>: always reflects the
// actually applied theme, even when next-themes' hook value is briefly
// undefined right after a client-side navigation. Click reads the DOM
// directly so the toggle never disagrees with what the user sees.
export function ThemeToggle() {
  const { setTheme } = useTheme();

  const handlePress = () => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <Button
      isIconOnly
      variant="outline"
      size="sm"
      aria-label="Toggle theme"
      onPress={handlePress}
    >
      <span className="dark:hidden" aria-hidden>
        ☀️
      </span>
      <span className="hidden dark:inline" aria-hidden>
        🌙
      </span>
    </Button>
  );
}
