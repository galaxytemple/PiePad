import { PALETTE } from "@/components/pad/types";
import type {
  GraphEvent,
  GraphMode,
  GraphProgram,
} from "@/components/pad/graph-types";

const ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_NODES = 500;
const MAX_GRAPHS = 8;

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
  return null; // graph_node / graph_edge added in later tasks
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
