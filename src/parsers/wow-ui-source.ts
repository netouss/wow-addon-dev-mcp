import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  context: string[];
}

export interface SearchOptions {
  filePattern?: string;
  contextLines?: number;
  maxResults?: number;
}

/**
 * Searches and browses the wow-ui-source Blizzard FrameXML/AddOns code.
 * Provides structured access to Blizzard's own UI implementation.
 */
export class WowUiSourceSearcher {
  private readonly basePath: string;
  private readonly addonsPath: string;

  constructor(wowUiSourcePath: string) {
    this.basePath = wowUiSourcePath;
    this.addonsPath = join(wowUiSourcePath, "Interface", "AddOns");
  }

  /** Search for a pattern across Blizzard UI source files */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { filePattern, contextLines = 3, maxResults = 15 } = options;
    const results: SearchResult[] = [];
    const regex = new RegExp(escapeRegex(query), "gi");

    let files: string[];
    try {
      files = await this.collectFiles(this.addonsPath, filePattern);
    } catch {
      throw new Error(
        `Cannot read wow-ui-source at: ${this.basePath}\n` +
        `Make sure WOW_UI_SOURCE_PATH points to a valid clone of ` +
        `https://github.com/Gethe/wow-ui-source`
      );
    }

    for (const filePath of files) {
      if (results.length >= maxResults) break;

      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break;
        if (!regex.test(lines[i])) continue;
        regex.lastIndex = 0; // reset for global regex

        const contextStart = Math.max(0, i - contextLines);
        const contextEnd = Math.min(lines.length - 1, i + contextLines);

        results.push({
          file: relative(this.basePath, filePath),
          line: i + 1,
          content: lines[i].trim(),
          context: lines.slice(contextStart, contextEnd + 1),
        });
      }
    }

    return results;
  }

  /** List all Blizzard addons in wow-ui-source */
  async listAddons(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.addonsPath);
    } catch {
      throw new Error(
        `Cannot read wow-ui-source at: ${this.basePath}\n` +
        `Make sure WOW_UI_SOURCE_PATH points to a valid clone of ` +
        `https://github.com/Gethe/wow-ui-source`
      );
    }
    const addons: string[] = [];

    for (const entry of entries) {
      const entryPath = join(this.addonsPath, entry);
      const stats = await stat(entryPath);
      if (stats.isDirectory()) {
        addons.push(entry);
      }
    }

    return addons.sort();
  }

  /** Get the file structure of a specific Blizzard addon */
  async getAddonStructure(addonName: string) {
    const addonPath = join(this.addonsPath, addonName);

    try {
      const files = await this.collectFiles(addonPath);
      return {
        name: addonName,
        path: relative(this.basePath, addonPath),
        files: files.map((f) => ({
          path: relative(addonPath, f),
          ext: extname(f),
        })),
        fileCount: files.length,
        luaFiles: files.filter((f) => f.endsWith(".lua")).length,
        xmlFiles: files.filter((f) => f.endsWith(".xml")).length,
        tocFiles: files.filter((f) => f.endsWith(".toc")).length,
      };
    } catch {
      return { error: `Addon '${addonName}' not found in wow-ui-source` };
    }
  }

  /** List known widget types by scanning SharedXML and FrameXML */
  async listWidgetTypes(): Promise<string[]> {
    // Search for CreateFrame calls and widget type definitions
    const results = await this.search("ObjectAPI", {
      filePattern: "*.lua",
      maxResults: 200,
    });

    const types = new Set<string>();
    const typeRegex = /ObjectAPI\s*=\s*"(\w+)"/g;

    for (const result of results) {
      for (const line of result.context) {
        let match;
        while ((match = typeRegex.exec(line)) !== null) {
          types.add(match[1]);
        }
      }
    }

    return Array.from(types).sort();
  }

  /** Get methods for a specific widget type */
  async getWidgetMethods(widgetType: string) {
    // Search for method definitions on the widget type
    const results = await this.search(`${widgetType}Mixin`, {
      filePattern: "*.lua",
      maxResults: 50,
    });

    const methods: Array<{ name: string; file: string; line: number }> = [];
    const funcRegex = new RegExp(`function\\s+${escapeRegex(widgetType)}Mixin[.:]([\\w]+)`, "g");

    for (const result of results) {
      for (const line of result.context) {
        let match;
        while ((match = funcRegex.exec(line)) !== null) {
          methods.push({
            name: match[1],
            file: result.file,
            line: result.line,
          });
        }
      }
    }

    return {
      widgetType,
      methods,
      mixinName: `${widgetType}Mixin`,
    };
  }

  /** Recursively collect files, optionally filtered by pattern */
  private async collectFiles(dirPath: string, pattern?: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (!pattern || matchPattern(entry.name, pattern)) {
            files.push(fullPath);
          }
        }
      }
    }

    await walk(dirPath);
    return files;
  }
}

/** Simple glob-like matching (supports *.ext and prefix**) */
function matchPattern(filename: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    return filename.endsWith(pattern.slice(1));
  }
  if (pattern.includes("**")) {
    return true; // directory patterns handled elsewhere
  }
  return filename.includes(pattern);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
