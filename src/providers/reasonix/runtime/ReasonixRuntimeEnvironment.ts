import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

/**
 * What a launched `reasonix acp` runs under: the vault's own variables, and a
 * PATH a desktop app can actually find the binary on.
 *
 * Nothing is set here that the user did not ask for. Devin's launcher forces
 * `RUST_LOG=warn` because that CLI traces every dispatch to stderr; Reasonix is
 * a Go binary that writes only warnings there, so it needs no quieting, and a
 * variable set for a runtime the process does not have would be cargo.
 */
export function buildReasonixRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, 'reasonix');
  const envVars = parseEnvironmentVariables(envText);
  return {
    ...process.env,
    ...envVars,
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
