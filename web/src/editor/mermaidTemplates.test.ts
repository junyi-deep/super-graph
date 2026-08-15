// @vitest-environment jsdom
import { describe,expect,it } from "vitest";
import mermaid from "mermaid";
import { MERMAID_TEMPLATES } from "./mermaidTemplates";

describe("Mermaid templates",()=>{
  it("offers every Visimer editable diagram family",()=>{expect(MERMAID_TEMPLATES).toHaveLength(22)});
  it("uses unique ids and non-empty source",()=>{expect(new Set(MERMAID_TEMPLATES.map(item=>item.id)).size).toBe(MERMAID_TEMPLATES.length);expect(MERMAID_TEMPLATES.every(item=>item.code.includes("\n"))).toBe(true)});
  for(const template of MERMAID_TEMPLATES)it(`parses the ${template.id} template`,async()=>{await expect(mermaid.parse(template.code)).resolves.toBeTruthy()});
});
