/**
 * How a Reasonix permission request is described to the person answering it.
 *
 * **The request says what it is about, so nothing here remembers.** Probed on
 * 2026-09-09 against `reasonix v1.38.3`: `session/request_permission` carries a
 * `toolCall` with `title`, `kind`, `rawInput` and `locations` already filled in,
 * plus `_meta["reasonix.io"]` naming the tool and its subject. That is the
 * difference from Devin, whose requests carry an id and nothing else and whose
 * composition therefore keeps the last sixty-four `tool_call` updates to look
 * one up. Reasonix needs no such memory, and adding one would be a cache with
 * no question to answer.
 */

/** What the approval prompt says, for one Reasonix permission request. */
export interface ReasonixPermissionPresentation {
  readonly blockedPath?: string;
  readonly description: string;
  readonly toolName: string;
}

/** Where Reasonix names the tool and subject of the call it is asking about. */
const REASONIX_META_KEY = 'reasonix.io';

/** The prompt's words, from the tool that raised the request. */
export function buildReasonixPermissionPresentation(
  rawTitle: string | null | undefined,
  rawKind: string | null | undefined,
  input: Record<string, unknown>,
  locations: ReadonlyArray<{ path: string }> | null | undefined,
  meta?: Record<string, unknown> | null,
): ReasonixPermissionPresentation {
  const vendor = asRecord(meta?.[REASONIX_META_KEY]);
  const title = rawTitle?.trim() || readString(vendor, 'tool') || '';
  const kind = rawKind?.trim() || '';

  const command = readString(input, 'command');
  if (command) {
    return {
      description: `Reasonix wants to run \`${command}\`.`,
      toolName: title || 'Shell command',
    };
  }

  if (kind === 'switch_mode') {
    return {
      description: 'Reasonix wants to leave Plan mode and start implementing the plan.',
      toolName: title || 'Exit plan mode',
    };
  }

  const path = extractPermissionPath(input, locations) ?? readString(vendor, 'subject');
  if (kind === 'edit' && path) {
    return {
      blockedPath: path,
      description: `Reasonix wants to write ${path}.`,
      toolName: title || 'Write file',
    };
  }

  const toolName = title || kind || 'Reasonix action';
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
