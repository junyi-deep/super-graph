import { describe,expect,it } from "vitest";
import { canShowDelete,groupDrawings } from "./directory";
const base={id:"1",name:"n",updatedBy:null,createdAt:0,updatedAt:0,imageUrl:"/x",scene:undefined,space:"user" as const,folderId:null,projectId:null,type:"excalidraw" as const};
describe("directory",()=>{it("groups by owner",()=>{const grouped=groupDrawings([{...base,owner:{id:"a",username:"alice"},canDelete:true},{...base,id:"2",owner:{id:"b",username:"bob"},canDelete:false}]);expect(Object.keys(grouped)).toEqual(["alice","bob"])});it("uses server permission for delete",()=>{expect(canShowDelete({...base,owner:{id:"a",username:"alice"},canDelete:false})).toBe(false)})});
