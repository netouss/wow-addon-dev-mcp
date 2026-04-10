import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Parsed representation of a single API function */
export interface ApiFunction {
  name: string;
  fullName: string; // namespace.name
  system: string;
  namespace?: string;
  type: "Function";
  arguments: ApiParam[];
  returns: ApiParam[];
  hasRestrictions?: boolean;
  secretArguments?: string;
}

export interface ApiParam {
  name: string;
  type: string;
  nilable: boolean;
  mixin?: string;
  default?: string;
}

export interface ApiEvent {
  name: string;
  system: string;
  namespace?: string;
  type: "Event";
  payload: ApiParam[];
}

export interface ApiTable {
  name: string;
  system: string;
  namespace?: string;
  type: "ScriptObject" | "Enumeration" | "Structure" | "Constants" | "CallbackType";
  fields: ApiParam[];
  values?: Array<{ name: string; type: string; value?: number }>;
}

interface ParsedSystem {
  name: string;
  namespace?: string;
  functions: ApiFunction[];
  events: ApiEvent[];
  tables: ApiTable[];
}

/**
 * Parses the Blizzard_APIDocumentationGenerated Lua files from wow-ui-source.
 * These files follow a consistent Lua table structure that can be parsed
 * with regex (they're structured data, not arbitrary Lua).
 */
export class BlizzardApiDocParser {
  private systems: ParsedSystem[] = [];
  private loaded = false;
  private readonly docPath: string;

  constructor(wowUiSourcePath: string) {
    this.docPath = join(
      wowUiSourcePath,
      "Interface",
      "AddOns",
      "Blizzard_APIDocumentationGenerated"
    );
  }

  /** Ensure docs are loaded (lazy, one-time) */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    let files: string[];
    try {
      files = await readdir(this.docPath);
    } catch {
      throw new Error(
        `Cannot read Blizzard API documentation at: ${this.docPath}\n` +
        `Make sure WOW_UI_SOURCE_PATH points to a valid clone of ` +
        `https://github.com/Gethe/wow-ui-source`
      );
    }
    const luaFiles = files.filter((f) => f.endsWith("Documentation.lua"));

    for (const file of luaFiles) {
      const content = await readFile(join(this.docPath, file), "utf-8");
      const system = this.parseDocFile(content, file);
      if (system) {
        this.systems.push(system);
      }
    }

    this.loaded = true;
  }

  /** Parse a single documentation Lua file */
  private parseDocFile(content: string, filename: string): ParsedSystem | null {
    // Extract system name
    const nameMatch = content.match(/Name\s*=\s*"([^"]+)"/);
    if (!nameMatch) return null;

    const systemName = nameMatch[1];

    // Extract namespace
    const nsMatch = content.match(/Namespace\s*=\s*"([^"]+)"/);
    const namespace = nsMatch?.[1];

    const system: ParsedSystem = {
      name: systemName,
      namespace,
      functions: [],
      events: [],
      tables: [],
    };

    // Parse functions
    system.functions = this.parseFunctions(content, systemName, namespace);
    // Parse events
    system.events = this.parseEvents(content, systemName, namespace);
    // Parse tables (enums, structures)
    system.tables = this.parseTables(content, systemName, namespace);

    return system;
  }

  private parseFunctions(content: string, system: string, namespace?: string): ApiFunction[] {
    const functions: ApiFunction[] = [];

    // Match function blocks within Functions = { ... }
    const functionsBlock = this.extractBlock(content, "Functions");
    if (!functionsBlock) return functions;

    // Split into individual function entries
    const fnBlocks = this.splitEntries(functionsBlock);

    for (const block of fnBlocks) {
      const nameMatch = block.match(/Name\s*=\s*"([^"]+)"/);
      if (!nameMatch) continue;

      const name = nameMatch[1];
      const hasRestrictions = /HasRestrictions\s*=\s*true/.test(block);
      const secretMatch = block.match(/SecretArguments\s*=\s*"([^"]+)"/);

      const fn: ApiFunction = {
        name,
        fullName: namespace ? `${namespace}.${name}` : name,
        system,
        namespace,
        type: "Function",
        arguments: this.parseParams(block, "Arguments"),
        returns: this.parseParams(block, "Returns"),
        hasRestrictions: hasRestrictions || undefined,
        secretArguments: secretMatch?.[1],
      };

      functions.push(fn);
    }

    return functions;
  }

  private parseEvents(content: string, system: string, namespace?: string): ApiEvent[] {
    const events: ApiEvent[] = [];
    const eventsBlock = this.extractBlock(content, "Events");
    if (!eventsBlock) return events;

    const eventBlocks = this.splitEntries(eventsBlock);

    for (const block of eventBlocks) {
      const nameMatch = block.match(/Name\s*=\s*"([^"]+)"/);
      if (!nameMatch) continue;

      events.push({
        name: nameMatch[1],
        system,
        namespace,
        type: "Event",
        payload: this.parseParams(block, "Payload"),
      });
    }

    return events;
  }

  private parseTables(content: string, system: string, namespace?: string): ApiTable[] {
    const tables: ApiTable[] = [];
    const tablesBlock = this.extractBlock(content, "Tables");
    if (!tablesBlock) return tables;

    const tableBlocks = this.splitEntries(tablesBlock);

    for (const block of tableBlocks) {
      const nameMatch = block.match(/Name\s*=\s*"([^"]+)"/);
      const typeMatch = block.match(/Type\s*=\s*"([^"]+)"/);
      if (!nameMatch || !typeMatch) continue;

      const table: ApiTable = {
        name: nameMatch[1],
        system,
        namespace,
        type: typeMatch[1] as ApiTable["type"],
        fields: this.parseParams(block, "Fields"),
      };

      // For enumerations, extract values
      if (typeMatch[1] === "Enumeration") {
        table.values = this.parseEnumValues(block);
      }

      tables.push(table);
    }

    return tables;
  }

  /** Extract a named block like Functions = { ... } from Lua content */
  private extractBlock(content: string, blockName: string): string | null {
    const regex = new RegExp(`${blockName}\\s*=\\s*\\{`);
    const match = regex.exec(content);
    if (!match) return null;

    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;

    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
      i++;
    }

    return content.slice(start, i - 1);
  }

  /** Split block content into individual { ... } entries */
  private splitEntries(block: string): string[] {
    const entries: string[] = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < block.length; i++) {
      if (block[i] === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (block[i] === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          entries.push(block.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return entries;
  }

  /** Parse Arguments/Returns/Payload/Fields parameter arrays */
  private parseParams(block: string, paramType: string): ApiParam[] {
    const paramsBlock = this.extractBlock(block, paramType);
    if (!paramsBlock) return [];

    const paramEntries = this.splitEntries(paramsBlock);
    const params: ApiParam[] = [];

    for (const entry of paramEntries) {
      const nameMatch = entry.match(/Name\s*=\s*"([^"]+)"/);
      const typeMatch = entry.match(/Type\s*=\s*"([^"]+)"/);
      const nilableMatch = entry.match(/Nilable\s*=\s*(true|false)/);
      const mixinMatch = entry.match(/Mixin\s*=\s*"([^"]+)"/);

      if (nameMatch && typeMatch) {
        params.push({
          name: nameMatch[1],
          type: typeMatch[1],
          nilable: nilableMatch?.[1] === "true",
          mixin: mixinMatch?.[1],
        });
      }
    }

    return params;
  }

  /** Parse enum values */
  private parseEnumValues(block: string): Array<{ name: string; type: string; value?: number }> {
    const valuesBlock = this.extractBlock(block, "Fields");
    if (!valuesBlock) return [];

    const entries = this.splitEntries(valuesBlock);
    return entries
      .map((entry) => {
        const nameMatch = entry.match(/Name\s*=\s*"([^"]+)"/);
        const typeMatch = entry.match(/Type\s*=\s*"([^"]+)"/);
        const enumMatch = entry.match(/EnumValue\s*=\s*(\d+)/);
        if (!nameMatch) return null;
        return {
          name: nameMatch[1],
          type: typeMatch?.[1] ?? "unknown",
          value: enumMatch ? parseInt(enumMatch[1], 10) : undefined,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }

  // --- Public query methods ---

  async lookupFunction(name: string, exact: boolean): Promise<ApiFunction[]> {
    await this.ensureLoaded();

    const lowerName = name.toLowerCase();

    return this.systems.flatMap((s) =>
      s.functions.filter((f) =>
        exact
          ? f.name.toLowerCase() === lowerName || f.fullName.toLowerCase() === lowerName
          : f.name.toLowerCase().includes(lowerName) || f.fullName.toLowerCase().includes(lowerName)
      )
    );
  }

  async search(query: string, type: string, limit: number) {
    await this.ensureLoaded();

    const lowerQuery = query.toLowerCase();
    const results: Array<{
      type: string;
      name: string;
      fullName?: string;
      system: string;
      namespace?: string;
    }> = [];

    for (const system of this.systems) {
      if (type === "all" || type === "function") {
        for (const fn of system.functions) {
          if (
            fn.name.toLowerCase().includes(lowerQuery) ||
            fn.fullName.toLowerCase().includes(lowerQuery) ||
            fn.arguments.some((a) => a.name.toLowerCase().includes(lowerQuery))
          ) {
            results.push({
              type: "Function",
              name: fn.name,
              fullName: fn.fullName,
              system: fn.system,
              namespace: fn.namespace,
            });
          }
        }
      }

      if (type === "all" || type === "event") {
        for (const evt of system.events) {
          if (evt.name.toLowerCase().includes(lowerQuery)) {
            results.push({
              type: "Event",
              name: evt.name,
              system: evt.system,
              namespace: evt.namespace,
            });
          }
        }
      }

      if (type === "all" || type === "table") {
        for (const tbl of system.tables) {
          if (tbl.name.toLowerCase().includes(lowerQuery)) {
            results.push({
              type: tbl.type,
              name: tbl.name,
              system: tbl.system,
              namespace: tbl.namespace,
            });
          }
        }
      }
    }

    return results.slice(0, limit);
  }

  async listNamespaces(): Promise<Array<{ namespace: string; functionCount: number }>> {
    await this.ensureLoaded();

    const nsMap = new Map<string, number>();
    for (const system of this.systems) {
      if (system.namespace) {
        nsMap.set(
          system.namespace,
          (nsMap.get(system.namespace) ?? 0) + system.functions.length
        );
      }
    }

    return Array.from(nsMap.entries())
      .map(([namespace, functionCount]) => ({ namespace, functionCount }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
  }

  async getNamespace(namespace: string) {
    await this.ensureLoaded();

    const lowerNs = namespace.toLowerCase();
    const matching = this.systems.filter(
      (s) => s.namespace?.toLowerCase() === lowerNs
    );

    return {
      namespace,
      systems: matching.map((s) => s.name),
      functions: matching.flatMap((s) => s.functions),
      events: matching.flatMap((s) => s.events),
      tables: matching.flatMap((s) => s.tables),
    };
  }

  async getEvent(eventName: string) {
    await this.ensureLoaded();

    const lowerName = eventName.toLowerCase();
    for (const system of this.systems) {
      const event = system.events.find(
        (e) => e.name.toLowerCase() === lowerName
      );
      if (event) return event;
    }

    // Partial match fallback
    return this.systems
      .flatMap((s) => s.events)
      .filter((e) => e.name.toLowerCase().includes(lowerName));
  }

  async listEvents(filter?: string) {
    await this.ensureLoaded();

    const events = this.systems.flatMap((s) => s.events);
    if (!filter) return events.map((e) => ({ name: e.name, system: e.system }));

    const lowerFilter = filter.toLowerCase();
    return events
      .filter((e) => e.name.toLowerCase().includes(lowerFilter))
      .map((e) => ({ name: e.name, system: e.system }));
  }

  async getConstant(name: string) {
    await this.ensureLoaded();

    const lowerName = name.toLowerCase();
    for (const system of this.systems) {
      const table = system.tables.find(
        (t) =>
          t.name.toLowerCase() === lowerName &&
          (t.type === "Enumeration" || t.type === "Constants")
      );
      if (table) return table;
    }

    return null;
  }

  async listConstants(filter?: string) {
    await this.ensureLoaded();

    const tables = this.systems.flatMap((s) =>
      s.tables.filter((t) => t.type === "Enumeration" || t.type === "Constants")
    );

    if (!filter) return tables.map((t) => ({ name: t.name, type: t.type, system: t.system }));

    const lowerFilter = filter.toLowerCase();
    return tables
      .filter((t) => t.name.toLowerCase().includes(lowerFilter))
      .map((t) => ({ name: t.name, type: t.type, system: t.system }));
  }
}
