-- V5: per-user color preference for the awareness pill / remote-cursor tint.
--
-- NULL means "auto" — the app falls back to colorFor(displayName), the same
-- name-hash behaviour that's been in place since launch. Only when the user
-- explicitly picks a colour on /me do we persist a hex value here.
--
-- Run locally with table-owner DDL credentials. The runtime user
-- (APP_PROD_USER) intentionally has no DDL.

ALTER TABLE users ADD color_pref VARCHAR2(7);

-- Reject any value that isn't a 7-char hex (#RRGGBB). The application also
-- validates against the canonical PALETTE before storing, but the CHECK is
-- a cheap belt-and-suspenders guard against direct SQL or future drift.
ALTER TABLE users ADD CONSTRAINT chk_users_color_pref
  CHECK (color_pref IS NULL
         OR REGEXP_LIKE(color_pref, '^#[0-9a-fA-F]{6}$'));
