# Contributing to wow-addon-dev-mcp

Thank you for your interest in contributing! This document explains how to get
started and the conventions to follow.

---

## Getting Started

### Requirements
- Node.js >= 20
- TypeScript knowledge (the codebase is 100% TypeScript)
- Familiarity with the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)

### Setup

```bash
git clone https://github.com/<your-username>/wow-addon-dev-mcp.git
cd wow-addon-dev-mcp
npm install
npm run dev   # watch mode — recompiles on save
```

For tools that read Blizzard source files, also clone wow-ui-source and configure
`WOW_UI_SOURCE_PATH` (see README Quick Start).

---

## Project Structure

```
src/
  index.ts          # MCP server entry — tool registrations live here
  parsers/
    blizzard-api-doc.ts   # Parses Blizzard_APIDocumentationGenerated Lua files
    wow-ui-source.ts      # Searches FrameXML source code
  tools/
    addon-scaffold.ts     # Boilerplate generator
    api-migration.ts      # Deprecation database + migration suggestions
    toc-validator.ts      # TOC file linter
```

---

## Adding a New Tool

1. **Create or extend a file** under `src/tools/`.

2. **Register the tool** in `src/index.ts`:
   ```typescript
   server.tool("my_tool_name", "Short description", { param: z.string() }, async ({ param }) => {
     // If tool needs wow-ui-source:
     const parser = tryGetApiDocParser();
     if (!parser) return missingSourceError();
     // ...
     return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
   });
   ```

3. **Tool naming conventions:**
   - Use `snake_case` for tool names.
   - Use `[requires wow-ui-source]` in the README description for tools that need
     `WOW_UI_SOURCE_PATH`.
   - Tools that work without local data should not call `tryGetApiDocParser()`/
     `tryGetUiSourceSearcher()`.

4. **Graceful degradation:**
   - If your tool requires `WOW_UI_SOURCE_PATH`, **always** check `tryGetApiDocParser()`/
     `tryGetUiSourceSearcher()` for `null` and return `missingSourceError()`.
   - Do not `throw` from a tool handler — return an error text instead.

5. **Document the tool** in `README.md` (Tools Reference section) and update
   the feature count in the Features section.

---

## Updating the Deprecation / Migration Database

The built-in deprecation list lives in `src/tools/api-migration.ts` — the
`KNOWN_MIGRATIONS` map. To add new deprecated functions:

```typescript
"OldFunctionName": {
  replacement: "C_NewNamespace.NewFunction",
  patch: "11.0.0",
  notes: "Returns a table instead of multiple values",
},
```

---

## Updating Known Interface Versions

TOC validation uses the `KNOWN_INTERFACE_VERSIONS` map in
`src/tools/toc-validator.ts`. When a new WoW patch ships, add the new version:

```typescript
"120100": "Midnight (12.1.0)",
```

---

## Code Style

- TypeScript strict mode is enabled — no implicit `any`.
- Use `async/await` for all async operations.
- Keep tool handler functions small; delegate logic to classes in `src/tools/`
  or `src/parsers/`.
- Do not add `console.log` in production code — MCP servers communicate via
  stdio and console output corrupts the protocol.

---

## Running Tests

```bash
npm test
```

Tests use [Vitest](https://vitest.dev/). Add test files alongside source files
as `*.test.ts`.

---

## Submitting a Pull Request

1. Fork the repository and create a feature branch.
2. Make your changes and run `npm run build` to ensure compilation succeeds.
3. Run `npm test`.
4. Open a PR with a short description of what was added/changed and **why**.
5. Reference any related issues.

---

## Reporting Bugs

Open a GitHub Issue with:
- What you expected to happen
- What actually happened (error message, tool output)
- Your Node.js version and OS
- Whether `WOW_UI_SOURCE_PATH` is configured
