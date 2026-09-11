import { getCliBinaryFingerprint } from '../../core/providers/cliBinaryFingerprint';
import type GrimoirePlugin from '../../main';
import type { ReasonixProviderSettings } from './settings';

/**
 * The inputs that decide which models the Reasonix CLI offers over ACP: which binary
 * runs and which environment it reads. The model catalog keys its refresh cache
 * on this, and every discovery persists a digest of it so a later load can tell
 * a list discovered under this configuration from one merely assumed to match.
 *
 * The binary's identity is part of that, not just its path: a CLI release can
 * change which models it offers, and an upgrade in place leaves the path
 * untouched. Without it a catalog discovered before the upgrade stays settled
 * and the new models never reach the picker.
 */
export function buildReasonixModelCatalogFingerprint(
  settings: ReasonixProviderSettings,
  cliPath: string,
  environmentVariables: string,
): string {
  return JSON.stringify({
    cliBinary: getCliBinaryFingerprint(cliPath),
    cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentVariables,
  });
}

export function resolveReasonixModelCatalogFingerprint(
  plugin: GrimoirePlugin,
  settings: ReasonixProviderSettings,
): string {
  return buildReasonixModelCatalogFingerprint(
    settings,
    plugin.getResolvedProviderCliPath?.('reasonix') ?? settings.cliPath,
    plugin.getActiveEnvironmentVariables?.('reasonix') ?? settings.environmentVariables,
  );
}
