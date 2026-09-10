import { GrokPlanUsageStore, grokPlanUsageStore } from '@/providers/grok/app/GrokPlanUsageStore';

describe('GrokPlanUsageStore', () => {
  beforeEach(() => {
    grokPlanUsageStore.reset();
  });

  it('aggregates ACP usage_update cost into monthly spend usage', () => {
    grokPlanUsageStore.recordCost({ amount: 1.25, currency: 'USD' });
    grokPlanUsageStore.recordCost({ amount: 0.75, currency: 'USD' });

    expect(grokPlanUsageStore.getCachedUsage({
      plugin: {} as any,
      providerId: 'grok',
      settings: {},
    })).toEqual({
      plan: 'API keys',
      spend: '$2.00 this month',
      note: 'Pay per token across vendors · no cap set.',
    });
  });

  it('keeps currencies separate when ACP reports a non-USD cost', () => {
    grokPlanUsageStore.recordCost({ amount: 4.2, currency: 'EUR' });

    expect(grokPlanUsageStore.getCachedUsage({
      plugin: {} as any,
      providerId: 'grok',
      settings: {},
    })).toEqual({
      plan: 'API keys',
      spend: 'EUR 4.20 this month',
      note: 'Pay per token across vendors · no cap set.',
    });
  });

  it('merges SuperGrok credit windows with API spend usage', () => {
    grokPlanUsageStore.setCreditsUsageForTests({
      plan: 'SuperGrok',
      windows: [{
        label: 'Credits',
        pct: 6,
        pctKnown: true,
        reset: 'Jul 1',
      }],
      note: 'Free credits · resets Jul 1',
    });
    grokPlanUsageStore.recordCost({ amount: 1.25, currency: 'USD' });

    expect(grokPlanUsageStore.getCachedUsage({
      plugin: {} as any,
      providerId: 'grok',
      settings: {},
    })).toEqual({
      plan: 'SuperGrok',
      windows: [{
        label: 'Credits',
        pct: 6,
        pctKnown: true,
        reset: 'Jul 1',
      }],
      spend: '$1.25 this month',
      note: 'Free credits · resets Jul 1 · Pay per token across vendors · no cap set.',
    });
  });

  it('records only deltas from cumulative Grok Build session costs', () => {
    const store = new GrokPlanUsageStore();

    expect(store.recordSessionTotalCost('session-1', { amount: 1.25, currency: 'USD' })).toBe(true);
    expect(store.recordSessionTotalCost('session-1', { amount: 1.5, currency: 'USD' })).toBe(true);
    expect(store.recordSessionTotalCost('session-1', { amount: 1.5, currency: 'USD' })).toBe(false);

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'grok',
      settings: {},
    })).toEqual({
      plan: 'API keys',
      spend: '$1.50 this month',
      note: 'Pay per token across vendors · no cap set.',
    });
  });

  it('refreshes unified usage through the active Grok ACP billing reader', async () => {
    const store = new GrokPlanUsageStore();
    const owner = {};
    store.setBillingReader(jest.fn().mockResolvedValue({
      config: {
        creditUsagePercent: 12,
        currentPeriod: {
          end: '2026-07-20T17:37:13.518496+00:00',
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
        },
        isUnifiedBillingUser: true,
      },
      subscription_tier: 'X Premium+',
    }), owner);

    await expect(store.refreshUsage({
      plugin: {} as any,
      providerId: 'grok',
      settings: {},
    })).resolves.toEqual({
      plan: 'X Premium+',
      note: expect.stringContaining('Shared across Grok products'),
      windows: [{
        label: 'Weekly',
        pct: 12,
        pctKnown: true,
        reset: expect.stringMatching(/Jul/),
        resetAt: expect.any(Number),
      }],
    });
  });

  it('restores the previous ACP billing reader when a temporary runtime closes', async () => {
    const store = new GrokPlanUsageStore();
    const activeOwner = {};
    const temporaryOwner = {};
    const billingPayload = (pct: number) => ({
      config: {
        creditUsagePercent: pct,
        currentPeriod: {
          end: '2026-07-20T17:37:13.518496+00:00',
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
        },
        isUnifiedBillingUser: true,
      },
    });
    store.setBillingReader(async () => billingPayload(10), activeOwner);
    store.setBillingReader(async () => billingPayload(20), temporaryOwner);
    const context = {
      plugin: {} as any,
      providerId: 'grok' as const,
      settings: {},
    };

    await expect(store.refreshUsage(context)).resolves.toEqual(expect.objectContaining({
      windows: [expect.objectContaining({ pct: 20 })],
    }));

    store.setBillingReader(null, temporaryOwner);
    await expect(store.refreshUsage(context)).resolves.toEqual(expect.objectContaining({
      windows: [expect.objectContaining({ pct: 10 })],
    }));
  });
});
