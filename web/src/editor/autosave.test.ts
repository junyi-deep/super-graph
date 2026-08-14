import { describe, expect, it, vi } from "vitest";
import { AutosaveCoordinator } from "./autosave";

describe("AutosaveCoordinator",()=>{
  it("does nothing until dirty",async()=>{const save=vi.fn(async()=>{});const a=new AutosaveCoordinator();expect(await a.run(save)).toBe(false);expect(save).not.toHaveBeenCalled()});
  it("saves once and clears dirty",async()=>{const a=new AutosaveCoordinator();a.markChanged();expect(await a.run(async()=>{})).toBe(true);expect(a.isDirty()).toBe(false);expect(a.getStatus()).toBe("saved")});
  it("does not lose changes made during a save",async()=>{let release!:()=>void;const pending=new Promise<void>(r=>release=r);const a=new AutosaveCoordinator();a.markChanged();const run=a.run(()=>pending);a.markChanged();release();await run;expect(a.isDirty()).toBe(true);expect(a.getStatus()).toBe("dirty")});
  it("keeps dirty after failure so the next tick retries",async()=>{const a=new AutosaveCoordinator();a.markChanged();await a.run(async()=>{throw new Error("offline")});expect(a.isDirty()).toBe(true);expect(a.getStatus()).toBe("error");await a.run(async()=>{});expect(a.isDirty()).toBe(false)});
});
