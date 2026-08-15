import type { ReactNode } from "react";
import { FileCode2, Image, Link2, TextCursorInput, X } from "lucide-react";
import type { Drawing } from "../types";

const download=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

function ManualCopy({label,value,icon}:{label:string;value:string;icon:ReactNode}){
  return <label className="manual-copy"><span className="share-icon">{icon}</span><span><b>{label}</b><small>点击文本框后按 Ctrl/Cmd + C 手动复制</small></span><textarea readOnly rows={value.startsWith("![")?2:1} value={value} onFocus={event=>event.currentTarget.select()} onClick={event=>event.currentTarget.select()}/></label>;
}

export function ShareDialog({drawing,onClose,createPNG,createSVG}:{drawing:Drawing;onClose:()=>void;createPNG:()=>Promise<Blob>;createSVG:()=>Promise<Blob>}){
  const exportPNG=async()=>download(await createPNG(),`${drawing.name}.png`);
  const exportSVG=async()=>download(await createSVG(),`${drawing.name}.svg`);
  const imageURL=`${location.origin}${drawing.imageUrl}`;
  const collaborationURL=`${location.origin}/d/${drawing.id}`;
  const markdown=`![${drawing.name}](${imageURL})`;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="share-dialog" onMouseDown={event=>event.stopPropagation()}><header><div><h2>分享“{drawing.name}”</h2><p>下载图片，或从文本框中手动复制分享地址</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={17}/></button></header><div className="share-grid download-grid"><button onClick={exportSVG}><span className="share-icon"><FileCode2 size={20}/></span><b>SVG 图片</b><small>矢量格式，下载到本地</small></button><button onClick={exportPNG}><span className="share-icon"><Image size={20}/></span><b>PNG 图片</b><small>导出当前画布</small></button></div><div className="manual-copy-list"><ManualCopy label="Markdown 链接" value={markdown} icon={<TextCursorInput size={19}/>}/><ManualCopy label="协作分享链接" value={collaborationURL} icon={<Link2 size={19}/>}/><ManualCopy label="PNG 图片地址" value={imageURL} icon={<Image size={19}/>}/></div><p className="clipboard-note">当前站点可能使用内网或自签名证书，浏览器会禁用自动写入剪贴板。请选中文本后使用键盘手动复制。</p></section></div>;
}
