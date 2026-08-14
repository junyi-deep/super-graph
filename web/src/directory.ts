import type { Drawing } from "./types";
export function groupDrawings(drawings:Drawing[]){return drawings.reduce<Record<string,Drawing[]>>((out,d)=>{(out[d.owner.username]??=[]).push(d);return out},{})}
export function canShowDelete(drawing:Drawing){return drawing.canDelete}
