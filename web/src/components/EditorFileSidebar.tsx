import { useEffect, useState } from "react";
import { ChevronLeft, FolderTree, Menu, Plus } from "lucide-react";
import { api } from "../api";
import type { SpaceMode, TreeData, User } from "../types";
import { FileTree } from "./FileTree";

const empty:TreeData={users:[],projects:[],folders:[],drawings:[]};
export function EditorFileSidebar({user,selectedId}:{user:User;selectedId:string}){const [open,setOpen]=useState(false);const [mode,setMode]=useState<SpaceMode>("user");const [tree,setTree]=useState(empty);const load=()=>api.tree().then(setTree).catch(()=>{});useEffect(()=>{if(open)void load()},[open]);const createProject=async()=>{const name=prompt("新项目名称")?.trim();if(!name)return;try{await api.createProject(name);setMode("project");await load()}catch(error){alert(error instanceof Error?error.message:"创建失败")}};return <aside className={`editor-file-sidebar ${open?"open":"collapsed"}`}><button className="file-sidebar-toggle" onClick={()=>setOpen(!open)} title={open?"收起文件树":"展开文件树"}>{open?<ChevronLeft size={17}/>:<Menu size={17}/>}</button>{open&&<><header><b><FolderTree size={15}/>文件树</b><div><button className={mode==="user"?"active":""} onClick={()=>setMode("user")}>用户</button><button className={mode==="project"?"active":""} onClick={()=>setMode("project")}>项目</button></div></header>{mode==="project"&&<button className="sidebar-new-project" onClick={createProject}><Plus size={14}/>新建项目</button>}<FileTree data={tree} mode={mode} currentUser={user} selectedId={selectedId} editable compact onMutated={load}/></>}</aside>}
