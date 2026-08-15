import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const appURL = process.env.E2E_APP_URL || "http://localhost:5173";
const chromeBinary =
  process.env.CHROME_BIN ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "google-chrome");
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "super-graph-e2e-"));
const chrome = spawn(
  chromeBinary,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForJSON = async (url) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error("Chrome DevTools endpoint did not start");
};

class CDP {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || [])
        listener(message.params);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    this.listeners.set(method, [
      ...(this.listeners.get(method) || []),
      listener,
    ]);
  }
  close() {
    this.socket.close();
  }
}

const evaluate = async (cdp, expression) => {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || "Evaluation failed");
  return result.result.value;
};
const waitFor = async (cdp, expression, label) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(cdp, expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const drag = async (cdp, source, target) => {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: source.x,
    y: source.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: source.x,
    y: source.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: source.x + ((target.x - source.x) * step) / 12,
      y: source.y + ((target.y - source.y) * step) / 12,
      button: "left",
      buttons: 1,
    });
    await sleep(35);
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.x,
    y: target.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
};
const positions = (sourceId, targetId, _compact, targetHalf) => `(() => {
  const sourceRow = document.querySelector('.tree-row.file:has(a[href="/d/${sourceId}"])');
  const targetRow = document.querySelector('.tree-row.file:has(a[href="/d/${targetId}"])');
  const source = sourceRow?.querySelector('.file-drag-handle');
  if (!source || !targetRow) return null;
  const s = source.getBoundingClientRect();
  const t = targetRow.getBoundingClientRect();
  return {
    source: { x: s.left + s.width / 2, y: s.top + s.height / 2 },
    target: { x: t.left + Math.min(t.width / 2, 80), y: t.top + t.height * ${targetHalf} }
  };
})()`;
const uiOrder = `Array.from(document.querySelectorAll('.tree-row.file a[href^="/d/"]')).map(a => a.getAttribute('href').slice(3))`;

let cdp;
let ids = [];
let folderId = "";
try {
  await waitForJSON(`http://127.0.0.1:${port}/json/version`);
  const page = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(appURL)}`,
    { method: "PUT" },
  ).then((response) => response.json());
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  let reorderRequests = 0;
  cdp.on("Network.requestWillBeSent", ({ request }) => {
    if (request.url.endsWith("/api/tree/reorder") && request.method === "PATCH")
      reorderRequests += 1;
  });
  await waitFor(cdp, "document.readyState === 'complete'", "initial page");

  const fixture = await evaluate(cdp, `(async () => {
    const json = async (url, options) => {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(url + ': ' + response.status + ' ' + await response.text());
      return response.status === 204 ? null : response.json();
    };
    const username = 'e2e-drag-' + Date.now();
    const user = await json('/api/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({username, password:'123456'})
    });
    const folder = await json('/api/folders', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({name:'拖动验证', space:'user', userId:user.id})
    });
    const drawings = [];
    for (const name of ['A-拖动验证','B-拖动验证','C-拖动验证']) {
      drawings.push(await json('/api/drawings', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name, space:'user', folderId:folder.id})
      }));
    }
    localStorage.setItem('super-graph:tree-expanded:' + user.id,
      JSON.stringify({user:['user:' + user.id, folder.id], project:[]}));
    localStorage.setItem('super-graph:file-sidebar-open', 'true');
    return {userId:user.id, folderId:folder.id, ids:drawings.map(item => item.id)};
  })()`);
  ids = fixture.ids;
  folderId = fixture.folderId;

  await evaluate(cdp, "location.href='/'");
  await waitFor(cdp, `document.querySelectorAll('.tree-row.file').length === 3`, "main file tree");
  let points = await evaluate(cdp, positions(ids[0], ids[1], false, 0.8));
  if (!points) throw new Error("Main tree drag points not found");
  await drag(cdp, points.source, points.target);
  await waitFor(cdp, `${uiOrder}[0] === ${JSON.stringify(ids[1])}`, "main tree reorder");
  const mainUI = await evaluate(cdp, uiOrder);
  const mainAPI = await evaluate(cdp, `fetch('/api/tree?mode=user&parentId=${folderId}').then(r=>r.json()).then(t=>t.drawings.map(d=>d.id))`);
  if (mainUI.join() !== [ids[1], ids[0], ids[2]].join())
    throw new Error(`Main UI order incorrect: ${mainUI}`);
  if (mainAPI.join() !== mainUI.join())
    throw new Error(`Main API order incorrect: ${mainAPI}`);

  await evaluate(cdp, `location.href='/d/${ids[0]}'`);
  await waitFor(cdp, `document.querySelectorAll('.editor-file-sidebar .tree-row.file').length === 3`, "editor sidebar tree");
  points = await evaluate(cdp, positions(ids[2], ids[1], true, 0.2));
  if (!points) throw new Error("Sidebar drag points not found");
  await drag(cdp, points.source, points.target);
  await waitFor(cdp, `${uiOrder}[0] === ${JSON.stringify(ids[2])}`, "sidebar tree reorder");
  const sidebarUI = await evaluate(cdp, uiOrder);
  const sidebarAPI = await evaluate(cdp, `fetch('/api/tree?mode=user&parentId=${folderId}').then(r=>r.json()).then(t=>t.drawings.map(d=>d.id))`);
  if (sidebarUI.join() !== [ids[2], ids[1], ids[0]].join())
    throw new Error(`Sidebar UI order incorrect: ${sidebarUI}`);
  if (sidebarAPI.join() !== sidebarUI.join())
    throw new Error(`Sidebar API order incorrect: ${sidebarAPI}`);
  if (reorderRequests !== 2)
    throw new Error(`Expected 2 reorder PATCH requests, received ${reorderRequests}`);

  console.log(JSON.stringify({
    ok: true,
    mainUI,
    mainAPI,
    sidebarUI,
    sidebarAPI,
    reorderRequests,
  }, null, 2));
} finally {
  if (cdp && ids.length) {
    try {
      await evaluate(cdp, `(async()=>{
        for (const id of ${JSON.stringify(ids)}) await fetch('/api/drawings/' + id, {method:'DELETE'});
        await fetch('/api/folders/${folderId}', {method:'DELETE'});
      })()`);
    } catch {
      // Keep the original test failure; fixture cleanup is best-effort.
    }
  }
  cdp?.close();
  if (chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGTERM");
    await Promise.race([exited, sleep(2000)]);
  }
  rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
