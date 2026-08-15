import type { ReactNode } from "react";
import { FileCode2, Image, Link2, TextCursorInput } from "lucide-react";
import type { Drawing } from "../types";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "./ui/dialog";

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
  return <Dialog open onOpenChange={value=>{if(!value)onClose()}}><DialogContent className="share-dialog max-w-[640px]"><DialogHeader><DialogTitle>分享“{drawing.name}”</DialogTitle><DialogDescription>下载图片，或从文本框中手动复制分享地址</DialogDescription></DialogHeader><div className="share-grid download-grid"><button onClick={exportSVG}><span className="share-icon"><FileCode2 size={20}/></span><b>SVG 图片</b><small>矢量格式，下载到本地</small></button><button onClick={exportPNG}><span className="share-icon"><Image size={20}/></span><b>PNG 图片</b><small>导出当前画布</small></button></div><div className="manual-copy-list"><ManualCopy label="Markdown 链接" value={markdown} icon={<TextCursorInput size={19}/>}/><ManualCopy label="协作分享链接" value={collaborationURL} icon={<Link2 size={19}/>}/><ManualCopy label="PNG 图片地址" value={imageURL} icon={<Image size={19}/>}/></div><p className="clipboard-note">当前站点可能使用内网或自签名证书，浏览器会禁用自动写入剪贴板。请选中文本后使用键盘手动复制。</p></DialogContent></Dialog>;
}
