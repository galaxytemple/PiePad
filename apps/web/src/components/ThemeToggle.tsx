"use client";

import { Button } from "@heroui/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes can't know the resolved theme until the client mounts. To
  // avoid SSR/CSR icon mismatch we always render the moon glyph on first
  // paint and let useEffect swap it once the real theme is known. Keeping
  // a real icon (not a placeholder dot) means the button always looks
  // right and is always hittable.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && theme === "dark";
  const next = isDark ? "light" : "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      isIconOnly
      variant="outline"
      size="sm"
      aria-label={label}
      onPress={() => setTheme(next)}
    >
      <span aria-hidden suppressHydrationWarning>
        {isDark ? "☀️" : "🌙"}
      </span>
    </Button>
  );
}
