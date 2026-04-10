interface ScaffoldOptions {
  features: string[];
  interfaceVersions: string;
}

interface ScaffoldResult {
  files: Array<{
    path: string;
    content: string;
    description: string;
  }>;
}

/**
 * Generates WoW addon boilerplate following NetoussAddons conventions.
 */
export class AddonScaffold {
  constructor(private readonly workspacePath: string) {}

  generate(addonName: string, options: ScaffoldOptions): ScaffoldResult {
    const dbName = `${addonName}DB`;
    const files: ScaffoldResult["files"] = [];

    // --- TOC file ---
    files.push({
      path: `${addonName}/${addonName}.toc`,
      content: this.generateToc(addonName, dbName, options),
      description: "Table of Contents — addon metadata and file list",
    });

    // --- main.lua ---
    files.push({
      path: `${addonName}/main.lua`,
      content: this.generateMainLua(addonName, dbName, options),
      description: "Main entry point with event dispatcher and core logic",
    });

    // --- Config.lua (if options panel requested) ---
    if (options.features.includes("options_panel")) {
      files.push({
        path: `${addonName}/Config.lua`,
        content: this.generateConfigLua(addonName, dbName),
        description: "Settings/options panel integration",
      });
    }

    return { files };
  }

  private generateToc(addonName: string, dbName: string, options: ScaffoldOptions): string {
    const lines: string[] = [
      `## Interface: ${options.interfaceVersions}`,
      `## Title: ${addonName}`,
      `## Notes: Description of ${addonName}`,
      `## Author: YourName`,
      `## Version: 0.1.0`,
    ];

    if (options.features.includes("savedvariables")) {
      lines.push(`## SavedVariables: ${dbName}`);
    }

    lines.push(
      `## IconTexture: Interface\\Icons\\INV_Misc_QuestionMark`,
      `## Category-enUS: User Interface`,
      `## X-Category: Interface Enhancements`,
      ``
    );

    lines.push("main.lua");
    if (options.features.includes("options_panel")) {
      lines.push("Config.lua");
    }

    return lines.join("\n") + "\n";
  }

  private generateMainLua(addonName: string, dbName: string, options: ScaffoldOptions): string {
    const lines: string[] = [];

    // Namespace
    lines.push(`local ADDON_NAME, ns = ...`);
    lines.push(`local ${addonName} = {}`);
    lines.push(``);

    // Defaults
    if (options.features.includes("savedvariables")) {
      lines.push(`local defaults = {`);
      lines.push(`    enabled = true,`);
      lines.push(`}`);
      lines.push(``);
    }

    // OnLoad
    lines.push(`function ${addonName}:OnLoad()`);
    lines.push(`    self.frame = CreateFrame("Frame", ADDON_NAME .. "Frame")`);
    lines.push(`    self.frame:SetScript("OnEvent", function(_, event, ...)`);
    lines.push(`        if self[event] then`);
    lines.push(`            self[event](self, ...)`);
    lines.push(`        end`);
    lines.push(`    end)`);
    lines.push(``);
    lines.push(`    self.frame:RegisterEvent("ADDON_LOADED")`);
    lines.push(`    self.frame:RegisterEvent("PLAYER_LOGIN")`);

    if (options.features.includes("combat_check")) {
      lines.push(`    self.frame:RegisterEvent("PLAYER_REGEN_DISABLED")`);
      lines.push(`    self.frame:RegisterEvent("PLAYER_REGEN_ENABLED")`);
    }

    lines.push(`end`);
    lines.push(``);

    // ADDON_LOADED
    lines.push(`function ${addonName}:ADDON_LOADED(name)`);
    lines.push(`    if name ~= ADDON_NAME then return end`);

    if (options.features.includes("savedvariables")) {
      lines.push(``);
      lines.push(`    -- Initialize SavedVariables`);
      lines.push(`    ${dbName} = ${dbName} or {}`);
      lines.push(`    for k, v in pairs(defaults) do`);
      lines.push(`        if ${dbName}[k] == nil then`);
      lines.push(`            ${dbName}[k] = v`);
      lines.push(`        end`);
      lines.push(`    end`);
      lines.push(`    self.db = ${dbName}`);
    }

    if (options.features.includes("slash_command")) {
      lines.push(``);
      lines.push(`    -- Register slash commands`);
      const slashName = addonName.toLowerCase();
      lines.push(`    SLASH_${addonName.toUpperCase()}1 = "/${slashName}"`);
      lines.push(`    SlashCmdList["${addonName.toUpperCase()}"] = function(msg)`);
      lines.push(`        ${addonName}:HandleSlashCommand(msg)`);
      lines.push(`    end`);
    }

    lines.push(``);
    lines.push(`    self.frame:UnregisterEvent("ADDON_LOADED")`);
    lines.push(`end`);
    lines.push(``);

    // PLAYER_LOGIN
    lines.push(`function ${addonName}:PLAYER_LOGIN()`);
    lines.push(`    -- Called once after all addons are loaded and the player is in the world`);
    lines.push(`end`);
    lines.push(``);

    // Combat check events
    if (options.features.includes("combat_check")) {
      lines.push(`function ${addonName}:PLAYER_REGEN_DISABLED()`);
      lines.push(`    -- Entered combat — disable UI changes on secure frames`);
      lines.push(`    self.inCombat = true`);
      lines.push(`end`);
      lines.push(``);
      lines.push(`function ${addonName}:PLAYER_REGEN_ENABLED()`);
      lines.push(`    -- Left combat — safe to modify frames again`);
      lines.push(`    self.inCombat = false`);
      lines.push(`end`);
      lines.push(``);
    }

    // Slash command handler
    if (options.features.includes("slash_command")) {
      lines.push(`function ${addonName}:HandleSlashCommand(msg)`);
      lines.push(`    local cmd = msg:lower():trim()`);
      lines.push(`    if cmd == "help" or cmd == "" then`);
      lines.push(`        print("|cff00ccff${addonName}|r commands:")`);
      lines.push(`        print("  /${addonName.toLowerCase()} help — Show this help")`);
      lines.push(`        print("  /${addonName.toLowerCase()} toggle — Toggle on/off")`);
      lines.push(`    elseif cmd == "toggle" then`);

      if (options.features.includes("savedvariables")) {
        lines.push(`        self.db.enabled = not self.db.enabled`);
        lines.push(`        print("|cff00ccff${addonName}|r " .. (self.db.enabled and "enabled" or "disabled"))`);
      }

      lines.push(`    end`);
      lines.push(`end`);
      lines.push(``);
    }

    // Movable frame helper
    if (options.features.includes("movable_frame")) {
      lines.push(`function ${addonName}:CreateMovableFrame(name, width, height)`);
      lines.push(`    local f = CreateFrame("Frame", name, UIParent, "BackdropTemplate")`);
      lines.push(`    f:SetSize(width, height)`);
      lines.push(`    f:SetPoint("CENTER")`);
      lines.push(`    f:SetMovable(true)`);
      lines.push(`    f:EnableMouse(true)`);
      lines.push(`    f:RegisterForDrag("LeftButton")`);
      lines.push(`    f:SetScript("OnDragStart", function(self)`);
      lines.push(`        if not InCombatLockdown() then`);
      lines.push(`            self:StartMoving()`);
      lines.push(`        end`);
      lines.push(`    end)`);
      lines.push(`    f:SetScript("OnDragStop", function(self)`);
      lines.push(`        self:StopMovingOrSizing()`);

      if (options.features.includes("savedvariables")) {
        lines.push(`        -- Save position`);
        lines.push(`        local point, _, relPoint, x, y = self:GetPoint()`);
        lines.push(`        ${addonName}.db.position = { point = point, relPoint = relPoint, x = x, y = y }`);
      }

      lines.push(`    end)`);
      lines.push(``);

      if (options.features.includes("savedvariables")) {
        lines.push(`    -- Restore saved position`);
        lines.push(`    local pos = self.db and self.db.position`);
        lines.push(`    if pos then`);
        lines.push(`        f:ClearAllPoints()`);
        lines.push(`        f:SetPoint(pos.point, UIParent, pos.relPoint, pos.x, pos.y)`);
        lines.push(`    end`);
      }

      lines.push(``);
      lines.push(`    return f`);
      lines.push(`end`);
      lines.push(``);
    }

    // Initialize
    lines.push(`-- Initialize the addon`);
    lines.push(`${addonName}:OnLoad()`);
    lines.push(``);

    return lines.join("\n");
  }

  private generateConfigLua(addonName: string, dbName: string): string {
    return [
      `local ADDON_NAME, ns = ...`,
      ``,
      `-- Options panel using Settings API (Retail 10.0+)`,
      `local category = Settings.RegisterVerticalLayoutCategory("|cff00ccff${addonName}|r")`,
      ``,
      `local function InitSettings(category)`,
      `    local variable = Settings.RegisterAddOnSetting(category, "${addonName}_Enabled", "enabled", ${dbName}, type(true), "Enable ${addonName}", true)`,
      `    Settings.CreateCheckbox(category, variable, "Enable or disable ${addonName}")`,
      `end`,
      ``,
      `InitSettings(category)`,
      `Settings.RegisterAddOnCategory(category)`,
      ``,
    ].join("\n");
  }
}
