import type { AcpContentPayload } from '@/providers/acp/execution/AcpContentPayload';
import {
  mapGrimoireModeToReasonix,
  mapGrimoireModeToReasonixApproval,
} from '@/providers/reasonix/modes';

import type { ReasonixExecutionDynamicApplier } from './ReasonixExecutionBackend';

/** What one Reasonix turn asks its session to be set to, once the session exists. */
export interface ReasonixAcpDynamicConfig {
  readonly modeId?: string;
  readonly modelId?: string;
}

export interface ReasonixAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<ReasonixAcpDynamicConfig>;
}

/** Told when the agent would not take the mode the vault asked for. */
export type ReasonixModeRefusedReporter = (input: {
  /** Grimoire's own word for it, which is what the person picked. */
  readonly modeId: string;
  /**
   * Which of the pair the agent refused, since one mode is two calls.
   *
   * The wire method rather than a name of this file's own, because the debug
   * log's safe-key list already admits `method` — a key nobody has thought
   * about is refused there, and `method` is one somebody did.
   */
  readonly method: 'session/set_mode' | 'session/set_config_option';
  readonly error: unknown;
}) => void;

/**
 * Reasonix's own ordering, over the protocol-generic ACP kernel: the model,
 * then the approval posture, then the session mode.
 *
 * **One Grimoire mode is two calls here.** Reasonix separates what a session is
 * doing (`normal`, `plan`, `goal`, moved with `session/set_mode`) from how much
 * it may do unasked (`tool_approval`: `ask`, `auto`, `yolo`, moved with
 * `session/set_config_option`); Grimoire's toolbar drives both, and `modes.ts`
 * holds the translation. Both were probed on 2026-09-09: `session/set_mode`
 * answers `{}` and pushes a `current_mode_update`, and the config option answers
 * with the session's whole option list.
 *
 * **The posture goes first, and that order is a safety property.** Two calls
 * can half-succeed, and the half that must not be the survivor is the loose
 * one: a person leaving Auto-approve for Safe whose mode call landed and whose
 * posture call did not would run the turn on `yolo` behind a toolbar reading
 * Safe. Sent posture-first, a failure leaves the session in the mode it already
 * had *and* stops before the mode moves, so the pair is only ever wrong in the
 * stricter direction.
 *
 * The model goes through `session/set_config_option` rather than
 * `session/set_model`. Reasonix answers both, and the config option is the one
 * that reports back what the session now holds, so a turn that ran on another
 * model than the badge shows is visible rather than silent.
 *
 * Model first and strict, posture and mode after and tolerant: a model the
 * session did not offer must fail the turn rather than run it somewhere else,
 * while a refused mode leaves the session in the mode it already had.
 */
export class ReasonixAcpDynamicConfigApplier implements ReasonixExecutionDynamicApplier {
  /** The sessions already told about a refusal, so a turn is not the unit. */
  private readonly reportedSessions = new Set<string>();

  constructor(
    private readonly resolver: ReasonixAcpDynamicConfigResolver,
    private readonly onModeRefused?: ReasonixModeRefusedReporter,
  ) {}

  async apply(input: Parameters<ReasonixExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolver.resolve(input.dynamicRef);
    throwIfAborted(input.signal);
    if (config.modelId?.trim()) {
      await input.client.setConfigOption({
        configId: 'model',
        sessionId: input.sessionId,
        type: 'select',
        value: config.modelId.trim(),
      });
    }
    throwIfAborted(input.signal);
    const requested = config.modeId?.trim();
    if (requested) {
      await this.applyMode(input, requested);
    }
  }

  private async applyMode(
    input: Parameters<ReasonixExecutionDynamicApplier['apply']>[0],
    grimoireMode: string,
  ): Promise<void> {
    // Only ever `tool_approval` at this point: the model's own set is in
    // `apply`, and it is strict rather than reported.
    let method: 'session/set_mode' | 'session/set_config_option' = 'session/set_config_option';
    try {
      await input.client.setConfigOption({
        configId: 'tool_approval',
        sessionId: input.sessionId,
        type: 'select',
        value: mapGrimoireModeToReasonixApproval(grimoireMode),
      });
      throwIfAborted(input.signal);
      method = 'session/set_mode';
      await input.client.setMode({
        modeId: mapGrimoireModeToReasonix(grimoireMode),
        sessionId: input.sessionId,
      });
      this.reportedSessions.delete(input.sessionId);
    } catch (error) {
      if (input.signal.aborted) {
        throw error;
      }
      // Named in Grimoire's vocabulary, because that is what the person
      // picked and what the toolbar still shows. The agent's own id would
      // say "normal" for both Safe and Auto-approve, which are the two the
      // notice most needs to tell apart.
      this.onModeRefused?.({ error, method, modeId: grimoireMode });
      if (this.reportedSessions.has(input.sessionId)) {
        return;
      }
      this.reportedSessions.add(input.sessionId);
      const detail = refusalDetail(error);
      input.presentContent?.({
        kind: 'mode-refused',
        modeId: grimoireMode,
        ...(detail ? { detail } : {}),
      } satisfies AcpContentPayload);
    }
  }
}

/**
 * The sentence worth showing, out of the error the agent sent.
 *
 * Reasonix puts its actionable text in `data.details` where it has any and in
 * the message otherwise; both are read, and the generic JSON-RPC text is not.
 */
function refusalDetail(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of ['details', 'uri']) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() && message.trim() !== 'Internal error'
    ? message.trim()
    : undefined;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Reasonix dynamic configuration aborted.');
}
