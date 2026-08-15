import { useEffect, useState } from "react";
import {
  Clock3,
  ChevronDown,
  FilePenLine,
  FolderKanban,
  KeyRound,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Shapes,
  Star,
  UserRound,
  Workflow,
} from "lucide-react";
import { api } from "../api";
import { FileTree } from "../components/FileTree";
import {
  AdminSettingsPage,
  PasswordDialog,
} from "../components/ManagementDialogs";
import { StatsPanel } from "../components/StatsPanel";
import { NameDialog } from "../components/ui/form-dialog";
import { recentDrawings } from "../directory";
import type { DrawingType, SpaceMode, Stats, TreeData, User } from "../types";

const emptyTree: TreeData = {
  users: [],
  projects: [],
  folders: [],
  drawings: [],
};
const recentTime = (value: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const mergeById = <T extends { id: string }>(current: T[], incoming: T[]) => [
  ...new Map([...current, ...incoming].map((item) => [item.id, item])).values(),
];
const mergeTree = (current: TreeData, incoming: TreeData): TreeData => ({
  users: mergeById(current.users, incoming.users),
  projects: mergeById(current.projects, incoming.projects),
  folders: mergeById(current.folders, incoming.folders),
  drawings: mergeById(current.drawings, incoming.drawings),
});

export function Directory({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [tree, setTree] = useState<TreeData>(emptyTree);
  const [allDrawings, setAllDrawings] = useState<TreeData["drawings"]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [view, setView] = useState<SpaceMode | "system">("user");
  const mode: SpaceMode = view === "project" ? "project" : "user";
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | DrawingType>("all");
  const [error, setError] = useState("");
  const [projectDialog, setProjectDialog] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [recentView, setRecentView] = useState<"recent" | "favorite">("recent");
  const load = async () => {
    try {
      const [roots, drawings, nextStats] = await Promise.all([
        api.tree({ mode }),
        api.drawings(true),
        api.stats(),
      ]);
      setTree((previous) => mergeTree(previous, roots));
      setAllDrawings(drawings);
      setStats(nextStats);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(
      () =>
        api
          .stats()
          .then(setStats)
          .catch(() => {}),
      30000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        api
          .tree(search ? { mode, q: search } : { mode })
          .then((result) =>
            setTree((previous) =>
              search
                ? mergeTree(emptyTree, { ...result, drawings: result.drawings })
                : mergeTree(previous, result),
            ),
          )
          .catch(() => {}),
      180,
    );
    return () => clearTimeout(timer);
  }, [mode, search]);
  const loadChildren = async (kind: "root" | "folder", id: string) => {
    try {
      const incoming = await api.tree(
        kind === "root" ? { mode, rootId: id } : { mode, parentId: id },
      );
      setTree((previous) => mergeTree(previous, incoming));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "目录加载失败");
    }
  };
  const reloadAfterMutation = async () => {
    const full = await api.tree();
    setTree(full);
    setAllDrawings(await api.drawings(true));
  };
  const createProject = async (name: string) => {
    setProjectDialog(false);
    try {
      await api.createProject(name);
      setView("project");
      await reloadAfterMutation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    }
  };
  const recent = recentDrawings(allDrawings, user.id, 12);
  const favorite = allDrawings
    .filter((item) => item.favorite)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const sidebarItems = recentView === "recent" ? recent : favorite;
  const searchPlaceholder =
    mode === "user" ? "搜索用户、目录或文件" : "搜索项目、目录或文件";
  return (
    <main className={`workspace-page ${recentOpen ? "" : "recent-collapsed"}`}>
      <header className="workspace-header">
        <div className="brand">
          <span className="brand-mark">
            <Shapes size={18} />
          </span>
          <div>
            <h1>Super Graph</h1>
            <p>团队画板与 Mermaid 图表协作空间</p>
          </div>
        </div>
        <details className="account-menu">
          <summary className="account-trigger">
            <span className="avatar">
              {user.username.slice(0, 1).toUpperCase()}
            </span>
            <span className="account-identity">
              <b>{user.username}</b>
              <small>{user.isAdmin ? "管理员" : "当前账号"}</small>
            </span>
            <ChevronDown size={14} />
          </summary>
          <div className="account-dropdown">
            <button onClick={() => setPasswordDialog(true)}>
              <KeyRound size={14} />
              修改密码
            </button>
            <button
              onClick={async () => {
                await api.logout();
                onLogout();
              }}
            >
              <LogOut size={14} />
              退出登录
            </button>
          </div>
        </details>
      </header>
      <div className="workspace-body">
        <aside className="recent-sidebar">
          <button
            className="recent-collapse"
            title={recentOpen ? "收起最近修改" : "展开最近修改"}
            onClick={() => setRecentOpen(!recentOpen)}
          >
            {recentOpen ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </button>
          {recentOpen && (
            <div className="tree-card recent-card">
              <div className="recent-tabs">
                <button
                  className={recentView === "recent" ? "active" : ""}
                  onClick={() => setRecentView("recent")}
                >
                  <Clock3 size={13} />
                  最近修改
                </button>
                <button
                  className={recentView === "favorite" ? "active" : ""}
                  onClick={() => setRecentView("favorite")}
                >
                  <Star size={13} />
                  收藏
                </button>
              </div>
              <div className="recent-list compact">
                {sidebarItems.length ? (
                  sidebarItems.map((drawing) => (
                    <a href={`/d/${drawing.id}`} key={drawing.id}>
                      <span className="recent-icon">
                        {drawing.type === "mermaid" ? (
                          <Workflow size={14} />
                        ) : (
                          <FilePenLine size={14} />
                        )}
                      </span>
                      <span>
                        <b>{drawing.name}</b>
                        <time>{recentTime(drawing.updatedAt)}</time>
                      </span>
                    </a>
                  ))
                ) : (
                  <p className="recent-empty">
                    {recentView === "favorite"
                      ? "还没有收藏文件"
                      : "还没有由你修改的文件"}
                  </p>
                )}
              </div>
            </div>
          )}
        </aside>
        <section className="tree-workspace">
          <div className="workspace-toolbar">
            <div className="space-tabs">
              <button
                className={view === "user" ? "active" : ""}
                onClick={() => {
                  setView("user");
                  setSearch("");
                }}
              >
                <UserRound size={14} />
                用户空间
              </button>
              <button
                className={view === "project" ? "active" : ""}
                onClick={() => {
                  setView("project");
                  setSearch("");
                }}
              >
                <FolderKanban size={14} />
                项目空间
              </button>
              {user.isAdmin && (
                <button
                  className={view === "system" ? "active" : ""}
                  onClick={() => {
                    setView("system");
                    setSearch("");
                  }}
                >
                  <Settings size={14} />
                  系统设置
                </button>
              )}
            </div>
            {view !== "system" && (
              <div className="workspace-actions">
                <select
                  className="type-filter"
                  value={typeFilter}
                  onChange={(event) =>
                    setTypeFilter(event.target.value as typeof typeFilter)
                  }
                >
                  <option value="all">全部类型</option>
                  <option value="excalidraw">Excalidraw</option>
                  <option value="mermaid">Mermaid</option>
                </select>
                <label className="tree-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={searchPlaceholder}
                  />
                </label>
              </div>
            )}
          </div>
          {error && <p className="error notice">{error}</p>}
          {view === "system" ? (
            <AdminSettingsPage
              users={tree.users}
              onChanged={() => void reloadAfterMutation()}
            />
          ) : (
            <div className="tree-card main-tree-card">
              <div className="tree-card-head">
                <span>
                  {mode === "user"
                    ? "文件目录 · 所有用户"
                    : "文件目录 · 所有项目"}
                </span>
                <span className="tree-head-actions">
                  <small>
                    {
                      tree.drawings.filter((drawing) => drawing.space === mode)
                        .length
                    }{" "}
                    个已加载文件
                  </small>
                  {mode === "project" && (
                    <button onClick={() => setProjectDialog(true)}>
                      <Plus size={13} />
                      新建项目
                    </button>
                  )}
                </span>
              </div>
              <FileTree
                data={tree}
                mode={mode}
                currentUser={user}
                editable
                filter={search}
                typeFilter={typeFilter}
                onExpand={loadChildren}
                onMutated={reloadAfterMutation}
              />
            </div>
          )}
        </section>
        <StatsPanel stats={stats} />
      </div>
      <NameDialog
        open={projectDialog}
        title="新建项目"
        description="项目空间中的所有成员都可以创建文件和目录。"
        onCancel={() => setProjectDialog(false)}
        onSubmit={createProject}
      />
      <PasswordDialog
        open={passwordDialog}
        onClose={() => setPasswordDialog(false)}
      />
    </main>
  );
}
