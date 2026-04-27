/**
 * Mixin / Template / Frame finder for wow-ui-source.
 *
 * Mixins (e.g. `ButtonMixin`) and XML templates (e.g. `UIPanelButtonTemplate`)
 * are the primary reuse mechanism in modern Blizzard UI. This tool indexes
 * their declarations so addon authors can quickly find the canonical source.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export interface MixinTemplateMatch {
  name: string;
  kind: "Mixin" | "Template" | "Frame";
  file: string;
  line: number;
  /** Inheritance / mixes-in chain when detectable. */
  inherits?: string[];
  snippet: string;
}

export class MixinTemplateFinder {
  private readonly basePath: string;
  private readonly addonsPath: string;
  private cache: MixinTemplateMatch[] | null = null;

  constructor(wowUiSourcePath: string) {
    this.basePath = wowUiSourcePath;
    this.addonsPath = join(wowUiSourcePath, "Interface", "AddOns");
  }

  /** Find mixins/templates whose name matches `query` (case-insensitive substring). */
  async find(
    query: string,
    options: { kind?: "Mixin" | "Template" | "Frame" | "all"; limit?: number } = {}
  ): Promise<MixinTemplateMatch[]> {
    const { kind = "all", limit = 25 } = options;
    const index = await this.getIndex();
    const lowerQuery = query.toLowerCase();

    const filtered = index.filter((m) => {
      if (kind !== "all" && m.kind !== kind) return false;
      return m.name.toLowerCase().includes(lowerQuery);
    });

    return filtered.slice(0, limit);
  }

  /** Build (or reuse) the in-memory index. */
  private async getIndex(): Promise<MixinTemplateMatch[]> {
    if (this.cache) return this.cache;

    const matches: MixinTemplateMatch[] = [];
    const luaFiles: string[] = [];
    const xmlFiles: string[] = [];

    try {
      await walk(this.addonsPath, (path) => {
        if (path.endsWith(".lua")) luaFiles.push(path);
        else if (path.endsWith(".xml")) xmlFiles.push(path);
      });
    } catch (err) {
      throw new Error(
        `Cannot index wow-ui-source at: ${this.basePath}\n` +
          `Make sure WOW_UI_SOURCE_PATH points to a valid clone of ` +
          `https://github.com/Gethe/wow-ui-source\n` +
          `Underlying error: ${(err as Error).message}`
      );
    }

    // Lua: capture `FooMixin = {}` and `FooMixin = CreateFromMixins(BarMixin, BazMixin)`
    const mixinRegex = /^\s*(?:local\s+)?(\w+Mixin)\s*=\s*(?:\{|CreateFromMixins\s*\(([^)]*)\))/;

    for (const file of luaFiles) {
      const content = await safeRead(file);
      if (!content) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = mixinRegex.exec(lines[i]);
        if (!m) continue;
        matches.push({
          name: m[1],
          kind: "Mixin",
          file: relative(this.basePath, file),
          line: i + 1,
          inherits: m[2]
            ? m[2]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          snippet: lines[i].trim(),
        });
      }
    }

    // XML: capture <Frame name="FooFrame" virtual="true"> and inherits attribute
    const frameRegex = /<\s*(Frame|Button|EditBox|CheckButton|Slider|ScrollFrame|StatusBar|Texture|FontString)\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*\binherits\s*=\s*["']([^"']+)["']/i;
    const frameRegexNoInherit = /<\s*(Frame|Button|EditBox|CheckButton|Slider|ScrollFrame|StatusBar)\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*\bvirtual\s*=\s*["']true["']/i;

    for (const file of xmlFiles) {
      const content = await safeRead(file);
      if (!content) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = frameRegex.exec(lines[i]);
        if (m) {
          matches.push({
            name: m[2],
            kind: "Template",
            file: relative(this.basePath, file),
            line: i + 1,
            inherits: m[3].split(",").map((s) => s.trim()).filter(Boolean),
            snippet: lines[i].trim(),
          });
          continue;
        }
        const m2 = frameRegexNoInherit.exec(lines[i]);
        if (m2) {
          matches.push({
            name: m2[2],
            kind: "Template",
            file: relative(this.basePath, file),
            line: i + 1,
            snippet: lines[i].trim(),
          });
        }
      }
    }

    this.cache = matches;
    return matches;
  }
}

async function walk(dir: string, onFile: (path: string) => void): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
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
