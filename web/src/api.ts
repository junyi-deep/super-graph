import type {
  CollaborationStatus,
  Drawing,
  DrawingActivity,
  DrawingType,
  Folder,
  GlobalSettings,
  Project,
  SpaceMode,
  Stats,
  TreeData,
  User,
} from "./types";

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string")
    headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new APIError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
type DrawingLocation = {
  space?: SpaceMode;
  folderId?: string | null;
  projectId?: string | null;
  type?: DrawingType;
  mermaidCode?: string;
};
export const api = {
  me: () => request<User>("/api/me"),
  login: (username: string, password: string) =>
    request<User>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/logout", { method: "POST" }),
  drawings: (mine = false) =>
    request<Drawing[]>(`/api/drawings${mine ? "?mine=1" : ""}`),
  drawing: (id: string) => request<Drawing>(`/api/drawings/${id}`),
  create: (name: string, location: DrawingLocation = {}) =>
    request<Drawing>("/api/drawings", {
      method: "POST",
      body: JSON.stringify({ name, ...location }),
    }),
  rename: (id: string, name: string) =>
    request<Drawing>(`/api/drawings/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  remove: (id: string) =>
    request<void>(`/api/drawings/${id}`, { method: "DELETE" }),
  tree: (query?: {
    mode?: SpaceMode;
    rootId?: string;
    parentId?: string;
    q?: string;
  }) => {
    const params = new URLSearchParams();
    if (query)
      for (const [key, value] of Object.entries(query))
        if (value) params.set(key, value);
    return request<TreeData>(`/api/tree${params.size ? `?${params}` : ""}`);
  },
  stats: () => request<Stats>("/api/stats"),
  createFolder: (input: {
    name: string;
    space: SpaceMode;
    userId?: string | null;
    projectId?: string | null;
    parentId?: string | null;
  }) =>
    request<Folder>("/api/folders", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  renameFolder: (id: string, name: string) =>
    request<void>(`/api/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  removeFolder: (id: string) =>
    request<void>(`/api/folders/${id}`, { method: "DELETE" }),
  createProject: (name: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameProject: (id: string, name: string) =>
    request<void>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  removeProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  config: () =>
    request<{ autosaveIntervalMs: number; maxDocumentEditors: number }>(
      "/api/config",
    ),
  changePassword: (password: string) =>
    request<void>("/api/password", {
      method: "PATCH",
      body: JSON.stringify({ password }),
    }),
  adminSettings: () => request<GlobalSettings>("/api/admin/settings"),
  updateAdminSettings: (settings: GlobalSettings) =>
    request<GlobalSettings>("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    }),
  updateUser: (id: string, input: { blocked?: boolean; password?: string }) =>
    request<void>(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  removeUser: (id: string) =>
    request<void>(`/api/admin/users/${id}`, { method: "DELETE" }),
  favorite: (id: string, value: boolean) =>
    request<void>(`/api/drawings/${id}/favorite`, {
      method: value ? "PUT" : "DELETE",
    }),
  relocate: (
    id: string,
    input: {
      operation: "copy" | "move";
      name: string;
      space: SpaceMode;
      folderId?: string | null;
      projectId?: string | null;
    },
  ) =>
    request<Drawing>(`/api/drawings/${id}/relocate`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  collaboration: (id: string) =>
    request<CollaborationStatus>(`/api/drawings/${id}/collaboration`),
  updateCollaboration: (
    id: string,
    input: {
      enabled?: boolean;
      limit?: number;
      userId?: string;
      canEdit?: boolean;
    },
  ) =>
    request<CollaborationStatus>(`/api/drawings/${id}/collaboration`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  drawingActivity: (id: string) =>
    request<DrawingActivity[]>(`/api/drawings/${id}/activity`),
  reorder: (
    items: {
      kind: "folder" | "drawing" | "project";
      id: string;
      order: number;
    }[],
  ) =>
    request<void>("/api/tree/reorder", {
      method: "PATCH",
      body: JSON.stringify({ items }),
    }),
  autosave: (id: string, scene: unknown, image: Blob) => {
    const form = new FormData();
    form.append("scene", JSON.stringify(scene));
    form.append("image", image, "drawing.png");
    return request<{ savedAt: number }>(`/api/drawings/${id}/autosave`, {
      method: "PUT",
      body: form,
    });
  },
};
