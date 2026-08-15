import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultSidebar, Excalidraw, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Check, Expand, FilePenLine, Share2 } from "lucide-react";
import { api } from "../api";
import { EditorFileSidebar } from "../components/EditorFileSidebar";
import { EditorTools } from "../components/EditorTools";
import { ShareDialog } from "../components/ShareDialog";
import type { Drawing, Scene, User } from "../types";
import { AutosaveCoordinator, type SaveStatus } from "../editor/autosave";
import { contentSignature, restoreSceneFromStorage, serializeSceneForStorage } from "../editor/scene";
import { useCollaboration } from "../editor/useCollaboration";
import { MermaidEditor } from "./MermaidEditor";

const labels:Record<SaveStatus,string>={saved:"已保存",saving:"正在保存…",dirty:"未保存",error:"保存失败，正在重试"};

export function Editor({id,user}:{id:string;user:User}){
  const [drawing,setDrawing]=useState<Drawing|null>(null);const [error,setError]=useState("");
  useEffect(()=>{api.drawing(id).then(item=>setDrawing(item.type==="excalidraw"?{...item,scene:restoreSceneFromStorage(item.scene)}:item)).catch(reason=>setError(reason.message))},[id]);
  if(error)return <main className="center error">{error} <a href="/">返回主页面</a></main>;
  if(!drawing)return <main className="center">正在加载…</main>;
  if(drawing.type==="mermaid")return <MermaidEditor initial={drawing} user={user}/>;
  return <ExcalidrawEditor initial={drawing} user={user}/>;
}

function ExcalidrawEditor({initial,user}:{initial:Drawing;user:User}){
  const id=initial.id;const [drawing,setDrawing]=useState(initial);const [apiRef,setAPI]=useState<ExcalidrawImperativeAPI|null>(null);const [status,setStatus]=useState<SaveStatus>("saved");const [editingName,setEditingName]=useState(false);const [nameDraft,setNameDraft]=useState("");const [shareOpen,setShareOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const latest=useRef<{elements:readonly ExcalidrawElement[];appState:any;files:BinaryFiles}|null>(null);const signature=useRef<string>();const autosaver=useMemo(()=>new AutosaveCoordinator(setStatus),[]);
  const scene=(drawing.scene??{elements:[],appState:{},files:{}}) as Scene;const collab=useCollaboration(id,user,apiRef,scene,root);
  useEffect(()=>{if(!apiRef)return;let interval:number;api.config().then(config=>{interval=window.setInterval(()=>autosaver.run(async()=>{const current=latest.current;if(!current)return;const stored=serializeSceneForStorage(current.elements,current.appState,current.files);const image=await exportToBlob({elements:current.elements,appState:{...current.appState,exportScale:Math.min(current.appState.exportScale||1,2)},files:current.files,mimeType:"image/png",maxWidthOrHeight:8192});await api.autosave(id,stored,image)}),Math.max(config.autosaveIntervalMs,1000))});return()=>clearInterval(interval)},[apiRef,id,autosaver]);
  const onChange=(elements:readonly ExcalidrawElement[],appState:any,files:BinaryFiles)=>{latest.current={elements,appState,files};const next=contentSignature(elements,files);if(signature.current===undefined){signature.current=next;return}if(next!==signature.current){signature.current=next;autosaver.markChanged()}};
  const beginNameEdit=()=>{setNameDraft(drawing.name);setEditingName(true)};
  const saveName=async()=>{setEditingName(false);const name=nameDraft.trim();if(!name||name===drawing.name)return;try{setDrawing(await api.rename(id,name))}catch(error){apiRef?.setToast({message:error instanceof Error?error.message:"重命名失败"})}};
  const fullscreen=async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()};
  const data=()=>({elements:apiRef?.getSceneElements()||[],appState:apiRef?.getAppState()||{},files:apiRef?.getFiles()||{}});
  const createPNG=()=>exportToBlob({...data(),mimeType:"image/png",maxWidthOrHeight:8192});
  const createSVG=async()=>{const svg=await exportToSvg({...data(),renderEmbeddables:true});return new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"})};
  return <div className="editor-page"><header className="editor-bar"><a className="back-home" href="/">← 返回主页面</a><div className="filename-wrap"><FilePenLine className="file-glyph" size={19}/>{editingName?<input autoFocus value={nameDraft} onChange={event=>setNameDraft(event.target.value)} onBlur={saveName} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();if(event.key==="Escape"){event.preventDefault();setNameDraft(drawing.name);setEditingName(false)}}}/>:<button className="filename-button" onClick={beginNameEdit} title="点击修改文件名"><b>{drawing.name}</b><span>点击修改</span></button>}</div><div className="identity-chip"><span>{drawing.owner.username.slice(0,1).toUpperCase()}</span><div><small>所有者</small><b>{drawing.owner.username}</b></div></div><div className="identity-chip editing"><span>{user.username.slice(0,1).toUpperCase()}</span><div><small>正在编辑</small><b>{user.username}</b></div></div><span className={`save-pill ${status}`}><Check size={12}/>{labels[status]}</span><details className="collaborator-menu"><summary><span className={collab.connected?"online-dot":"offline-dot"}/>{collab.connected?`协作已连接 · ${collab.users.length}`:"协作重连中"}<b>⌄</b></summary><div>{collab.users.length?collab.users.map(person=><p key={person.id}><i style={{background:person.color}}>{person.username.slice(0,1).toUpperCase()}</i><span>{person.username}{person.self?"（我）":""}</span><em>在线</em></p>):<p className="muted">等待协作者加入</p>}</div></details><button className="share-button" onClick={()=>setShareOpen(true)}><Share2 size={15}/>分享</button><button className="icon-button" onClick={fullscreen} title="全屏显示"><Expand size={17}/></button></header><div className="editor-body"><EditorFileSidebar user={user} selectedId={id}/><div className="canvas" ref={root}><Excalidraw initialData={scene as any} excalidrawAPI={setAPI} onChange={onChange} onPointerUpdate={collab.onPointerUpdate} isCollaborating={collab.connected} langCode="zh-CN" name={drawing.name} renderTopRightUI={()=>null} UIOptions={{canvasActions:{loadScene:false,export:false,saveAsImage:false,saveToActiveFile:false,toggleTheme:false,changeViewBackgroundColor:false}}}><DefaultSidebar /></Excalidraw></div><EditorTools api={apiRef} name={drawing.name} onShare={()=>setShareOpen(true)}/></div>{shareOpen&&apiRef&&<ShareDialog drawing={drawing} onClose={()=>setShareOpen(false)} createPNG={createPNG} createSVG={createSVG}/>}</div>;
}
