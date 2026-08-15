import type { Drawing } from "./types";
export function groupDrawings(drawings:Drawing[]){return drawings.reduce<Record<string,Drawing[]>>((out,d)=>{(out[d.owner.username]??=[]).push(d);return out},{})}
export function canShowDelete(drawing:Drawing){return drawing.canDelete}
export function recentDrawings(drawings:Drawing[],userId:string,limit=30){return drawings.filter(drawing=>(drawing.updatedBy?.id||drawing.owner.id)===userId).sort((left,right)=>right.updatedAt-left.updatedAt).slice(0,limit)}
