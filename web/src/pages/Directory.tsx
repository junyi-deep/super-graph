import { useEffect, useState } from "react";
import { FolderKanban, LogOut, Plus, Search, Shapes, UserRound } from "lucide-react";
import { api } from "../api";
import { FileTree } from "../components/FileTree";
import { StatsPanel } from "../components/StatsPanel";
import type { SpaceMode, Stats, TreeData, User } from "../types";

const emptyTree:TreeData={users:[],projects:[],folders:[],drawings:[]};
export function Directory({user,onLogout}:{user:User;onLogout:()=>void}){
  const [tree,setTree]=useState<TreeData>(emptyTree);const [stats,setStats]=useState<Stats|null>(null);const [mode,setMode]=useState<SpaceMode>("user");const [search,setSearch]=useState("");const [error,setError]=useState("");
  const load=async()=>{try{const [nextTree,nextStats]=await Promise.all([api.tree(),api.stats()]);setTree(nextTree);setStats(nextStats);setError("")}catch(e){setError(e instanceof Error?e.message:"加载失败")}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>api.stats().then(setStats).catch(()=>{}),30000);return()=>clearInterval(timer)},[]);
  const createProject=async()=>{const name=prompt("新项目名称")?.trim();if(!name)return;try{await api.createProject(name);setMode("project");await load()}catch(e){setError(e instanceof Error?e.message:"创建失败")}};
  return <main className="workspace-page"><header className="workspace-header"><div className="brand"><span className="brand-mark"><Shapes size={18}/></span><div><h1>Super Graph</h1><p>团队画板与 Mermaid 图表协作空间</p></div></div><div className="header-user"><span className="avatar">{user.username.slice(0,1).toUpperCase()}</span><div><b>{user.username}</b><small>当前账号</small></div><button className="ghost" onClick={async()=>{await api.logout();onLogout()}}><LogOut size={13}/>退出</button></div></header><div className="workspace-body"><section className="tree-workspace"><div className="workspace-toolbar"><div className="space-tabs"><button className={mode==="user"?"active":""} onClick={()=>setMode("user")}><UserRound size={14}/>用户空间</button><button className={mode==="project"?"active":""} onClick={()=>setMode("project")}><FolderKanban size={14}/>项目空间</button></div><div className="workspace-actions">{mode==="project"&&<button onClick={createProject}><Plus size={14}/>新建项目</button>}<label className="tree-search"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索文件"/></label></div></div>{error&&<p className="error notice">{error}</p>}<div className="tree-card"><div className="tree-card-head"><span>{mode==="user"?"所有用户":"所有项目"}</span><small>{tree.drawings.filter(d=>d.space===mode).length} 个文件</small></div><FileTree data={tree} mode={mode} currentUser={user} editable filter={search} onMutated={load}/></div></section><StatsPanel stats={stats}/></div></main>;
}
