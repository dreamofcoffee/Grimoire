import { spawn } from 'node:child_process';

import { getVaultPath } from '../../../utils/path';
import { isRecord } from '../../../utils/records';
import type { ProviderPlanUsage, ProviderPlanUsageContext } from '../../shared/providerHostContracts';
import { buildAntigravityProcessLaunch } from '../runtime/AntigravityProcessLaunch';
import { buildAntigravityRuntimeEnv } from '../runtime/AntigravityRuntimeEnvironment';

const USAGE_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 128_000;

export async function fetchAntigravityPlanUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
  const command = context.plugin.getResolvedProviderCliPath('antigravity') ?? 'agy';
  const runtimeEnv = buildNonInteractiveUsageEnv(buildAntigravityRuntimeEnv(context.settings, command));
  const output = await runAgyUsage(command, getVaultPath(context.plugin.app) ?? process.cwd(), runtimeEnv);
  return parseAntigravityUsageResponse(JSON.parse(output) as unknown);
}

export function parseAntigravityUsageResponse(value: unknown): ProviderPlanUsage | null {
  if (!isRecord(value) || !isRecord(value.command) || !isRecord(value.command.data)) return null;
  const groups = value.command.data.groups;
  if (!Array.isArray(groups)) return null;

  const windows: NonNullable<ProviderPlanUsage['windows']> = [];
  for (const groupValue of groups) {
    if (!isRecord(groupValue) || typeof groupValue.name !== 'string' || !Array.isArray(groupValue.buckets)) continue;
    const buckets = [...(groupValue.buckets as unknown[])].sort(
      (left, right) => usageWindowOrder(left) - usageWindowOrder(right),
    );
    const groupLabel = formatGroupLabel(groupValue.name);
    const weeklyExhausted = buckets.some(bucket => (
      isRecord(bucket) && bucket.window === 'weekly' && readRemainingFraction(bucket.remaining_fraction) === 0
    ));
    const weeklyReset = buckets.find(bucket => isRecord(bucket) && bucket.window === 'weekly');
    for (const bucketValue of buckets) {
      if (!isRecord(bucketValue) || (bucketValue.window !== '5h' && bucketValue.window !== 'weekly')) continue;
      const remaining = readRemainingFraction(bucketValue.remaining_fraction);
      if (remaining === null) continue;
      const blockedByWeekly = bucketValue.window === '5h' && bucketValue.disabled === true && weeklyExhausted;
      const resetAt = readResetDate(
        blockedByWeekly && isRecord(weeklyReset) ? weeklyReset.reset_time : bucketValue.reset_time,
      );
      if (!resetAt) continue;
      windows.push({
        label: `${groupLabel} ${bucketValue.window === '5h' ? '5h' : 'Weekly'}`,
        pct: blockedByWeekly ? 0 : Math.round((1 - remaining) * 100),
        ...(blockedByWeekly ? { pctKnown: false } : {}),
        reset: formatResetLabel(resetAt),
        resetAt: resetAt.getTime(),
      });
    }
  }
  return windows.length > 0 ? { plan: 'Antigravity', windows } : null;
}

function buildNonInteractiveUsageEnv(runtimeEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...runtimeEnv, CI: '1', TERM: 'dumb' };
  delete env.SSH_CLIENT;
  delete env.SSH_CONNECTION;
  delete env.SSH_TTY;
  return env;
}

function runAgyUsage(command: string, cwd: string, runtimeEnv: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const launch = buildAntigravityProcessLaunch(
      command,
      ['--print', '/usage', '--output-format', 'json', '--print-timeout', '10s'],
      runtimeEnv,
    );
    const proc = spawn(launch.command, launch.args, {
      cwd, env: runtimeEnv, shell: launch.shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const timeout = window.setTimeout(() => {
      proc.kill('SIGTERM');
      finish(() => reject(new Error('Antigravity usage refresh timed out.')));
    }, USAGE_TIMEOUT_MS);
    proc.stdout.on('data', chunk => { stdout = appendLimited(stdout, String(chunk)); });
    proc.stderr.on('data', chunk => { stderr = appendLimited(stderr, String(chunk)); });
    proc.on('error', error => finish(() => reject(error)));
    proc.on('exit', (code, signal) => finish(() => {
      if (code === 0 && stdout.trim()) return resolve(stdout.trim());
      const status = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      reject(new Error(stderr.trim() || `Antigravity usage refresh failed (${status}).`));
    }));
  });
}

function appendLimited(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-OUTPUT_LIMIT);
}

function readRemainingFraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function usageWindowOrder(value: unknown): number {
  if (!isRecord(value)) return 2;
  if (value.window === '5h') return 0;
  if (value.window === 'weekly') return 1;
  return 2;
}

function formatGroupLabel(value: string): string {
  if (value === 'Gemini Models') return 'Gemini';
  if (value === 'Claude and GPT models') return 'Claude/GPT';
  return value.trim();
}

function readResetDate(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const reset = value instanceof Date ? value : new Date(value);
  return Number.isFinite(reset.getTime()) ? reset : null;
}

function formatResetLabel(reset: Date): string {
  const now = new Date();
  return reset.toDateString() === now.toDateString()
    ? reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : reset.toLocaleDateString(undefined, { weekday: 'short' });
}
