import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getHostnameKey } from '../../../utils/env';
import { resolveCliExecutable } from '../../../utils/resolveCliExecutable';
import { getReasonixProviderSettings } from '../settings';

/**
 * Where the installers put the binary: the shell script in `~/.local/bin`, and
 * the Homebrew cask beside every other cask. Looked in only after PATH, which
 * a desktop app does not inherit from the shell.
 */
const REASONIX_FALLBACK_PATHS = [
  '~/.local/bin/reasonix',
  '/opt/homebrew/bin/reasonix',
  '/usr/local/bin/reasonix',
];

export class ReasonixCliResolver {
  private readonly cachedHostname = getHostnameKey();
  private lastCliPath = '';
  private lastEnvText = '';
  private lastHostnamePath = '';
  private resolvedPath: string | null = null;

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const reasonixSettings = getReasonixProviderSettings(settings);
    const cliPath = reasonixSettings.cliPath.trim();
    const hostnamePath = (reasonixSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'reasonix');

    if (
      this.resolvedPath !== null
      && cliPath === this.lastCliPath
      && envText === this.lastEnvText
      && hostnamePath === this.lastHostnamePath
    ) {
      return this.resolvedPath;
    }

    this.lastCliPath = cliPath;
    this.lastEnvText = envText;
    this.lastHostnamePath = hostnamePath;
    this.resolvedPath = this.resolve(
      reasonixSettings.cliPathsByHost,
      cliPath,
      envText,
    );
    return this.resolvedPath;
  }

  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText: string,
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    return resolveCliExecutable('reasonix', [hostnamePath, legacyPath], envText, {
      fallbackPaths: REASONIX_FALLBACK_PATHS,
    });
  }

  reset(): void {
    this.lastCliPath = '';
    this.lastEnvText = '';
    this.lastHostnamePath = '';
    this.resolvedPath = null;
  }
}

/**
 * The one instance, shared by the module declaration and the workspace, built
 * on first use because the constructor reads the machine's hostname.
 */
let sharedResolver: ReasonixCliResolver | null = null;

export function reasonixCliResolver(): ReasonixCliResolver {
  return sharedResolver ??= new ReasonixCliResolver();
}
