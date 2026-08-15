/// <reference types="vite/client" />
interface Window { EXCALIDRAW_ASSET_PATH: string }
declare module "node:fs" { export function readFileSync(path:URL,encoding:"utf8"):string }
