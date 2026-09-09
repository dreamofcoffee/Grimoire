export const REASONIX_SYNTHETIC_MODEL_ID = 'reasonix';
export const REASONIX_MODEL_PREFIX = 'reasonix:';

export function encodeReasonixModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${REASONIX_MODEL_PREFIX}${normalized}` : REASONIX_SYNTHETIC_MODEL_ID;
}

export function decodeReasonixModelId(model: string): string | null {
  if (!model.startsWith(REASONIX_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(REASONIX_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function isReasonixModelSelectionId(model: string): boolean {
  return model === REASONIX_SYNTHETIC_MODEL_ID || model.startsWith(REASONIX_MODEL_PREFIX);
}
