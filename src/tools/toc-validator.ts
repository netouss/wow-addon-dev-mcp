interface TocValidationResult {
  valid: boolean;
  errors: TocIssue[];
  warnings: TocIssue[];
  info: TocIssue[];
  parsed: {
    interfaceVersions: string[];
    title?: string;
    savedVariables?: string[];
    savedVariablesPerCharacter?: string[];
    dependencies?: string[];
    optionalDeps?: string[];
    files: string[];
    metadata: Record<string, string>;
  };
}

interface TocIssue {
  line?: number;
  message: string;
  fix?: string;
}

// Known valid Interface versions (major releases)
const KNOWN_INTERFACE_VERSIONS: Record<string, string> = {
  "120000": "Midnight (12.0.0)",
  "110207": "The War Within 11.2.7",
  "110205": "The War Within 11.2.5",
  "110200": "The War Within 11.2.0",
  "110105": "The War Within 11.1.5",
  "110100": "The War Within 11.1.0",
  "110007": "The War Within 11.0.7",
  "110005": "The War Within 11.0.5",
  "110002": "The War Within 11.0.2",
  "110000": "The War Within 11.0.0",
  "100207": "Dragonflight 10.2.7",
  "100200": "Dragonflight 10.2.0",
  "100100": "Dragonflight 10.1.0",
  "100007": "Dragonflight 10.0.7",
  "100005": "Dragonflight 10.0.5",
  "100002": "Dragonflight 10.0.2",
  "40402": "Cataclysm Classic 4.4.2",
  "40401": "Cataclysm Classic 4.4.1",
  "40400": "Cataclysm Classic 4.4.0",
  "30403": "Wrath Classic 3.4.3",
  "11507": "Classic Era 1.15.7",
  "11506": "Classic Era 1.15.6",
  "11505": "Classic Era 1.15.5",
};

const REQUIRED_FIELDS = ["Interface", "Title"];

export class TocValidator {
  validate(tocContent: string, expectedAddonName?: string): TocValidationResult {
    const errors: TocIssue[] = [];
    const warnings: TocIssue[] = [];
    const info: TocIssue[] = [];

    const lines = tocContent.split("\n");
    const metadata: Record<string, string> = {};
    const files: string[] = [];
    let interfaceVersions: string[] = [];

    // Parse TOC lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      if (!line || line.startsWith("#")) {
        // Parse ## directives
        const directiveMatch = line.match(/^##\s*([^:]+):\s*(.+)$/);
        if (directiveMatch) {
          const key = directiveMatch[1].trim();
          const value = directiveMatch[2].trim();
          metadata[key] = value;

          if (key === "Interface") {
            interfaceVersions = value.split(",").map((v) => v.trim());
          }
        }
        continue;
      }

      // Non-comment, non-empty lines are file references
      if (!line.startsWith("#")) {
        files.push(line);

        // Check for common file reference issues
        if (line.includes("\\")) {
          warnings.push({
            line: lineNum,
            message: `Backslash in file path — use forward slashes`,
            fix: line.replace(/\\/g, "/"),
          });
        }
      }
    }

    // --- Validation checks ---

    // Required fields
    for (const field of REQUIRED_FIELDS) {
      if (!metadata[field]) {
        errors.push({
          message: `Missing required field: ## ${field}`,
          fix: field === "Interface" ? "## Interface: 120000" : `## ${field}: YourValue`,
        });
      }
    }

    // Interface version validation
    for (const version of interfaceVersions) {
      if (!/^\d{5,6}$/.test(version)) {
        errors.push({
          message: `Invalid Interface version format: '${version}' — must be 5-6 digits`,
          fix: `Use format like 120000 (major*10000 + minor*100 + patch)`,
        });
      } else if (!KNOWN_INTERFACE_VERSIONS[version]) {
        const closest = this.findClosestVersion(version);
        warnings.push({
          message: `Unknown Interface version: ${version}`,
          fix: closest
            ? `Did you mean ${closest} (${KNOWN_INTERFACE_VERSIONS[closest]})?`
            : "Check the current game version",
        });
      } else {
        info.push({
          message: `Interface ${version} = ${KNOWN_INTERFACE_VERSIONS[version]}`,
        });
      }
    }

    // Multi-version support check
    if (interfaceVersions.length === 1) {
      info.push({
        message: `Single Interface version — consider adding multiple versions for wider compatibility`,
        fix: `## Interface: 120000, 110207`,
      });
    }

    // Title check
    if (metadata["Title"] && expectedAddonName) {
      if (!metadata["Title"].includes(expectedAddonName)) {
        warnings.push({
          message: `Title '${metadata["Title"]}' doesn't contain expected addon name '${expectedAddonName}'`,
        });
      }
    }

    // SavedVariables naming convention
    const svName = metadata["SavedVariables"];
    if (svName && !svName.endsWith("DB") && !svName.endsWith("Settings") && !svName.endsWith("Data")) {
      info.push({
        message: `SavedVariables '${svName}' — convention is to suffix with DB, Settings, or Data`,
      });
    }

    // Check for empty file list
    if (files.length === 0) {
      errors.push({
        message: "No Lua/XML files referenced in TOC",
        fix: "Add at least main.lua to the TOC",
      });
    }

    // Check file order — main.lua should typically be first or after libs
    const mainIdx = files.findIndex((f) => f.toLowerCase() === "main.lua");
    if (mainIdx === -1 && files.length > 0) {
      info.push({
        message: "No 'main.lua' file found in TOC — ensure your entry point is listed",
      });
    }

    // Category localization check
    const hasCategoryEnUS = "Category-enUS" in metadata;
    if (!hasCategoryEnUS && metadata["Title"]) {
      info.push({
        message: "Consider adding ## Category-enUS for addon browser categorization",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      info,
      parsed: {
        interfaceVersions,
        title: metadata["Title"],
        savedVariables: metadata["SavedVariables"]?.split(",").map((s) => s.trim()),
        savedVariablesPerCharacter: metadata["SavedVariablesPerCharacter"]?.split(",").map((s) => s.trim()),
        dependencies: metadata["Dependencies"]?.split(",").map((s) => s.trim()),
        optionalDeps: metadata["OptionalDeps"]?.split(",").map((s) => s.trim()),
        files,
        metadata,
      },
    };
  }

  private findClosestVersion(version: string): string | null {
    const num = parseInt(version, 10);
    let closest: string | null = null;
    let minDiff = Infinity;

    for (const known of Object.keys(KNOWN_INTERFACE_VERSIONS)) {
      const diff = Math.abs(parseInt(known, 10) - num);
      if (diff < minDiff) {
        minDiff = diff;
        closest = known;
      }
    }

    return minDiff < 500 ? closest : null;
  }
}
