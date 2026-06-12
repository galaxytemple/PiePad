# `graph_info:` Panel Message — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Builds on:** the graph/tree directives in `lib/graph-directives.ts` and the
`GraphView` step timeline.

## 1. Purpose

A top-level `graph_info: <text>` directive that shows free text at the **bottom
of the graph panel**, as a per-step narration. It does **not** consume a
timeline step — it attaches its text to the **immediately-preceding** directive
(step), so when the user steps the timeline to that step the message appears.
Example: print `graph_node:0:color:1` then `graph_info: visiting node 0` — node 0
colours on that step and "visiting node 0" shows at the bottom for that step.

## 2. Directive

```
graph_info: <text>
```

- The text is the entire remainder of the line (terminal — may contain `:`), with
  a literal `\n` converted to a real newline (same as node `info`).
- `@id` is **not meaningful** (the bottom message is panel-global, not per-graph).
  If a user writes `graph_info@x: ...`, the `@x` is ignored.

## 3. Step semantics

- `graph_info:` does **not** emit a timeline event — `stepCount` is unchanged.
- It attaches its text to the **most-recently-emitted event** (the previous
  step): `messages[events.length - 1] = text`.
- **Last-wins**: multiple `graph_info:` lines after the same step overwrite
  (use `\n` for multi-line). 
- If no event has been emitted yet (the `graph_info:` is before any
  `graph:`/`tree:`/`graph_node:`/`graph_edge:` line), it is **ignored** (no step
  to attach to).

## 4. Model

- `GraphProgram` gains **`messages: Record<number, string>`** — step index →
  message.
- The parser's per-line result becomes a local union
  `type ParseResult = GraphEvent | { kind: "info"; text: string }`. `parseLine`
  returns `{ kind: "info", text }` for a `graph_info:` line (it is NOT a
  `GraphEvent` and never enters `events`).
- `parseGraphProgram` handles the result:
  - `kind === "info"` → if `events.length > 0`, set
    `messages[events.length - 1] = result.text`; otherwise ignore.
  - otherwise → `events.push(result)` as today.
- `frameAt` / `applyEvent` / `GraphEvent` / `SingleGraphState` are **unchanged**.

## 5. UI (`GraphView` bottom footer)

The existing footer (`infoLine`) becomes:
- show `program.messages[step]` if present (the `graph_info:` narration for the
  current step);
- else fall back to the current node event's `deco.info` (existing behaviour,
  preserved);
- else hidden.

`\n` renders as line breaks (footer already uses `whitespace-pre-line`).

## 6. Parser wiring & stdout

- `parseLine`: the guard already accepts lines starting with `graph` (so
  `graph_info` passes). Route `kw === "graph_info"` to return
  `{ kind: "info", text: body.trimStart().replace(/\\n/g, "\n") }` — `body` is
  the remainder after the first colon; `trimStart()` drops the conventional
  space in `graph_info: hi` so the message is `hi`, not ` hi`.
- `stripGraphDirectives`: extend `DIRECTIVE_RE` to include `graph_info` so those
  lines are removed from the run-output panel:
  `/^(graph(_node|_edge|_info)?|tree)(@[A-Za-z0-9_-]+)?:/`.

## 7. Validation / edge cases

- Empty text (`graph_info:`) → attaches `""` to the previous step (footer shows
  empty → effectively hidden). Acceptable.
- `graph_info:` with no preceding event → ignored.
- Whitespace: leading/trailing line whitespace trimmed (existing `parseLine`
  `raw.trim()`); the text keeps internal spacing.

## 8. Testing

- **Unit** (`graph-directives.test.ts`):
  - `graph_info:` does not change `stepCount`; `parseGraphProgram("graph: [[]]\ngraph_node:0:color:1\ngraph_info: hi").stepCount === 2`.
  - message attaches to the previous step index (`messages[1] === "hi"`).
  - last-wins when two `graph_info:` follow the same step.
  - `graph_info:` before any event is ignored (`messages` empty, stepCount 0).
  - `\n` converted in the message.
  - `stripGraphDirectives` removes `graph_info:` (and `graph_info@x:`) lines,
    keeps a real `info: ...` log line (different keyword) untouched.
- **Manual** (in-app): print directives + `graph_info:` lines; step the timeline
  and confirm the bottom message changes per step, and the directive lines are
  stripped from the output panel.

## 9. Out of scope (YAGNI)

- Per-`@id` separate messages (panel-global only).
- Accumulating multiple messages per step (last-wins only).
- A persistent always-visible message independent of the step.
