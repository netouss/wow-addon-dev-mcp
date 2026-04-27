/**
 * Static analysis for WoW addon Lua code.
 *
 * Detects common addon pitfalls that the Lua interpreter alone will not catch:
 * combat-protected calls without InCombatLockdown(), forgotten `local` keywords,
 * heavy work in OnUpdate, missing event unregistration, deprecated globals, etc.
 *
 * Designed to work without wow-ui-source — purely pattern-based.
 */

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  line: number;
  column: number;
  message: string;
  suggestion?: string;
  snippet: string;
}

export interface LintReport {
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    linesScanned: number;
  };
}

interface LineRule {
  rule: string;
  severity: LintSeverity;
  pattern: RegExp;
  message: string;
  suggestion?: string;
  /** Optional negative-context predicate. Returns true to skip this match. */
  ignoreIf?: (line: string, allLines: string[], idx: number) => boolean;
}

/**
 * Per-line rules. Each pattern is matched against the code-only portion of the
 * line (with line comments stripped) so we don't flag matches inside `--` text.
 */
const LINE_RULES: LineRule[] = [
  {
    rule: "no-print-debug",
    severity: "info",
    pattern: /\bprint\s*\(/,
    message: "Bare print() call — consider a namespaced debug helper",
    suggestion: "Replace with a guarded debug function (e.g. ns:Debug(...)).",
  },
  {
    rule: "no-getglobal",
    severity: "warning",
    pattern: /\bgetglobal\s*\(/,
    message: "getglobal() is deprecated",
    suggestion: "Use _G[\"Name\"] for explicit global access.",
  },
  {
    rule: "no-setglobal",
    severity: "warning",
    pattern: /\bsetglobal\s*\(/,
    message: "setglobal() is deprecated",
    suggestion: "Assign directly via _G[\"Name\"] = value.",
  },
  {
    rule: "no-this-keyword",
    severity: "error",
    pattern: /(^|[^.\w])this\b/,
    message: "Implicit 'this' is not available in modern WoW",
    suggestion: "Use the explicit `self` parameter from your script handler.",
  },
  {
    rule: "no-arg-table",
    severity: "warning",
    pattern: /(^|[^.\w])arg\b\s*\[/,
    message: "Implicit 'arg' table is Lua 5.0 — disabled in WoW",
    suggestion: "Use the `...` varargs and `select()` instead.",
  },
  {
    rule: "tainted-securehook-target",
    severity: "warning",
    pattern: /\bSecureHookScript\s*\(\s*nil/,
    message: "SecureHookScript called with nil frame argument",
    suggestion: "Pass the frame whose script you want to hook as the first argument.",
  },
  {
    rule: "secure-call-needs-combat-check",
    severity: "warning",
    pattern: /:(SetAttribute|RegisterUnitWatch|SetMacroText|Show|Hide)\s*\(/,
    message: "Possible secure-frame call — wrap in InCombatLockdown() guard",
    suggestion: "if not InCombatLockdown() then frame:SetAttribute(...) end",
    ignoreIf: (_line, all, i) => containsNearby(all, i, /InCombatLockdown\s*\(/, 5),
  },
  {
    rule: "tostring-on-frame",
    severity: "info",
    pattern: /tostring\s*\(\s*self\s*\)/,
    message: "tostring(self) on a frame returns the userdata address — use self:GetName() if you need a name",
  },
  {
    rule: "missing-pcall-around-c-namespace",
    severity: "info",
    pattern: /=\s*C_(\w+)\.(\w+)\s*\(/,
    message: "C_* API may return nil for invalid input — guard the result before use",
    ignoreIf: (line) => /\bif\b|\band\b|\bor\b|local\s+\w+\s*=\s*C_/.test(line),
  },
  {
    rule: "onupdate-without-throttle",
    severity: "warning",
    pattern: /SetScript\s*\(\s*["']OnUpdate["']/,
    message: "OnUpdate handler — ensure you throttle work to avoid per-frame overhead",
    suggestion: "Accumulate elapsed time (self.elapsed = (self.elapsed or 0) + elapsed) and only act every N seconds.",
  },
  {
    rule: "table-create-in-loop",
    severity: "info",
    pattern: /\bfor\b.*\bdo\b.*\{\s*\}/,
    message: "Table allocation inside a loop body — hoist the table out of the loop if possible",
  },
  {
    rule: "global-leak-uppercase",
    severity: "warning",
    // function FOO() — declared without `local`
    pattern: /^(?!\s*local\s)\s*function\s+([A-Z]\w*)\s*\(/,
    message: "Top-level function appears to leak into the global namespace",
    suggestion: "Prefix with `local`, or attach to your addon namespace (e.g. ns.Foo = function() ... end).",
  },
  {
    rule: "register-unfiltered-unit-event",
    severity: "info",
    pattern: /:RegisterEvent\s*\(\s*["'](UNIT_AURA|UNIT_HEALTH|UNIT_POWER_UPDATE|UNIT_SPELLCAST_SUCCEEDED)["']\s*\)/,
    message: "Unit event registered without unit filter — high CPU cost",
    suggestion: "Use frame:RegisterUnitEvent(\"EVENT\", \"player\", \"target\") to only fire for relevant units.",
  },
  {
    rule: "saved-variables-init-without-load",
    severity: "warning",
    // Heuristic: SavedVariables global referenced before any ADDON_LOADED handler in file.
    pattern: /\b\w+DB\s*=\s*\w+DB\s+or\s+\{\}/,
    message: "SavedVariables initialization detected — make sure this runs after ADDON_LOADED for your addon",
    ignoreIf: (_line, all, i) => containsNearby(all, i, /ADDON_LOADED/, 10),
  },
];

/**
 * Whole-file rules — run once over the joined source to catch structural issues.
 */
interface FileRule {
  rule: string;
  severity: LintSeverity;
  check: (source: string, lines: string[]) => LintIssue[];
}

const FILE_RULES: FileRule[] = [
  {
    rule: "missing-addon-namespace",
    severity: "info",
    check(_source, lines) {
      const hasNs = lines.some((l) => /local\s+(ADDON_NAME|addonName)\s*,\s*ns\s*=\s*\.{3}/.test(l));
      if (hasNs) return [];
      return [
        {
          rule: "missing-addon-namespace",
          severity: "info",
          line: 1,
          column: 1,
          message: "File doesn't declare the addon namespace via `local ADDON_NAME, ns = ...`",
          suggestion: "Add `local ADDON_NAME, ns = ...` at the top to use the shared namespace table.",
          snippet: lines[0] ?? "",
        },
      ];
    },
  },
  {
    rule: "register-without-handler",
    severity: "warning",
    check(_source, lines) {
      const issues: LintIssue[] = [];
      const registered = new Map<string, number>();
      const handled = new Set<string>();

      const regRegex = /:RegisterE?vent\s*\(\s*["']([A-Z_]+)["']/;
      const fnRegex = /function\s+[\w.:]+:([A-Z_]+)\s*\(/;
      const dispatchRegex = /\bself\s*\[\s*event\s*\]/;

      let usesDispatcher = false;

      lines.forEach((line, i) => {
        const code = stripComment(line);
        const reg = regRegex.exec(code);
        if (reg) registered.set(reg[1], i + 1);
        const fn = fnRegex.exec(code);
        if (fn) handled.add(fn[1]);
        if (dispatchRegex.test(code)) usesDispatcher = true;
      });

      if (usesDispatcher) return [];

      for (const [event, line] of registered) {
        if (!handled.has(event)) {
          issues.push({
            rule: "register-without-handler",
            severity: "warning",
            line,
            column: 1,
            message: `Event '${event}' is registered but has no matching handler function (no self.${event}() and no event dispatcher detected)`,
            suggestion: `Define function MyAddon:${event}(...) end, or wire a dispatcher: frame:SetScript("OnEvent", function(_, e, ...) self[e](self, ...) end).`,
            snippet: lines[line - 1] ?? "",
          });
        }
      }
      return issues;
    },
  },
];

/** Returns true if any of the surrounding `±radius` lines matches `pattern`. */
function containsNearby(
  lines: string[],
  index: number,
  pattern: RegExp,
  radius: number
): boolean {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length - 1, index + radius);
  for (let i = start; i <= end; i++) {
    if (pattern.test(lines[i])) return true;
  }
  return false;
}

/** Strip a Lua line comment from a line, preserving content inside strings. */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === "-" && line[i + 1] === "-") {
      return line.slice(0, i);
    }
  }
  return line;
}

export class LuaLinter {
  lint(luaCode: string, options: { rules?: string[] } = {}): LintReport {
    const lines = luaCode.split("\n");
    const issues: LintIssue[] = [];
    const enabledRules = options.rules && options.rules.length > 0
      ? new Set(options.rules)
      : null;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const code = stripComment(rawLine);
      if (!code.trim()) continue;

      for (const rule of LINE_RULES) {
        if (enabledRules && !enabledRules.has(rule.rule)) continue;
        const match = rule.pattern.exec(code);
        if (!match) continue;
        if (rule.ignoreIf?.(code, lines, i)) continue;

        issues.push({
          rule: rule.rule,
          severity: rule.severity,
          line: i + 1,
          column: (match.index ?? 0) + 1,
          message: rule.message,
          suggestion: rule.suggestion,
          snippet: rawLine.trim(),
        });
      }
    }

    for (const rule of FILE_RULES) {
      if (enabledRules && !enabledRules.has(rule.rule)) continue;
      issues.push(...rule.check(luaCode, lines));
    }

    issues.sort((a, b) => a.line - b.line || a.column - b.column);

    return {
      issues,
      summary: {
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        infos: issues.filter((i) => i.severity === "info").length,
        linesScanned: lines.length,
      },
    };
  }

  /** Returns the catalog of rules this linter knows about. */
  listRules(): Array<{ rule: string; severity: LintSeverity; description: string }> {
    return [
      ...LINE_RULES.map((r) => ({ rule: r.rule, severity: r.severity, description: r.message })),
      ...FILE_RULES.map((r) => ({ rule: r.rule, severity: r.severity, description: r.rule })),
    ];
  }
}
