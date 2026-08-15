// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Drawing, TreeData, User } from "../types";
import { FileTree } from "./FileTree";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const user: User = {
  id: "user-1",
  username: "tester",
  isAdmin: false,
  blocked: false,
};
const drawing = (id: string, name: string, sortOrder: number): Drawing => ({
  id,
  name,
  owner: user,
  updatedBy: user,
  createdAt: 1,
  updatedAt: 1,
  canDelete: true,
  imageUrl: `/image/${id}.png`,
  space: "user",
  folderId: "folder-1",
  projectId: null,
  type: "excalidraw",
  favorite: false,
  collaborationEnabled: true,
  collaboratorLimit: 16,
  canEdit: true,
  sortOrder,
});
const data: TreeData = {
  users: [user],
  projects: [],
  folders: [
    {
      id: "folder-1",
      name: "folder",
      space: "user",
      userId: user.id,
      projectId: null,
      parentId: null,
      createdBy: user,
      createdAt: 1,
      updatedAt: 1,
      canDelete: true,
      sortOrder: 1,
    },
  ],
  drawings: [drawing("a", "A", 1), drawing("b", "B", 2), drawing("c", "C", 3)],
};

describe("FileTree pointer dragging", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([
    { compact: false, surface: "main tree" },
    { compact: true, surface: "editor sidebar" },
  ])("reorders adjacent files downward in the $surface", async ({ compact }) => {
    localStorage.setItem(
      `super-graph:tree-expanded:${user.id}`,
      JSON.stringify({ user: [`user:${user.id}`, "folder-1"], project: [] }),
    );
    const reorder = vi.spyOn(api, "reorder").mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <FileTree
          data={data}
          mode="user"
          currentUser={user}
          editable
          compact={compact}
        />,
      );
    });

    const source = container.querySelector<HTMLElement>(
      '.tree-row.file:has(a[href="/d/a"]) .file-drag-handle',
    );
    const target = container.querySelector<HTMLElement>(
      '.tree-row.file:has(a[href="/d/b"])',
    );
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    target!.getBoundingClientRect = () =>
      ({ top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    await act(async () => {
      source!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 10,
          clientY: 10,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          clientX: 40,
          clientY: 132,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 40,
          clientY: 132,
        }),
      );
      await Promise.resolve();
    });

    expect(reorder).toHaveBeenCalledWith([
      { kind: "drawing", id: "b", order: 1 },
      { kind: "drawing", id: "a", order: 2 },
      { kind: "drawing", id: "c", order: 3 },
    ]);
    await act(async () => root.unmount());
  });
});
