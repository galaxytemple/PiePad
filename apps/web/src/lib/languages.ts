// Editor + Piston language registry. Adding a language means a new entry
// here, plus a matching install line in scripts/install-piston-langs.sh
// (only for `runnable` ones).

export interface LanguageDef {
  id: string; // Monaco language ID
  label: string;
  /** When set, the run button is enabled and uses these values for Piston. */
  piston?: { language: string; version: string };
}

export const LANGUAGES: readonly LanguageDef[] = [
  { id: "javascript", label: "JavaScript", piston: { language: "javascript", version: "*" } },
  { id: "typescript", label: "TypeScript", piston: { language: "typescript", version: "*" } },
  { id: "python", label: "Python", piston: { language: "python", version: "*" } },
  { id: "java", label: "Java", piston: { language: "java", version: "*" } },
  { id: "cpp", label: "C++", piston: { language: "c++", version: "*" } },
  { id: "sql", label: "SQL" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
] as const;

export const DEFAULT_LANGUAGE_ID = "javascript";

export function findLanguage(id: string): LanguageDef {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0]!;
}
