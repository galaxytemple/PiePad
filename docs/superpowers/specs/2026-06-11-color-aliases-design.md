# Color Aliases + `color:0` = default — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Builds on:** the directive color handling in `lib/graph-directives.ts`.

## 1. Purpose

Let directive `color:` values use **named aliases** (an enum) instead of raw
1–16 numbers, and make **`color:0` mean "default / uncolored"** — rendered as the
same colour an un-coloured node already has (so `unvisited` looks like a
freshly-drawn node, and reverts a node to that state).

## 2. Named aliases (built-in, global)

A fixed map name → number, usable anywhere a `color` value goes (node or edge):

| alias | number |
|---|---|
| `unvisited` | 0 (default/uncoloured) |
| `visited` | 7 |
| `visiting` | 16 |
| `edge_visited` | 10 |
| `edge_visited2` | 11 |

- `graph_node:0:color:visited` ≡ `graph_node:0:color:7`.
- `graph_edge:0:1:color:edge_visited` ≡ `…:color:10`.
- Aliases are plain names → numbers; no node/edge restriction (`edge_visited`
  works on a node too).
- Case-sensitive, lowercase, exact match.

## 3. `color:0` = default (themed)

Currently `color` accepts 1–16 → `PALETTE[c-1]`; `0` is rejected. Change: accept
`0`, meaning **"no explicit colour"** — the element falls back to its themed
default in `buildStyle` (node `#3f3f46` dark / `#d4d4d8` light; edge
`#71717a` / `#a1a1aa`). This matches "the initial node colour" and is
theme-aware. Setting `color:0` (or `color:unvisited`) on an already-coloured
node reverts it to the default look.

Implementation: `color:0` resolves to the **empty string `""`**. The existing
renderer already treats an empty `data("color")` as "use the default"
(`(ele) => ele.data("color") || nodeBg`), so no renderer change is needed for
the fallback itself.

## 4. Resolver

Add a pure helper in `lib/graph-directives.ts`:
```ts
const COLOR_ALIASES: Record<string, number> = {
  unvisited: 0, visited: 7, visiting: 16, edge_visited: 10, edge_visited2: 11,
};

// Resolve a color token (alias name OR 0..16) to a hex, or "" for 0
// (default/uncoloured), or null when invalid (→ the directive line is ignored).
function resolveColor(token: string): string | null {
  const t = token.trim();
  const n = t in COLOR_ALIASES ? COLOR_ALIASES[t] : parseIndex(t);
  if (n === null) return null;        // unknown alias or non-decimal
  if (n === 0) return "";             // default / uncoloured (themed fallback)
  if (n < 1 || n > 16) return null;
  return PALETTE[n - 1]!;
}
```
(`parseIndex` already returns a non-negative int for `/^\d+$/`, else null, so
`parseIndex("0") === 0` and `parseIndex("visited") === null`.)

Use it in the shared `parseDecoChain` color branch (covers both node and edge):
replace the current `const c = parseIndex(token); if (c === null || c < 1 || c > 16) return null; deco.color = PALETTE[c-1]!;` with
```ts
const hex = resolveColor(token);
if (hex === null) return null; // invalid color/alias → ignore whole line
deco.color = hex;              // hex, or "" for color:0 (default)
```
`deco.color === ""` flows through `applyEvent` merge and `toElements`
(`color: deco.color ?? ""`) unchanged → element renders with the themed default.

## 5. Discoverability (help panel)

- **Legend**: add a `0 default` swatch showing the themed default node bg, so the
  legend reads `0 default, 1 red … 16 pink`. To avoid duplicating the gray, export
  the default node bg from `useCytoscapeGraph` as a const
  (`export const DEFAULT_NODE_BG = { dark: "#3f3f46", light: "#d4d4d8" } as const;`)
  and use it both in `buildStyle`'s `nodeBg` and in the `GraphView` legend's 0
  swatch (chosen by `isDark`).
- **USAGE**: add one line listing the aliases, e.g.
  `  color aliases: unvisited(0) visited(7) visiting(16) edge_visited(10) edge_visited2(11)`.

## 6. Validation / edge cases

- Unknown alias or out-of-range / non-decimal number → `resolveColor` returns
  `null` → the whole directive line is ignored (existing strictness).
- `color:0` / `color:unvisited` → `""` (valid) → default look.
- Aliases apply identically in single (`graph_node:0:color:visited`) and combined
  (`graph_node:0:color:visited:info:x`) directives, since both go through
  `parseDecoChain`.

## 7. Testing

- **Unit** (`graph-directives.test.ts`):
  - each alias resolves to the right hex on a node and on an edge
    (`color:visited` → `PALETTE[6]`; `color:edge_visited` → `PALETTE[9]`;
    `edge_visited2` → `PALETTE[10]`).
  - `color:0` and `color:unvisited` → `deco.color === ""` (and frameAt state
    `nodes[n].color === ""`).
  - unknown alias (`color:bogus`) → line ignored (no step / no deco).
  - alias works in a combined directive (`color:visiting:info:hi`).
- **Manual** (in-app): `color:visited` colours like `color:7`; `color:unvisited`
  (or `color:0`) shows the same gray as an un-coloured node in both light and
  dark themes; legend shows `0 default` + the 16 colours; USAGE lists aliases.

## 8. Out of scope (YAGNI)

- User-defined / runtime-registered aliases (built-in fixed set only).
- Per-node vs per-edge alias namespaces (all global).
- Changing the existing 1–16 PALETTE.
