import type { SpaceMode } from "../types";

export type TreeExpansion=Record<SpaceMode,string[]>;
const empty=():TreeExpansion=>({user:[],project:[]});
export function expansionStorageKey(userId:string){return `super-graph:tree-expanded:${userId}`}
export function readTreeExpansion(userId:string,storage:Pick<Storage,"getItem">=localStorage):TreeExpansion{try{const value=JSON.parse(storage.getItem(expansionStorageKey(userId))||"null");return{user:Array.isArray(value?.user)?value.user:[],project:Array.isArray(value?.project)?value.project:[]}}catch{return empty()}}
export function toggleTreeExpansion(value:TreeExpansion,mode:SpaceMode,id:string):TreeExpansion{const entries=new Set(value[mode]);entries.has(id)?entries.delete(id):entries.add(id);return{...value,[mode]:[...entries]}}
