import { useEffect, useState } from "react";
import { Clock3, FilePenLine, FolderKanban, LogOut, Plus, Search, Shapes, UserRound, Workflow } from "lucide-react";
import { api } from "../api";
import { FileTree } from "../components/FileTree";
import { StatsPanel } from "../components/StatsPanel";
import { NameDialog } from "../components/ui/form-dialog";
import { recentDrawings } from "../directory";
import type { SpaceMode, Stats, TreeData, User } from "../types";

const emptyTree:TreeData={users:[],projects:[],folders:[],drawings:[]};
const recentTime=(value:number)=>new Intl.DateTimeFormat("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value));

export function Directory({user,onLogout}:{user:User;onLogout:()=>void}){
  const [tree,setTree]=useState<TreeData>(emptyTree);
  const [stats,setStats]=useState<Stats|null>(null);
  const [mode,setMode]=useState<SpaceMode>("user");
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [projectDialog,setProjectDialog]=useState(false);
  const load=async()=>{try{const [nextTree,nextStats]=await Promise.all([api.tree(),api.stats()]);setTree(nextTree);setStats(nextStats);setError("")}catch(reason){setError(reason instanceof Error?reason.message:"加载失败")}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>api.stats().then(setStats).catch(()=>{}),30000);return()=>clearInterval(timer)},[]);
  const createProject=async(name:string)=>{setProjectDialog(false);try{await api.createProject(name);setMode("project");await load()}catch(reason){setError(reason instanceof Error?reason.message:"创建失败")}};
  const recent=recentDrawings(tree.drawings,user.id,12);
  const searchPlaceholder=mode==="user"?"搜索用户、目录或文件":"搜索项目、目录或文件";
  return <main className="workspace-page">
    <header className="workspace-header"><div className="brand"><span className="brand-mark"><Shapes size={18}/></span><div><h1>Super Graph</h1><p>团队画板与 Mermaid 图表协作空间</p></div></div><div className="header-user"><span className="avatar">{user.username.slice(0,1).toUpperCase()}</span><div><b>{user.username}</b><small>当前账号</small></div><button className="ghost" onClick={async()=>{await api.logout();onLogout()}}><LogOut size={13}/>退出</button></div></header>
    <div className="workspace-body">
      <aside className="recent-sidebar"><div className="tree-card recent-card"><div className="tree-card-head"><span><Clock3 size={14}/>最近修改</span><small>{recent.length} 个文件</small></div><div className="recent-list">{recent.length?recent.map(drawing=><a href={`/d/${drawing.id}`} key={drawing.id}><span className="recent-icon">{drawing.type==="mermaid"?<Workflow size={16}/>:<FilePenLine size={16}/>}</span><span><b>{drawing.name}</b><small>{drawing.space==="project"?"项目空间":"用户空间"}</small></span><time>{recentTime(drawing.updatedAt)}</time></a>):<p className="recent-empty">还没有由你修改的文件</p>}</div></div></aside>
      <section className="tree-workspace"><div className="workspace-toolbar"><div className="space-tabs"><button className={mode==="user"?"active":""} onClick={()=>{setMode("user");setSearch("")}}><UserRound size={14}/>用户空间</button><button className={mode==="project"?"active":""} onClick={()=>{setMode("project");setSearch("")}}><FolderKanban size={14}/>项目空间</button></div><div className="workspace-actions">{mode==="project"&&<button onClick={()=>setProjectDialog(true)}><Plus size={14}/>新建项目</button>}<label className="tree-search"><Search size={14}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={searchPlaceholder}/></label></div></div>{error&&<p className="error notice">{error}</p>}<div className="tree-card"><div className="tree-card-head"><span>{mode==="user"?"文件目录 · 所有用户":"文件目录 · 所有项目"}</span><small>{tree.drawings.filter(drawing=>drawing.space===mode).length} 个文件</small></div><FileTree data={tree} mode={mode} currentUser={user} editable filter={search} onMutated={load}/></div></section>
      <StatsPanel stats={stats}/>
    </div>
    <NameDialog open={projectDialog} title="新建项目" description="项目空间中的所有成员都可以创建文件和目录。" onCancel={()=>setProjectDialog(false)} onSubmit={createProject}/>
  </main>;
}
