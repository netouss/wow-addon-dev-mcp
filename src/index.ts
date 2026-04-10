import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BlizzardApiDocParser } from "./parsers/blizzard-api-doc.js";
import { WowUiSourceSearcher } from "./parsers/wow-ui-source.js";
import { TocValidator } from "./tools/toc-validator.js";
import { AddonScaffold } from "./tools/addon-scaffold.js";
import { ApiMigration } from "./tools/api-migration.js";

const server = new McpServer({
  name: "wow-addon-dev-mcp",
  version: "0.1.0",
});

// Paths configured via environment variables (all optional — tools degrade gracefully)
const WOW_UI_SOURCE_PATH = process.env.WOW_UI_SOURCE_PATH ?? "";
const ADDONS_WORKSPACE_PATH = process.env.ADDONS_WORKSPACE_PATH ?? "";

// --- Lazy-loaded singletons ---
let apiDocParser: BlizzardApiDocParser | null = null;
let uiSourceSearcher: WowUiSourceSearcher | null = null;

/** Message returned by tools that require WOW_UI_SOURCE_PATH when it is not set. */
const WOW_UI_SOURCE_REQUIRED_MSG =
  "⚠️  This tool requires a local clone of wow-ui-source.\n\n" +
  "1. Clone https://github.com/Gethe/wow-ui-source to a local directory.\n" +
  "2. Set the WOW_UI_SOURCE_PATH environment variable in your MCP server config " +
  "to point to the cloned directory.\n\n" +
  "See the README for full setup instructions.";

/**
 * Returns the BlizzardApiDocParser, or null when WOW_UI_SOURCE_PATH is not configured.
 * Tools that need it should check for null and return WOW_UI_SOURCE_REQUIRED_MSG.
 */
function tryGetApiDocParser(): BlizzardApiDocParser | null {
  if (!WOW_UI_SOURCE_PATH) return null;
  if (!apiDocParser) {
    apiDocParser = new BlizzardApiDocParser(WOW_UI_SOURCE_PATH);
  }
  return apiDocParser;
}

/**
 * Returns the WowUiSourceSearcher, or null when WOW_UI_SOURCE_PATH is not configured.
 */
function tryGetUiSourceSearcher(): WowUiSourceSearcher | null {
  if (!WOW_UI_SOURCE_PATH) return null;
  if (!uiSourceSearcher) {
    uiSourceSearcher = new WowUiSourceSearcher(WOW_UI_SOURCE_PATH);
  }
  return uiSourceSearcher;
}

/** Convenience helper: returns a MCP text-content error response. */
function missingSourceError() {
  return { content: [{ type: "text" as const, text: WOW_UI_SOURCE_REQUIRED_MSG }] };
}

// ═══════════════════════════════════════════════════════════
// TOOL 1: lookup_blizzard_api — Look up a WoW API function
// ═══════════════════════════════════════════════════════════
server.tool(
  "lookup_blizzard_api",
  "Look up a WoW in-game API function by name. Returns signature, parameters, return values, and restrictions from the official Blizzard_APIDocumentationGenerated source.",
  {
    name: z.string().describe("Function name to look up, e.g. 'C_AuctionHouse.GetItemSearchResultInfo' or partial like 'GetItemSearch'"),
    exact: z.boolean().optional().describe("If true, match exact name only. If false (default), partial/fuzzy match."),
  },
  async ({ name, exact }) => {
    const parser = tryGetApiDocParser();
    if (!parser) return missingSourceError();
    const results = await parser.lookupFunction(name, exact ?? false);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 2: search_blizzard_api — Full-text search across APIs
// ═══════════════════════════════════════════════════════════
server.tool(
  "search_blizzard_api",
  "Search across all WoW in-game API functions, events, and tables by keyword. Searches function names, parameter names, and system names.",
  {
    query: z.string().describe("Search query — matches against function names, param names, system names"),
    type: z.enum(["function", "event", "table", "all"]).optional().describe("Filter by type (default: all)"),
    limit: z.number().optional().describe("Max results (default: 20)"),
  },
  async ({ query, type, limit }) => {
    const parser = tryGetApiDocParser();
    if (!parser) return missingSourceError();
    const results = await parser.search(query, type ?? "all", limit ?? 20);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 3: get_api_namespace — List functions in a C_ namespace
// ═══════════════════════════════════════════════════════════
server.tool(
  "get_api_namespace",
  "Get all functions in a WoW C_ namespace (e.g. C_AuctionHouse, C_CurrencyInfo). Pass 'list' to get all available namespaces.",
  {
    namespace: z.string().describe("Namespace name like 'C_AuctionHouse' or 'list' for all namespaces"),
  },
  async ({ namespace }) => {
    const parser = tryGetApiDocParser();
    if (!parser) return missingSourceError();
    const results = namespace === "list"
      ? await parser.listNamespaces()
      : await parser.getNamespace(namespace);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 4: get_api_events — Get event details and payloads
// ═══════════════════════════════════════════════════════════
server.tool(
  "get_api_events",
  "Look up a WoW game event by name. Returns the event payload parameters and the system it belongs to.",
  {
    event: z.string().describe("Event name like 'UNIT_AURA' or 'AUCTION_HOUSE_SHOW', or 'list' for all events"),
    filter: z.string().optional().describe("Filter events by keyword when listing"),
  },
  async ({ event, filter }) => {
    const parser = tryGetApiDocParser();
    if (!parser) return missingSourceError();
    const results = event === "list"
      ? await parser.listEvents(filter)
      : await parser.getEvent(event);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 5: search_framexml — Search in wow-ui-source FrameXML
// ═══════════════════════════════════════════════════════════
server.tool(
  "search_framexml",
  "Search Blizzard's FrameXML source code (wow-ui-source). Find how Blizzard implements UI patterns, mixins, templates, and widgets. Returns matching code snippets with file paths and line numbers.",
  {
    query: z.string().describe("Search term — function name, mixin name, template name, or pattern"),
    filePattern: z.string().optional().describe("Glob pattern to filter files, e.g. '*.lua', '*.xml', 'Blizzard_NamePlates/**'"),
    contextLines: z.number().optional().describe("Lines of context around matches (default: 3)"),
    maxResults: z.number().optional().describe("Max results (default: 15)"),
  },
  async ({ query, filePattern, contextLines, maxResults }) => {
    const searcher = tryGetUiSourceSearcher();
    if (!searcher) return missingSourceError();
    const results = await searcher.search(query, {
      filePattern,
      contextLines: contextLines ?? 3,
      maxResults: maxResults ?? 15,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 6: get_blizzard_addon — Get Blizzard addon structure
// ═══════════════════════════════════════════════════════════
server.tool(
  "get_blizzard_addon",
  "Get the structure and file list of a Blizzard UI addon from wow-ui-source. Use to understand how Blizzard implements specific UI features. Pass 'list' for all addons.",
  {
    addonName: z.string().describe("Addon name like 'Blizzard_AuctionHouseUI' or 'list' for all"),
  },
  async ({ addonName }) => {
    const searcher = tryGetUiSourceSearcher();
    if (!searcher) return missingSourceError();
    const results = addonName === "list"
      ? await searcher.listAddons()
      : await searcher.getAddonStructure(addonName);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 7: validate_toc — Validate a .toc file
// ═══════════════════════════════════════════════════════════
server.tool(
  "validate_toc",
  "Validate a WoW addon .toc file. Checks for required fields, valid Interface versions, proper formatting, and common mistakes.",
  {
    tocContent: z.string().describe("The full content of the .toc file to validate"),
    addonName: z.string().optional().describe("Expected addon name (for cross-checking)"),
  },
  async ({ tocContent, addonName }) => {
    const validator = new TocValidator();
    const results = validator.validate(tocContent, addonName);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 8: check_api_deprecation — Check if APIs are deprecated
// ═══════════════════════════════════════════════════════════
server.tool(
  "check_api_deprecation",
  "Check if WoW API functions used in code are deprecated. Scans Lua code for API calls and reports deprecated functions with their modern replacements.",
  {
    luaCode: z.string().describe("Lua source code to scan for deprecated API usage"),
  },
  async ({ luaCode }) => {
    // check_api_deprecation works with the built-in migration table — no wow-ui-source needed
    const migrator = new ApiMigration(tryGetApiDocParser() ?? undefined);
    const results = await migrator.checkDeprecations(luaCode);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 9: suggest_api_migration — Suggest API migration paths
// ═══════════════════════════════════════════════════════════
server.tool(
  "suggest_api_migration",
  "Given an old/deprecated WoW API function, suggest the modern replacement with code examples. Useful for migrating addons between patches.",
  {
    oldFunction: z.string().describe("Deprecated function name, e.g. 'GetContainerItemInfo'"),
  },
  async ({ oldFunction }) => {
    // suggest_api_migration uses the built-in table first; wow-ui-source only needed for unknown functions
    const migrator = new ApiMigration(tryGetApiDocParser() ?? undefined);
    const results = await migrator.suggestMigration(oldFunction);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 10: scaffold_addon — Generate addon boilerplate
// ═══════════════════════════════════════════════════════════
server.tool(
  "scaffold_addon",
  "Generate WoW addon boilerplate code following NetoussAddons conventions. Creates TOC, main.lua, and Config.lua with correct event dispatching, SavedVariables, slash commands, and combat lockdown patterns.",
  {
    addonName: z.string().describe("Name of the addon to scaffold"),
    features: z.array(z.enum([
      "savedvariables",
      "slash_command",
      "movable_frame",
      "minimap_button",
      "options_panel",
      "event_handler",
      "combat_check",
    ])).optional().describe("Features to include in scaffold"),
    interfaceVersions: z.string().optional().describe("Comma-separated Interface versions, e.g. '120000, 110207'"),
  },
  async ({ addonName, features, interfaceVersions }) => {
    const scaffold = new AddonScaffold(ADDONS_WORKSPACE_PATH);
    const results = scaffold.generate(addonName, {
      features: features ?? ["savedvariables", "slash_command", "event_handler"],
      interfaceVersions: interfaceVersions ?? "120000, 110207",
    });
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 11: get_wow_constants — Get WoW game constants
// ═══════════════════════════════════════════════════════════
server.tool(
  "get_wow_constants",
  "Look up WoW game constants, enums, and global values from the API documentation. Useful for getting correct enum values for API calls.",
  {
    name: z.string().describe("Constant/enum name like 'Enum.ItemQuality' or 'list' for all"),
    filter: z.string().optional().describe("Filter when listing"),
  },
  async ({ name, filter }) => {
    const parser = tryGetApiDocParser();
    if (!parser) return missingSourceError();
    const results = name === "list"
      ? await parser.listConstants(filter)
      : await parser.getConstant(name);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// TOOL 12: get_widget_api — Get widget type methods
// ═══════════════════════════════════════════════════════════
server.tool(
  "get_widget_api",
  "Get methods available on a WoW UI widget type (Frame, Button, EditBox, etc.). Shows inheritance chain and all available methods with signatures.",
  {
    widgetType: z.string().describe("Widget type like 'Frame', 'Button', 'EditBox' or 'list' for all types"),
  },
  async ({ widgetType }) => {
    const searcher = tryGetUiSourceSearcher();
    if (!searcher) return missingSourceError();
    const results = widgetType === "list"
      ? await searcher.listWidgetTypes()
      : await searcher.getWidgetMethods(widgetType);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// --- Start the server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
