import type { BlizzardApiDocParser } from "../parsers/blizzard-api-doc.js";

/** Known deprecated functions → modern replacements */
const KNOWN_MIGRATIONS: Record<string, { replacement: string; patch: string; notes?: string }> = {
  // Container APIs (moved to C_Container in 10.0)
  "GetContainerItemInfo": { replacement: "C_Container.GetContainerItemInfo", patch: "10.0.0", notes: "Returns a table instead of multiple values" },
  "GetContainerNumSlots": { replacement: "C_Container.GetContainerNumSlots", patch: "10.0.0" },
  "GetContainerItemLink": { replacement: "C_Container.GetContainerItemLink", patch: "10.0.0" },
  "GetContainerNumFreeSlots": { replacement: "C_Container.GetContainerNumFreeSlots", patch: "10.0.0" },
  "GetContainerItemID": { replacement: "C_Container.GetContainerItemID", patch: "10.0.0" },
  "UseContainerItem": { replacement: "C_Container.UseContainerItem", patch: "10.0.0" },
  "PickupContainerItem": { replacement: "C_Container.PickupContainerItem", patch: "10.0.0" },
  "SplitContainerItem": { replacement: "C_Container.SplitContainerItem", patch: "10.0.0" },

  // Spell APIs (moved to C_Spell in 11.0)
  "GetSpellInfo": { replacement: "C_Spell.GetSpellInfo", patch: "11.0.0", notes: "Returns a table instead of multiple values" },
  "GetSpellName": { replacement: "C_Spell.GetSpellName", patch: "11.0.0" },
  "GetSpellTexture": { replacement: "C_Spell.GetSpellTexture", patch: "11.0.0" },
  "GetSpellCooldown": { replacement: "C_Spell.GetSpellCooldown", patch: "11.0.0", notes: "Returns a SpellCooldownInfo table" },
  "GetSpellCharges": { replacement: "C_Spell.GetSpellCharges", patch: "11.0.0" },
  "GetSpellCount": { replacement: "C_Spell.GetSpellCount", patch: "11.0.0" },
  "IsSpellKnown": { replacement: "C_SpellBook.IsSpellInSpellBook", patch: "11.0.0" },
  "IsUsableSpell": { replacement: "C_Spell.IsSpellUsable", patch: "11.0.0" },
  "IsSpellInRange": { replacement: "C_Spell.IsSpellInRange", patch: "11.0.0" },

  // Aura APIs (moved to C_UnitAuras in 10.0)
  "UnitBuff": { replacement: "C_UnitAuras.GetBuffDataByIndex", patch: "10.0.0", notes: "Returns AuraData table" },
  "UnitDebuff": { replacement: "C_UnitAuras.GetDebuffDataByIndex", patch: "10.0.0", notes: "Returns AuraData table" },
  "UnitAura": { replacement: "C_UnitAuras.GetAuraDataByIndex", patch: "10.0.0", notes: "Returns AuraData table" },

  // Item APIs (moved to C_Item in 11.0)
  "GetItemInfo": { replacement: "C_Item.GetItemInfo", patch: "11.0.0", notes: "Returns a table — use C_Item.GetItemInfoInstant for cached data" },
  "GetItemInfoInstant": { replacement: "C_Item.GetItemInfoInstant", patch: "11.0.0" },

  // Currency APIs
  "GetCurrencyInfo": { replacement: "C_CurrencyInfo.GetCurrencyInfo", patch: "8.0.1" },
  "GetCurrencyListInfo": { replacement: "C_CurrencyInfo.GetCurrencyListInfo", patch: "8.0.1" },

  // AddOns APIs
  "GetNumAddOns": { replacement: "C_AddOns.GetNumAddOns", patch: "11.0.0" },
  "GetAddOnInfo": { replacement: "C_AddOns.GetAddOnInfo", patch: "11.0.0" },
  "IsAddOnLoaded": { replacement: "C_AddOns.IsAddOnLoaded", patch: "11.0.0" },
  "EnableAddOn": { replacement: "C_AddOns.EnableAddOn", patch: "11.0.0" },
  "DisableAddOn": { replacement: "C_AddOns.DisableAddOn", patch: "11.0.0" },
  "LoadAddOn": { replacement: "C_AddOns.LoadAddOn", patch: "11.0.0" },

  // Tooltip APIs
  "GameTooltip:SetBagItem": { replacement: "C_TooltipInfo.GetBagItem + GameTooltip:ProcessInfo", patch: "10.0.2" },

  // Misc
  "GetAddOnMetadata": { replacement: "C_AddOns.GetAddOnMetadata", patch: "11.0.0" },
  "GetBuildInfo": { replacement: "Still valid but check for 12.x changes", patch: "current" },
};

export interface DeprecationReport {
  deprecated: Array<{
    function: string;
    line: number;
    column: number;
    replacement: string;
    patch: string;
    notes?: string;
  }>;
  unknownApis: string[];
  summary: string;
}

export interface MigrationSuggestion {
  oldFunction: string;
  replacement: string;
  patch: string;
  notes?: string;
  codeExample?: string;
}

export class ApiMigration {
  constructor(private readonly parser?: BlizzardApiDocParser) {}

  async checkDeprecations(luaCode: string): Promise<DeprecationReport> {
    const deprecated: DeprecationReport["deprecated"] = [];
    const lines = luaCode.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const [oldFn, migration] of Object.entries(KNOWN_MIGRATIONS)) {
        // Match function calls (not inside comments)
        const commentStart = line.indexOf("--");
        const searchLine = commentStart >= 0 ? line.slice(0, commentStart) : line;

        const fnRegex = new RegExp(`\\b${escapeRegex(oldFn)}\\s*\\(`, "g");
        let match;
        while ((match = fnRegex.exec(searchLine)) !== null) {
          deprecated.push({
            function: oldFn,
            line: i + 1,
            column: match.index + 1,
            replacement: migration.replacement,
            patch: migration.patch,
            notes: migration.notes,
          });
        }
      }
    }

    return {
      deprecated,
      unknownApis: [],
      summary: deprecated.length === 0
        ? "No deprecated API calls found."
        : `Found ${deprecated.length} deprecated API call(s) that should be updated.`,
    };
  }

  async suggestMigration(oldFunction: string): Promise<MigrationSuggestion> {
    // Check known migrations first
    const known = KNOWN_MIGRATIONS[oldFunction];
    if (known) {
      return {
        oldFunction,
        replacement: known.replacement,
        patch: known.patch,
        notes: known.notes,
        codeExample: this.generateMigrationExample(oldFunction, known),
      };
    }

    // Try to find in API docs (might be renamed to a C_ namespace)
    if (this.parser) {
      const results = await this.parser.lookupFunction(oldFunction, false);
      if (results.length > 0) {
        return {
          oldFunction,
          replacement: results[0].fullName,
          patch: "unknown",
          notes: `Found matching function: ${results[0].fullName} in ${results[0].system}`,
        };
      }
    }

    return {
      oldFunction,
      replacement: "unknown",
      patch: "unknown",
      notes: `No known migration path for '${oldFunction}'. Check warcraft.wiki.gg for current status.`,
    };
  }

  private generateMigrationExample(
    oldFn: string,
    migration: { replacement: string; notes?: string }
  ): string {
    const lines: string[] = [
      `-- OLD (deprecated):`,
      `-- local result = ${oldFn}(args)`,
      ``,
      `-- NEW:`,
      `-- local result = ${migration.replacement}(args)`,
    ];

    if (migration.notes?.includes("Returns a table")) {
      lines.push(`-- Note: The new API returns a table instead of multiple values.`);
      lines.push(`-- Access fields via result.fieldName instead of positional returns.`);
    }

    return lines.join("\n");
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
