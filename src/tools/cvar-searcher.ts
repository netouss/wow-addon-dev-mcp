/**
 * Console variable (CVar) lookup for wow-ui-source.
 *
 * Scans the Blizzard UI source for `RegisterCVar`, `SetCVar`, and
 * `C_CVar.GetCVar` references to surface CVar names, default values, and
 * the file/line where they're used. This is a discovery tool — it does not
 * (and cannot) replicate the full game-engine CVar table.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export interface CVarReference {
  name: string;
  defaultValue?: string;
  file: string;
  line: number;
  usage: "Set" | "Get" | "Register" | "Reference";
  snippet: string;
}

export interface CVarSummary {
  name: string;
  defaultValue?: string;
  references: number;
  files: string[];
}

export class CVarSearcher {
  private readonly basePath: string;
  private cache: CVarReference[] | null = null;

  constructor(wowUiSourcePath: string) {
    this.basePath = wowUiSourcePath;
  }

  /** Search for a CVar by name (case-insensitive substring). */
  async search(query: string, limit = 25): Promise<CVarSummary[]> {
    const refs = await this.getIndex();
    const lowerQuery = query.toLowerCase();

    const grouped = new Map<string, CVarReference[]>();
    for (const ref of refs) {
      if (!ref.name.toLowerCase().includes(lowerQuery)) continue;
      const list = grouped.get(ref.name) ?? [];
      list.push(ref);
      grouped.set(ref.name, list);
    }

    const summaries = Array.from(grouped.entries()).map(([name, group]) => ({
      name,
      defaultValue: group.find((g) => g.defaultValue !== undefined)?.defaultValue,
      references: group.length,
      files: Array.from(new Set(group.map((g) => g.file))).slice(0, 5),
    }));

    summaries.sort((a, b) => b.references - a.references || a.name.localeCompare(b.name));
    return summaries.slice(0, limit);
  }

  /** Get every reference for a single CVar name. */
  async getReferences(name: string): Promise<CVarReference[]> {
    const refs = await this.getIndex();
    const lowerName = name.toLowerCase();
    return refs.filter((r) => r.name.toLowerCase() === lowerName);
  }

  private async getIndex(): Promise<CVarReference[]> {
    if (this.cache) return this.cache;

    const refs: CVarReference[] = [];
    const luaFiles: string[] = [];

    try {
      await walk(this.basePath, (path) => {
        if (path.endsWith(".lua")) luaFiles.push(path);
      });
    } catch (err) {
      throw new Error(
        `Cannot index wow-ui-source at: ${this.basePath}\n` +
          `Make sure WOW_UI_SOURCE_PATH points to a valid clone of ` +
          `https://github.com/Gethe/wow-ui-source\n` +
          `Underlying error: ${(err as Error).message}`
      );
    }

    // Match common CVar API call shapes. We strip the trailing `(` and capture
    // the first string argument (the CVar name) and an optional second arg.
    const patterns: Array<{ regex: RegExp; usage: CVarReference["usage"]; capturesDefault?: boolean }> = [
      { regex: /\bRegisterCVar\s*\(\s*["']([^"']+)["'](?:\s*,\s*([^,)]+))?/g, usage: "Register", capturesDefault: true },
      { regex: /\bSetCVar\s*\(\s*["']([^"']+)["'](?:\s*,\s*([^,)]+))?/g, usage: "Set", capturesDefault: true },
      { regex: /\bGetCVar(?:Bool|Default)?\s*\(\s*["']([^"']+)["']/g, usage: "Get" },
      { regex: /\bC_CVar\.(?:Get|Set|Register)\w*\s*\(\s*["']([^"']+)["']/g, usage: "Reference" },
    ];

    for (const file of luaFiles) {
      const content = await safeRead(file);
      if (!content) continue;
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const code = stripComment(lines[i]);
        if (!code) continue;
        for (const { regex, usage, capturesDefault } of patterns) {
          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(code)) !== null) {
            refs.push({
              name: m[1],
              usage,
              defaultValue: capturesDefault ? m[2]?.trim() : undefined,
              file: relative(this.basePath, file),
              line: i + 1,
              snippet: lines[i].trim(),
            });
          }
        }
      }
    }

    this.cache = refs;
    return refs;
  }
}

async function walk(dir: string, onFile: (path: string) => void): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip .git and obvious noise dirs
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      await walk(fullPath, onFile);
    } else if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

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
