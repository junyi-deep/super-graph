import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

const storedAppStateKeys = ["viewBackgroundColor","gridSize","gridStep","gridModeEnabled","theme","currentItemStrokeColor","currentItemBackgroundColor","currentItemFillStyle","currentItemStrokeWidth","currentItemStrokeStyle","currentItemRoughness","currentItemOpacity","currentItemFontFamily","currentItemFontSize","currentItemTextAlign","currentItemStartArrowhead","currentItemEndArrowhead"] as const;
export function serializeSceneForStorage(elements:readonly ExcalidrawElement[],appState:AppState,files:BinaryFiles){const stored:Record<string,unknown>={};for(const key of storedAppStateKeys)stored[key]=(appState as any)[key];return{elements,appState:stored,files}}
export function restoreSceneFromStorage(scene:any){return{elements:Array.isArray(scene?.elements)?scene.elements:[],appState:scene?.appState??{},files:scene?.files??{}}}
export function contentSignature(elements:readonly ExcalidrawElement[],files:BinaryFiles){return elements.map(e=>`${e.id}:${e.version}`).join("|")+"#"+Object.keys(files).sort().join("|")}
