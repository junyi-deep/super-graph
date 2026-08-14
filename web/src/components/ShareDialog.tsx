import { useState } from "react";
import { Check, Copy, FileCode2, Image, Link2, X } from "lucide-react";
import type { Drawing } from "../types";

const download=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
export function ShareDialog({drawing,onClose,createPNG,createSVG}:{drawing:Drawing;onClose:()=>void;createPNG:()=>Promise<Blob>;createSVG:()=>Promise<Blob>}){
  const [notice,setNotice]=useState("");
  const copy=async(text:string,message:string)=>{await navigator.clipboard.writeText(text);setNotice(message);window.setTimeout(()=>setNotice(""),1800)};
  const exportPNG=async()=>download(await createPNG(),`${drawing.name}.png`);
  const exportSVG=async()=>download(await createSVG(),`${drawing.name}.svg`);
  const imageURL=`${location.origin}${drawing.imageUrl}`;const collaborationURL=`${location.origin}/d/${drawing.id}`;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="share-dialog" onMouseDown={e=>e.stopPropagation()}><header><div><h2>分享“{drawing.name}”</h2><p>下载图片或复制始终指向最新内容的链接</p></div><button className="icon-button" onClick={onClose}><X size={17}/></button></header><div className="share-grid"><button onClick={exportSVG}><span className="share-icon violet"><FileCode2 size={20}/></span><b>SVG 图片</b><small>矢量格式，下载到本地</small></button><button onClick={exportPNG}><span className="share-icon blue"><Image size={20}/></span><b>PNG 图片</b><small>导出当前画布</small></button><button onClick={()=>copy(`![${drawing.name}](${imageURL})`,"Markdown 已复制")}><span className="share-icon green"><Copy size={19}/></span><b>Markdown 链接</b><small>固定 PNG 地址，内容自动更新</small></button><button onClick={()=>copy(collaborationURL,"协作链接已复制")}><span className="share-icon orange"><Link2 size={19}/></span><b>协作分享链接</b><small>登录后打开并编辑</small></button></div><div className="share-url"><code>{imageURL}</code><button onClick={()=>copy(imageURL,"PNG 地址已复制")}>{notice?<><Check size={14}/>{notice}</>:<><Copy size={14}/>复制地址</>}</button></div></section></div>;
}
