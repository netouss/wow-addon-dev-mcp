# wow-addon-dev-mcp — WoW Addon Development MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that gives GitHub Copilot (and any MCP-compatible client) deep knowledge of the World of Warcraft addon development ecosystem, powered by Blizzard's own API documentation and FrameXML source code.

---

## Features

- **12 tools** covering API lookup, FrameXML search, TOC validation, deprecation checks, and addon scaffolding
- **No network calls** — all data comes from your local `wow-ui-source` clone
- **Graceful degradation** — tools that do not need `wow-ui-source` work immediately (TOC validation, deprecation scanner, addon scaffolding)
- **Lazy loading** — API documentation (~700 files) is parsed only on first access

---

## Quick Start

### 1. Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- A MCP-compatible client (e.g. [VS Code + GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat))

### 2. Clone and Build

```bash
git clone https://github.com/<your-username>/wow-addon-dev-mcp.git
cd wow-addon-dev-mcp
npm install
npm run build
```

> **Windows note:** If your working directory is on a network drive (e.g. Google Drive), build to a local path to avoid `node_modules` issues:
> ```powershell
> Copy-Item ".\wow-addon-dev-mcp" -Destination "C:\dev\wow-addon-dev-mcp" -Recurse -Exclude "node_modules","dist"
> Set-Location "C:\dev\wow-addon-dev-mcp"
> npm install
> npm run build
> ```

### 3. (Optional) Clone wow-ui-source

Several tools require a local copy of [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source) — Blizzard's mirrored UI source code. Without it, the API lookup, FrameXML search, constants, and widget tools are unavailable, but all other tools continue to work.

```bash
git clone https://github.com/Gethe/wow-ui-source.git /path/to/wow-ui-source
```

### 4. Configure the MCP Server

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Then configure your MCP client. For **VS Code**, create or update `.vscode/mcp.json`:

```json
{
  "servers": {
    "wow-addon-dev": {
      "command": "node",
      "args": ["/path/to/wow-addon-dev-mcp/dist/index.js"],
      "env": {
        "WOW_UI_SOURCE_PATH": "/path/to/wow-ui-source",
        "ADDONS_WORKSPACE_PATH": "/path/to/your/addons/workspace"
      }
    }
  }
}
```

Replace the paths with your actual directories. `ADDONS_WORKSPACE_PATH` is optional and only affects path suggestions in the `scaffold_addon` tool.

Reload VS Code — the `wow-addon-dev` server will appear in Copilot's tool list.

---

## Tools Reference (12 tools)

Tools marked **[requires wow-ui-source]** need `WOW_UI_SOURCE_PATH` to be configured. All other tools work out of the box.

### 1. `lookup_blizzard_api` [requires wow-ui-source]
Look up a WoW in-game API function by exact or partial name.

**Use case:** "What parameters does `C_AuctionHouse.GetItemSearchResultInfo` expect?"

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Function name (full or partial) |
| `exact` | boolean? | Exact match only (default: false) |

**Returns:** Function signature, parameters (name, type, nilable), return values, system/namespace.

---

### 2. `search_blizzard_api` [requires wow-ui-source]
Full-text search across all API functions, events, and data tables.

**Use case:** "Find all APIs related to auction house" → search `"auction"`

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search keyword |
| `type` | `"function"`\|`"event"`\|`"table"`\|`"all"`? | Filter by type |
| `limit` | number? | Max results (default: 20) |

---

### 3. `get_api_namespace` [requires wow-ui-source]
List all functions available in a `C_` namespace.

**Use case:** "What functions are in `C_CurrencyInfo`?"

| Parameter | Type | Description |
|-----------|------|-------------|
| `namespace` | string | Namespace name (e.g. `C_AuctionHouse`) or `list` |

---

### 4. `get_api_events` [requires wow-ui-source]
Look up WoW game events with their payload parameters.

**Use case:** "What payload does `UNIT_AURA` carry?"

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | string | Event name (e.g. `UNIT_AURA`) or `list` |
| `filter` | string? | Filter keyword when listing |

---

### 5. `search_framexml` [requires wow-ui-source]
Search Blizzard's FrameXML/addon source code.

**Use case:** "How does Blizzard implement the quest tracker?" → search `"ObjectiveTrackerFrame"`

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search term |
| `filePattern` | string? | Glob filter (e.g. `*.lua`, `Blizzard_NamePlates/**`) |
| `contextLines` | number? | Lines of context (default: 3) |
| `maxResults` | number? | Max results (default: 15) |

**Returns:** Matching code snippets with file paths and line numbers.

---

### 6. `get_blizzard_addon` [requires wow-ui-source]
Browse the structure and file list of a Blizzard UI addon.

**Use case:** "What files make up `Blizzard_AuctionHouseUI`?"

| Parameter | Type | Description |
|-----------|------|-------------|
| `addonName` | string | Addon name or `list` for all |

---

### 7. `validate_toc`
Validate a `.toc` file for correctness.

**Use case:** Paste a TOC file and get instant feedback on missing fields, invalid Interface versions, naming issues.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tocContent` | string | Full TOC content |
| `addonName` | string? | Expected addon name |

**Checks:** Required fields (`## Interface`, `## Title`), valid Interface version numbers, multi-version comma syntax, SavedVariables naming, file path separators.

---

### 8. `check_api_deprecation`
Scan Lua code for deprecated API calls.

**Use case:** Paste the contents of a `.lua` file and get a report of all deprecated calls with their modern replacements.

| Parameter | Type | Description |
|-----------|------|-------------|
| `luaCode` | string | Lua source code to scan |

**Covers:** Container→C_Container, Spell→C_Spell, UnitBuff→C_UnitAuras, GetItemInfo→C_Item, AddOn→C_AddOns, Currency→C_CurrencyInfo, and more.

---

### 9. `suggest_api_migration`
Given one deprecated function, get the full migration path.

**Use case:** "How do I replace `GetSpellInfo`?"

| Parameter | Type | Description |
|-----------|------|-------------|
| `oldFunction` | string | Deprecated function name |

**Returns:** Replacement function, patch version, notes about return value changes, code example.

---

### 10. `scaffold_addon`
Generate WoW addon boilerplate.

**Use case:** "Create a new addon called MyTracker with saved variables and a minimap button"

| Parameter | Type | Description |
|-----------|------|-------------|
| `addonName` | string | Name of the addon |
| `features` | array? | Feature flags: `savedvariables`, `slash_command`, `movable_frame`, `minimap_button`, `options_panel`, `event_handler`, `combat_check` |
| `interfaceVersions` | string? | Interface versions (default: `120000, 110207`) |

**Generates:** TOC file, `main.lua` (event dispatcher, SavedVariables, slash commands), `Config.lua` (options panel using Settings API).

---

### 11. `get_wow_constants` [requires wow-ui-source]
Look up WoW game constants and enums.

**Use case:** "What are the `Enum.ItemQuality` values?"

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Constant/enum name or `list` |
| `filter` | string? | Filter keyword |

---

### 12. `get_widget_api` [requires wow-ui-source]
Get methods available on a UI widget type.

**Use case:** "What methods does an `EditBox` widget have?"

| Parameter | Type | Description |
|-----------|------|-------------|
| `widgetType` | string | Widget type (e.g. `Frame`, `Button`, `EditBox`) or `list` |

---

## Architecture

```
wow-addon-dev-mcp/
├── src/
│   ├── index.ts                    # MCP server entry — all 12 tool registrations
│   ├── parsers/
│   │   ├── blizzard-api-doc.ts     # Parses 700+ Blizzard_APIDocumentationGenerated Lua files
│   │   └── wow-ui-source.ts        # Searches FrameXML source code
│   └── tools/
│       ├── addon-scaffold.ts       # Generates addon boilerplate
│       ├── api-migration.ts        # Deprecation checking + migration suggestions
│       └── toc-validator.ts        # TOC file validation
├── dist/                           # Compiled JS output (git-ignored)
├── .env.example                    # Environment variable template
├── package.json
└── tsconfig.json
```

### Key Design Decisions

- **Lazy loading:** API documentation (~700 files) is parsed on first access, not at server startup.
- **Local-first:** All data comes from your local `wow-ui-source` clone — no network calls, no API keys.
- **Graceful degradation:** Tools that do not require `wow-ui-source` (TOC validation, deprecation scanner, addon scaffolding) work independently. Tools that need it return a helpful setup message if the path is not configured.

---

## Development

### Rebuild after changes

```bash
npm run build
```

### Watch mode

```bash
npm run dev
```

### Run tests

```bash
npm test
```

### Adding a new tool

1. Implement logic in a new file under `src/tools/` or extend an existing one.
2. Register the tool in `src/index.ts` with `server.tool(name, description, schema, handler)`.
3. If the tool requires `wow-ui-source`, call `tryGetApiDocParser()` / `tryGetUiSourceSearcher()` and return `missingSourceError()` when they are `null`.
4. Document the new tool in this README and in `CONTRIBUTING.md`.

---

## Possible Future Enhancements

### Near-term
- **SavedVariables schema inference:** Parse WTF SavedVariables files to understand stored data shapes
- **Ace3 library reference:** Index Ace3 library APIs (AceAddon, AceDB, AceGUI, etc.)
- **LibStub pattern detection:** Validate library loading patterns in TOC files

### Medium-term
- **Battle.net Web API integration:** OAuth2 flow + Game Data/Profile API for live item data, character profiles, auction prices
- **Wago.io integration:** Fetch popular addon patterns and WeakAura code

### Long-term
- **Cross-addon dependency analysis:** Map dependency graphs across multiple addons
- **Automated patch notes scanner:** Compare wow-ui-source across versions to identify breaking API changes
- **In-game testing bridge:** Connect to the game client's debug console for live addon testing

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add tools, report bugs, and submit pull requests.

## License

[MIT](LICENSE)

