import { useMemo, useState } from "react";
import { Activity, CalendarDays, FolderKanban, UserRound } from "lucide-react";
import type { ActivityDay, Stats } from "../types";
import { Button } from "./ui/button";

type HeatmapView="month"|"year";
type HeatmapCell={date:string;created:number;updated:number;count:number}|null;
const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;

export function buildHeatmap(activity:ActivityDay[],view:HeatmapView,now=new Date()){
  const end=new Date(now);end.setHours(0,0,0,0);
  const start=view==="month"?new Date(end.getFullYear(),end.getMonth(),1):new Date(end.getFullYear(),end.getMonth(),end.getDate()-364);
  const visibleEnd=view==="month"?new Date(end.getFullYear(),end.getMonth()+1,0):end;
  const gridStart=new Date(start);gridStart.setDate(gridStart.getDate()-gridStart.getDay());
  const gridEnd=new Date(visibleEnd);gridEnd.setDate(gridEnd.getDate()+(6-gridEnd.getDay()));
  const values=new Map(activity.map(item=>[item.date,item]));const cells:HeatmapCell[]=[];
  for(const date=new Date(gridStart);date<=gridEnd;date.setDate(date.getDate()+1)){
    if(date<start||date>visibleEnd||date>end){cells.push(null);continue}
    const key=dateKey(date);const value=values.get(key);cells.push({date:key,created:value?.created||0,updated:value?.updated||0,count:(value?.created||0)+(value?.updated||0)});
  }
  const columns=Math.ceil(cells.length/7);const labels:Array<string>=[];let previous="";
  for(let column=0;column<columns;column++){const item=cells.slice(column*7,column*7+7).find(Boolean);if(!item){labels.push("");continue}const date=new Date(`${item.date}T00:00:00`);const label=view==="month"?`${date.getMonth()+1}/${date.getDate()}`:`${date.getMonth()+1}月`;labels.push(label===previous?"":label);previous=label}
  return{cells,columns,labels};
}

function ActivityHeatmap({stats}:{stats:Stats}){
  const [view,setView]=useState<HeatmapView>("month");const model=useMemo(()=>buildHeatmap(stats.activity,view),[stats.activity,view]);
  const level=(count:number)=>count===0?0:count===1?1:count<=3?2:count<=6?3:4;
  return <section className="heatmap-card"><header><div><Activity size={16}/><b>文件活跃趋势</b></div><div className="heatmap-switch"><Button size="sm" variant={view==="month"?"default":"ghost"} onClick={()=>setView("month")}>月</Button><Button size="sm" variant={view==="year"?"default":"ghost"} onClick={()=>setView("year")}>年</Button></div></header><div className="heatmap-scroll"><div className="heatmap-chart"><div className="heatmap-month-axis" style={{gridTemplateColumns:`repeat(${model.columns}, 12px)`}}>{model.labels.map((label,index)=><span key={index}>{label}</span>)}</div><div className="heatmap-content"><div className="heatmap-week-axis">{["日","一","二","三","四","五","六"].map(day=><span key={day}>{day}</span>)}</div><div className="heatmap-grid">{model.cells.map((item,index)=>item?<i key={item.date} className={`heatmap-cell level-${level(item.count)}`} tabIndex={0} aria-label={`${item.date}，创建 ${item.created} 个，变更 ${item.updated} 个`}><span>{item.date}<br/>创建文件：{item.created}<br/>变更文件：{item.updated}</span></i>:<i className="blank" key={`blank-${index}`}/>)}</div></div></div></div><footer><span>少</span>{[0,1,2,3,4].map(item=><i key={item} className={`level-${item}`}/>)}<span>多</span></footer></section>;
}

export function StatsPanel({stats}:{stats:Stats|null}){
  if(!stats)return <aside className="stats-panel"><div className="stat-card skeleton">统计加载中…</div></aside>;
  const ranking=(title:string,Icon:typeof UserRound,items:Stats["personalFiles"])=><section className="ranking-card"><h3><Icon size={15}/>{title}</h3>{items.length?items.map((item,index)=><div className="rank-row" key={item.name}><b>{index+1}</b><span>{item.name}</span><strong>{item.count}</strong></div>):<p className="muted">暂无数据</p>}</section>;
  return <aside className="stats-panel"><div className="stat-grid"><div className="stat-card"><span className="stat-icon"><CalendarDays size={18}/></span><div><b>{stats.dailyActive}</b><small>今日活跃</small></div></div><div className="stat-card"><span className="stat-icon"><Activity size={18}/></span><div><b>{stats.monthlyActive}</b><small>近 30 日活跃</small></div></div></div><ActivityHeatmap stats={stats}/>{ranking("个人文件数量排行",UserRound,stats.personalFiles)}{ranking("项目文件树排行",FolderKanban,stats.projectFiles)}</aside>;
}
