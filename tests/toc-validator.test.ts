import { describe, it, expect } from "vitest";
import { TocValidator } from "../src/tools/toc-validator.js";

const validator = new TocValidator();

describe("TocValidator", () => {
  it("flags missing required fields", () => {
    const result = validator.validate("# empty toc\n");
    expect(result.valid).toBe(false);
    const messages = result.errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("Interface"))).toBe(true);
    expect(messages.some((m) => m.includes("Title"))).toBe(true);
  });

  it("accepts a well-formed multi-version TOC", () => {
    const toc = [
      "## Interface: 120000, 110207",
      "## Title: MyAddon",
      "## SavedVariables: MyAddonDB",
      "main.lua",
    ].join("\n");
    const result = validator.validate(toc, "MyAddon");
    expect(result.valid).toBe(true);
    expect(result.parsed.interfaceVersions).toEqual(["120000", "110207"]);
    expect(result.parsed.savedVariables).toEqual(["MyAddonDB"]);
  });

  it("warns on backslashes in file paths", () => {
    const toc = [
      "## Interface: 110207",
      "## Title: BS",
      "Modules\\Foo.lua",
    ].join("\n");
    const result = validator.validate(toc);
    expect(result.warnings.some((w) => w.message.includes("Backslash"))).toBe(true);
  });

  it("rejects malformed Interface versions", () => {
    const result = validator.validate("## Interface: abc\n## Title: T\nmain.lua\n");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Invalid Interface"))).toBe(true);
  });
});
