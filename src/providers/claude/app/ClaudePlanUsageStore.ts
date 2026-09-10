import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type {
  ProviderPlanUsageWindow,
} from '../../../core/providers/types';
import { formatPlanResetLabel, resolvePlanResetDate } from '../../../providers/shared/planUsageReset';
import type {
  ProviderPlanUsage,
  ProviderPlanUsageContext,
} from '../../../providers/shared/providerHostContracts';
import { ProviderSpendUsageStore } from '../../../providers/shared/ProviderSpendUsageStore';
import { isRecord } from '../../../utils/records';
import { getClaudeProviderSettings } from '../settings';
import { loadClaudeStatusLineUsageSnapshot } from './ClaudeStatusLineUsageSnapshot';

type ClaudeRateLimitType = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';

interface ClaudeRateLimitWindowEntry {
  key: string;
  window: ProviderPlanUsageWindow;
}

/**
 * Windows resolved from `rate_limit_info.unifiedWindows`. The SDK also reports
 * `seven_day_overage_included` there, which carries separate product meaning and
 * stays out until the readout defines how to present it.
 */
const UNIFIED_RATE_LIMIT_KEYS: readonly ClaudeRateLimitType[] = ['five_hour', 'seven_day'];

export class ClaudePlanUsageStore extends ProviderSpendUsageStore {
  private windows = new Map<string, ProviderPlanUsageWindow>();

  constructor() {
    super({
      plan: 'Claude Code',
      note: 'SDK token cost reported for completed turns.',
      isAvailable: settings => getClaudeProviderSettings(settings).enabled,
    });
  }

  recordSdkMessage(message: SDKMessage | Record<string, unknown>): boolean {
    const rateLimitWindows = parseClaudeRateLimitWindows(message);
    if (rateLimitWindows.length > 0) {
      let quotaChanged = false;
      for (const { key, window } of rateLimitWindows) {
        const current = this.windows.get(key);
        if (JSON.stringify(current) !== JSON.stringify(window)) {
          quotaChanged = true;
        }
        this.windows.set(key, window);
      }
      return quotaChanged;
    }

    if (!isRecord(message) || message.type !== 'result' || !isRecord(message.modelUsage)) {
      return false;
    }

    let changed = false;
    for (const usage of Object.values(message.modelUsage)) {
      if (!isRecord(usage)) {
        continue;
      }
      const costUSD = usage.costUSD;
      if (typeof costUSD === 'number' && Number.isFinite(costUSD) && costUSD > 0) {
        changed = this.recordCost({ amount: costUSD, currency: 'USD' }) || changed;
      }
    }
    return changed;
  }

  reset(): void {
    super.reset();
    this.windows.clear();
  }

  getCachedUsage(context: ProviderPlanUsageContext): ProviderPlanUsage | null {
    const spendUsage = super.getCachedUsage(context);
    if (this.windows.size > 0) {
      return {
        plan: 'Claude Code',
        ...(spendUsage?.spend ? { spend: spendUsage.spend } : {}),
        ...(spendUsage?.note ? { note: spendUsage.note } : {}),
        windows: [...this.windows.values()],
      };
    }

    return spendUsage;
  }

  async refreshUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
    const adapter = context.plugin.storage?.getAdapter?.();
    if (adapter) {
      const windows = await loadClaudeStatusLineUsageSnapshot(adapter);
      if (windows) {
        for (const { key, window } of windows) {
          this.windows.set(key, window);
        }
      }
    }

    return this.getCachedUsage(context);
  }
}

export const claudePlanUsageStore = new ClaudePlanUsageStore();

/**
 * Every window one `rate_limit_event` reports: the per-window percentages in
 * `unifiedWindows` first, then the event-level window for a key they did not
 * report. The event-level record is frequently reset-only, so it must never
 * replace a key already resolved from `unifiedWindows`.
 */
function parseClaudeRateLimitWindows(message: SDKMessage | Record<string, unknown>): ClaudeRateLimitWindowEntry[] {
  if (!isRecord(message) || message.type !== 'rate_limit_event' || !isRecord(message.rate_limit_info)) {
    return [];
  }

  const info = message.rate_limit_info;
  const entries = parseUnifiedRateLimitWindows(info);
  const eventWindow = parseEventRateLimitWindow(info);
  if (eventWindow && !entries.some(entry => entry.key === eventWindow.key)) {
    entries.push(eventWindow);
  }

  return entries;
}

function parseEventRateLimitWindow(info: Record<string, unknown>): ClaudeRateLimitWindowEntry | null {
  const rateLimitType = readRateLimitType(info.rateLimitType);
  if (!rateLimitType) {
    return null;
  }

  const pct = readUtilizationPct(info);
  const resetValue = readResetValue(info, rateLimitType);
  const reset = formatPlanResetLabel(resetValue);
  const label = formatRateLimitLabel(rateLimitType);
  if (!reset || !label) {
    return null;
  }

  const resetAt = resolvePlanResetDate(resetValue);

  return {
    key: rateLimitType,
    window: {
      label,
      pct: pct ?? 0,
      ...(pct === null ? { pctKnown: false } : {}),
      reset,
      ...(resetAt ? { resetAt: resetAt.getTime() } : {}),
    },
  };
}

/**
 * Recent Claude CLI builds report the consumed percentage per window in
 * `rate_limit_info.unifiedWindows` and leave the top-level `utilization`
 * undefined on most events. Reading only the top-level field leaves the window
 * at `pctKnown: false`, which renders as an em dash and, while it is the only
 * known window, suppresses the quota readout entirely.
 *
 * The field is absent from the published SDK types, so it is read defensively:
 * anything unexpected falls back to the event-level window.
 */
function parseUnifiedRateLimitWindows(info: Record<string, unknown>): ClaudeRateLimitWindowEntry[] {
  const unifiedWindows = info.unifiedWindows;
  if (!isRecord(unifiedWindows)) {
    return [];
  }

  const entries: ClaudeRateLimitWindowEntry[] = [];
  for (const key of UNIFIED_RATE_LIMIT_KEYS) {
    const unifiedWindow = unifiedWindows[key];
    if (!isRecord(unifiedWindow)) {
      continue;
    }

    const pct = readUtilizationPct(unifiedWindow);
    const reset = formatPlanResetLabel(unifiedWindow.resetsAt);
    const label = formatRateLimitLabel(key);
    if (pct === null || !reset || !label) {
      continue;
    }

    const resetAt = resolvePlanResetDate(unifiedWindow.resetsAt);

    entries.push({
      key,
      window: { label, pct, reset, ...(resetAt ? { resetAt: resetAt.getTime() } : {}) },
    });
  }

  return entries;
}

function readRateLimitType(value: unknown): ClaudeRateLimitType | null {
  return value === 'five_hour'
    || value === 'seven_day'
    || value === 'seven_day_opus'
    || value === 'seven_day_sonnet'
    || value === 'overage'
    ? value
    : null;
}

function readUtilizationPct(info: Record<string, unknown>): number | null {
  const utilization = info.utilization;
  if (typeof utilization === 'number' && Number.isFinite(utilization)) {
    const pct = utilization > 0 && utilization <= 1 ? utilization * 100 : utilization;
    return clampPct(pct);
  }

  return info.status === 'rejected' ? 100 : null;
}

function readResetValue(info: Record<string, unknown>, rateLimitType: ClaudeRateLimitType): unknown {
  return rateLimitType === 'overage'
    ? info.overageResetsAt ?? info.resetsAt
    : info.resetsAt;
}

function formatRateLimitLabel(rateLimitType: ClaudeRateLimitType): string | null {
  if (rateLimitType === 'five_hour') {
    return '5-hr';
  }
  if (rateLimitType === 'seven_day') {
    return 'Weekly';
  }
  if (rateLimitType === 'seven_day_opus') {
    return 'Weekly Opus';
  }
  if (rateLimitType === 'seven_day_sonnet') {
    return 'Weekly Sonnet';
  }
  if (rateLimitType === 'overage') {
    return 'Overage';
  }
  return null;
}


function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}
