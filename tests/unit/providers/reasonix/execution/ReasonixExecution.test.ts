import trace from '@test/fixtures/provider-traces/reasonix-execution.json';

import { JsonRpcErrorResponse } from '@/providers/acp';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { ReasonixAcpDynamicConfigApplier } from '@/providers/reasonix/execution/ReasonixAcpDynamicConfig';
import { ReasonixInteractionBridge } from '@/providers/reasonix/execution/ReasonixInteractionBridge';
import { buildReasonixPermissionPresentation } from '@/providers/reasonix/execution/ReasonixPermissionPresentation';
import { ReasonixProjectionResultSink } from '@/providers/reasonix/execution/ReasonixProjectionResultSink';

describe('Reasonix dynamic configuration', () => {
  function createClient(): { client: ManagedAcpClient; calls: string[] } {
    const calls: string[] = [];
    const client = {
      setConfigOption: async ({ configId, value }: { configId: string; value: string }) => {
        calls.push(`set-config:${configId}:${value}`);
        return { configOptions: [] };
      },
      setMode: async ({ modeId }: { modeId: string }) => {
        calls.push(`set-mode:${modeId}`);
        return {};
      },
      setModel: async ({ modelId }: { modelId: string }) => {
        calls.push(`set-model:${modelId}`);
        return {};
      },
    } as unknown as ManagedAcpClient;
    return { client, calls };
  }

  it('sets the model, then the approval posture, then the mode', async () => {
    const { client, calls } = createClient();
    const applier = new ReasonixAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'custom-api-z-ai/glm-5.3', modeId: 'plan' }),
    });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(trace.cases.dynamicConfiguration);
  });

  it('spends Auto-approve on the approval option, not on the session mode', async () => {
    // The whole reason one Grimoire mode is two calls here: Reasonix has no
    // `bypass` mode, and a turn that only set a mode would run Auto-approve in
    // whatever posture the session already had.
    const { client, calls } = createClient();
    const applier = new ReasonixAcpDynamicConfigApplier({
      // `full_access` is Grimoire's word, not Reasonix's.
      resolve: async () => ({ modeId: 'full_access' }),
    });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(['set-config:tool_approval:yolo', 'set-mode:normal']);
  });

  it('runs the turn even when the agent will not take the mode', async () => {
    const refused: Array<{ method: string; modeId: string }> = [];
    const client = {
      setConfigOption: async () => ({ configOptions: [] }),
      setMode: async () => {
        throw new JsonRpcErrorResponse(
          'session/set_mode',
          -32602,
          'Invalid params',
          { details: 'Mode plan is not available for this session.' },
        );
      },
    } as unknown as ManagedAcpClient;
    const presented: unknown[] = [];
    const applier = new ReasonixAcpDynamicConfigApplier(
      { resolve: async () => ({ modeId: 'plan' }) },
      ({ method, modeId }) => refused.push({ method, modeId }),
    );

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
      presentContent: payload => presented.push(payload),
    })).resolves.toBeUndefined();

    expect(refused).toEqual([{ method: 'session/set_mode', modeId: 'plan' }]);
    expect(presented).toEqual([{
      kind: 'mode-refused',
      modeId: 'plan',
      detail: 'Mode plan is not available for this session.',
    }]);
  });

  it('never moves the mode when the approval posture would not move', async () => {
    // The half-succeed that must not happen. Leaving Auto-approve for Safe, a
    // mode that landed and a posture that did not would run the turn on `yolo`
    // behind a toolbar reading Safe, and the once-per-session notice would then
    // stay quiet about it for every later turn.
    const calls: string[] = [];
    const client = {
      setConfigOption: async ({ configId }: { configId: string }) => {
        calls.push(`set-config:${configId}`);
        if (configId === 'tool_approval') {
          throw new JsonRpcErrorResponse('session/set_config_option', -32602, 'Invalid params');
        }
        return { configOptions: [] };
      },
      setMode: async ({ modeId }: { modeId: string }) => {
        calls.push(`set-mode:${modeId}`);
        return {};
      },
    } as unknown as ManagedAcpClient;
    const refused: Array<{ method: string; modeId: string }> = [];
    const applier = new ReasonixAcpDynamicConfigApplier(
      { resolve: async () => ({ modeId: 'normal' }) },
      ({ method, modeId }) => refused.push({ method, modeId }),
    );

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(['set-config:tool_approval']);
    expect(refused).toEqual([{ method: 'session/set_config_option', modeId: 'normal' }]);
  });

  it('tells a person once per session, not once per turn', async () => {
    const client = {
      setConfigOption: async () => ({ configOptions: [] }),
      setMode: async () => {
        throw new JsonRpcErrorResponse('session/set_mode', -32602, 'Invalid params');
      },
    } as unknown as ManagedAcpClient;
    const presented: unknown[] = [];
    const applier = new ReasonixAcpDynamicConfigApplier({ resolve: async () => ({ modeId: 'plan' }) });
    const apply = () => applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
      presentContent: payload => presented.push(payload),
    });

    await apply();
    await apply();

    expect(presented).toHaveLength(1);
  });

  it('names the mode in the toolbar vocabulary, not the agent shared id', async () => {
    // Safe and Auto-approve are both `normal` on the wire. A notice built from
    // the wire value would tell somebody who asked for Auto-approve that Safe
    // was refused.
    const presented: unknown[] = [];
    const client = {
      setConfigOption: async () => {
        throw new JsonRpcErrorResponse('session/set_config_option', -32602, 'Invalid params');
      },
    } as unknown as ManagedAcpClient;
    const applier = new ReasonixAcpDynamicConfigApplier({
      resolve: async () => ({ modeId: 'full_access' }),
    });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
      presentContent: payload => presented.push(payload),
    });

    expect(presented).toEqual([expect.objectContaining({ modeId: 'full_access' })]);
  });

  it('reads the reason out of the shape the refusal answers with', async () => {
    const presented: unknown[] = [];
    const client = {
      setConfigOption: async () => ({ configOptions: [] }),
      setMode: async () => {
        throw new JsonRpcErrorResponse(
          'session/set_mode',
          -32002,
          'Resource not found',
          { uri: 'Mode not found: plan. Available modes: normal' },
        );
      },
    } as unknown as ManagedAcpClient;
    const applier = new ReasonixAcpDynamicConfigApplier({ resolve: async () => ({ modeId: 'plan' }) });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
      presentContent: payload => presented.push(payload),
    });

    expect(presented).toEqual([expect.objectContaining({
      detail: 'Mode not found: plan. Available modes: normal',
    })]);
  });

  it('still stops when the run the mode belonged to was abandoned', async () => {
    const abort = new AbortController();
    const client = {
      setConfigOption: async () => ({ configOptions: [] }),
      setMode: async () => {
        abort.abort(new Error('cancelled'));
        throw new Error('cancelled');
      },
    } as unknown as ManagedAcpClient;
    const applier = new ReasonixAcpDynamicConfigApplier({
      resolve: async () => ({ modeId: 'plan' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('cancelled');
  });

  it('performs no provider call without an opaque config reference', async () => {
    const resolve = jest.fn();
    const applier = new ReasonixAcpDynamicConfigApplier({ resolve });

    await applier.apply({
      client: {} as ManagedAcpClient,
      sessionId: 'native-session',
      signal: new AbortController().signal,
    });

    expect(resolve).not.toHaveBeenCalled();
  });

  it('stops before the mode when the owning run is aborted', async () => {
    const abort = new AbortController();
    const calls: string[] = [];
    const client = {
      setConfigOption: async ({ configId, value }: { configId: string; value: string }) => {
        calls.push(`set-config:${configId}:${value}`);
        abort.abort(new Error('settings transition'));
        return { configOptions: [] };
      },
      setMode: async ({ modeId }: { modeId: string }) => {
        calls.push(`set-mode:${modeId}`);
        return {};
      },
    } as unknown as ManagedAcpClient;
    const applier = new ReasonixAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'custom-api-z-ai/glm-5.3', modeId: 'plan' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('settings transition');
    expect(calls).toEqual(['set-config:model:custom-api-z-ai/glm-5.3']);
  });
});

describe('Reasonix permission presentation', () => {
  it('names the command the request carries in its input', () => {
    expect(buildReasonixPermissionPresentation('bash', 'execute', { command: 'rm out.txt' }, undefined))
      .toEqual({
        description: 'Reasonix wants to run `rm out.txt`.',
        toolName: 'bash',
      });
  });

  it('describes an edit by the path the request already carries', () => {
    // The probed shape: title, kind, `rawInput` and `locations` all present,
    // plus Reasonix's own `_meta` naming the tool and its subject.
    expect(buildReasonixPermissionPresentation(
      'write_file hello.txt',
      'edit',
      { content: 'hi', path: 'hello.txt' },
      [{ path: '/vault/hello.txt' }],
      { 'reasonix.io': { approvalId: '1', fresh: false, subject: 'hello.txt', tool: 'write_file' } },
    )).toEqual({
      blockedPath: 'hello.txt',
      description: 'Reasonix wants to write hello.txt.',
      toolName: 'write_file hello.txt',
    });
  });

  it('falls back to the vendor meta when the request names no tool', () => {
    expect(buildReasonixPermissionPresentation(undefined, 'edit', {}, undefined, {
      'reasonix.io': { subject: 'notes/today.md', tool: 'write_file' },
    })).toEqual({
      blockedPath: 'notes/today.md',
      description: 'Reasonix wants to write notes/today.md.',
      toolName: 'write_file',
    });
  });

  it('says what a plan exit is asking', () => {
    expect(buildReasonixPermissionPresentation('Exit plan mode', 'switch_mode', {}, undefined))
      .toEqual({
        description: 'Reasonix wants to leave Plan mode and start implementing the plan.',
        toolName: 'Exit plan mode',
      });
  });

  it('falls back to the kind, then to a name, rather than asking about nothing', () => {
    expect(buildReasonixPermissionPresentation('   ', 'read', {}, undefined).toolName).toBe('read');
    expect(buildReasonixPermissionPresentation(null, null, {}, undefined))
      .toEqual({ description: 'Reasonix action requests permission.', toolName: 'Reasonix action' });
  });

  it('takes the path from the input before the tool call locations', () => {
    expect(buildReasonixPermissionPresentation('Read', 'read', {
      path: 'first.md',
      filePath: 'second.md',
    }, [{ path: 'location.md' }]).blockedPath).toBe('first.md');
    expect(buildReasonixPermissionPresentation('Read', 'read', {}, [{ path: 'location.md' }])
      .blockedPath).toBe('location.md');
  });
});

describe('Reasonix interactions', () => {
  /** The probed `session/request_permission`, options and all. */
  function permissionRequest(): AcpRequestPermissionRequest {
    return {
      sessionId: 'acp-session-1',
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'allow_always', kind: 'allow_always', name: 'Allow Edit for this session' },
        { optionId: 'reject_once', kind: 'reject_once', name: 'Reject' },
      ],
      toolCall: {
        toolCallId: 'gate-1',
        title: 'write_file hello.txt',
        kind: 'edit',
        status: 'pending',
        rawInput: { content: 'hi', path: 'hello.txt' },
        locations: [{ path: '/vault/hello.txt' }],
        _meta: {
          'reasonix.io': { approvalId: '1', fresh: false, subject: 'hello.txt', tool: 'write_file' },
        },
      },
    };
  }

  it('describes the permission from the request alone', async () => {
    // No tool-call memory is consulted, because none is kept: what Devin has to
    // look up, Reasonix sends.
    const bridge = new ReasonixInteractionBridge();

    const prepared = await bridge.prepare(permissionRequest());

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      kind: 'approval',
      toolName: 'write_file hello.txt',
      description: 'Reasonix wants to write hello.txt.',
      options: [
        { responseId: 'allow-once', label: 'Allow', presentation: 'allow' },
        { responseId: 'allow-always', label: 'Allow Edit for this session', presentation: 'always' },
        { responseId: 'reject-once', label: 'Reject', presentation: 'reject' },
      ],
    }));
  });

  it('answers the agent with the option its response id stands for', async () => {
    const bridge = new ReasonixInteractionBridge();
    const prepared = await bridge.prepare(permissionRequest());

    await expect(prepared.resolve('allow-once')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
  });
});

describe('ReasonixProjectionResultSink', () => {
  const commit = (overrides: Record<string, unknown> = {}) =>
    new ReasonixProjectionResultSink().storeResult({
      output: 'the answer',
      nativeSessionRef: 'reasonix-session',
      nativeRunRef: 'message-1',
      signal: new AbortController().signal,
      ...overrides,
    });

  it('commits a reference and never the answer', async () => {
    const outcome = await commit();

    expect(outcome.kind).toBe('committed');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('the answer');
    expect(serialized).not.toContain('reasonix-session');
  });

  it('commits nothing for a run that was already abandoned', async () => {
    const abort = new AbortController();
    abort.abort(new Error('stopped'));

    await expect(commit({ signal: abort.signal })).resolves.toEqual({ kind: 'aborted' });
  });
});
