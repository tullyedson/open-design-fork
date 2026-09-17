import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDesign } from "@open-design/contracts/mcp-design";
import { DesignStore } from "../src/store";

const roots: string[] = [];
const stores: DesignStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const memoryStore = () => {
  const store = new DesignStore(":memory:");
  stores.push(store);
  return store;
};

describe("standalone design persistence", () => {
  it("persists source and history across reopen, and rejects a stale writer on another connection", () => {
    const root = mkdtempSync(join(tmpdir(), "open-design-mcp-"));
    roots.push(root);
    const file = join(root, "designs.sqlite");
    const first = new DesignStore(file);
    const second = new DesignStore(file);
    stores.push(first, second);
    const initial = first.create("Garden");
    const readElsewhere = second.read(initial.id);
    const next = first.save(initial.id, initial.revision, {
      ...initial.design,
      brief: "Add a greenhouse",
    });
    expect(() =>
      second.save(initial.id, readElsewhere.revision, {
        ...initial.design,
        brief: "Lost write",
      }),
    ).toThrow(/conflict/);
    expect(second.read(initial.id)).toEqual(next);
    const reopened = new DesignStore(file);
    stores.push(reopened);
    expect(reopened.read(initial.id).design.brief).toBe("Add a greenhouse");
    expect(reopened.history(initial.id).map((v) => v.revision)).toEqual([
      next.revision,
      initial.revision,
    ]);
  });

  it("restores as a new revision, but cannot restore another design or bypass compare-and-swap", () => {
    const store = memoryStore();
    const initial = store.create("Original");
    const other = store.create("Other");
    const changed = store.save(
      initial.id,
      initial.revision,
      { ...initial.design, brief: "Changed" },
      "Renamed",
    );
    expect(() =>
      store.restore(initial.id, changed.revision, other.revision),
    ).toThrow(/does not belong/);
    expect(() =>
      store.restore(initial.id, initial.revision, initial.revision),
    ).toThrow(/conflict/);
    const restored = store.restore(
      initial.id,
      changed.revision,
      initial.revision,
    );
    expect(restored.title).toBe("Original");
    expect(restored.design).toEqual(initial.design);
    expect(restored.revision).not.toBe(initial.revision);
    expect(store.history(initial.id)).toHaveLength(3);
  });

  it("rejects invalid writes without changing either the document or history", () => {
    const store = memoryStore();
    const original = store.create("Safe");
    const invalid = {
      ...emptyDesign(),
      entry: "../secret.html",
      files: [{ path: "../secret.html", content: "bad" }],
    };
    expect(() => store.save(original.id, original.revision, invalid)).toThrow(
      /relative/,
    );
    expect(() =>
      store.save(original.id, original.revision, original.design, "   "),
    ).toThrow(/title/);
    expect(() =>
      store.create("Huge", { ...emptyDesign(), brief: "x".repeat(20001) }),
    ).toThrow(/20,000/);
    expect(store.read(original.id)).toEqual(original);
    expect(store.history(original.id)).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
  });

  it("bounds history per design without affecting other designs", () => {
    const store = memoryStore();
    const other = store.create("Untouched");
    let current = store.create("Many revisions");
    const firstRevision = current.revision;
    for (let i = 0; i < 105; i++)
      current = store.save(current.id, current.revision, {
        ...current.design,
        brief: String(i),
      });
    expect(store.history(current.id)).toHaveLength(100);
    expect(store.history(current.id)[0]?.revision).toBe(current.revision);
    expect(() =>
      store.restore(current.id, current.revision, firstRevision),
    ).toThrow(/no longer retained/);
    expect(store.read(other.id)).toEqual(other);
  });
});
