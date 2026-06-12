# `graph_info:` — Per-Graph, Header-Anchored, Sticky (revision)

**Date:** 2026-06-11
**Status:** Approved
**Revises:** `docs/superpowers/specs/2026-06-11-graph-info-message-design.md`

## 1. Why this revision

The first cut put the `graph_info:` message in a footer **below the step bar**,
which (a) gets clipped / is hard to see, (b) is ambiguous with multiple graphs,
(c) only shows on the exact attached step and vanishes as you step, and (d) its
node-info fallback leaks node labels like `d:5` / `low:3` into that slot — the
user reports (d) as a bug.

This revision moves the message **under each graph's `[@id] mode` header**,
scopes it **per graph id**, makes it **sticky**, and **removes the footer +
node-info fallback** entirely.

## 2. Directive (changed)

```
graph_info[@id]: <text>
```
- `@id` is now **meaningful** (default `main`). The message belongs to that
  graph. `graph_info: hi` → graph `main`; `graph_info@b: low:3` → graph `b`.
- `<text>` = remainder after the first colon, `trimStart()` + literal `\n` → real
  newline (unchanged).
- Still emits **no timeline step**; attaches to the previous event's step index
  (`events.length - 1`). Ignored if no event has been emitted yet.

## 3. Model (changed)

`GraphProgram.messages` changes type:
```ts
// graphId -> stepIndex -> message
messages: Record<string, Record<number, string>>;
```
Parser internal `info` result gains an `id`:
`{ kind: "info"; id: string; text: string }`. `parseGraphProgram`:
```ts
if (result.kind === "info") {
  if (events.length > 0) {
    (messages[result.id] ??= {})[events.length - 1] = result.text;
  }
  continue;
}
```
Last-wins per `(id, stepIndex)`. `frameAt`/`GraphEvent`/`SingleGraphState`
unchanged.

## 4. Sticky display — pure helper

```ts
// The message shown for graph `id` at `step` is the most recent graph_info for
// that id at or before `step` (sticky — persists until the next one). "" if none.
export function messageFor(
  messages: Record<string, Record<number, string>>,
  id: string,
  step: number
): string
```
Implementation: scan `k` from `step` down to `0`, return `messages[id]?.[k]` when
defined; else `""`. (Sizes are tiny; linear scan is fine.)

This fixes "only shows on that one frame and disappears": as you step forward the
message stays until a newer `graph_info` for that id; rewinding shows the message
in effect at that step.

## 5. UI (changed) — `GraphView` / `GraphCanvas`

- **Remove** the bottom footer block (the `infoLine` `<div>` below the step bar)
  and its `infoLine` / `nodeInfo` derivation. No node-info fallback anywhere in
  the panel chrome — node `info` continues to render only as the node's own
  sub-label on the canvas (existing `toElements` behaviour, untouched).
- In `GraphCanvas`, render the graph's sticky message **directly under the
  `[@id] mode` header line, above the canvas**:
  ```
  [@main] directed
  visiting root            ← messageFor(messages, "main", step)
  [ cytoscape canvas ]
  ```
  Hidden when the message is `""`. Uses `whitespace-pre-line` for `\n`.
- `GraphView` passes each rendered graph its message: `messageFor(program.messages, id, step)`. `GraphCanvas` gains a `message: string` prop.
- A `graph_info@id` whose `id` has no graph in the current frame simply isn't
  rendered (no canvas for it) — stored but orphaned, harmless.

## 6. Parser wiring & stdout

- `parseLine`'s `graph_info` branch returns `{ kind: "info", id, text }` (it
  already has `id` from `parseHead`; stop ignoring it).
- `stripGraphDirectives` — **no change**: `DIRECTIVE_RE`
  (`/^(graph(_node|_edge|_info)?|tree)(@[A-Za-z0-9_-]+)?:/`) already strips
  `graph_info:` and `graph_info@b:`.

## 7. Testing

- **Unit** (`graph-directives.test.ts`) — migrate the existing graph_info
  assertions from `p.messages[0]` to `p.messages.main[0]`, and add:
  - `graph_info@b: low:3` stores under `messages.b`, not `messages.main`.
  - still no extra step; ignored before any event; `\n` + trimStart.
  - `messageFor`: returns the latest message at-or-before `step` (sticky),
    `""` when none, isolated per id.
- **Component**: not unit-tested (node env). Manual verification.
- **Manual** (in-app): per-graph message under each header; persists across steps
  until the next `graph_info` for that graph; no message/box below the step bar;
  node `d:5`/`low:3` info appears only under its node, never in a panel slot;
  multi-graph each shows its own message.

## 8. Out of scope (YAGNI)

- Accumulating multiple messages per step (last-wins).
- Messages for a graph id that is never defined (orphaned, not shown).
- Any change to node/edge info rendering on the canvas.
