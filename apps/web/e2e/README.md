# E2E tests

Playwright against `next dev` on port 3000 (or `$PORT`). Run from
`apps/web` with `pnpm e2e` (or `pnpm e2e:ui` for the UI runner).

## What's covered

- `auth-redirect.spec.ts` — smoke tests for the proxy.ts redirect rules
  and the login page. No real OAuth required.

## What's not (yet)

Authenticated flows (creating a pad, password gate, owner controls,
admin pages, real-time sync between two contexts) need a logged-in
session. Two options to add later:

1. **`storageState`** — sign in once manually, save the cookies via
   `page.context().storageState({ path: ".auth/user.json" })`, then point
   later tests at it via `test.use({ storageState: ".auth/user.json" })`.
2. **Test-only signin endpoint** — gate behind `process.env.E2E_AUTH=1`,
   accept an email, mint the same session JWT Auth.js writes. Only enable
   when the env flag is set.

The first is preferred; it exercises the same auth path as production and
needs no new code.

## First-time setup

```bash
pnpm exec playwright install chromium
```
