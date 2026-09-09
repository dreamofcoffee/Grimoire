import { CodexPlanUsageStore } from '@/providers/codex/app/CodexPlanUsageStore';

describe('CodexPlanUsageStore', () => {
  it('returns no usage until account rate-limit windows arrive', () => {
    const store = new CodexPlanUsageStore();

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'codex',
      settings: {},
    })).toBeNull();
  });

  it('maps account rate-limit windows into provider plan usage', () => {
    const store = new CodexPlanUsageStore();

    const changed = store.updateFromRateLimits({
      plan: 'ChatGPT Pro',
      rateLimits: {
        fiveHour: {
          label: '5-hour',
          remaining: 76,
          limit: 100,
          reset: '4:05p',
        },
        weekly: {
          remaining: 12,
          limit: 100,
          reset: 'Mon',
        },
      },
    });

    expect(changed).toBe(true);
    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'codex',
      settings: {},
    })).toEqual({
      plan: 'ChatGPT Pro',
      updatedAt: expect.any(Number),
      windows: [
        { label: '5-hr', pct: 24, reset: '4:05p' },
        { label: 'Weekly', pct: 88, reset: 'Mon' },
      ],
    });
  });

  it('maps Codex app-server account/rateLimits/read payload into plan usage', () => {
    const store = new CodexPlanUsageStore();

    const changed = store.updateFromRateLimits({
      rateLimits: {
        limitId: 'codex',
        primary: {
          usedPercent: 5,
          windowDurationMins: 300,
          resetsAt: 1780791597,
        },
        secondary: {
          usedPercent: 61,
          windowDurationMins: 10080,
          resetsAt: 1781195795,
        },
        planType: 'prolite',
      },
    });

    expect(changed).toBe(true);
    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'codex',
      settings: {},
    })).toEqual({
      plan: 'ChatGPT Pro',
      updatedAt: expect.any(Number),
      windows: [
        { label: '5-hr', pct: 5, reset: expect.any(String), resetAt: expect.any(Number) },
        { label: 'Weekly', pct: 61, reset: expect.any(String), resetAt: expect.any(Number) },
      ],
    });
  });

  it('records when the rate-limit snapshot was last refreshed', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 11, 19, 55).getTime());
    try {
      const store = new CodexPlanUsageStore();

      store.updateFromRateLimits({
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: '12:55 AM' },
        },
      });

      expect(store.getCachedUsage({
        plugin: {} as any,
        providerId: 'codex',
        settings: {},
      })).toMatchObject({
        updatedAt: new Date(2026, 6, 11, 19, 55).getTime(),
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('formats numeric reset timestamps with the user local time format for same-day windows', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 13, 9).getTime());
    try {
      const store = new CodexPlanUsageStore();
      const localResetDate = new Date(2026, 5, 7, 17, 0);
      const localResetAt = Math.floor(localResetDate.getTime() / 1000);
      const expectedReset = new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(localResetDate);

      store.updateFromRateLimits({
        rateLimits: {
          primary: {
            usedPercent: 9,
            windowDurationMins: 300,
            resetsAt: localResetAt,
          },
        },
      });

      expect(store.getCachedUsage({
        plugin: {} as any,
        providerId: 'codex',
        settings: {},
      })).toEqual({
        plan: 'ChatGPT Pro',
        updatedAt: expect.any(Number),
        windows: [
          { label: '5-hr', pct: 9, reset: expectedReset, resetAt: localResetAt * 1000 },
        ],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshes usage through a registered rate-limit reader', async () => {
    const store = new CodexPlanUsageStore();
    store.setRateLimitsReader(jest.fn().mockResolvedValue({
      rateLimits: {
        primary: { usedPercent: 8, windowDurationMins: 300, resetsAt: '4:05p' },
      },
    }));

    await expect(store.refreshUsage({
      plugin: {} as any,
      providerId: 'codex',
      settings: {},
    })).resolves.toEqual({
      plan: 'ChatGPT Pro',
      updatedAt: expect.any(Number),
      windows: [
        { label: '5-hr', pct: 8, reset: '4:05p' },
      ],
    });
  });

  it('keeps the cached value when a rate-limit payload is empty', () => {
    const store = new CodexPlanUsageStore();

    store.updateFromRateLimits({
      planName: 'ChatGPT Pro',
      rateLimits: [
        { window: '5h', pct: 31, resetAt: '3:20p' },
      ],
    });

    const changed = store.updateFromRateLimits({ rateLimits: {} });

    expect(changed).toBe(false);
    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'codex',
      settings: {},
    })).toEqual({
      plan: 'ChatGPT Pro',
      updatedAt: expect.any(Number),
      windows: [
        { label: '5-hr', pct: 31, reset: '3:20p' },
      ],
    });
  });
});
