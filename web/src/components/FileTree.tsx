import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FilePenLine,
  FilePlus2,
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Move,
  Pencil,
  Star,
  Trash2,
  UserRound,
  Workflow,
} from "lucide-react";
import { api } from "../api";
import { MERMAID_TEMPLATES } from "../editor/mermaidTemplates";
import type {
  Drawing,
  DrawingType,
  Folder as FolderItem,
  SpaceMode,
  TreeData,
  User,
} from "../types";
import { MoveCopyDialog } from "./ManagementDialogs";
import { ConfirmDialog, NameDialog } from "./ui/form-dialog";
import {
  expansionStorageKey,
  readTreeExpansion,
  toggleTreeExpansion,
} from "./treeExpansion";
import { buildTreeSearch } from "./treeSearch";
import { reorderSiblingIds, type DropPosition } from "./treeOrder";

type Props = {
  data: TreeData;
  mode: SpaceMode;
  currentUser: User;
  selectedId?: string;
  editable?: boolean;
  filter?: string;
  typeFilter?: "all" | DrawingType;
  compact?: boolean;
  onMutated?: () => void;
  onExpand?: (kind: "root" | "folder", id: string) => void;
};
type FileTarget = {
  space: SpaceMode;
  folderId?: string | null;
  projectId?: string | null;
};
type FolderTarget = {
  space: SpaceMode;
  userId?: string | null;
  projectId?: string | null;
  parentId?: string | null;
};
type NameAction = {
  title: string;
  description?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (name: string) => Promise<unknown>;
};
type DeleteAction = {
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
};
type CreateAction = { target: FileTarget; type: DrawingType };
const dateTime = (value: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function FileTree({
  data,
  mode,
  currentUser,
  selectedId,
  editable = false,
  filter = "",
  typeFilter = "all",
  compact = false,
  onMutated = () => {},
  onExpand,
}: Props) {
  const [expansion, setExpansion] = useState(() =>
    readTreeExpansion(currentUser.id),
  );
  const [nameAction, setNameAction] = useState<NameAction | null>(null);
  const [deleteAction, setDeleteAction] = useState<DeleteAction | null>(null);
  const [createAction, setCreateAction] = useState<CreateAction | null>(null);
  const [relocate, setRelocate] = useState<{
    drawing: Drawing;
    operation: "copy" | "move";
  } | null>(null);
  const [templateId, setTemplateId] = useState(MERMAID_TEMPLATES[0].id);
  const [error, setError] = useState("");
  const [dragged, setDragged] = useState<{
    kind: "folder" | "drawing";
    id: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    kind: "folder" | "root" | "drawing";
    id: string;
    position?: DropPosition;
  } | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const [manualOrder, setManualOrder] = useState<Record<string, number>>({});
  const requested = useRef(new Set<string>());
  const expanded = useMemo(() => new Set(expansion[mode]), [expansion, mode]);
  const search = useMemo(
    () => buildTreeSearch(data, mode, filter),
    [data, mode, filter],
  );
  const folders = useMemo(
    () =>
      data.folders
        .filter(
          (folder) => folder.space === mode && search.folderIds.has(folder.id),
        )
        .sort(
          (a, b) =>
            (manualOrder[`folder:${a.id}`] ?? a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
            (manualOrder[`folder:${b.id}`] ?? b.sortOrder ?? Number.MAX_SAFE_INTEGER),
        ),
    [data, mode, search, manualOrder],
  );
  const drawings = useMemo(
    () =>
      data.drawings
        .filter(
          (drawing) =>
            drawing.space === mode &&
            search.drawingIds.has(drawing.id) &&
            (typeFilter === "all" || drawing.type === typeFilter),
        )
        .sort(
          (a, b) =>
            (manualOrder[`drawing:${a.id}`] ?? a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
            (manualOrder[`drawing:${b.id}`] ?? b.sortOrder ?? Number.MAX_SAFE_INTEGER),
        ),
    [data, mode, search, typeFilter, manualOrder],
  );
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      document
        .querySelectorAll<HTMLDetailsElement>(".file-more-menu[open]")
        .forEach((menu) => {
          if (!menu.contains(target)) menu.removeAttribute("open");
        });
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);
  useEffect(() => {
    if (!onExpand || filter) return;
    for (const id of expansion[mode]) {
      const key = `${mode}:${id}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const root = /^(user|project):/.test(id);
      onExpand(root ? "root" : "folder", id.replace(/^(user|project):/, ""));
    }
  }, [mode, expansion, onExpand, filter]);
  const toggle = (id: string, kind: "root" | "folder" = "folder") =>
    setExpansion((previous) => {
      const wasOpen = previous[mode].includes(id);
      const next = toggleTreeExpansion(previous, mode, id);
      localStorage.setItem(
        expansionStorageKey(currentUser.id),
        JSON.stringify(next),
      );
      if (!wasOpen) onExpand?.(kind, id.replace(/^(user|project):/, ""));
      return next;
    });
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError("");
      await onMutated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    }
  };
  const createFile = (target: FileTarget, type: DrawingType) => {
    setTemplateId(MERMAID_TEMPLATES[0].id);
    setCreateAction({ target, type });
  };
  const submitCreate = async (name: string) => {
    const action = createAction;
    if (!action) return;
    setCreateAction(null);
    const template = MERMAID_TEMPLATES.find((item) => item.id === templateId);
    try {
      const item = await api.create(name, {
        ...action.target,
        type: action.type,
        mermaidCode: action.type === "mermaid" ? template?.code : undefined,
      });
      window.location.href = `/d/${item.id}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    }
  };
  const createFolder = (input: FolderTarget) =>
    setNameAction({
      title: "新建目录",
      description: "目录会创建在当前选择的位置。",
      onSubmit: (name) => api.createFolder({ name, ...input }),
    });
  const actions = (children: React.ReactNode) => (
    <span className="tree-actions">{children}</span>
  );
  const beginDrag = (
    event: React.DragEvent,
    kind: "folder" | "drawing",
    id: string,
  ) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.dropEffect = "move";
    event.dataTransfer.setData("text/plain", `${kind}:${id}`);
    const label =
      kind === "drawing"
        ? data.drawings.find((item) => item.id === id)?.name
        : data.folders.find((item) => item.id === id)?.name;
    const preview = document.createElement("div");
    preview.className = "file-drag-preview";
    preview.textContent = `${kind === "drawing" ? "移动文件" : "调整目录"} · ${label || "未命名"}`;
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 18, 18);
    window.setTimeout(() => preview.remove(), 0);
    setDragged({ kind, id });
  };
  const finishDrag = () => {
    setDragged(null);
    setDropTarget(null);
    setDragPoint(null);
    dropTargetRef.current = null;
  };
  const closeFileMenu = (event: React.MouseEvent<HTMLElement>) =>
    event.currentTarget.closest("details")?.removeAttribute("open");
  const droppedID = (
    event: React.DragEvent,
    expectedKind: "folder" | "drawing",
  ) => {
    const [kind, id] = event.dataTransfer.getData("text/plain").split(":");
    if (kind === expectedKind && id) return id;
    return dragged?.kind === expectedKind ? dragged.id : "";
  };
  const reorder = async (
    kind: "folder" | "drawing",
    source: string,
    target: string,
    siblings: string[],
    position: DropPosition,
  ) => {
    if (source === target) return;
    const next = reorderSiblingIds(siblings, source, target, position);
    setManualOrder((previous) => ({
      ...previous,
      ...Object.fromEntries(
        next.map((id, index) => [`${kind}:${id}`, index + 1]),
      ),
    }));
    await run(() =>
      api.reorder(next.map((id, index) => ({ kind, id, order: index + 1 }))),
    );
  };
  const sameLocation = (drawing: Drawing, target: FileTarget) =>
    drawing.space === target.space &&
    (drawing.folderId || null) === (target.folderId || null) &&
    (drawing.projectId || null) === (target.projectId || null);
  const moveDrawing = async (id: string, target: FileTarget) => {
    const drawing = data.drawings.find((item) => item.id === id);
    if (!drawing || sameLocation(drawing, target)) return;
    await run(() =>
      api.relocate(drawing.id, {
        operation: "move",
        name: drawing.name,
        space: target.space,
        folderId: target.folderId || null,
        projectId: target.projectId || null,
      }),
    );
  };
  const canMove = (drawing: Drawing) =>
    drawing.owner.id === currentUser.id || currentUser.isAdmin;
  const canUseDrawingLocation = (drawing: Drawing) =>
    drawing.space === "project" || drawing.owner.id === currentUser.id;
  const setActiveDropTarget = (target: typeof dropTarget) => {
    dropTargetRef.current = target;
    setDropTarget(target);
  };
  const pointerDropTarget = (clientX: number, clientY: number) => {
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-tree-drop-kind]");
    if (!row || row.dataset.treeDropEnabled === "false") return null;
    const kind = row.dataset.treeDropKind as "folder" | "root" | "drawing";
    const id = row.dataset.treeDropId || "";
    if (!id) return null;
    if (kind === "drawing" || kind === "folder") {
      const bounds = row.getBoundingClientRect();
      return {
        kind,
        id,
        position: (clientY >= bounds.top + bounds.height / 2
          ? "after"
          : "before") as DropPosition,
      };
    }
    return { kind, id };
  };
  const completePointerDrop = (source: string) => {
    const target = dropTargetRef.current;
    if (!target || target.id === source) return;
    const sourceDrawing = data.drawings.find((item) => item.id === source);
    if (!sourceDrawing) return;
    if (target.kind === "drawing") {
      const targetDrawing = data.drawings.find((item) => item.id === target.id);
      if (!targetDrawing || !canUseDrawingLocation(targetDrawing)) return;
      const location: FileTarget = {
        space: targetDrawing.space,
        folderId: targetDrawing.folderId,
        projectId: targetDrawing.projectId,
      };
      if (!sameLocation(sourceDrawing, location)) {
        void moveDrawing(source, location);
        return;
      }
      const siblings = drawings
        .filter((item) => sameLocation(item, location))
        .map((item) => item.id);
      void reorder(
        "drawing",
        source,
        target.id,
        siblings,
        target.position || "before",
      );
      return;
    }
    if (target.kind === "folder") {
      const folder = data.folders.find((item) => item.id === target.id);
      if (
        !folder ||
        (folder.space === "user" && folder.userId !== currentUser.id)
      )
        return;
      void moveDrawing(source, {
        space: folder.space,
        folderId: folder.id,
        projectId: folder.projectId,
      });
      return;
    }
    if (target.id === `user:${currentUser.id}`) {
      void moveDrawing(source, {
        space: "user",
        folderId: null,
        projectId: null,
      });
      return;
    }
    if (target.id.startsWith("project:")) {
      void moveDrawing(source, {
        space: "project",
        folderId: null,
        projectId: target.id.slice("project:".length),
      });
    }
  };
  const beginPointerFileDrag = (
    event: React.PointerEvent<HTMLElement>,
    drawing: Drawing,
  ) => {
    if (event.button !== 0 || !canMove(drawing)) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    const move = (nextEvent: PointerEvent) => {
      if (
        !active &&
        Math.hypot(nextEvent.clientX - origin.x, nextEvent.clientY - origin.y) < 4
      )
        return;
      if (!active) {
        active = true;
        setDragged({ kind: "drawing", id: drawing.id });
      }
      nextEvent.preventDefault();
      setDragPoint({ x: nextEvent.clientX, y: nextEvent.clientY });
      setActiveDropTarget(pointerDropTarget(nextEvent.clientX, nextEvent.clientY));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", cancel);
      if (active) completePointerDrop(drawing.id);
      finishDrag();
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", cancel);
      finishDrag();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };
  const fileNode = (drawing: Drawing, siblings: Drawing[]) => (
    <div
      data-tree-drop-kind="drawing"
      data-tree-drop-id={drawing.id}
      data-tree-drop-enabled={canUseDrawingLocation(drawing)}
      onDragOver={(event) => {
        if (dragged?.kind !== "drawing" || !canUseDrawingLocation(drawing))
          return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        const bounds = event.currentTarget.getBoundingClientRect();
        setActiveDropTarget({
          kind: "drawing",
          id: drawing.id,
          position:
            event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before",
        });
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const source = droppedID(event, "drawing");
        const sourceDrawing = data.drawings.find((item) => item.id === source);
        const target: FileTarget = {
          space: drawing.space,
          folderId: drawing.folderId,
          projectId: drawing.projectId,
        };
        if (sourceDrawing && sameLocation(sourceDrawing, target)) {
          void reorder(
            "drawing",
            source,
            drawing.id,
            siblings.map((item) => item.id),
            dropTarget?.kind === "drawing" && dropTarget.id === drawing.id
              ? dropTarget.position || "before"
              : "before",
          );
        } else if (source) {
          void moveDrawing(source, target);
        }
        finishDrag();
      }}
      className={`tree-row file ${selectedId === drawing.id ? "selected" : ""} ${dragged?.kind === "drawing" && dragged.id === drawing.id ? "dragging" : ""} ${dropTarget?.kind === "drawing" && dropTarget.id === drawing.id && dragged?.id !== drawing.id ? `drop-target reorder-target drop-${dropTarget.position || "before"}` : ""}`}
      key={drawing.id}
    >
      <a
        href={`/d/${drawing.id}`}
        title={`${drawing.name} · ${drawing.owner.username}`}
      >
        <span className="node-icon">
          {drawing.type === "mermaid" ? (
            <Workflow size={16} />
          ) : (
            <FilePenLine size={16} />
          )}
        </span>
        <span className="file-copy">
          <span className="node-label">{drawing.name}</span>
          <span className="file-meta">
            <span>创建：{dateTime(drawing.createdAt)}</span>
            <span>修改：{dateTime(drawing.updatedAt)}</span>
            <span>创建人：{drawing.owner.username}</span>
            <span>
              修改人：{drawing.updatedBy?.username || drawing.owner.username}
            </span>
          </span>
        </span>
      </a>
      {editable && compact && canMove(drawing) && (
        <span className="compact-file-controls">
          <span
            className="file-drag-handle"
            role="button"
            tabIndex={0}
            title="拖动排序或移动到目录"
            aria-label={`拖动 ${drawing.name}`}
            onPointerDown={(event) => beginPointerFileDrag(event, drawing)}
          >
            <GripVertical size={14} />
          </span>
          <details className="file-more-menu">
            <summary title="更多操作" aria-label={`${drawing.name} 更多操作`}>
              <MoreHorizontal size={15} />
            </summary>
            <div>
              <button
                onClick={(event) => {
                  closeFileMenu(event);
                  void run(() => api.favorite(drawing.id, !drawing.favorite));
                }}
              >
                <Star
                  size={13}
                  fill={drawing.favorite ? "currentColor" : "none"}
                />
                {drawing.favorite ? "取消收藏" : "收藏"}
              </button>
              <button
                onClick={(event) => {
                  closeFileMenu(event);
                  setRelocate({ drawing, operation: "copy" });
                }}
              >
                <Copy size={13} />
                复制
              </button>
              <button
                onClick={(event) => {
                  closeFileMenu(event);
                  setNameAction({
                    title: "修改文件名",
                    initialValue: drawing.name,
                    onSubmit: (name) => api.rename(drawing.id, name),
                  });
                }}
              >
                <Pencil size={13} />
                编辑
              </button>
              {drawing.canDelete && (
                <button
                  className="danger"
                  onClick={(event) => {
                    closeFileMenu(event);
                    setDeleteAction({
                      title: `删除“${drawing.name}”？`,
                      description:
                        "文件、画布内容和分享图片会一并删除，此操作无法撤销。",
                      onConfirm: () => api.remove(drawing.id),
                    });
                  }}
                >
                  <Trash2 size={13} />
                  删除
                </button>
              )}
            </div>
          </details>
        </span>
      )}
      {editable &&
        !compact &&
        actions(
          <>
            {canMove(drawing) && (
              <span
                className="file-drag-handle"
                role="button"
                tabIndex={0}
                title="拖动排序或移动到目录"
                aria-label={`拖动 ${drawing.name}`}
                onPointerDown={(event) => beginPointerFileDrag(event, drawing)}
              >
                <GripVertical size={14} />
              </span>
            )}
            <button
              title={drawing.favorite ? "取消收藏" : "收藏"}
              className={drawing.favorite ? "favorite" : ""}
              onClick={() =>
                void run(() => api.favorite(drawing.id, !drawing.favorite))
              }
            >
              <Star
                size={14}
                fill={drawing.favorite ? "currentColor" : "none"}
              />
            </button>
            <button
              title="复制到…"
              onClick={() => setRelocate({ drawing, operation: "copy" })}
            >
              <Copy size={14} />
            </button>
            {(drawing.owner.id === currentUser.id || currentUser.isAdmin) && (
              <button
                title="移动到…"
                onClick={() => setRelocate({ drawing, operation: "move" })}
              >
                <Move size={14} />
              </button>
            )}
            <button
              title="重命名"
              onClick={() =>
                setNameAction({
                  title: "修改文件名",
                  initialValue: drawing.name,
                  onSubmit: (name) => api.rename(drawing.id, name),
                })
              }
            >
              <Pencil size={14} />
            </button>
            {drawing.canDelete && (
              <button
                title="删除"
                className="danger"
                onClick={() =>
                  setDeleteAction({
                    title: `删除“${drawing.name}”？`,
                    description:
                      "文件、画布内容和分享图片会一并删除，此操作无法撤销。",
                    onConfirm: () => api.remove(drawing.id),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            )}
          </>,
        )}
    </div>
  );
  const createControls = (target: FileTarget, folderInput: FolderTarget) => (
    <>
      <button title="新建子目录" onClick={() => createFolder(folderInput)}>
        <FolderPlus size={14} />
      </button>
      <button
        title="新建 Excalidraw 画板"
        onClick={() => createFile(target, "excalidraw")}
      >
        <FilePlus2 size={14} />
      </button>
      <button
        title="新建 Mermaid 图"
        onClick={() => createFile(target, "mermaid")}
      >
        <Workflow size={14} />
      </button>
    </>
  );
  const folderNode = (
    folder: FolderItem,
    siblings: FolderItem[],
  ): React.ReactNode => {
    const open = expanded.has(folder.id) || Boolean(filter);
    const acceptsDrawing =
      folder.space === "project" || folder.userId === currentUser.id;
    const children = folders.filter((item) => item.parentId === folder.id);
    const files = drawings.filter((item) => item.folderId === folder.id);
    return (
      <div className="tree-branch" key={folder.id}>
        <div
          data-tree-drop-kind="folder"
          data-tree-drop-id={folder.id}
          data-tree-drop-enabled={acceptsDrawing}
          draggable={editable}
          onDragStart={(event) => beginDrag(event, "folder", folder.id)}
          onDragOver={(event) => {
            if (!dragged || (dragged.kind === "drawing" && !acceptsDrawing))
              return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const bounds = event.currentTarget.getBoundingClientRect();
            setActiveDropTarget({
              kind: "folder",
              id: folder.id,
              position:
                dragged.kind === "folder" &&
                event.clientY >= bounds.top + bounds.height / 2
                  ? "after"
                  : "before",
            });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragged?.kind === "drawing" && acceptsDrawing) {
              const source = droppedID(event, "drawing");
              if (source)
                void moveDrawing(source, {
                  space: folder.space,
                  folderId: folder.id,
                  projectId: folder.projectId,
                });
            } else {
              const source = droppedID(event, "folder");
              if (source)
                void reorder(
                  "folder",
                  source,
                  folder.id,
                  siblings.map((item) => item.id),
                  dropTarget?.kind === "folder" && dropTarget.id === folder.id
                    ? dropTarget.position || "before"
                    : "before",
                );
            }
            finishDrag();
          }}
          onDragEnd={finishDrag}
          className={`tree-row folder ${dragged?.kind === "folder" && dragged.id === folder.id ? "dragging" : ""} ${dropTarget?.kind === "folder" && dropTarget.id === folder.id && dragged?.id !== folder.id ? dragged?.kind === "drawing" ? "drop-target folder-drop-target" : `drop-target reorder-target drop-${dropTarget.position || "before"}` : ""}`}
        >
          <button className="tree-toggle" onClick={() => toggle(folder.id)}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <span className="node-icon">
            {open ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
          <span className="node-label" onDoubleClick={() => toggle(folder.id)}>
            {folder.name}
          </span>
          {editable &&
            actions(
              <>
                {createControls(
                  {
                    space: folder.space,
                    folderId: folder.id,
                    projectId: folder.projectId,
                  },
                  {
                    space: folder.space,
                    userId: folder.userId,
                    projectId: folder.projectId,
                    parentId: folder.id,
                  },
                )}
                {folder.canDelete && (
                  <>
                    <button
                      title="重命名"
                      onClick={() =>
                        setNameAction({
                          title: "修改目录名",
                          initialValue: folder.name,
                          onSubmit: (name) => api.renameFolder(folder.id, name),
                        })
                      }
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      title="删除空目录"
                      className="danger"
                      onClick={() =>
                        setDeleteAction({
                          title: `删除目录“${folder.name}”？`,
                          description: "只能删除不包含子目录或文件的空目录。",
                          onConfirm: () => api.removeFolder(folder.id),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </>,
            )}
        </div>
        {open && (
          <div className="tree-children">
            {children.map((item) => folderNode(item, children))}
            {files.map((item) => fileNode(item, files))}
            {!children.length && !files.length && (
              <span className="tree-empty">空目录</span>
            )}
          </div>
        )}
      </div>
    );
  };
  const root = (
    id: string,
    label: string,
    rootFolders: FolderItem[],
    rootFiles: Drawing[],
    controls: React.ReactNode,
    target?: FileTarget,
  ) => {
    const open = expanded.has(id) || Boolean(filter);
    return (
      <div className="tree-branch" key={id}>
        <div
          data-tree-drop-kind="root"
          data-tree-drop-id={id}
          data-tree-drop-enabled={Boolean(target)}
          className={`tree-row root ${dropTarget?.kind === "root" && dropTarget.id === id ? "drop-target folder-drop-target" : ""}`}
          onDragOver={(event) => {
            if (dragged?.kind !== "drawing" || !target) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setActiveDropTarget({ kind: "root", id });
          }}
          onDrop={(event) => {
            if (dragged?.kind !== "drawing" || !target) return;
            event.preventDefault();
            event.stopPropagation();
            const source = droppedID(event, "drawing");
            if (source) void moveDrawing(source, target);
            finishDrag();
          }}
        >
          <button className="tree-toggle" onClick={() => toggle(id, "root")}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <span className="node-icon">
            {mode === "user" ? (
              <UserRound size={16} />
            ) : (
              <FolderKanban size={16} />
            )}
          </span>
          <span className="node-label">{label}</span>
          {editable && actions(controls)}
        </div>
        {open && (
          <div className="tree-children">
            {rootFolders.map((item) => folderNode(item, rootFolders))}
            {rootFiles.map((item) => fileNode(item, rootFiles))}
            {!rootFolders.length && !rootFiles.length && (
              <span className="tree-empty">暂无内容</span>
            )}
          </div>
        )}
      </div>
    );
  };
  const visibleUsers = data.users
    .filter((item) => search.rootIds.has(item.id))
    .sort((a, b) =>
      a.id === currentUser.id
        ? -1
        : b.id === currentUser.id
          ? 1
          : a.username.localeCompare(b.username),
    );
  const visibleProjects = data.projects.filter((item) =>
    search.rootIds.has(item.id),
  );
  return (
    <>
      <div
        className={`file-tree ${compact ? "compact" : ""} ${dragged ? "drag-active" : ""}`}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
        onDrop={finishDrag}
      >
        {dragged?.kind === "drawing" && (
          <div className="tree-drag-status" role="status">
            <Move size={13} />拖到目录可移动文件，拖到文件上/下半部可调整前后顺序
          </div>
        )}
        {dragged?.kind === "drawing" && dragPoint && (
          <div
            className="pointer-drag-preview"
            style={{ left: dragPoint.x + 14, top: dragPoint.y + 14 }}
          >
            <Move size={13} />
            {data.drawings.find((item) => item.id === dragged.id)?.name ||
              "移动文件"}
          </div>
        )}
        {error && <p className="error notice tree-error">{error}</p>}
        {mode === "user"
          ? visibleUsers.map((item) =>
              root(
                `user:${item.id}`,
                item.username,
                folders.filter(
                  (folder) => folder.userId === item.id && !folder.parentId,
                ),
                drawings.filter(
                  (drawing) =>
                    drawing.owner.id === item.id && !drawing.folderId,
                ),
                item.id === currentUser.id
                  ? createControls(
                      { space: "user" },
                      { space: "user", userId: item.id },
                    )
                  : null,
                item.id === currentUser.id
                  ? { space: "user", folderId: null, projectId: null }
                  : undefined,
              ),
            )
          : visibleProjects.map((project) =>
              root(
                `project:${project.id}`,
                project.name,
                folders.filter(
                  (folder) =>
                    folder.projectId === project.id && !folder.parentId,
                ),
                drawings.filter(
                  (drawing) =>
                    drawing.projectId === project.id && !drawing.folderId,
                ),
                <>
                  {createControls(
                    { space: "project", projectId: project.id },
                    { space: "project", projectId: project.id },
                  )}
                  {project.canDelete && (
                    <>
                      <button
                        title="重命名项目"
                        onClick={() =>
                          setNameAction({
                            title: "修改项目名",
                            initialValue: project.name,
                            onSubmit: (name) =>
                              api.renameProject(project.id, name),
                          })
                        }
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        title="删除项目"
                        className="danger"
                        onClick={() =>
                          setDeleteAction({
                            title: `删除项目“${project.name}”？`,
                            description: currentUser.isAdmin
                              ? "管理员删除会一并删除项目中的目录和文件。"
                              : "只能删除不包含目录或文件的空项目。",
                            onConfirm: () => api.removeProject(project.id),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </>,
                { space: "project", folderId: null, projectId: project.id },
              ),
            )}
        {filter && search.rootIds.size === 0 && (
          <p className="tree-search-empty">没有匹配内容</p>
        )}
      </div>
      <NameDialog
        open={Boolean(nameAction)}
        title={nameAction?.title || "输入名称"}
        description={nameAction?.description}
        initialValue={nameAction?.initialValue}
        submitLabel={nameAction?.submitLabel}
        onCancel={() => setNameAction(null)}
        onSubmit={(name) => {
          const action = nameAction;
          setNameAction(null);
          if (action) void run(() => action.onSubmit(name));
        }}
      />
      <NameDialog
        open={Boolean(createAction)}
        title={
          createAction?.type === "mermaid"
            ? "新建 Mermaid 图"
            : "新建 Excalidraw 画板"
        }
        description={
          createAction?.type === "mermaid"
            ? "输入名称并选择初始图表类型。"
            : "输入新画板的名称。"
        }
        initialValue={
          createAction?.type === "mermaid" ? "未命名 Mermaid" : "未命名画板"
        }
        submitLabel="创建"
        onCancel={() => setCreateAction(null)}
        onSubmit={submitCreate}
      >
        {createAction?.type === "mermaid"
          ? () => (
              <label className="grid gap-2 text-sm font-medium">
                图表类型
                <select
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {MERMAID_TEMPLATES.map((template) => (
                    <option value={template.id} key={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          : undefined}
      </NameDialog>
      <ConfirmDialog
        open={Boolean(deleteAction)}
        title={deleteAction?.title || "确认删除"}
        description={deleteAction?.description || "此操作无法撤销。"}
        confirmLabel="删除"
        destructive
        onCancel={() => setDeleteAction(null)}
        onConfirm={() => {
          const action = deleteAction;
          setDeleteAction(null);
          if (action) void run(action.onConfirm);
        }}
      />
      <MoveCopyDialog
        drawing={relocate?.drawing || null}
        operation={relocate?.operation || "copy"}
        currentUser={currentUser}
        onClose={() => setRelocate(null)}
        onDone={onMutated}
      />
    </>
  );
}
