import { describe, expect, it } from "vitest";
import { parseGraphProgram } from "./graph-directives";

describe("parseGraphProgram — graph: directive", () => {
  it("parses a directed adjacency list into one graph event", () => {
    const p = parseGraphProgram("graph: [[1,2],[1],[2]]");
    expect(p.stepCount).toBe(1);
    expect(p.events[0]).toEqual({
      kind: "graph",
      id: "main",
      mode: "directed",
      adjacency: [[1, 2], [1], [2]],
    });
    expect(p.warnings).toEqual([]);
  });

  it("ignores non-directive lines and keeps real output out of events", () => {
    const p = parseGraphProgram("hello\ngraph: [[1],[0]]\nworld");
    expect(p.stepCount).toBe(1);
    expect(p.events[0].kind).toBe("graph");
  });

  it("accepts explicit directed: prefix", () => {
    const p = parseGraphProgram("graph:directed: [[1],[0]]");
    expect(p.events[0]).toMatchObject({ kind: "graph", mode: "directed" });
  });
});
