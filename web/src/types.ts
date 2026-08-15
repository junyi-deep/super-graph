export type User = {
  id: string;
  username: string;
  isAdmin: boolean;
  blocked: boolean;
};
export type SpaceMode = "user" | "project";
export type DrawingType = "excalidraw" | "mermaid";
export type Scene = {
  elements: readonly any[];
  appState: Record<string, any>;
  files: Record<string, any>;
};
export type MermaidSourceTheme = "dark" | "light" | "blue";
export type MermaidDocument = {
  code: string;
  theme: string;
  editorTheme?: MermaidSourceTheme;
  canvasBackground?: string;
};
export type Drawing = {
  id: string;
  name: string;
  owner: User;
  updatedBy: User | null;
  scene?: Scene | MermaidDocument;
  createdAt: number;
  updatedAt: number;
  canDelete: boolean;
  imageUrl: string;
  space: SpaceMode;
  folderId: string | null;
  projectId: string | null;
  type: DrawingType;
  favorite: boolean;
  collaborationEnabled: boolean;
  collaboratorLimit: number;
  canEdit: boolean;
  sortOrder?: number;
};
export type Folder = {
  id: string;
  name: string;
  space: SpaceMode;
  userId: string | null;
  projectId: string | null;
  parentId: string | null;
  createdBy: User;
  createdAt: number;
  updatedAt: number;
  canDelete: boolean;
  sortOrder?: number;
};
export type Project = {
  id: string;
  name: string;
  createdBy: User;
  createdAt: number;
  updatedAt: number;
  canDelete: boolean;
  sortOrder?: number;
};
export type TreeData = {
  users: User[];
  projects: Project[];
  folders: Folder[];
  drawings: Drawing[];
};
export type Rank = { name: string; count: number };
export type ActivityDay = {
  date: string;
  count: number;
  created: number;
  updated: number;
};
export type Stats = {
  dailyActive: number;
  monthlyActive: number;
  activity: ActivityDay[];
  personalFiles: Rank[];
  projectFiles: Rank[];
};
export type GlobalSettings = {
  maxDocumentEditors: number;
  maxProjectEditors: number;
  maxGlobalEditors: number;
  defaultDrawingLimit: number;
};
export type CollaborationParticipant = {
  user: User;
  canEdit: boolean;
  online: boolean;
};
export type CollaborationStatus = {
  enabled: boolean;
  limit: number;
  maxLimit: number;
  canManage: boolean;
  canEdit: boolean;
  participants: CollaborationParticipant[];
};
export type DrawingActivity = { user: User; changedAt: number };
