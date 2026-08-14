import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const source = resolve(
  webDirectory,
  "node_modules/@excalidraw/excalidraw/dist/excalidraw-assets",
);
const destination = resolve(
  webDirectory,
  "../internal/frontend/dist/excalidraw-assets",
);

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

console.log(`Copied Excalidraw assets to ${destination}`);
