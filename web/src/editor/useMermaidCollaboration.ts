import { useEffect, useRef } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import type { User } from "../types";

export function useMermaidCollaboration(
  id: string,
  user: User,
  initialCode: string,
  canEdit: boolean,
  onCode: (value: string) => void,
) {
  const textRef = useRef<Y.Text | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    const text = doc.getText("mermaid");
    textRef.current = text;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const provider = new WebsocketProvider(
      `${protocol}://${location.host}/api/collaboration`,
      id,
      doc,
      { connect: true },
    );
    provider.awareness.setLocalStateField("user", {
      userId: user.id,
      username: user.username,
      name: user.username,
      role: canEdit ? "edit" : "view",
    });
    const observe = () => onCode(text.toString());
    text.observe(observe);
    const sync = (synced: boolean) => {
      if (synced && text.length === 0 && canEdit)
        doc.transact(() => text.insert(0, initialCode));
    };
    provider.on("sync", sync);
    return () => {
      provider.off("sync", sync);
      text.unobserve(observe);
      provider.destroy();
      doc.destroy();
      textRef.current = null;
    };
  }, [id, user.id, user.username, canEdit]);
  return (value: string) => {
    const text = textRef.current;
    if (!text || !canEdit) return;
    text.doc?.transact(() => {
      text.delete(0, text.length);
      text.insert(0, value);
    });
  };
}
