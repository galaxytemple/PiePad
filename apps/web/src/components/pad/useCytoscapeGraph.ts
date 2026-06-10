import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";
import type { SingleGraphState } from "./graph-types";

export const LAYOUTS = ["breadthfirst", "cose", "circle", "grid"] as const;
export type LayoutName = (typeof LAYOUTS)[number];

function toElements(s: SingleGraphState): ElementDefinition[] {
  const nodes: ElementDefinition[] = s.adjacency.map((_, i) => {
    const deco = s.nodes[i] ?? {};
    const label = deco.info ? `${i}\n${deco.info}` : `${i}`;
    return { data: { id: `n${i}`, label, color: deco.color ?? "" } };
  });

  const seen = new Set<string>();
  const edges: ElementDefinition[] = [];
  s.adjacency.forEach((row, src) => {
    row.forEach((dst) => {
      const key =
        s.mode === "undirected"
          ? [src, dst].sort((a, b) => a - b).join("-")
          : `${src}->${dst}`;
      if (seen.has(key)) return;
      seen.add(key);
      const deco =
        s.edges[`${src}->${dst}`] ??
        (s.mode === "undirected" ? s.edges[`${dst}->${src}`] : undefined) ??
        {};
      edges.push({
        data: {
          id: `e${src}-${dst}`,
          source: `n${src}`,
          target: `n${dst}`,
          label: deco.label ?? "",
          color: deco.color ?? "",
        },
        classes: s.mode === "undirected" ? "undirected" : "",
      });
    });
  });

  return [...nodes, ...edges];
}

const STYLE_CACHE = new Map<boolean, cytoscape.StylesheetStyle[]>();

function buildStyle(isDark: boolean): cytoscape.StylesheetStyle[] {
  const cached = STYLE_CACHE.get(isDark);
  if (cached) return cached;
  const text = isDark ? "#e4e4e7" : "#18181b";
  const nodeBg = isDark ? "#3f3f46" : "#d4d4d8";
  const line = isDark ? "#71717a" : "#a1a1aa";
  const style: cytoscape.StylesheetStyle[] = [
    {
      selector: "node",
      style: {
        "background-color": (ele) => ele.data("color") || nodeBg,
        label: "data(label)",
        color: text,
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        "font-size": 11,
        width: 36,
        height: 36,
      },
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": (ele) => ele.data("color") || line,
        "target-arrow-color": (ele) => ele.data("color") || line,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 10,
        color: text,
      },
    },
    { selector: "edge.undirected", style: { "target-arrow-shape": "none" } },
  ];
  STYLE_CACHE.set(isDark, style);
  return style;
}

// Renders one graph into a container. Re-layout happens only when the graph's
// structure (adjacency + mode) changes, so node positions stay fixed while
// stepping through color/info/edge changes.
export function useCytoscapeGraph(
  state: SingleGraphState,
  layout: LayoutName,
  isDark: boolean
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const structureKeyRef = useRef<string>("");

  useEffect(() => {
    // Guard: containerRef is null during SSR/first render before the div is
    // attached. The cleanup re-runs on Strict Mode remount and recreates cy.
    if (!containerRef.current) return;
    const cy = cytoscape({ container: containerRef.current, elements: [] });
    cyRef.current = cy;
    structureKeyRef.current = "";
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.json({ elements: toElements(state) });
    cy.style(buildStyle(isDark));
    const structureKey = `${state.mode}:${JSON.stringify(state.adjacency)}`;
    if (structureKey !== structureKeyRef.current) {
      cy.layout({ name: layout, padding: 12 }).run();
      structureKeyRef.current = structureKey;
    }
  }, [state, layout, isDark]);

  return containerRef;
}
