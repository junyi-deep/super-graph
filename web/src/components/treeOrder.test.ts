import { describe, expect, it } from "vitest";
import { reorderSiblingIds } from "./treeOrder";

describe("reorderSiblingIds", () => {
  it("moves an adjacent item down when dropped on the lower half", () => {
    expect(reorderSiblingIds(["a", "b", "c"], "a", "b", "after")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("moves an item up when dropped on the upper half", () => {
    expect(reorderSiblingIds(["a", "b", "c"], "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});
