import { useEffect, useRef, useState } from "react";
import { ChevronLeft, FolderTree, Menu, Plus, Search } from "lucide-react";
import { api } from "../api";
import type { SpaceMode, TreeData, User } from "../types";
import { FileTree } from "./FileTree";
import { NameDialog } from "./ui/form-dialog";

const empty: TreeData = { users: [], projects: [], folders: [], drawings: [] };
const merge = <T extends { id: string }>(a: T[], b: T[]) => [
  ...new Map([...a, ...b].map((item) => [item.id, item])).values(),
];
const mergeTree = (a: TreeData, b: TreeData): TreeData => ({
  users: merge(a.users, b.users),
  projects: merge(a.projects, b.projects),
  folders: merge(a.folders, b.folders),
  drawings: merge(a.drawings, b.drawings),
});
const minimumWidth = 240;
const maximumWidth = 560;
const openStorageKey = "super-graph:file-sidebar-open";
const storedWidth = () => {
  const value = Number(localStorage.getItem("super-graph:file-sidebar-width"));
  return Number.isFinite(value)
    ? Math.min(maximumWidth, Math.max(minimumWidth, value))
    : 310;
};
export function EditorFileSidebar({
  user,
  selectedId,
}: {
  user: User;
  selectedId: string;
}) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(openStorageKey) === "true",
  );
  const [width, setWidth] = useState(storedWidth);
  const widthRef = useRef(width);
  const [mode, setMode] = useState<SpaceMode>("user");
  const [tree, setTree] = useState(empty);
  const [search, setSearch] = useState("");
  const [projectDialog, setProjectDialog] = useState(false);
  const [error, setError] = useState("");
  const load = async (
    query = { mode } as {
      mode: SpaceMode;
      rootId?: string;
      parentId?: string;
      q?: string;
    },
  ) => {
    const incoming = await api.tree(query);
    setTree((previous) => mergeTree(previous, incoming));
  };
  useEffect(() => {
    if (open) void load({ mode });
  }, [open, mode]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (search)
        api
          .tree({ mode, q: search })
          .then(setTree)
          .catch(() => {});
    }, 180);
    return () => clearTimeout(timer);
  }, [search, mode, open]);
  const createProject = async (name: string) => {
    setProjectDialog(false);
    try {
      await api.createProject(name);
      setMode("project");
      setError("");
      await load({ mode: "project" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    }
  };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const move = (nextEvent: PointerEvent) => {
      const next = Math.min(
        maximumWidth,
        Math.max(minimumWidth, startWidth + nextEvent.clientX - startX),
      );
      widthRef.current = next;
      setWidth(next);
    };
    const stop = () => {
      localStorage.setItem(
        "super-graph:file-sidebar-width",
        String(widthRef.current),
      );
      document.body.classList.remove("resizing-file-sidebar");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    document.body.classList.add("resizing-file-sidebar");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  return (
    <>
      <aside
        className={`editor-file-sidebar ${open ? "open" : "collapsed"}`}
        style={open ? { width } : undefined}
      >
        <button
          className="file-sidebar-toggle"
          onClick={() => {
            const next = !open;
            localStorage.setItem(openStorageKey, String(next));
            setOpen(next);
          }}
          title={open ? "收起文件树" : "展开文件树"}
        >
          {open ? <ChevronLeft size={17} /> : <Menu size={17} />}
        </button>
        {open && (
          <>
            <header>
              <b>
                <FolderTree size={15} />
                文件树
              </b>
              <div>
                <button
                  className={mode === "user" ? "active" : ""}
                  onClick={() => setMode("user")}
                >
                  用户
                </button>
                <button
                  className={mode === "project" ? "active" : ""}
                  onClick={() => setMode("project")}
                >
                  项目
                </button>
              </div>
            </header>
            <label className="sidebar-tree-search">
              <Search size={13} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索目录或文件"
              />
            </label>
            {error && <p className="error notice tree-error">{error}</p>}
            {mode === "project" && (
              <button
                className="sidebar-new-project"
                onClick={() => setProjectDialog(true)}
              >
                <Plus size={14} />
                新建项目
              </button>
            )}
            <FileTree
              data={tree}
              mode={mode}
              currentUser={user}
              selectedId={selectedId}
              editable
              filter={search}
              compact
              onExpand={(kind, id) =>
                void load(
                  kind === "root"
                    ? { mode, rootId: id }
                    : { mode, parentId: id },
                )
              }
              onMutated={() => load({ mode })}
            />
            <div
              className="file-sidebar-resizer"
              role="separator"
              aria-label="调整文件树宽度"
              aria-orientation="vertical"
              aria-valuemin={minimumWidth}
              aria-valuemax={maximumWidth}
              aria-valuenow={width}
              onPointerDown={startResize}
            />
          </>
        )}
      </aside>
      <NameDialog
        open={projectDialog}
        title="新建项目"
        description="项目空间中的所有成员都可以创建文件和目录。"
        onCancel={() => setProjectDialog(false)}
        onSubmit={createProject}
      />
    </>
  );
}
