import { describe,expect,it } from "vitest";
import { readTreeExpansion,toggleTreeExpansion } from "./treeExpansion";

describe("tree expansion persistence",()=>{
  it("restores valid modes and ignores malformed data",()=>{expect(readTreeExpansion("u",{getItem:()=>'{"user":["a"],"project":["p"]}'})).toEqual({user:["a"],project:["p"]});expect(readTreeExpansion("u",{getItem:()=>"broken"})).toEqual({user:[],project:[]})});
  it("toggles one mode without changing the other",()=>{expect(toggleTreeExpansion({user:["a"],project:["p"]},"user","b")).toEqual({user:["a","b"],project:["p"]})});
});
