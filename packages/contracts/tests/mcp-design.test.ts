import { describe, it, expect } from "vitest";
import {
  DesignDraft,
  emptyDesign,
  normalizeDesign,
  type SavedDesign,
} from "../src/mcp-design";
const saved = (revision = "one"): SavedDesign => ({
  id: "design-one",
  title: "Design",
  savedAt: "2026-01-01T00:00:00Z",
  revision,
  design: emptyDesign(),
});
describe("Open Design MCP source contract", () => {
  it("round trips complete source and refuses escaping or ambiguous files", () => {
    expect(normalizeDesign(emptyDesign())).toEqual(emptyDesign());
    for (const name of [
      "../secret.html",
      "/index.html",
      "a\\index.html",
      ".env",
      "index.html:secret",
      "a/../index.html",
    ])
      expect(() =>
        normalizeDesign({
          ...emptyDesign(),
          entry: name,
          files: [{ path: name, content: "x" }],
        }),
      ).toThrow();
    expect(() =>
      normalizeDesign({
        ...emptyDesign(),
        files: [...emptyDesign().files, { path: "INDEX.HTML", content: "x" }],
      }),
    ).toThrow(/unique/);
  });
  it("does not apply a stale response to a new draft or overwrite dirty text", () => {
    const draft = new DesignDraft();
    draft.load(saved());
    const generation = draft.generation;
    draft.change({ ...draft.design!, brief: "in progress" });
    expect(draft.observe(saved("remote"), generation)).toBe(false);
    expect(draft.design!.brief).toBe("in progress");
    expect(draft.observe(saved("remote"), draft.generation)).toBe(false);
    expect(draft.conflict).toBe(true);
  });
  it("acknowledges a save without losing typing that continued in flight", () => {
    const draft = new DesignDraft();
    draft.load(saved());
    draft.change({ ...draft.design!, brief: "first" });
    const sent = draft.generation;
    draft.change({ ...draft.design!, brief: "second" });
    draft.acknowledge(
      { ...saved("two"), design: { ...emptyDesign(), brief: "first" } },
      sent,
    );
    expect(draft.saved!.revision).toBe("two");
    expect(draft.design!.brief).toBe("second");
    expect(draft.dirty).toBe(true);
  });
});
