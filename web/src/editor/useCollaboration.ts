import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { generateNKeysBetween } from "fractional-indexing";
import { ExcalidrawBinding } from "y-excalidraw";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import type { Scene, User } from "../types";

const colors = [
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#9c36b5",
  "#f08c00",
  "#0c8599",
];
export type CollaboratorUser = {
  id: string;
  username: string;
  color: string;
  self?: boolean;
};
export function useCollaboration(
  id: string,
  user: User,
  api: ExcalidrawImperativeAPI | null,
  scene: Scene,
  root: RefObject<HTMLDivElement>,
  canEdit: boolean,
) {
  const [pointerHandler, setPointerHandler] = useState<
    ((payload: any) => void) | undefined
  >();
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<CollaboratorUser[]>([]);
  useEffect(() => {
    if (!api || !root.current) return;
    const doc = new Y.Doc();
    const yElements = doc.getArray<Y.Map<any>>("elements");
    const yAssets = doc.getMap<any>("assets");
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const provider = new WebsocketProvider(
      `${protocol}://${location.host}/api/collaboration`,
      id,
      doc,
      { connect: true },
    );
    const color =
      colors[
        Math.abs(user.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0)) %
          colors.length
      ];
    provider.awareness.setLocalStateField("user", {
      userId: user.id,
      username: user.username,
      name: user.username,
      color,
      colorLight: color + "33",
      role: canEdit ? "edit" : "view",
    });
    const updateUsers = () => {
      const unique = new Map<string, CollaboratorUser>();
      for (const state of provider.awareness.getStates().values()) {
        if (state.user?.userId)
          unique.set(state.user.userId, {
            id: state.user.userId,
            username: state.user.username || state.user.name || "协作者",
            color: state.user.color || "#6965db",
            self: state.user.userId === user.id,
          });
      }
      setUsers([...unique.values()]);
    };
    let binding: ExcalidrawBinding | undefined;
    const onStatus = ({ status }: { status: string }) =>
      setConnected(status === "connected");
    provider.on("status", onStatus);
    provider.awareness.on("change", updateUsers);
    updateUsers();
    const onSync = (synced: boolean) => {
      if (!synced || binding) return;
      doc.transact(() => {
        for (let i = yElements.length - 1; i >= 0; i--) {
          const entry = yElements.get(i);
          if (!(entry instanceof Y.Map) || !entry.get("el")?.id)
            yElements.delete(i, 1);
        }
      });
      if (yElements.length === 0 && scene.elements.length) {
        const keys = generateNKeysBetween(null, null, scene.elements.length);
        doc.transact(() => {
          yElements.push(
            scene.elements.map(
              (el, i) =>
                new Y.Map(Object.entries({ pos: keys[i], el: { ...el } })),
            ),
          );
          for (const [key, file] of Object.entries(scene.files))
            yAssets.set(key, file);
        });
      }
      binding = new ExcalidrawBinding(
        yElements,
        yAssets,
        api,
        provider.awareness,
      );
      setPointerHandler(() => binding!.onPointerUpdate);
    };
    provider.on("sync", onSync);
    return () => {
      provider.off("sync", onSync);
      provider.off("status", onStatus);
      provider.awareness.off("change", updateUsers);
      binding?.destroy();
      provider.destroy();
      doc.destroy();
      setPointerHandler(undefined);
      setUsers([]);
    };
  }, [id, user.id, user.username, api, canEdit]);
  return { onPointerUpdate: pointerHandler, connected, users };
}
