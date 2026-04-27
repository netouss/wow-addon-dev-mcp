import { describe, it, expect } from "vitest";
import { ApiMigration } from "../src/tools/api-migration.js";

const migrator = new ApiMigration();

describe("ApiMigration", () => {
  it("detects deprecated container APIs", async () => {
    const code = "local info = GetContainerItemInfo(0, 1)";
    const report = await migrator.checkDeprecations(code);
    expect(report.deprecated.length).toBe(1);
    expect(report.deprecated[0].replacement).toBe("C_Container.GetContainerItemInfo");
  });

  it("ignores deprecated calls that appear inside a comment", async () => {
    const code = "-- GetSpellInfo(123) is deprecated";
    const report = await migrator.checkDeprecations(code);
    expect(report.deprecated).toHaveLength(0);
  });

  it("returns 'no migration' for unknown functions when no parser is available", async () => {
    const result = await migrator.suggestMigration("TotallyMadeUpFn");
    expect(result.replacement).toBe("unknown");
  });

  it("suggests known migrations with a code example", async () => {
    const result = await migrator.suggestMigration("UnitBuff");
    expect(result.replacement).toContain("C_UnitAuras");
    expect(result.codeExample).toContain("OLD");
    expect(result.codeExample).toContain("NEW");
  });
});
