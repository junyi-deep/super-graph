import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToSvg,
  loadFromBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  BinaryFileData,
  DataURL,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileCode2,
  Library,
  Palette,
  SunMoon,
  Upload,
  Users,
  Wrench,
} from "lucide-react";
import { CollaborationPanel } from "./CollaborationSidebar";

const backgrounds = [
  "#ffffff",
  "#f8fafc",
  "#fefce8",
  "#f0fdf4",
  "#eff6ff",
  "#faf5ff",
  "#18181b",
];
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const readDataURL = (file: File) =>
  new Promise<DataURL>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as DataURL);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("invalid SVG"));
    image.src = source;
  });
const newFileID = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(20)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("") as FileId;

export function EditorTools({
  api,
  name,
  drawingId,
  onAccessChange,
  kind = "excalidraw",
  children,
}: {
  api: ExcalidrawImperativeAPI | null;
  name: string;
  drawingId: string;
  onAccessChange?: (canEdit: boolean) => void;
  kind?: "excalidraw" | "mermaid";
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"tools" | "collaboration">("tools");
  const input = useRef<HTMLInputElement>(null);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [background, setBackground] = useState("#ffffff");
  useEffect(() => {
    if (api) setBackground(api.getAppState().viewBackgroundColor || "#ffffff");
  }, [api]);
  const setCanvasBackground = (color: string) => {
    setBackground(color);
    api?.updateScene({ appState: { viewBackgroundColor: color } });
  };
  const importSVG = async (file: File) => {
    if (!api) return;
    const dataURL = await readDataURL(file);
    const image = await loadImage(dataURL);
    const fileId = newFileID();
    const ratio = Math.min(
      1,
      640 / Math.max(image.naturalWidth, 1),
      480 / Math.max(image.naturalHeight, 1),
    );
    const width = Math.max(120, (image.naturalWidth || 640) * ratio);
    const height = Math.max(80, (image.naturalHeight || 360) * ratio);
    const state = api.getAppState();
    const zoom = state.zoom?.value || 1;
    const x = -state.scrollX + state.width / (2 * zoom) - width / 2;
    const y = -state.scrollY + state.height / (2 * zoom) - height / 2;
    const [element] = convertToExcalidrawElements([
      { type: "image", x, y, width, height, fileId, status: "saved" },
    ]);
    const binary: BinaryFileData = {
      id: fileId,
      dataURL,
      mimeType: "image/svg+xml",
      created: Date.now(),
    };
    api.addFiles([binary]);
    api.updateScene({
      elements: [...api.getSceneElements(), element],
      appState: { selectedElementIds: { [element.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setToast({ message: "SVG 已作为图片导入" });
  };
  const importFile = async (file?: File) => {
    if (!api || !file) return;
    try {
      if (
        file.type === "image/svg+xml" ||
        file.name.toLowerCase().endsWith(".svg")
      ) {
        await importSVG(file);
        return;
      }
      const data = await loadFromBlob(
        file,
        api.getAppState(),
        api.getSceneElements(),
      );
      api.updateScene({
        elements: data.elements,
        appState: data.appState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      if (data.files) api.addFiles(Object.values(data.files));
      api.setToast({ message: "文件已导入" });
    } catch {
      api.setToast({ message: "无法导入该文件" });
    }
  };
  const exportScene = () => {
    if (!api) return;
    download(
      new Blob(
        [
          serializeAsJSON(
            api.getSceneElementsIncludingDeleted(),
            api.getAppState(),
            api.getFiles(),
            "local",
          ),
        ],
        { type: "application/json" },
      ),
      `${name}.excalidraw`,
    );
  };
  const exportSVG = async () => {
    if (!api) return;
    const svg = await exportToSvg({
      elements: api.getSceneElements(),
      appState: api.getAppState(),
      files: api.getFiles(),
      renderEmbeddables: true,
    });
    download(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml;charset=utf-8",
      }),
      `${name}.svg`,
    );
  };
  const theme = () => {
    if (!api) return;
    api.updateScene({
      appState: {
        theme: api.getAppState().theme === "dark" ? "light" : "dark",
      },
    });
  };
  return (
    <aside className={`editor-tools ${open ? "open" : "collapsed"}`}>
      <button
        className="tools-collapse"
        onClick={() => setOpen(!open)}
        title={open ? "收起工具栏" : "展开工具栏"}
      >
        {open ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
      </button>
      {open && (
        <>
          <header>
            <span>{tab === "tools" ? "画布工具" : "协作"}</span>
            <small>
              {tab === "tools" ? "导入、导出与显示设置" : "参与成员与修改记录"}
            </small>
          </header>
          <div className="editor-tools-tabs" role="tablist" aria-label="右侧边栏">
            <button
              role="tab"
              aria-selected={tab === "tools"}
              className={tab === "tools" ? "active" : ""}
              onClick={() => setTab("tools")}
            >
              <Wrench size={13} />
              工具
            </button>
            <button
              role="tab"
              aria-selected={tab === "collaboration"}
              className={tab === "collaboration" ? "active" : ""}
              onClick={() => setTab("collaboration")}
            >
              <Users size={13} />
              协作
            </button>
          </div>
          {tab === "collaboration" ? (
            <CollaborationPanel
              drawingId={drawingId}
              onAccessChange={onAccessChange}
            />
          ) : kind === "mermaid" ? (
            children || (
              <div className="mermaid-tools-note">
                <Wrench size={18} />
                <b>Mermaid 图表工具</b>
                <p>当前没有可用工具。</p>
              </div>
            )
          ) : (
            <div className="tool-list">
            <details className="tool-group-details">
              <summary>
                <span><Upload size={16} /></span>
                <div><b>导入</b><small>点击选择导入类型</small></div>
                <ChevronRight size={14} />
              </summary>
              <div className="tool-group-options">
                <button
                  onClick={() => {
                    if (!input.current) return;
                    input.current.accept =
                      ".excalidraw,.json,application/json";
                    input.current.click();
                  }}
                >
                  <FileCode2 size={14} />
                  Excalidraw / JSON
                </button>
                <button
                  onClick={() => {
                    if (!input.current) return;
                    input.current.accept = ".svg,image/svg+xml";
                    input.current.click();
                  }}
                >
                  <FileCode2 size={14} />
                  SVG 图片
                </button>
              </div>
            </details>
            <input
              ref={input}
              hidden
              type="file"
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <details className="tool-group-details">
              <summary>
                <span><Download size={16} /></span>
                <div><b>导出</b><small>点击选择导出格式</small></div>
                <ChevronRight size={14} />
              </summary>
              <div className="tool-group-options">
                <button onClick={exportScene}>
                  <Download size={14} />
                  Excalidraw 源文件
                </button>
                <button onClick={() => void exportSVG()}>
                  <FileCode2 size={14} />
                  SVG 图片
                </button>
              </div>
            </details>
            <button onClick={theme}>
              <span>
                <SunMoon size={16} />
              </span>
              <div>
                <b>主题切换</b>
                <small>浅色 / 深色</small>
              </div>
            </button>
            <button onClick={() => setBackgroundOpen((value) => !value)}>
              <span>
                <Palette size={16} />
              </span>
              <div>
                <b>画布背景</b>
                <small>常用颜色与自定义颜色</small>
              </div>
            </button>
            {backgroundOpen && (
              <div className="background-picker">
                <div className="background-presets">
                  {backgrounds.map((color) => (
                    <button
                      key={color}
                      className={background === color ? "active" : ""}
                      style={{ background: color }}
                      title={color}
                      aria-label={`设置背景 ${color}`}
                      onClick={() => setCanvasBackground(color)}
                    />
                  ))}
                </div>
                <label>
                  自定义
                  <input
                    type="color"
                    value={background}
                    onChange={(event) =>
                      setCanvasBackground(event.target.value)
                    }
                  />
                </label>
              </div>
            )}
            <button
              onClick={() =>
                api?.toggleSidebar({
                  name: "default",
                  tab: "library",
                  force: true,
                })
              }
            >
              <span>
                <Library size={16} />
              </span>
              <div>
                <b>Library</b>
                <small>打开素材库</small>
              </div>
            </button>
            <button
              onClick={() =>
                window.open(
                  "https://docs.excalidraw.com",
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              <span>
                <CircleHelp size={16} />
              </span>
              <div>
                <b>帮助</b>
                <small>打开 Excalidraw 使用文档</small>
              </div>
            </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
