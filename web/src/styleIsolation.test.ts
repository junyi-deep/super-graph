import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("third-party canvas style isolation",()=>{
  it("loads Excalidraw's official stylesheet",()=>{const main=readFileSync(new URL("./main.tsx",import.meta.url),"utf8");expect(main).toContain('import "@excalidraw/excalidraw/index.css"')});
  it("uses Tailwind utilities without the global preflight reset",()=>{const css=readFileSync(new URL("./style.css",import.meta.url),"utf8");expect(css).toContain('tailwindcss/utilities.css');expect(css).not.toContain('@import "tailwindcss";');expect(css).not.toContain('tailwindcss/preflight.css')});
});
