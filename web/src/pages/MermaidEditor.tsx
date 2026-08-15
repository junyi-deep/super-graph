import { useEffect, useMemo, useRef, useState } from "react";
import {
  MermaidWysiwyg,
  type MermaidWysiwygEditor,
} from "@visimer/react";
import type { MermaidCanvasView, Tool } from "@visimer/dom";
import mermaid from "mermaid";
import {
  Check,
  Brush,
  ChevronLeft,
  Code2,
  Download,
  Expand,
  FileInput,
  Keyboard,
  LayoutTemplate,
  Moon,
  MousePointer2,
  Plus,
  Redo2,
  Share2,
  Trash2,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import { api } from "../api";
import { EditorFileSidebar } from "../components/EditorFileSidebar";
import { EditorTools } from "../components/EditorTools";
import { ShareDialog } from "../components/ShareDialog";
import { ConfirmDialog } from "../components/ui/form-dialog";
import { AutosaveCoordinator, type SaveStatus } from "../editor/autosave";
import { renderMermaidPNG, renderMermaidSVG } from "../editor/mermaid";
import { MERMAID_TEMPLATES } from "../editor/mermaidTemplates";
import { useMermaidCollaboration } from "../editor/useMermaidCollaboration";
import type {
  Drawing,
  MermaidDocument,
  MermaidSourceTheme,
  User,
} from "../types";

const labels: Record<SaveStatus, string> = {
  saved: "已保存",
  saving: "正在保存…",
  dirty: "未保存",
  error: "保存失败，正在重试",
};
type NodeShape = NonNullable<Parameters<MermaidCanvasView["addNode"]>[0]>;
type ParticipantType =
  | "participant"
  | "actor"
  | "boundary"
  | "control"
  | "entity"
  | "database"
  | "collections"
  | "queue";
const NODE_SHAPES: { value: NodeShape; label: string }[] = [
  { value: "rect", label: "矩形" },
  { value: "round", label: "圆角矩形" },
  { value: "diamond", label: "菱形" },
  { value: "circle", label: "圆形" },
  { value: "cylinder", label: "数据库" },
  { value: "hexagon", label: "六边形" },
];
const CANVAS_BACKGROUNDS = [
  { value: "#ffffff", label: "白色" },
  { value: "#f8fafc", label: "浅灰" },
  { value: "#fefce8", label: "米黄" },
  { value: "#f0fdf4", label: "浅绿" },
  { value: "#eff6ff", label: "浅蓝" },
  { value: "#18181b", label: "深色" },
];
const PARTICIPANT_TYPES: { value: ParticipantType; label: string }[] = [
  { value: "participant", label: "参与者" },
  { value: "actor", label: "角色" },
  { value: "boundary", label: "边界" },
  { value: "control", label: "控制器" },
  { value: "entity", label: "实体" },
  { value: "database", label: "数据库" },
  { value: "collections", label: "集合" },
  { value: "queue", label: "队列" },
];
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function MermaidEditor({
  initial,
  user,
}: {
  initial: Drawing;
  user: User;
}) {
  const initialDocument = (initial.scene || {}) as MermaidDocument;
  const [drawing, setDrawing] = useState(initial);
  const [code, setCode] = useState(
    initialDocument.code || MERMAID_TEMPLATES[0].code,
  );
  const [theme, setTheme] = useState(initialDocument.theme || "default");
  const [editorTheme, setEditorTheme] = useState<MermaidSourceTheme>(
    initialDocument.editorTheme || "dark",
  );
  const [canvasBackground, setCanvasBackground] = useState(
    initialDocument.canvasBackground || "#ffffff",
  );
  const [nodeShape, setNodeShape] = useState<NodeShape>("round");
  const [participantType, setParticipantType] =
    useState<ParticipantType>("participant");
  const [canvasTool, setCanvasTool] = useState<Tool>("select");
  const [operationsOpen, setOperationsOpen] = useState(true);
  const [themesOpen, setThemesOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(true);
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [view, setView] = useState<MermaidCanvasView | null>(null);
  const [syntaxError, setSyntaxError] = useState(false);
  const [codeWidth, setCodeWidth] = useState(() => {
    const stored = Number(localStorage.getItem("super-graph:mermaid-code-width"));
    return Number.isFinite(stored) && stored >= 240 ? stored : 360;
  });
  const [showLineNumbers, setShowLineNumbers] = useState(
    () => localStorage.getItem("super-graph:mermaid-line-numbers") !== "false",
  );
  const [codeOpen, setCodeOpen] = useState(
    () => localStorage.getItem("super-graph:mermaid-code-open") !== "false",
  );
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [shareOpen, setShareOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(initial.canEdit);
  const [pendingTemplate, setPendingTemplate] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(initial.name);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lineNumbers = useRef<HTMLDivElement>(null);
  const visimerEditor = useRef<MermaidWysiwygEditor | null>(null);
  const renderListener = useRef<(() => void) | null>(null);
  const codeWidthRef = useRef(codeWidth);
  const current = useRef({ code, theme, editorTheme, canvasBackground });
  const autosaver = useMemo(() => new AutosaveCoordinator(setStatus), []);
  const updateCollaborativeCode = useMermaidCollaboration(
    drawing.id,
    user,
    initialDocument.code || MERMAID_TEMPLATES[0].code,
    canEdit,
    (value) => {
      setCode(value);
      autosaver.markChanged();
    },
  );
  useEffect(() => {
    current.current = { code, theme, editorTheme, canvasBackground };
  }, [code, theme, editorTheme, canvasBackground]);
  useEffect(() => () => renderListener.current?.(), []);
  useEffect(() => {
    let timer = 0;
    api.config().then((config) => {
      timer = window.setInterval(
        () =>
          autosaver.run(async () => {
            if (!canEdit) return;
            const value = current.current;
            const png = await renderMermaidPNG(value.code, value.theme);
            await api.autosave(
              drawing.id,
              {
                code: value.code,
                theme: value.theme,
                editorTheme: value.editorTheme,
                canvasBackground: value.canvasBackground,
              },
              png,
            );
          }),
        Math.max(config.autosaveIntervalMs, 1000),
      );
    });
    return () => clearInterval(timer);
  }, [autosaver, drawing.id, canEdit]);
  const updateCode = (value: string) => {
    if (!canEdit) return;
    setCode(value);
    updateCollaborativeCode(value);
    autosaver.markChanged();
  };
  const updateTheme = (value: string) => {
    if (!canEdit) return;
    setTheme(value);
    autosaver.markChanged();
  };
  const updateEditorTheme = (value: MermaidSourceTheme) => {
    if (!canEdit) return;
    setEditorTheme(value);
    autosaver.markChanged();
  };
  const updateCanvasBackground = (value: string) => {
    if (!canEdit) return;
    setCanvasBackground(value);
    autosaver.markChanged();
  };
  const importMMD = async (file?: File) => {
    if (!file) return;
    updateCode(await file.text());
    if (fileInput.current) fileInput.current.value = "";
  };
  const exportMMD = () =>
    download(
      new Blob([code], { type: "text/plain;charset=utf-8" }),
      `${drawing.name}.mmd`,
    );
  const applyTemplate = (id: string) => {
    const template = MERMAID_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    updateCode(template.code);
    setPendingTemplate("");
    window.setTimeout(() => view?.fitView(), 100);
  };
  const fullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };
  const startCodeResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = codeWidthRef.current;
    const move = (nextEvent: PointerEvent) => {
      const max = Math.max(420, window.innerWidth * 0.55);
      const next = Math.min(max, Math.max(240, startWidth + nextEvent.clientX - startX));
      codeWidthRef.current = next;
      setCodeWidth(next);
    };
    const stop = () => {
      localStorage.setItem(
        "super-graph:mermaid-code-width",
        String(codeWidthRef.current),
      );
      document.body.classList.remove("resizing-mermaid-code");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    document.body.classList.add("resizing-mermaid-code");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  const setCodePanelOpen = (next: boolean) => {
    setCodeOpen(next);
    localStorage.setItem("super-graph:mermaid-code-open", String(next));
    window.setTimeout(() => view?.fitView(), 80);
  };
  const selectSourceForEntities = (entityIds: string[]) => {
    const editor = visimerEditor.current;
    const input = textarea.current;
    if (!editor || !input || !entityIds.length) return;
    const span = entityIds.flatMap((id) => editor.entityRanges(id))[0];
    if (!span) return;
    input.setSelectionRange(span.start, span.end);
    const line = code.slice(0, span.start).split("\n").length - 1;
    input.scrollTop = Math.max(0, line * 19.8 - input.clientHeight / 3);
    if (lineNumbers.current) lineNumbers.current.scrollTop = input.scrollTop;
  };
  const handleSelectionChange = (entityIds: string[]) => {
    setSelectedEntities(entityIds);
    selectSourceForEntities(entityIds);
  };
  const undo = () => {
    if (canEdit) visimerEditor.current?.undo();
  };
  const redo = () => {
    if (canEdit) visimerEditor.current?.redo();
  };
  const deleteSelection = () => {
    const editor = visimerEditor.current;
    if (!canEdit || !editor?.selection.length) return;
    editor.deleteEntities(editor.selection, "api");
  };
  const clearSelection = () => visimerEditor.current?.clearSelection("api");
  const addParticipant = () => {
    const editor = visimerEditor.current;
    if (!canEdit || !editor) return;
    const result = editor.dispatch(
      {
        type: "seq.addParticipant",
        ptype: participantType,
        name: "新参与者",
      },
      "api",
    );
    if (result?.created?.length) editor.setSelection(result.created, "api");
  };
  const selectCanvasForCaret = () => {
    const input = textarea.current;
    const editor = visimerEditor.current;
    if (!input || !editor || input.selectionStart !== input.selectionEnd) return;
    const entity = editor.entityAt(input.selectionStart);
    editor.setSelection(entity ? [entity] : [], "code");
  };
  const saveName = async () => {
    setEditingName(false);
    const name = nameDraft.trim();
    if (name && name !== drawing.name)
      try {
        setDrawing(await api.rename(drawing.id, name));
      } catch {
        setNameDraft(drawing.name);
      }
  };
  const createPNG = () => renderMermaidPNG(code, theme);
  const createSVG = () => renderMermaidSVG(code, theme);
  const flowchart = /^\s*(flowchart|graph)\b/.test(code);
  const sequenceDiagram = /^\s*sequenceDiagram\b/.test(code);
  useEffect(() => {
    if (!flowchart) setCanvasTool("select");
  }, [flowchart]);
  const pending = MERMAID_TEMPLATES.find((item) => item.id === pendingTemplate);
  return (
    <div className="editor-page mermaid-page">
      <header className="editor-bar">
        <a className="back-home" href="/">
          ← 返回主页面
        </a>
        <div className="filename-wrap">
          <Workflow className="file-glyph" size={19} />
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setNameDraft(drawing.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <button
              className="filename-button"
              onClick={() => {
                setNameDraft(drawing.name);
                setEditingName(true);
              }}
            >
              <b>{drawing.name}</b>
              <span>点击修改</span>
            </button>
          )}
        </div>
        <div className="identity-chip">
          <span>{drawing.owner.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <small>创建人</small>
            <b>{drawing.owner.username}</b>
          </div>
        </div>
        <div className="identity-chip editing">
          <span>{user.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <small>正在编辑</small>
            <b>{user.username}</b>
          </div>
        </div>
        <span className={`save-pill ${status}`}>
          <Check size={13} />
          {labels[status]}
        </span>
        <span className="editor-kind">
          <Workflow size={15} />
          Mermaid · Visimer
        </span>
        <button className="share-button" onClick={() => setShareOpen(true)}>
          <Share2 size={16} />
          分享
        </button>
        <button className="icon-button" onClick={fullscreen} title="全屏显示">
          <Expand size={18} />
        </button>
      </header>
      <div className="editor-body">
        <EditorFileSidebar user={user} selectedId={drawing.id} />
        <main className="mermaid-workspace">
          <div
            className={`mermaid-split ${codeOpen ? "" : "code-hidden"}`}
            style={{
              gridTemplateColumns: codeOpen
                ? `${codeWidth}px 6px minmax(0, 1fr)`
                : "minmax(0, 1fr)",
            }}
          >
            {codeOpen && <section className={`mermaid-code source-theme-${editorTheme}`}>
              <header>
                <Code2 size={15} />
                <b>Mermaid 源码</b>
                <label className="line-number-toggle">
                  <input
                    type="checkbox"
                    checked={showLineNumbers}
                    onChange={(event) => {
                      setShowLineNumbers(event.target.checked);
                      localStorage.setItem(
                        "super-graph:mermaid-line-numbers",
                        String(event.target.checked),
                      );
                    }}
                  />
                  行号
                </label>
                <button
                  className="mermaid-code-collapse"
                  title="收起源码面板"
                  onClick={() => setCodePanelOpen(false)}
                >
                  <ChevronLeft size={15} />
                </button>
              </header>
              <div className="mermaid-source-editor">
                {showLineNumbers && (
                  <div className="mermaid-line-numbers" ref={lineNumbers}>
                    {code.split("\n").map((_, index) => (
                      <span key={index}>{index + 1}</span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textarea}
                  disabled={!canEdit}
                  spellCheck={false}
                  value={code}
                  onChange={(event) => updateCode(event.target.value)}
                  onScroll={(event) => {
                    if (lineNumbers.current)
                      lineNumbers.current.scrollTop = event.currentTarget.scrollTop;
                  }}
                  onClick={selectCanvasForCaret}
                  onKeyUp={selectCanvasForCaret}
                />
              </div>
            </section>}
            {codeOpen && <div
              className="mermaid-code-resizer"
              role="separator"
              aria-label="调整 Mermaid 源码宽度"
              aria-orientation="vertical"
              aria-valuemin={240}
              aria-valuenow={Math.round(codeWidth)}
              onPointerDown={startCodeResize}
            />}
            <section
              className="mermaid-canvas"
              style={{ backgroundColor: canvasBackground }}
            >
              {!codeOpen && (
                <button
                  className="mermaid-code-reopen"
                  title="展开 Mermaid 源码"
                  onClick={() => setCodePanelOpen(true)}
                >
                  <Code2 size={14} />
                  展开源码
                </button>
              )}
              {syntaxError && (
                <div className="mermaid-syntax-error">语法有误，请检查 Mermaid 源码</div>
              )}
              <MermaidWysiwyg
                code={code}
                onCodeChange={updateCode}
                mermaid={mermaid as any}
                mermaidConfig={{
                  theme,
                  securityLevel: "strict",
                  suppressErrorRendering: true,
                }}
                accentColor="#18181b"
                panZoom
                tool={flowchart ? canvasTool : "select"}
                onSelectionChange={handleSelectionChange}
                onReady={(editor, canvas) => {
                  visimerEditor.current = editor;
                  setView(canvas);
                  renderListener.current?.();
                  renderListener.current = canvas.on("render", ({ ok }) =>
                    setSyntaxError(!ok),
                  );
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: canvasBackground,
                }}
              />
            </section>
          </div>
        </main>
        <EditorTools
          api={null}
          name={drawing.name}
          drawingId={drawing.id}
          onAccessChange={setCanEdit}
          kind="mermaid"
        >
          <div className="mermaid-side-tools">
            <section>
              <label>
                <span><LayoutTemplate size={14} />切换图表类型</span>
                <select
                  value=""
                  onChange={(event) => setPendingTemplate(event.target.value)}
                >
                  <option value="" disabled>选择图表类型…</option>
                  {MERMAID_TEMPLATES.map((template) => (
                    <option value={template.id} key={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <section className="mermaid-operations">
              <details
                className="side-tool-group mermaid-operation-group"
                open={operationsOpen}
                onToggle={(event) => setOperationsOpen(event.currentTarget.open)}
              >
                <summary>
                  <MousePointer2 size={15} />
                  <span>操作</span>
                  <ChevronLeft size={13} />
                </summary>
                <div className="mermaid-operation-content">
                  {flowchart && (
                    <>
                      <div className="mermaid-insert-node">
                        <select
                          aria-label="节点形状"
                          value={nodeShape}
                          disabled={!canEdit}
                          onChange={(event) => setNodeShape(event.target.value as NodeShape)}
                        >
                          {NODE_SHAPES.map((shape) => (
                            <option key={shape.value} value={shape.value}>{shape.label}</option>
                          ))}
                        </select>
                        <button
                          disabled={!canEdit}
                          onClick={() => view?.addNode(nodeShape, "新节点")}
                        >
                          <Plus size={14} />插入节点
                        </button>
                      </div>
                      <button
                        className={canvasTool === "connect" ? "active" : ""}
                        disabled={!canEdit}
                        onClick={() =>
                          setCanvasTool((value) => value === "connect" ? "select" : "connect")
                        }
                      >
                        <Share2 size={14} />
                        {canvasTool === "connect" ? "退出连线模式" : "进入连线模式"}
                      </button>
                      <small className="mermaid-operation-hint">
                        连线模式下，从一个节点拖到另一个节点即可创建连线。
                      </small>
                    </>
                  )}
                  {sequenceDiagram && (
                    <div className="mermaid-insert-node mermaid-add-participant">
                      <select
                        aria-label="参与者类型"
                        value={participantType}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setParticipantType(event.target.value as ParticipantType)
                        }
                      >
                        {PARTICIPANT_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                      <button disabled={!canEdit} onClick={addParticipant}>
                        <Plus size={14} />新增参与者
                      </button>
                    </div>
                  )}
                  <div className="mermaid-operation-grid">
                    <button disabled={!canEdit || !visimerEditor.current?.canUndo} onClick={undo}>
                      <Undo2 size={14} />撤销
                    </button>
                    <button disabled={!canEdit || !visimerEditor.current?.canRedo} onClick={redo}>
                      <Redo2 size={14} />重做
                    </button>
                    <button disabled={!canEdit || selectedEntities.length === 0} onClick={deleteSelection}>
                      <Trash2 size={14} />删除所选
                    </button>
                    <button disabled={selectedEntities.length === 0} onClick={clearSelection}>
                      <X size={14} />取消选择
                    </button>
                  </div>
                  {!flowchart && !sequenceDiagram && (
                    <small className="mermaid-operation-hint">
                      当前图表支持撤销、重做和所选元素操作。
                    </small>
                  )}
                </div>
              </details>
            </section>
            <section>
              <details className="side-tool-group">
                <summary>
                  <FileInput size={15} />
                  <span>导入</span>
                  <ChevronLeft size={13} />
                </summary>
                <div>
                  <button onClick={() => fileInput.current?.click()}>
                    <FileInput size={14} />导入 MMD
                  </button>
                </div>
              </details>
              <input
                ref={fileInput}
                hidden
                type="file"
                accept=".mmd,.mermaid,text/plain"
                onChange={(event) => void importMMD(event.target.files?.[0])}
              />
              <details className="side-tool-group">
                <summary>
                  <Download size={15} />
                  <span>导出</span>
                  <ChevronLeft size={13} />
                </summary>
                <div>
                  <button onClick={exportMMD}>
                    <Download size={14} />MMD 源文件
                  </button>
                  <button onClick={() => void createSVG().then((blob) => download(blob, `${drawing.name}.svg`))}>
                    <Code2 size={14} />SVG 图片
                  </button>
                  <button onClick={() => void createPNG().then((blob) => download(blob, `${drawing.name}.png`))}>
                    <Download size={14} />PNG 图片
                  </button>
                </div>
              </details>
            </section>
            <section>
              <details
                className="side-tool-group mermaid-theme-group"
                open={themesOpen}
                onToggle={(event) => setThemesOpen(event.currentTarget.open)}
              >
                <summary>
                  <Moon size={15} />
                  <span>主题与背景</span>
                  <ChevronLeft size={13} />
                </summary>
                <div>
                  <label>
                    <span>图表主题</span>
                    <select disabled={!canEdit} value={theme} onChange={(event) => updateTheme(event.target.value)}>
                      <option value="default">默认主题</option>
                      <option value="neutral">中性</option>
                      <option value="forest">森林</option>
                      <option value="dark">深色</option>
                      <option value="base">基础</option>
                    </select>
                  </label>
                  <label>
                    <span>源码主题</span>
                    <select
                      disabled={!canEdit}
                      value={editorTheme}
                      onChange={(event) => updateEditorTheme(event.target.value as MermaidSourceTheme)}
                    >
                      <option value="dark">深色</option>
                      <option value="light">浅色</option>
                      <option value="blue">深蓝</option>
                    </select>
                  </label>
                  <div className="canvas-background-setting">
                    <b><Brush size={14} />画布背景</b>
                    <div className="canvas-background-presets">
                      {CANVAS_BACKGROUNDS.map((background) => (
                        <button
                          key={background.value}
                          type="button"
                          disabled={!canEdit}
                          className={canvasBackground === background.value ? "active" : ""}
                          style={{ backgroundColor: background.value }}
                          title={background.label}
                          aria-label={`画布背景：${background.label}`}
                          onClick={() => updateCanvasBackground(background.value)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            </section>
            <section>
              <details
                className="side-tool-group mermaid-shortcuts-list"
                open={shortcutsOpen}
                onToggle={(event) => setShortcutsOpen(event.currentTarget.open)}
              >
                <summary>
                  <Keyboard size={15} />
                  <span>Visimer 快捷键</span>
                  <ChevronLeft size={13} />
                </summary>
                <div>
                  <span><kbd>Enter</kbd>编辑元素</span>
                  <span><kbd>Delete</kbd>删除元素</span>
                  <span><kbd>Ctrl + Z</kbd>撤销</span>
                  <span><kbd>Ctrl + 滚轮</kbd>缩放</span>
                  <span><kbd>Esc</kbd>取消选择</span>
                </div>
              </details>
            </section>
          </div>
        </EditorTools>
      </div>
      {shareOpen && (
        <ShareDialog
          drawing={drawing}
          onClose={() => setShareOpen(false)}
          createPNG={createPNG}
          createSVG={createSVG}
        />
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        title={`创建${pending?.name || "图表"}`}
        description="应用模板会替换当前 Mermaid 源码，此操作可以通过撤销恢复。"
        confirmLabel="应用模板"
        onCancel={() => setPendingTemplate("")}
        onConfirm={() => pending && applyTemplate(pending.id)}
      />
    </div>
  );
}
