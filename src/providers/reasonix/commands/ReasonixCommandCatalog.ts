import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { VaultSkillCommandCatalog, type VaultSkillStorageAdapter } from '../../../core/providers/commands/VaultSkillCommandCatalog';
import type { ProviderCatalogRefreshOutcome } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type { SlashCommand } from '../../../core/types';

const SKILLS_PATH = '.reasonix/skills';

/**
 * What a Reasonix slash menu lists: the vault's skills, and the commands the
 * open session announced.
 *
 * The two roots are ones the CLI itself scans: its own `.reasonix/skills` and
 * the cross-provider `.agents/skills`. It scans `.agent/skills` and
 * `.claude/skills` too, and those are deliberately not offered as editable
 * roots here — a skill Grimoire wrote into another provider's directory would
 * be a file that provider's own surface then manages.
 *
 * **`.reasonix/commands/*.md` is not managed here, and that is a scope
 * decision rather than an absence.** Reasonix reads command files the way Qwen
 * does; the session announces whatever they define, so they are *listed*
 * through the runtime half below. Editing them is a manager this provider does
 * not declare — `ReasonixProviderModule` says so in the same words.
 */
export class ReasonixCommandCatalog implements ProviderCommandCatalog {
  private runtimeCommands: SlashCommand[] = [];
  private readonly skills: VaultSkillCommandCatalog;

  constructor(adapter?: VaultSkillStorageAdapter) {
    this.skills = new VaultSkillCommandCatalog(adapter, {
      providerId: 'reasonix',
      roots: [
        { id: 'reasonix', path: SKILLS_PATH, editable: true },
        { id: 'agents', path: '.agents/skills', editable: true },
      ],
      dropdown: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
    });
  }

  setRuntimeCommands(commands: SlashCommand[]): void {
    const seen = new Set<string>();
    this.runtimeCommands = commands.flatMap((command) => {
      const name = command.name.trim().replace(/^\/+/, '');
      if (!name || seen.has(name.toLowerCase())) return [];
      seen.add(name.toLowerCase());
      return [{ ...command, name }];
    });
    this.skills.setRuntimeCommands([]);
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    const vault = await this.listVaultEntries();
    const runtime = this.runtimeCommands.map((command) => runtimeEntry(command));
    const seen = new Set<string>();
    return [...runtime, ...vault].filter((entry) => {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  listVaultEntries(): Promise<ProviderCommandEntry[]> {
    return this.skills.listVaultEntries();
  }

  saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    return this.skills.saveVaultEntry(entry);
  }

  deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    return this.skills.deleteVaultEntry(entry);
  }

  defaultVaultStoragePath(): string { return SKILLS_PATH; }

  async refresh(): Promise<ProviderCatalogRefreshOutcome> {
    await this.skills.refresh();
    return 'refreshed';
  }
}

function runtimeEntry(command: SlashCommand): ProviderCommandEntry {
  return {
    id: command.id,
    providerId: 'reasonix',
    kind: 'command',
    name: command.name,
    description: command.description,
    content: command.content,
    argumentHint: command.argumentHint,
    allowedTools: command.allowedTools,
    model: command.model,
    disableModelInvocation: command.disableModelInvocation,
    userInvocable: command.userInvocable,
    context: command.context,
    agent: command.agent,
    hooks: command.hooks,
    scope: 'runtime',
    source: command.source ?? 'sdk',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}
