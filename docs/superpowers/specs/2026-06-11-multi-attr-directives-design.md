# Multi-Attribute Directives — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Builds on:** the graph/tree view directives in `lib/graph-directives.ts`.

## 1. Purpose

Let a single `graph_node` / `graph_edge` directive set **multiple attributes at
once**, so colour + info (or colour + label) change together in **one timeline
step**. Example: `graph_node:0:color:6:info:hello`.

## 2. Grammar & parsing rule

- Node: `graph_node[@id]:<n>(:<attr>:<value>)+`, `attr` ∈ {`color`, `info`}.
- Edge: `graph_edge[@id]:<src>:<dst>(:<attr>:<value>)+`, `attr` ∈ {`color`, `label`}.
- Parse left→right, repeatedly reading `attr:value` pairs:
  - `color` → consumes the **next single token** (up to the next `:`), validated
    `1..16` → resolved to `PALETTE[c-1]`.
  - `info` / `label` → **terminal**: consumes the **entire remainder** of the
    line (so it may contain `:`), then parsing stops. `info` keeps the existing
    literal-`\n`→newline conversion.
- `color` may appear multiple times before the terminal `info`/`label` (last one
  wins). `info`/`label`, being terminal, is always last.
- Backward compatible: the existing single-attribute forms
  (`graph_node:0:color:1`, `graph_node:0:info:x`, `graph_edge:0:1:label:w`)
  parse unchanged.

## 3. Event model change

To apply several attributes in one timeline step, **one directive emits one
event carrying a partial decoration object** (not one event per attribute).

```ts
// graph-types.ts — GraphEvent node/edge variants change to carry `deco`:
| { kind: "node"; id: string; node: number; deco: NodeDeco }
| { kind: "edge"; id: string; src: number; dst: number; deco: EdgeDeco }
```
where `NodeDeco = { color?: string; info?: string }` and
`EdgeDeco = { color?: string; label?: string }` (existing types, reused).

`applyEvent` merges: `g.nodes[n] = { ...(g.nodes[n] ?? {}), ...ev.deco }`
(and the same for edges). Across directives this preserves per-attribute
last-write-wins; within one directive all parsed attributes apply together.

**Downstream is unaffected:** `frameAt` still produces the same
`SingleGraphState` (`nodes[i] = {color?, info?}`), so `useCytoscapeGraph`
rendering needs no change. Only the `GraphEvent` shape and the parser change.

## 4. Validation

- An invalid part anywhere → **ignore the whole line** (keep prior state),
  consistent with current strictness:
  - `color` value outside `1..16` or not a decimal integer,
  - an unknown `attr` token,
  - node/edge index out of range,
  - a `color` pair missing its value token.
- A directive with **no valid attribute** → ignored.
- Empty terminal value (`...:info:`) → `info = ""` is allowed.
- `info`/`label` text may be empty or contain colons; `\n` in `info` becomes a
  newline (existing behaviour).

## 5. Components touched

| File | Change |
|------|--------|
| `components/pad/graph-types.ts` | `GraphEvent` node/edge variants → `deco: NodeDeco` / `deco: EdgeDeco` |
| `lib/graph-directives.ts` | rewrite `parseNodeLine`/`parseEdgeLine` as an attr:value pair loop; `applyEvent` merges `deco` |
| `lib/graph-directives.test.ts` | update existing event-shape assertions (`{attr,value}` → `{deco}`); add combined-directive tests |
| `components/pad/GraphView.tsx` | `infoLine` footer reads `currentEvent.kind === "node" ? currentEvent.deco.info` instead of `attr === "info"` |

## 6. Testing

- **Unit** (`graph-directives.test.ts`):
  - `graph_node:0:color:6:info:hello` → one event, `deco {color: PALETTE[5], info:"hello"}`; `frameAt` shows both on node 0 in one step.
  - `graph_edge:0:1:color:3:label:w=5` → `deco {color: PALETTE[2], label:"w=5"}`.
  - terminal info keeps colons: `graph_node:0:color:1:info:a:b` → `info:"a:b"`.
  - repeated color: `graph_node:0:color:1:color:2:info:x` → `color: PALETTE[1]`.
  - literal `\n` in combined info still converts.
  - backward compat: single-attr forms still produce the right `deco` and
    `frameAt` state; existing tests updated to the `deco` shape.
  - invalid → whole line ignored: bad color (`color:99:info:x`), unknown attr
    (`graph_node:0:foo:1`), missing color value, out-of-range node.
  - no-attr (`graph_node:0`) ignored.
- **Manual** (in-app): a Python run using `graph_node:i:color:C:info:TEXT`
  shows colour and label appearing together in a single timeline step.

## 7. Out of scope (YAGNI)

- Attributes beyond color/info (node) and color/label (edge).
- Re-ordering rules other than "info/label terminal".
- Any change to the rendering layer or the `tree:`/`graph:` structure directives
  (they emit `kind:"graph"` events, untouched here).
