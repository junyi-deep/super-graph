import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const [server, room, cookie, clientsArg = "2", updatesArg = "1"] = process.argv.slice(2);
if (!server || !room || !cookie) throw new Error("usage: node collaboration-spike.mjs WS_URL ROOM COOKIE [CLIENTS] [UPDATES_PER_CLIENT]");
const clientCount = Number.parseInt(clientsArg, 10);
const updatesPerClient = Number.parseInt(updatesArg, 10);
if (!Number.isInteger(clientCount) || clientCount < 2 || !Number.isInteger(updatesPerClient) || updatesPerClient < 1)
  throw new Error("CLIENTS must be >= 2 and UPDATES_PER_CLIENT must be >= 1");
class SessionWebSocket extends WebSocket {
  constructor(address, protocols) { super(address, protocols, { headers: { Cookie: cookie } }); }
}
const docs = Array.from({ length: clientCount }, () => new Y.Doc());
const providers = docs.map(doc => new WebsocketProvider(server, room, doc, { WebSocketPolyfill: SessionWebSocket }));
const waitFor = (test, label) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`timeout: ${label}`)), 5000);
  const poll = () => test() ? (clearTimeout(timeout), resolve()) : setTimeout(poll, 20);
  poll();
});
try {
  await waitFor(() => providers.every(provider => provider.synced), "providers synced");
  providers.forEach((provider, index) => provider.awareness.setLocalStateField("user", { userId: `u${index}`, username: `user-${index}` }));
  const startedAt = performance.now();
  docs.forEach((doc, client) => {
    const shared = doc.getMap("spike");
    for (let update = 0; update < updatesPerClient; update++)
      shared.set(`${client}:${update}`, `client-${client}-update-${update}`);
  });
  const expected = clientCount * updatesPerClient;
  await waitFor(() => docs.every(doc => doc.getMap("spike").size >= expected), "concurrent CRDT convergence");
  await waitFor(() => providers.every(provider => provider.awareness.getStates().size >= clientCount), "awareness");
  const elapsed = Math.round(performance.now() - startedAt);
  console.log(`collaboration spike passed: ${clientCount} clients, ${expected} updates, ${elapsed}ms`);
} finally {
  providers.forEach(provider => provider.destroy());
  docs.forEach(doc => doc.destroy());
}
