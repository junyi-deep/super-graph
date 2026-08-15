import type { Drawing, DrawingType, Folder, Project, SpaceMode, Stats, TreeData, User } from "./types";

export class APIError extends Error { constructor(public status: number, message: string){ super(message); } }
async function request<T>(path:string, init?:RequestInit):Promise<T>{
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string") headers.set("Content-Type","application/json");
  const response=await fetch(path,{...init,headers,credentials:"same-origin"});
  if(!response.ok){let message=`请求失败 (${response.status})`;try{message=(await response.json()).error||message}catch{}throw new APIError(response.status,message)}
  if(response.status===204)return undefined as T;
  return response.json();
}
type DrawingLocation = { space?: SpaceMode; folderId?: string | null; projectId?: string | null; type?: DrawingType; mermaidCode?: string };
export const api={
  me:()=>request<User>("/api/me"),
  login:(username:string)=>request<User>("/api/login",{method:"POST",body:JSON.stringify({username})}),
  logout:()=>request<void>("/api/logout",{method:"POST"}),
  drawings:()=>request<Drawing[]>("/api/drawings"),
  drawing:(id:string)=>request<Drawing>(`/api/drawings/${id}`),
  create:(name:string,location:DrawingLocation={})=>request<Drawing>("/api/drawings",{method:"POST",body:JSON.stringify({name,...location})}),
  rename:(id:string,name:string)=>request<Drawing>(`/api/drawings/${id}`,{method:"PATCH",body:JSON.stringify({name})}),
  remove:(id:string)=>request<void>(`/api/drawings/${id}`,{method:"DELETE"}),
  tree:()=>request<TreeData>("/api/tree"),
  stats:()=>request<Stats>("/api/stats"),
  createFolder:(input:{name:string;space:SpaceMode;userId?:string|null;projectId?:string|null;parentId?:string|null})=>request<Folder>("/api/folders",{method:"POST",body:JSON.stringify(input)}),
  renameFolder:(id:string,name:string)=>request<void>(`/api/folders/${id}`,{method:"PATCH",body:JSON.stringify({name})}),
  removeFolder:(id:string)=>request<void>(`/api/folders/${id}`,{method:"DELETE"}),
  createProject:(name:string)=>request<Project>("/api/projects",{method:"POST",body:JSON.stringify({name})}),
  renameProject:(id:string,name:string)=>request<void>(`/api/projects/${id}`,{method:"PATCH",body:JSON.stringify({name})}),
  removeProject:(id:string)=>request<void>(`/api/projects/${id}`,{method:"DELETE"}),
  config:()=>request<{autosaveIntervalMs:number}>("/api/config"),
  autosave:(id:string,scene:unknown,image:Blob)=>{const form=new FormData();form.append("scene",JSON.stringify(scene));form.append("image",image,"drawing.png");return request<{savedAt:number}>(`/api/drawings/${id}/autosave`,{method:"PUT",body:form})},
};
