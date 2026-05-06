import { describe, expect, test } from "vitest";
import {
  DEFAULT_LANGUAGE_ID,
  findLanguage,
  LANGUAGES,
} from "./languages";

describe("findLanguage", () => {
  test("returns the matching definition when id is known", () => {
    const py = findLanguage("python");
    expect(py.id).toBe("python");
    expect(py.label).toBe("Python");
    expect(py.piston?.language).toBe("python");
  });

  test("falls back to the first language for unknown id", () => {
    const fallback = findLanguage("klingon");
    expect(fallback.id).toBe(LANGUAGES[0]!.id);
  });

  test("DEFAULT_LANGUAGE_ID is python and is in the registry", () => {
    expect(DEFAULT_LANGUAGE_ID).toBe("python");
    expect(LANGUAGES.find((l) => l.id === DEFAULT_LANGUAGE_ID)).toBeDefined();
  });

  test("runnable languages have a non-empty argsHint", () => {
    for (const lang of LANGUAGES) {
      if (lang.piston) {
        expect(lang.piston.argsHint.length).toBeGreaterThan(0);
        expect(lang.piston.language.length).toBeGreaterThan(0);
        expect(lang.piston.version.length).toBeGreaterThan(0);
      }
    }
  });
});
