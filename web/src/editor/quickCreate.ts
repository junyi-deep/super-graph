import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";

export type QuickCreateDirection="ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight";

const supported=new Set(["rectangle","diamond","ellipse","text"]);

export function adjacentSkeleton(source:ExcalidrawElement|undefined,direction:QuickCreateDirection,center={x:0,y:0}){
  const type=source&&supported.has(source.type)?source.type:"rectangle";
  const width=source?.width||180;const height=source?.height||100;const gap=64;
  const x=source?.x??center.x-width/2;const y=source?.y??center.y-height/2;
  const dx=direction==="ArrowLeft"?-(width+gap):direction==="ArrowRight"?width+gap:0;
  const dy=direction==="ArrowUp"?-(height+gap):direction==="ArrowDown"?height+gap:0;
  const common={type,x:x+dx,y:y+dy,width,height,strokeColor:source?.strokeColor||"#1e1e1e",backgroundColor:source?.backgroundColor||"transparent",fillStyle:source?.fillStyle||"solid",strokeWidth:source?.strokeWidth||1,strokeStyle:source?.strokeStyle||"solid",roughness:source?.roughness??1,opacity:source?.opacity??100};
  if(type==="text"&&source?.type==="text")return{...common,text:source.text||"文本",fontSize:source.fontSize,fontFamily:source.fontFamily,textAlign:source.textAlign,verticalAlign:source.verticalAlign};
  return common;
}

export function quickCreateElement(api:ExcalidrawImperativeAPI,direction:QuickCreateDirection){
  const state=api.getAppState();const elements=api.getSceneElements();const source=elements.find(element=>state.selectedElementIds[element.id]);const zoom=state.zoom?.value||1;const center={x:-state.scrollX+state.width/(2*zoom),y:-state.scrollY+state.height/(2*zoom)};const [created]=convertToExcalidrawElements([adjacentSkeleton(source,direction,center) as any]);api.updateScene({elements:[...elements,created],appState:{selectedElementIds:{[created.id]:true}},commitToHistory:true});api.scrollToContent(created,{fitToContent:false,animate:true});
}
