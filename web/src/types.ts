export type User = { id: string; username: string };
export type SpaceMode = "user" | "project";
export type DrawingType = "excalidraw" | "mermaid";
export type Scene = { elements: readonly any[]; appState: Record<string, any>; files: Record<string, any> };
export type MermaidDocument = { code: string; theme: string };
export type Drawing = {
  id: string; name: string; owner: User; updatedBy: User | null; scene?: Scene | MermaidDocument;
  createdAt: number; updatedAt: number; canDelete: boolean; imageUrl: string;
  space: SpaceMode; folderId: string | null; projectId: string | null; type: DrawingType;
};
export type Folder = {
  id: string; name: string; space: SpaceMode; userId: string | null; projectId: string | null;
  parentId: string | null; createdBy: User; createdAt: number; updatedAt: number; canDelete: boolean;
};
export type Project = { id: string; name: string; createdBy: User; createdAt: number; updatedAt: number; canDelete: boolean };
export type TreeData = { users: User[]; projects: Project[]; folders: Folder[]; drawings: Drawing[] };
export type Rank = { name: string; count: number };
export type ActivityDay = { date: string; count: number };
export type Stats = { dailyActive: number; monthlyActive: number; activity: ActivityDay[]; personalFiles: Rank[]; projectFiles: Rank[] };
