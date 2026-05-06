// Editor + Piston language registry. Adding a language means a new entry
// here, plus a matching install line in scripts/install-piston-langs.sh
// (only for `runnable` ones).

export interface LanguageDef {
  id: string; // Monaco language ID
  label: string;
  /** When set, the run button is enabled and uses these values for Piston. */
  piston?: { language: string; version: string; argsHint: string };
}

export const LANGUAGES: readonly LanguageDef[] = [
  {
    id: "javascript",
    label: "JavaScript",
    piston: {
      language: "javascript",
      version: "*",
      argsHint: "Read with: process.argv[2], process.argv[3], ...",
    },
  },
  {
    id: "typescript",
    label: "TypeScript",
    piston: {
      language: "typescript",
      version: "*",
      argsHint: "Read with: process.argv[2], process.argv[3], ...",
    },
  },
  {
    id: "python",
    label: "Python",
    piston: {
      language: "python",
      version: "*",
      argsHint: "Read with: sys.argv[1], sys.argv[2], ... (import sys first)",
    },
  },
  {
    id: "java",
    label: "Java",
    piston: {
      language: "java",
      version: "*",
      argsHint: "Read with: args[0], args[1], ... (the String[] passed to main)",
    },
  },
  {
    id: "cpp",
    label: "C++",
    piston: {
      language: "c++",
      version: "*",
      argsHint: "Read with: argv[1], argv[2], ... (in int main(int argc, char* argv[]))",
    },
  },
  { id: "sql", label: "SQL" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
] as const;

export const DEFAULT_LANGUAGE_ID = "python";

export function findLanguage(id: string): LanguageDef {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0]!;
}
