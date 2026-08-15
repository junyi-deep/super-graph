import type { SpaceMode, TreeData } from "../types";

export type TreeSearchResult={rootIds:Set<string>;folderIds:Set<string>;drawingIds:Set<string>};

export function buildTreeSearch(data:TreeData,mode:SpaceMode,query:string):TreeSearchResult{
  const roots=mode==="user"?data.users:data.projects;
  const folders=data.folders.filter(folder=>folder.space===mode);
  const drawings=data.drawings.filter(drawing=>drawing.space===mode);
  const all={rootIds:new Set(roots.map(root=>root.id)),folderIds:new Set(folders.map(folder=>folder.id)),drawingIds:new Set(drawings.map(drawing=>drawing.id))};
  const needle=query.trim().toLocaleLowerCase();
  if(!needle)return all;
  const result:TreeSearchResult={rootIds:new Set(),folderIds:new Set(),drawingIds:new Set()};
  const folderById=new Map(folders.map(folder=>[folder.id,folder]));
  const rootIdForFolder=(folder:typeof folders[number])=>mode==="user"?folder.userId:folder.projectId;
  const rootIdForDrawing=(drawing:typeof drawings[number])=>mode==="user"?drawing.owner.id:drawing.projectId;
  const includeFolder=(folderId:string|null)=>{let current=folderId;while(current){const folder=folderById.get(current);if(!folder)break;result.folderIds.add(folder.id);const rootId=rootIdForFolder(folder);if(rootId)result.rootIds.add(rootId);current=folder.parentId}};
  const includeFolderTree=(folderId:string)=>{result.folderIds.add(folderId);for(const drawing of drawings)if(drawing.folderId===folderId)result.drawingIds.add(drawing.id);for(const child of folders)if(child.parentId===folderId)includeFolderTree(child.id)};
  for(const folder of folders)if(folder.name.toLocaleLowerCase().includes(needle)){includeFolder(folder.id);includeFolderTree(folder.id)}
  for(const drawing of drawings)if(drawing.name.toLocaleLowerCase().includes(needle)){result.drawingIds.add(drawing.id);const rootId=rootIdForDrawing(drawing);if(rootId)result.rootIds.add(rootId);includeFolder(drawing.folderId)}
  for(const root of roots)if(("username" in root?root.username:root.name).toLocaleLowerCase().includes(needle)){
    result.rootIds.add(root.id);
    for(const folder of folders)if(rootIdForFolder(folder)===root.id)result.folderIds.add(folder.id);
    for(const drawing of drawings)if(rootIdForDrawing(drawing)===root.id)result.drawingIds.add(drawing.id);
  }
  return result;
}
