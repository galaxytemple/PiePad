"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

// HeroUI v3 dropped the HeroUIProvider. Only next-themes remains for the
// light/dark switch — components read tokens straight from the imported
// @heroui/styles in globals.css.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}
