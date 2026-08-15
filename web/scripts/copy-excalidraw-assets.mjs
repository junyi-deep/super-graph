import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const source = resolve(
  webDirectory,
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
);
const destination = resolve(
  webDirectory,
  "../internal/frontend/dist/fonts",
);

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

console.log(`Copied Excalidraw fonts to ${destination}`);
