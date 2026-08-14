import { Activity, CalendarDays, FolderKanban, UserRound } from "lucide-react";
import type { Stats } from "../types";

function ActivityHeatmap({stats}:{stats:Stats}){
  const counts=new Map(stats.activity.map(item=>[item.date,item.count]));
  const end=new Date();end.setHours(0,0,0,0);const start=new Date(end);start.setDate(start.getDate()-364);
  const cells:Array<{date:string;count:number}|null>=Array.from({length:start.getDay()},()=>null);
  for(const date=new Date(start);date<=end;date.setDate(date.getDate()+1)){const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;cells.push({date:key,count:counts.get(key)||0})}
  const level=(count:number)=>count===0?0:count===1?1:count<=3?2:count<=6?3:4;
  return <section className="heatmap-card"><header><div><Activity size={16}/><b>年度活跃趋势</b></div><span>过去 365 天</span></header><div className="heatmap-scroll"><div className="heatmap-grid">{cells.map((item,index)=>item?<i key={item.date} className={`level-${level(item.count)}`} title={`${item.date} · ${item.count} 位活跃用户`}/>:<i className="blank" key={`blank-${index}`}/>)}</div></div><footer><span>少</span>{[0,1,2,3,4].map(item=><i key={item} className={`level-${item}`}/>)}<span>多</span></footer></section>;
}

export function StatsPanel({stats}:{stats:Stats|null}){
  if(!stats)return <aside className="stats-panel"><div className="stat-card skeleton">统计加载中…</div></aside>;
  const ranking=(title:string,Icon:typeof UserRound,items:Stats["personalFiles"])=><section className="ranking-card"><h3><Icon size={15}/>{title}</h3>{items.length?items.map((item,index)=><div className="rank-row" key={item.name}><b>{index+1}</b><span>{item.name}</span><strong>{item.count}</strong></div>):<p className="muted">暂无数据</p>}</section>;
  return <aside className="stats-panel"><div className="stat-grid"><div className="stat-card"><span className="stat-icon"><CalendarDays size={18}/></span><div><b>{stats.dailyActive}</b><small>今日活跃</small></div></div><div className="stat-card"><span className="stat-icon"><Activity size={18}/></span><div><b>{stats.monthlyActive}</b><small>近 30 日活跃</small></div></div></div><ActivityHeatmap stats={stats}/>{ranking("个人文件数量排行",UserRound,stats.personalFiles)}{ranking("项目文件树排行",FolderKanban,stats.projectFiles)}</aside>;
}
