import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const REASONIX_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-reasonix'),
  association: { kind: 'provider' as const, providerId: 'reasonix' },
});

/**
 * Reasonix's execution backend: the shared managed-ACP one, under its own id.
 *
 * The eighth provider on it. What is Reasonix's is beside this file: `reasonix
 * acp` as a subcommand, models and modes read in ACP's own vocabulary, a
 * permission request that already describes itself, and the turn's tokens read
 * off a notification the agent sends under its own name.
 */
export class ReasonixExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: REASONIX_EXECUTION_DESCRIPTOR });
  }
}

export type ReasonixExecutionBackendContext =
  Omit<ManagedAcpExecutionBackendContext, 'descriptor'>;

export type {
  ManagedAcpExecutionDynamicApplier as ReasonixExecutionDynamicApplier,
  ManagedAcpExecutionInvocation as ReasonixExecutionInvocation,
  ManagedAcpExecutionResultSink as ReasonixExecutionResultSink,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
