import { describe,expect,it } from "vitest";
import { buildHeatmap } from "./StatsPanel";

describe("buildHeatmap",()=>{
  const activity=[{date:"2026-08-03",count:3,created:1,updated:2}];
  it("builds complete calendar weeks for the month view",()=>{const model=buildHeatmap(activity,"month",new Date("2026-08-15T12:00:00"));expect(model.cells.length%7).toBe(0);expect(model.cells.find(item=>item?.date==="2026-08-03")).toMatchObject({created:1,updated:2,count:3})});
  it("builds roughly one year of cells",()=>{const model=buildHeatmap(activity,"year",new Date("2026-08-15T12:00:00"));expect(model.cells.length).toBeGreaterThanOrEqual(365);expect(model.columns).toBeGreaterThanOrEqual(52)});
});
