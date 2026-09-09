import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ChatRuntimeQueryOptions } from '@/core/runtime/types';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
} from '@/providers/acp';
import type { AcpSessionModelState, AcpSessionModeState } from '@/providers/acp/types';
import {
  decodeReasonixModelId,
  encodeReasonixModelId,
  REASONIX_SYNTHETIC_MODEL_ID,
} from '@/providers/reasonix/models';
import { mapReasonixModeToGrimoire } from '@/providers/reasonix/modes';
import {
  getReasonixProviderSettings,
  type ReasonixDiscoveredModel,
  type ReasonixMode,
  updateReasonixProviderSettings,
} from '@/providers/reasonix/settings';

const PROVIDER_ID = 'reasonix' as const;

export interface ReasonixSessionConfigPorts {
  /** The whole settings object, which this both reads and seeds. */
  readonly settingsBag: () => Record<string, unknown>;
}

/**
 * What a Reasonix session is configured with, and what the vault knows of it.
 *
 * Devin's, over a session that answers in ACP's own vocabulary: `session/new`
 * replies with `models` and `modes` beside its `configOptions`, and
 * `extractAcpSessionModelState` and `extractAcpSessionModeState` read both.
 *
 * The mode a session *reports when it opens* is recorded and never adopted:
 * only a `current_mode_update` moves the toolbar, and it is translated on the
 * way, because the toolbar speaks Grimoire's three values and Reasonix's `goal`
 * is not among them.
 */
export class ReasonixSessionConfigState {
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;

  constructor(private readonly ports: ReasonixSessionConfigPorts) {}

  /** The model the session is on, in Reasonix's own id. */
  get sessionModelId(): string | null {
    return this.currentSessionModelId;
  }

  /** The mode the session is in, as Reasonix names it. */
  get sessionModeId(): string | null {
    return this.currentSessionModeId;
  }

  /** Records what a set actually applied, so the next turn does not repeat it. */
  markApplied(applied: {
    readonly modeId?: string | null;
    readonly modelId?: string | null;
  }): void {
    if (applied.modeId) {
      this.currentSessionModeId = applied.modeId;
    }
    if (applied.modelId) {
      this.currentSessionModelId = applied.modelId;
    }
  }

  /** Forgets what the live session was set to. */
  forgetSession(): void {
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
  }

  /**
   * This provider's own permission mode, not whichever one was projected last.
   *
   * `settings.permissionMode` is a shared field the coordinator projects the
   * active provider's value into; reading it directly answers for whoever was
   * toggled most recently.
   */
  permissionMode(): string {
    const snapshot = ProviderSettingsCoordinator
      .getProviderSettingsSnapshot(this.ports.settingsBag(), PROVIDER_ID);
    return typeof snapshot.permissionMode === 'string' ? snapshot.permissionMode : '';
  }

  /** Whether this session may reach outside the workspace. */
  fullAccess(): boolean {
    return this.permissionMode() === 'full_access';
  }

  /** What a turn should ask the session to switch to, before translation. */
  resolveSelectedModeId(): string {
    return this.permissionMode()
      || getReasonixProviderSettings(this.ports.settingsBag()).selectedMode;
  }

  resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    if (queryOptions?.model !== undefined) {
      return typeof queryOptions.model === 'string'
        ? decodeReasonixModelId(queryOptions.model)
        : null;
    }
    const settingsBag = this.ports.settingsBag();
    const providerSettings = getReasonixProviderSettings(settingsBag);
    const savedProviderModel = settingsBag.savedProviderModel;
    const savedReasonixModel = savedProviderModel
      && typeof savedProviderModel === 'object'
      && !Array.isArray(savedProviderModel)
      ? (savedProviderModel as Record<string, unknown>).reasonix
      : null;
    return typeof savedReasonixModel === 'string'
      ? decodeReasonixModelId(savedReasonixModel)
      : providerSettings.visibleModels[0] ?? null;
  }

  /** The model a usage badge is labelled with. */
  getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string {
    const rawModelId = this.currentSessionModelId ?? this.resolveSelectedRawModelId(queryOptions);
    return rawModelId ? encodeReasonixModelId(rawModelId) : REASONIX_SYNTHETIC_MODEL_ID;
  }

  /**
   * Takes on a mode the session says it switched to, and answers with the
   * toolbar's word for it. The one door that may move the user's selection.
   *
   * **Auto-approve survives a reported `normal`.** Reasonix runs Safe and
   * Auto-approve in the same session mode and separates them with the
   * `tool_approval` option, so a `current_mode_update` saying `normal` is not
   * evidence that the person left Auto-approve — and adopting it as Safe would
   * silently demote them every time the agent reported the mode it was already
   * in.
   */
  adoptCurrentMode(currentModeId: string): 'normal' | 'full_access' | 'plan' {
    this.currentSessionModeId = currentModeId;
    const reported = mapReasonixModeToGrimoire(currentModeId);
    const permissionMode = reported === 'normal' && this.permissionMode() === 'full_access'
      ? 'full_access'
      : reported;
    updateReasonixProviderSettings(this.ports.settingsBag(), { selectedMode: permissionMode });
    return permissionMode;
  }

  /**
   * Keeps what a session reported about itself.
   *
   * Answered once, when the session is created or loaded; a selector fed only
   * from later updates stays empty on a fresh vault.
   */
  syncSessionDiscovery(params: {
    configOptions?: Parameters<typeof extractAcpSessionModelState>[0]['configOptions'];
    models?: AcpSessionModelState | null;
    modes?: AcpSessionModeState | null;
  }): boolean {
    const modelState = extractAcpSessionModelState(params);
    const modeState = extractAcpSessionModeState(params);
    const updates: Parameters<typeof updateReasonixProviderSettings>[1] = {};

    if (modelState.currentModelId) {
      this.currentSessionModelId = modelState.currentModelId;
    }

    if (modelState.availableModels.length > 0) {
      updates.discoveredModels = modelState.availableModels.map((model): ReasonixDiscoveredModel => ({
        description: model.description ?? undefined,
        label: model.name || model.id,
        rawId: model.id,
      }));
      updates.visibleModels = modelState.availableModels
        .map((model) => model.id.trim())
        .filter(Boolean);
    }

    if (modeState.availableModes.length > 0) {
      updates.availableModes = modeState.availableModes.map((mode): ReasonixMode => ({
        description: mode.description ?? undefined,
        id: mode.id,
        name: mode.name,
      }));
    }

    if (modeState.currentModeId) {
      // Recorded, not adopted: where the agent starts is not what the user
      // picked. Only `adoptCurrentMode` moves the toolbar.
      this.currentSessionModeId = modeState.currentModeId;
    }

    if (Object.keys(updates).length === 0) {
      return false;
    }
    updateReasonixProviderSettings(this.ports.settingsBag(), updates);
    return true;
  }
}
