import { isRecord } from '../../../utils/records';
import type { AcpSessionNotification, AcpUsage } from '../../acp';

/**
 * The one notification Reasonix sends under its own name that anything is
 * drawn from.
 *
 * `reasonix acp` never sends the ACP `usage_update` session update — probed on
 * 2026-09-09 across a trivial turn and an eleven-tool Plan turn, and absent
 * from both. What it sends instead is `_reasonix.io/session/status_update`:
 * the whole session status, three or nine times a turn, with the turn's and the
 * session's tokens on it. Without this the usage badge would have nothing, and
 * with a guessed shape it would have the wrong thing.
 *
 * The status carries no context-window size, so the notification produced here
 * reports none. `size: 0` is read by `ReasonixContentPresenter` as "no window
 * was stated" rather than as a window of nothing, which keeps
 * `contextWindowIsAuthoritative` false and the badge honest about what it knows.
 */
export const REASONIX_STATUS_UPDATE_METHOD = '_reasonix.io/session/status_update';

export const REASONIX_SESSION_NOTIFICATION_METHODS = [
  REASONIX_STATUS_UPDATE_METHOD,
] as const;

/** Where the turn's own token counts ride on the synthesised usage update. */
export const REASONIX_TURN_USAGE_META_KEY = 'reasonix.io/turnUsage';

export function parseReasonixSessionNotification(
  method: string,
  params: unknown,
): AcpSessionNotification | null {
  if (method !== REASONIX_STATUS_UPDATE_METHOD || !isRecord(params)) {
    return null;
  }
  const sessionId = params.sessionId;
  const status = params.status;
  if (typeof sessionId !== 'string' || !sessionId.trim() || !isRecord(status)) {
    return null;
  }
  const usage = isRecord(status.usage) ? status.usage : null;
  const turn = readUsage(usage?.turn);
  if (!turn) {
    return null;
  }
  return {
    sessionId,
    update: {
      sessionUpdate: 'usage_update',
      // No window is stated anywhere in the status, so none is claimed here.
      size: 0,
      used: turn.totalTokens,
      cost: readCost(usage?.turn),
      _meta: { [REASONIX_TURN_USAGE_META_KEY]: turn },
    } as AcpSessionNotification['update'],
  };
}

/** The turn's tokens, in the shape every ACP usage badge is built from. */
function readUsage(value: unknown): AcpUsage | null {
  if (!isRecord(value)) {
    return null;
  }
  const totalTokens = readNumber(value.totalTokens);
  if (totalTokens === null || totalTokens <= 0) {
    // A turn that has not started reports zeros on every field; a badge built
    // from those would replace what the last turn spent with nothing.
    return null;
  }
  return {
    cachedReadTokens: readNumber(value.cacheHitTokens) ?? 0,
    cachedWriteTokens: readNumber(value.cacheMissTokens) ?? 0,
    inputTokens: readNumber(value.promptTokens) ?? 0,
    outputTokens: readNumber(value.completionTokens) ?? 0,
    thoughtTokens: readNumber(value.reasoningTokens) ?? 0,
    totalTokens,
  };
}

/**
 * What the turn cost, when Reasonix could price it.
 *
 * Both fields are null on a provider with no price table — the recorded
 * session says so as `costQuote.incompleteReason: "no_price"` — so an unpriced
 * turn contributes nothing to the spend indicator rather than a zero.
 */
function readCost(value: unknown): { amount: number; currency: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const amount = readNumber(value.estimatedCost);
  const currency = typeof value.currency === 'string' ? value.currency.trim() : '';
  return amount !== null && amount > 0 && currency ? { amount, currency } : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
