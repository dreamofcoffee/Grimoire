import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import { buildReasonixPermissionPresentation } from '@/providers/reasonix/execution/ReasonixPermissionPresentation';

/**
 * Reasonix's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared with every managed-ACP provider; what is Reasonix's is
 * the sentence a person reads, and it is built from the request alone — the
 * `toolCall` arrives with its title, kind, input and locations already on it.
 *
 * One interaction kind only. Reasonix's `ask` tool does reach this channel —
 * observed 2026-09-09, as a request whose title is the question — but it comes
 * as a permission request like any other, so it is answered as one. Opening a
 * question interaction would need a shape to recognise it by, and the request
 * carries none.
 */
export class ReasonixInteractionBridge extends AcpPermissionBridge {
  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildReasonixPermissionPresentation(
        request.toolCall.title,
        request.toolCall.kind,
        input,
        request.toolCall.locations,
        request.toolCall._meta,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}

/** How an opened Reasonix approval reaches the surface. */
export class ReasonixInteractionPresenter extends AcpApprovalPresenter {}
