import { describe,expect,it } from "vitest";
import { buildTreeSearch } from "./treeSearch";

const alice={id:"u1",username:"Alice"};
const data:any={users:[alice,{id:"u2",username:"Bob"}],projects:[{id:"p1",name:"Apollo"},{id:"p2",name:"Beacon"}],folders:[{id:"fu1",name:"设计",space:"user",userId:"u1",projectId:null,parentId:null},{id:"fu2",name:"草稿",space:"user",userId:"u1",projectId:null,parentId:"fu1"},{id:"fp1",name:"接口",space:"project",userId:null,projectId:"p1",parentId:null}],drawings:[{id:"du1",name:"登录流程",space:"user",owner:alice,folderId:"fu2",projectId:null},{id:"dp1",name:"部署图",space:"project",owner:alice,folderId:"fp1",projectId:"p1"}]};

describe("buildTreeSearch",()=>{
  it("finds users and includes all content below a matching user",()=>{const result=buildTreeSearch(data,"user","alice");expect([...result.rootIds]).toEqual(["u1"]);expect(result.folderIds.has("fu2")).toBe(true);expect(result.drawingIds.has("du1")).toBe(true)});
  it("finds a nested directory, keeps its ancestor visible, and shows its content",()=>{const result=buildTreeSearch(data,"user","草稿");expect([...result.rootIds]).toEqual(["u1"]);expect([...result.folderIds].sort()).toEqual(["fu1","fu2"]);expect([...result.drawingIds]).toEqual(["du1"])});
  it("finds project files and their project path",()=>{const result=buildTreeSearch(data,"project","部署");expect([...result.rootIds]).toEqual(["p1"]);expect([...result.folderIds]).toEqual(["fp1"]);expect([...result.drawingIds]).toEqual(["dp1"])});
});
