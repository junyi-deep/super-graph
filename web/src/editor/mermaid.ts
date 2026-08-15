import mermaid from "mermaid";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasmUrl from "@resvg/resvg-wasm/index_bg.wasm?url";

const xml=(value:string)=>value.startsWith("<?xml")?value:`<?xml version="1.0" encoding="UTF-8"?>\n${value}`;
let wasmReady:Promise<void>|null=null;

async function renderMermaidSource(code:string,theme:string):Promise<string>{
  // SVG foreignObject labels taint Canvas in Chromium. Text labels keep PNG export
  // fully browser-side and avoid any server-side rendering dependency.
  mermaid.initialize({
    startOnLoad:false,
    securityLevel:"strict",
    suppressErrorRendering:true,
    theme:theme as any,
    flowchart:{htmlLabels:false},
  });
  const id=`mermaid-export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result=await mermaid.render(id,code);
  return xml(result.svg);
}

export async function renderMermaidSVG(code:string,theme:string):Promise<Blob>{return new Blob([await renderMermaidSource(code,theme)],{type:"image/svg+xml;charset=utf-8"})}

export async function renderMermaidPNG(code:string,theme:string):Promise<Blob>{
  wasmReady??=initWasm(fetch(wasmUrl));await wasmReady;
  const renderer=new Resvg(await renderMermaidSource(code,theme),{fitTo:{mode:"width",value:1600},background:theme==="dark"?"#0f172a":"#ffffff",font:{loadSystemFonts:false,defaultFontFamily:"sans-serif"}});
  try{const rendered=renderer.render();try{const png=rendered.asPng();return new Blob([png.slice().buffer],{type:"image/png"})}finally{rendered.free()}}finally{renderer.free()}
}
