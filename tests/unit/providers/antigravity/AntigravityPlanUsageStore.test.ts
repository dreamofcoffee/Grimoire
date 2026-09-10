import { AntigravityPlanUsageStore } from '../../../../src/providers/antigravity/app/AntigravityPlanUsageStore';
import { parseAntigravityUsageResponse } from '../../../../src/providers/antigravity/app/AntigravityUsageFetcher';
import type { ProviderPlanUsageContext } from '../../../../src/providers/shared/providerHostContracts';

const context = {} as ProviderPlanUsageContext;

describe('Antigravity plan usage', () => {
  it('shows a 5h bucket disabled by an exhausted weekly limit without inventing its usage', () => {
    const usage = parseAntigravityUsageResponse({ command: { data: { groups: [
      { name: 'Gemini Models', buckets: [
        { window: 'weekly', remaining_fraction: 0.1788, reset_time: '2026-09-10T18:19:41Z' },
        { window: '5h', remaining_fraction: 1, reset_time: '2026-09-09T21:55:15Z' },
      ] },
      { name: 'Claude and GPT models', buckets: [
        { window: 'weekly', remaining_fraction: 0, reset_time: '2026-09-10T18:09:59Z' },
        { window: '5h', remaining_fraction: 1, disabled: true },
      ] },
    ] } } });

    expect(usage?.windows?.map(window => [window.label, window.pct, window.pctKnown])).toEqual([
      ['Gemini 5h', 0, undefined],
      ['Gemini Weekly', 82, undefined],
      ['Claude/GPT 5h', 0, false],
      ['Claude/GPT Weekly', 100, undefined],
    ]);
    expect(usage?.windows?.every(window => Boolean(window.reset))).toBe(true);
    expect(usage?.windows?.map(window => window.resetAt)).toEqual([
      Date.parse('2026-09-09T21:55:15Z'),
      Date.parse('2026-09-10T18:19:41Z'),
      Date.parse('2026-09-10T18:09:59Z'),
      Date.parse('2026-09-10T18:09:59Z'),
    ]);
  });

  it('rejects responses without usable quota windows', () => {
    expect(parseAntigravityUsageResponse({ command: { data: { groups: [] } } })).toBeNull();
    expect(parseAntigravityUsageResponse({ response: 'not usage data' })).toBeNull();
  });

  it('keeps the last good snapshot when a refresh fails', async () => {
    const good = { plan: 'Antigravity', windows: [{ label: 'Gemini Weekly', pct: 25, reset: 'Thu' }] };
    const reader = jest.fn().mockResolvedValueOnce(good).mockRejectedValueOnce(new Error('logged out'));
    const store = new AntigravityPlanUsageStore(reader);
    await expect(store.refreshUsage(context)).resolves.toEqual(good);
    await expect(store.refreshUsage(context)).resolves.toEqual(good);
  });
});
