import type { ProviderPlanUsageWindow } from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { formatPlanResetLabel, resolvePlanResetDate } from '../../../providers/shared/planUsageReset';
import { isRecord } from '../../../utils/records';

export const CLAUDE_STATUSLINE_USAGE_SNAPSHOT_PATH = '.grimoire/claude/statusline-usage.json';

type ClaudeStatusLineRateLimitKey = 'five_hour' | 'seven_day';

export interface ClaudeStatusLineUsageWindow {
  key: ClaudeStatusLineRateLimitKey;
  window: ProviderPlanUsageWindow;
}

export async function loadClaudeStatusLineUsageSnapshot(
  adapter: Pick<VaultFileAdapter, 'exists' | 'read'>,
): Promise<ClaudeStatusLineUsageWindow[] | null> {
  try {
    if (!(await adapter.exists(CLAUDE_STATUSLINE_USAGE_SNAPSHOT_PATH))) {
      return null;
    }

    return parseClaudeStatusLineUsageSnapshot(
      JSON.parse(await adapter.read(CLAUDE_STATUSLINE_USAGE_SNAPSHOT_PATH)) as unknown,
    );
  } catch {
    return null;
  }
}

export function parseClaudeStatusLineUsageSnapshot(payload: unknown): ClaudeStatusLineUsageWindow[] | null {
  if (!isRecord(payload)) {
    return null;
  }

  const rateLimits = isRecord(payload.rate_limits)
    ? payload.rate_limits
    : isRecord(payload.rateLimits)
      ? payload.rateLimits
      : payload;
  if (!isRecord(rateLimits)) {
    return null;
  }

  const windows = [
    parseStatusLineWindow('five_hour', rateLimits.five_hour),
    parseStatusLineWindow('seven_day', rateLimits.seven_day),
  ].filter((window): window is ClaudeStatusLineUsageWindow => window !== null);

  return windows.length > 0 ? windows : null;
}

function parseStatusLineWindow(
  key: ClaudeStatusLineRateLimitKey,
  value: unknown,
): ClaudeStatusLineUsageWindow | null {
  if (!isRecord(value)) {
    return null;
  }

  const pct = readPct(value.used_percentage ?? value.usedPercentage);
  const resetValue = value.resets_at ?? value.resetsAt;
  const reset = formatPlanResetLabel(resetValue);
  if (pct === null || !reset) {
    return null;
  }

  const resetAt = resolvePlanResetDate(resetValue);

  return {
    key,
    window: {
      label: key === 'five_hour' ? '5-hr' : 'Weekly',
      pct,
      reset,
      ...(resetAt ? { resetAt: resetAt.getTime() } : {}),
    },
  };
}

function readPct(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim())
      : Number.NaN;
  return Number.isFinite(numeric) ? clampPct(numeric) : null;
}


function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}

