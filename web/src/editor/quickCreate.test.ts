import { describe,expect,it,vi } from "vitest";
vi.mock("@excalidraw/excalidraw",()=>({convertToExcalidrawElements:vi.fn()}));
import { adjacentSkeleton } from "./quickCreate";

describe("adjacentSkeleton",()=>{
  const source={type:"rectangle",x:100,y:200,width:180,height:100,strokeColor:"#111111",backgroundColor:"#ffffff",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:1,opacity:100} as any;
  it("creates to the right with a visible gap",()=>{expect(adjacentSkeleton(source,"ArrowRight")).toMatchObject({type:"rectangle",x:344,y:200,width:180,height:100})});
  it("creates a default shape at the viewport center",()=>{expect(adjacentSkeleton(undefined,"ArrowDown",{x:500,y:400})).toMatchObject({type:"rectangle",x:410,y:514})});
});
