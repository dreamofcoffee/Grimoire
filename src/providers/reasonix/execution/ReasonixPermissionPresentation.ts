/**
 * How a Reasonix permission request is described to the person answering it.
 *
 * **The request says what it is about, so nothing here remembers.** Probed on
 * 2026-09-09 against `reasonix v1.38.3`: `session/request_permission` carries a
 * `toolCall` with `title`, `kind`, `rawInput` and `locations` already filled in,
 * and usually `_meta["reasonix.io"]` naming the tool and its subject. That is
 * the difference from Devin, whose requests carry an id and nothing else and
 * whose composition therefore keeps the last sixty-four `tool_call` updates to
 * look one up. Reasonix needs no such memory.
 *
 * **The tool is read from `_meta`, not from `kind`.** Three of the four shapes
 * probed arrive as `kind: "other"`, so switching on the kind recognises almost
 * nothing. What tells them apart is `_meta["reasonix.io"].tool`, and where that
 * is absent, a field of `rawInput`:
 *
 * - a write — `kind: "edit"`, `rawInput {path, content}`, `_meta.tool
 *   "write_file"`;
 * - a shell command — `rawInput.command`;
 * - leaving Plan mode — `kind: "other"`, `title "exit_plan_mode"`, `_meta.tool
 *   "exit_plan_mode"`, and nothing else at all;
 * - a question from the `ask` tool — `kind: "other"`, no `_meta`, `rawInput
 *   {question, options, multi}`, and the whole question repeated as the title.
 */

/** What the approval prompt says, for one Reasonix permission request. */
export interface ReasonixPermissionPresentation {
  readonly blockedPath?: string;
  readonly description: string;
  readonly toolName: string;
}

/** Where Reasonix names the tool and subject of the call it is asking about. */
const REASONIX_META_KEY = 'reasonix.io';

/** The tool Reasonix raises to leave Plan mode. */
const EXIT_PLAN_TOOL = 'exit_plan_mode';

/** The prompt's words, from the tool that raised the request. */
export function buildReasonixPermissionPresentation(
  rawTitle: string | null | undefined,
  rawKind: string | null | undefined,
  input: Record<string, unknown>,
  locations: ReadonlyArray<{ path: string }> | null | undefined,
  meta?: Record<string, unknown> | null,
): ReasonixPermissionPresentation {
  const vendor = asRecord(meta?.[REASONIX_META_KEY]);
  const title = rawTitle?.trim() ?? '';
  const tool = readString(vendor, 'tool') ?? title;
  const kind = rawKind?.trim() || '';

  // Before the title is used for anything, because for a question the title
  // *is* the question and would otherwise become the name of the tool.
  const question = readString(input, 'question');
  if (question) {
    return {
      description: question,
      toolName: 'Reasonix asks',
    };
  }

  const command = readString(input, 'command');
  if (command) {
    return {
      description: `Reasonix wants to run \`${command}\`.`,
      toolName: tool || 'Shell command',
    };
  }

  if (tool === EXIT_PLAN_TOOL || kind === 'switch_mode') {
    return {
      description: 'Reasonix wants to leave Plan mode and start implementing the plan.',
      toolName: 'Exit plan mode',
    };
  }

  const path = extractPermissionPath(input, locations) ?? readString(vendor, 'subject');
  if (kind === 'edit' && path) {
    return {
      blockedPath: path,
      description: `Reasonix wants to write ${path}.`,
      toolName: title || tool || 'Write file',
    };
  }

  const toolName = title || tool || kind || 'Reasonix action';
  return {
    ...(path ? { blockedPath: path } : {}),
    description: path
      ? `${toolName} requests access to ${path}.`
      : `${toolName} requests permission.`,
    toolName,
  };
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: ReadonlyArray<{ path: string }> | null | undefined,
): string | undefined {
  for (const key of ['path', 'file_path', 'filePath', 'filepath']) {
    const value = readString(input, key);
    if (value) {
      return value;
    }
  }
  return locations
    ?.map((location) => (typeof location?.path === 'string' ? location.path.trim() : ''))
    .find((path) => path.length > 0) || undefined;
}

function readString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
