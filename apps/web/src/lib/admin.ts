import { parseAdminEmails } from "@piepad/db";

// Effective admin = email present in ADMIN_EMAILS (comma-separated).
// Source of truth lives in env so admin assignment is an infra change, not
// silent SQL — see tasks/lessons.md.

let cached: { value: string; set: ReadonlySet<string> } | null = null;

function getAdminSet(): ReadonlySet<string> {
  const raw = (process.env.ADMIN_EMAILS ?? "").trim();
  if (cached && cached.value === raw) return cached.set;
  const next = new Set(parseAdminEmails(raw));
  cached = { value: raw, set: next };
  return next;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminSet().has(email.toLowerCase());
}
