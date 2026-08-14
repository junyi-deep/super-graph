import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const [server, room, cookie] = process.argv.slice(2);
if (!server || !room || !cookie) throw new Error("usage: node collaboration-spike.mjs WS_URL ROOM COOKIE");
class SessionWebSocket extends WebSocket {
  constructor(address, protocols) { super(address, protocols, { headers: { Cookie: cookie } }); }
}
const a = new Y.Doc(), b = new Y.Doc();
const pa = new WebsocketProvider(server, room, a, { WebSocketPolyfill: SessionWebSocket });
const pb = new WebsocketProvider(server, room, b, { WebSocketPolyfill: SessionWebSocket });
const waitFor = (test, label) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`timeout: ${label}`)), 5000);
  const poll = () => test() ? (clearTimeout(timeout), resolve()) : setTimeout(poll, 20);
  poll();
});
try {
  await waitFor(() => pa.synced && pb.synced, "providers synced");
  pa.awareness.setLocalStateField("user", { userId: "a", username: "alice" });
  a.getMap("spike").set("message", "A to B through Go");
  await waitFor(() => b.getMap("spike").get("message") === "A to B through Go", "CRDT update");
  await waitFor(() => [...pb.awareness.getStates().values()].some(s => s.user?.username === "alice"), "awareness");
  console.log("collaboration spike passed: sync + awareness");
} finally { pa.destroy(); pb.destroy(); a.destroy(); b.destroy(); }
