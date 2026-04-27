import { describe, it, expect } from "vitest";
import { LuaLinter } from "../src/tools/lua-linter.js";

const linter = new LuaLinter();

describe("LuaLinter", () => {
  it("flags deprecated globals (getglobal, this)", () => {
    const code = [
      "local f = getglobal('PlayerFrame')",
      "this:Hide()",
    ].join("\n");
    const report = linter.lint(code);
    const rules = report.issues.map((i) => i.rule);
    expect(rules).toContain("no-getglobal");
    expect(rules).toContain("no-this-keyword");
    expect(report.summary.errors + report.summary.warnings).toBeGreaterThan(0);
  });

  it("ignores line-rule patterns that appear inside line comments", () => {
    const code = "local ADDON_NAME, ns = ...\n-- this and getglobal in a comment should not trigger\n";
    const report = linter.lint(code);
    const lineRuleHits = report.issues.filter(
      (i) => i.rule === "no-getglobal" || i.rule === "no-this-keyword"
    );
    expect(lineRuleHits).toHaveLength(0);
  });

  it("suppresses secure-call warning when InCombatLockdown guard is nearby", () => {
    const code = [
      "if not InCombatLockdown() then",
      "    frame:SetAttribute('type', 'spell')",
      "end",
    ].join("\n");
    const report = linter.lint(code);
    const hasSecureWarning = report.issues.some((i) => i.rule === "secure-call-needs-combat-check");
    expect(hasSecureWarning).toBe(false);
  });

  it("warns about unfiltered unit events", () => {
    const code = "frame:RegisterEvent('UNIT_AURA')";
    const report = linter.lint(code);
    expect(report.issues.some((i) => i.rule === "register-unfiltered-unit-event")).toBe(true);
  });

  it("detects events registered without a handler when no dispatcher is present", () => {
    const code = [
      "local frame = CreateFrame('Frame')",
      "frame:RegisterEvent('PLAYER_LOGIN')",
    ].join("\n");
    const report = linter.lint(code);
    expect(report.issues.some((i) => i.rule === "register-without-handler")).toBe(true);
  });

  it("does NOT flag missing handler when a self[event] dispatcher is used", () => {
    const code = [
      "frame:SetScript('OnEvent', function(_, event, ...) self[event](self, ...) end)",
      "frame:RegisterEvent('PLAYER_LOGIN')",
    ].join("\n");
    const report = linter.lint(code);
    expect(report.issues.some((i) => i.rule === "register-without-handler")).toBe(false);
  });

  it("listRules returns at least the line rules", () => {
    const rules = linter.listRules();
    expect(rules.length).toBeGreaterThan(5);
    expect(rules.find((r) => r.rule === "no-getglobal")).toBeTruthy();
  });
});
