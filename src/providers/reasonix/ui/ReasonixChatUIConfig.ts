import type {
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import type {
  ProviderChatUIConfig,
} from '../../../providers/shared/providerHostContracts';
import { REASONIX_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeReasonixModelId,
  encodeReasonixModelId,
  isReasonixModelSelectionId,
  REASONIX_SYNTHETIC_MODEL_ID,
} from '../models';
import {
  getReasonixProviderSettings,
  updateReasonixProviderSettings,
} from '../settings';

const REASONIX_MODELS: ProviderUIOption[] = [
  {
    description: 'Reasonix CLI ACP runtime',
    label: 'Reasonix',
    value: REASONIX_SYNTHETIC_MODEL_ID,
  },
];
/**
 * The window every Reasonix session is measured against, because the wire never
 * states one.
 *
 * Devin's comment here said the wire overrides it per turn; that is not true of
 * this provider. Reasonix sends no `usage_update`, and the status notification
 * it sends instead carries no window size, so `contextWindowIsAuthoritative`
 * stays false and this figure is what the percentage is drawn from. It is a
 * default rather than a fact: the window really belongs to whichever model the
 * configured provider block serves, and a person whose model differs sets it in
 * the settings tab's custom context limits.
 */
const DEFAULT_CONTEXT_WINDOW = 200_000;
/**
 * One option, because the capability says `reasoningControl: 'none'` and the
 * contribution builds no reasoning group from it.
 *
 * Not because Reasonix has no effort control — it has an `effort` config option
 * — but because that option is `auto`, `enabled`, `disabled`, a switch for
 * whether to think rather than the tiered budget `reasoningControl` models.
 * Driving it is a separate piece of work; `ReasonixProviderModule` says so.
 */
const REASONIX_DEFAULT_REASONING = 'default';
const REASONIX_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { label: 'Default', value: REASONIX_DEFAULT_REASONING },
];
const REASONIX_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};

function getReasonixModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const reasonixSettings = getReasonixProviderSettings(settings);
  const discoveredModels = new Map(reasonixSettings.discoveredModels.map((model) => [
    model.rawId,
    model,
  ]));
  const optionRawIds = reasonixSettings.discoveredModels.length > 0
    ? reasonixSettings.discoveredModels.map((model) => model.rawId)
    : reasonixSettings.visibleModels;

  const options: ProviderUIOption[] = [];
  for (const rawId of optionRawIds) {
    const discovered = discoveredModels.get(rawId);
    const label = reasonixSettings.modelAliases[rawId] ?? discovered?.label ?? rawId;
    options.push({
      description: discovered?.description ?? 'Reasonix CLI ACP model',
      label,
      value: encodeReasonixModelId(rawId),
    });
  }

  return options.length > 0 ? options : [...REASONIX_MODELS];
}

export const reasonixChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getReasonixModelOptions(settings);
  },

  ownsModel(model: string): boolean {
    return isReasonixModelSelectionId(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return REASONIX_REASONING_OPTIONS.map((option) => ({ ...option }));
  },

  getDefaultReasoningValue(): string {
    return REASONIX_DEFAULT_REASONING;
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isReasonixModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeReasonixModelId(model);
    settingsBag.model = rawModelId ? encodeReasonixModelId(rawModelId) : REASONIX_SYNTHETIC_MODEL_ID;
  },

  applyReasoningSelection(): void {
    // Nothing to apply: see `REASONIX_REASONING_OPTIONS`.
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getReasonixModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return REASONIX_SYNTHETIC_MODEL_ID;
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return REASONIX_PERMISSION_MODE_TOGGLE;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateReasonixProviderSettings(settingsBag, { selectedMode: value });
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getReasonixProviderSettings(settings).selectedMode || null;
  },

  getProviderIcon() {
    return REASONIX_PROVIDER_ICON;
  },
};
