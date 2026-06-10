import { PALETTE } from "@/components/pad/types";
import type {
  GraphEvent,
  GraphMode,
  GraphProgram,
  MultiGraphState,
  SingleGraphState,
} from "@/components/pad/graph-types";

const ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_NODES = 500;
const MAX_GRAPHS = 8;

// Strict non-negative decimal integer (rejects "", "0x3", "1.0", "1e2").
function parseIndex(s: string): number | null {
  return /^\d+$/.test(s.trim()) ? Number(s) : null;
}

// Split `s` on `sep` into at most `max` parts; the final part keeps any
// remaining separators (so info/label text may contain colons).
function splitMax(s: string, sep: string, max: number): string[] {
  const parts: string[] = [];
  let rest = s;
  while (parts.length < max - 1) {
    const i = rest.indexOf(sep);
    if (i === -1) break;
    parts.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  parts.push(rest);
  return parts;
}

function parseHead(head: string): { kw: string; id: string } | null {
  const at = head.indexOf("@");
  if (at === -1) return { kw: head, id: "main" };
  const kw = head.slice(0, at);
  const id = head.slice(at + 1);
  if (!ID_RE.test(id)) return null;
  return { kw, id };
}

function parseGraphLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>,
  warnings: string[]
): GraphEvent | null {
  let mode: GraphMode = "directed";
  let payload = body.trimStart();
  if (payload.startsWith("undirected:")) {
    mode = "undirected";
    payload = payload.slice("undirected:".length);
  } else if (payload.startsWith("directed:")) {
    payload = payload.slice("directed:".length);
  }

  let json: unknown;
  try {
    json = JSON.parse(payload.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;

  const adjacency: number[][] = [];
  for (const row of json) {
    if (!Array.isArray(row)) return null;
    const out: number[] = [];
    for (const v of row) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
      out.push(v);
    }
    adjacency.push(out);
  }

  const n = adjacency.length;
  for (const row of adjacency) {
    for (const v of row) if (v >= n) return null; // neighbor out of range
  }
  if (n > MAX_NODES) {
    warnings.push(`graph @${id} has ${n} nodes (max ${MAX_NODES}); ignored`);
    return null;
  }
  if (!structures.has(id) && structures.size >= MAX_GRAPHS) {
    warnings.push(`more than ${MAX_GRAPHS} graphs; @${id} ignored`);
    return null;
  }

  structures.set(id, adjacency);
  return { kind: "graph", id, mode, adjacency };
}

function parseNodeLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>
): GraphEvent | null {
  const adj = structures.get(id);
  if (!adj) return null; // node before graph for this id
  const parts = splitMax(body, ":", 3); // [node, attr, value]
  if (parts.length < 3) return null;
  const node = parseIndex(parts[0]!);
  if (node === null || node >= adj.length) return null;
  const attr = parts[1];
  const value = parts[2];
  if (attr === "color") {
    const c = parseIndex(value);
    if (c === null || c < 1 || c > 16) return null;
    return { kind: "node", id, node, attr: "color", value: PALETTE[c - 1]! };
  }
  if (attr === "info") {
    return { kind: "node", id, node, attr: "info", value };
  }
  return null;
}

function parseEdgeLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>
): GraphEvent | null {
  const adj = structures.get(id);
  if (!adj) return null;
  const parts = splitMax(body, ":", 4); // [src, dst, attr, value]
  if (parts.length < 4) return null;
  const srcN = parseIndex(parts[0]!);
  const dstN = parseIndex(parts[1]!);
  if (srcN === null || dstN === null || srcN >= adj.length || dstN >= adj.length) return null;
  const attr = parts[2];
  const value = parts[3];
  if (attr === "color") {
    const c = parseIndex(value);
    if (c === null || c < 1 || c > 16) return null;
    return { kind: "edge", id, src: srcN, dst: dstN, attr: "color", value: PALETTE[c - 1]! };
  }
  if (attr === "label") {
    return { kind: "edge", id, src: srcN, dst: dstN, attr: "label", value };
  }
  return null;
}

// `structures` is a local accumulator tracking each id's current adjacency so
// node/edge directives can be range-validated against the graph in effect at
// that point in the stream. Mutating it during this forward pass is local
// construction state, not shared mutation.
function parseLine(
  raw: string,
  structures: Map<string, number[][]>,
  warnings: string[]
): GraphEvent | null {
  const line = raw.trim();
  if (!line.startsWith("graph")) return null;
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return null;
  const head = line.slice(0, firstColon).trim();
  const body = line.slice(firstColon + 1);
  const parsed = parseHead(head);
  if (!parsed) return null;
  const { kw, id } = parsed;
  if (kw === "graph") return parseGraphLine(id, body, structures, warnings);
  if (kw === "graph_node") return parseNodeLine(id, body, structures);
  if (kw === "graph_edge") return parseEdgeLine(id, body, structures);
  return null;
}

export function parseGraphProgram(stdout: string): GraphProgram {
  const events: GraphEvent[] = [];
  const warnings: string[] = [];
  const structures = new Map<string, number[][]>();
  for (const raw of stdout.split("\n")) {
    const ev = parseLine(raw, structures, warnings);
    if (ev) events.push(ev);
  }
  return { events, stepCount: events.length, warnings };
}

export function clampStep(index: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  if (index < 0) return 0;
  if (index > stepCount - 1) return stepCount - 1;
  return index;
}

// Fold events 0..index (inclusive) into an immutable multi-graph state.
// `state` is a fresh local accumulator built per call, so mutating it while
// folding is local construction — never touches caller-owned objects.
export function frameAt(program: GraphProgram, index: number): MultiGraphState {
  const last = clampStep(index, program.stepCount);
  const state: MultiGraphState = {};
  if (program.stepCount === 0) return state;
  for (let k = 0; k <= last; k++) applyEvent(state, program.events[k]!);
  return state;
}

function applyEvent(state: MultiGraphState, ev: GraphEvent): void {
  if (ev.kind === "graph") {
    // Replacing structure clears the id's decorations.
    state[ev.id] = {
      id: ev.id,
      mode: ev.mode,
      adjacency: ev.adjacency.map((row) => [...row]),
      nodes: {},
      edges: {},
    } satisfies SingleGraphState;
    return;
  }
  const g = state[ev.id];
  if (!g) return; // validated unreachable, defensive
  if (ev.kind === "node") {
    g.nodes[ev.node] = { ...(g.nodes[ev.node] ?? {}), [ev.attr]: ev.value };
  }
  if (ev.kind === "edge") {
    const key = `${ev.src}->${ev.dst}`;
    g.edges[key] = { ...(g.edges[key] ?? {}), [ev.attr]: ev.value };
  }
}

// Matches the directive keyword shape (with optional @id). Strips even invalid
// directives so stdout stays clean; validity is surfaced via the graph panel.
const DIRECTIVE_RE = /^graph(_node|_edge)?(@[A-Za-z0-9_-]+)?:/;

export function stripGraphDirectives(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !DIRECTIVE_RE.test(line.trim()))
    .join("\n");
}
