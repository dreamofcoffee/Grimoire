import { ClaudePlanUsageStore } from '@/providers/claude/app/ClaudePlanUsageStore';

describe('ClaudePlanUsageStore', () => {
  it('reads Claude statusline rate limits snapshot during refresh', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 13, 20).getTime());
    try {
      const store = new ClaudePlanUsageStore();
      const fiveHourReset = new Date(2026, 5, 7, 17, 0);
      const weeklyReset = new Date(2026, 5, 8, 0, 0);
      const files: Record<string, string> = {
        '.grimoire/claude/statusline-usage.json': JSON.stringify({
          rate_limits: {
            five_hour: {
              used_percentage: 13,
              resets_at: Math.floor(fiveHourReset.getTime() / 1000),
            },
            seven_day: {
              used_percentage: 63,
              resets_at: Math.floor(weeklyReset.getTime() / 1000),
            },
          },
        }),
      };
      const adapter = {
        exists: jest.fn(async (path: string) => path in files),
        read: jest.fn(async (path: string) => files[path]),
      };

      await expect(store.refreshUsage({
        plugin: {
          storage: {
            getAdapter: () => adapter,
          },
        } as any,
        providerId: 'claude',
        settings: {},
      })).resolves.toEqual({
        plan: 'Claude Code',
        windows: [
          {
            label: '5-hr',
            pct: 13,
            reset: new Intl.DateTimeFormat(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            }).format(fiveHourReset),
            resetAt: fiveHourReset.getTime(),
          },
          {
            label: 'Weekly',
            pct: 63,
            reset: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(weeklyReset),
            resetAt: weeklyReset.getTime(),
          },
        ],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps Claude SDK rate limit events into quota usage windows', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 13, 9).getTime());
    try {
      const store = new ClaudePlanUsageStore();
      const resetDate = new Date(2026, 5, 7, 17, 0);
      const expectedReset = new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(resetDate);

      const changed = store.recordSdkMessage({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed_warning',
          rateLimitType: 'five_hour',
          resetsAt: Math.floor(resetDate.getTime() / 1000),
          utilization: 0.47,
        },
      });

      expect(changed).toBe(true);
      expect(store.getCachedUsage({
        plugin: {} as any,
        providerId: 'claude',
        settings: {},
      })).toEqual({
        plan: 'Claude Code',
        windows: [
          { label: '5-hr', pct: 47, reset: expectedReset, resetAt: resetDate.getTime() },
        ],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps separate Claude weekly rate limit windows when present', () => {
    const store = new ClaudePlanUsageStore();

    store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'seven_day_opus',
        resetsAt: 'Mon',
        utilization: 71,
      },
    });
    store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'seven_day_sonnet',
        resetsAt: 'Tue',
        utilization: 12,
      },
    });

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'claude',
      settings: {},
    })).toEqual({
      plan: 'Claude Code',
      windows: [
        { label: 'Weekly Opus', pct: 71, reset: 'Mon' },
        { label: 'Weekly Sonnet', pct: 12, reset: 'Tue' },
      ],
    });
  });

  it('exposes quota and SDK token cost when both are available', () => {
    const store = new ClaudePlanUsageStore();

    store.recordSdkMessage({
      type: 'result',
      subtype: 'success',
      modelUsage: {
        'claude-sonnet-4-5-20250514': {
          inputTokens: 1000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 200,
          webSearchRequests: 0,
          costUSD: 0.0123,
        },
      },
    });
    store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: '5:00 PM',
        utilization: 9,
      },
    });

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'claude',
      settings: {},
    })).toEqual({
      plan: 'Claude Code',
      spend: '$0.01 this month',
      note: 'SDK token cost reported for completed turns.',
      windows: [
        { label: '5-hr', pct: 9, reset: '5:00 PM' },
      ],
    });
  });

  it('accepts Claude reset-only rate limit events when utilization is omitted', () => {
    const store = new ClaudePlanUsageStore();

    const changed = store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: '5:50 PM',
      },
    });

    expect(changed).toBe(true);
    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'claude',
      settings: {},
    })).toEqual({
      plan: 'Claude Code',
      windows: [
        { label: '5-hr', pct: 0, pctKnown: false, reset: '5:50 PM' },
      ],
    });
  });

  it('exposes SDK token cost when quota metadata is absent', () => {
    const store = new ClaudePlanUsageStore();

    const changed = store.recordSdkMessage({
      type: 'result',
      subtype: 'success',
      modelUsage: {
        'claude-sonnet-4-5-20250514': {
          inputTokens: 1000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 200,
          webSearchRequests: 0,
          costUSD: 0.0123,
        },
      },
    });

    expect(changed).toBe(true);
    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'claude',
      settings: {},
    })).toEqual({
      plan: 'Claude Code',
      spend: '$0.01 this month',
      note: 'SDK token cost reported for completed turns.',
    });
  });

  it('reads Claude quota percentages from unifiedWindows when the event omits utilization', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 13, 9).getTime());
    try {
      const store = new ClaudePlanUsageStore();
      const fiveHourReset = new Date(2026, 5, 7, 17, 0);
      const weeklyReset = new Date(2026, 5, 11, 3, 0);

      const changed = store.recordSdkMessage({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          rateLimitType: 'five_hour',
          resetsAt: Math.floor(fiveHourReset.getTime() / 1000),
          overageStatus: 'rejected',
          overageDisabledReason: 'org_level_disabled',
          isUsingOverage: false,
          unifiedWindows: {
            five_hour: {
              utilization: 0.47,
              resetsAt: Math.floor(fiveHourReset.getTime() / 1000),
            },
            seven_day: {
              utilization: 0.31,
              resetsAt: Math.floor(weeklyReset.getTime() / 1000),
            },
          },
        },
      });

      expect(changed).toBe(true);
      expect(store.getCachedUsage({
        plugin: {} as any,
        providerId: 'claude',
        settings: {},
      })).toEqual({
        plan: 'Claude Code',
        windows: [
          {
            label: '5-hr',
            pct: 47,
            reset: new Intl.DateTimeFormat(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            }).format(fiveHourReset),
            resetAt: fiveHourReset.getTime(),
          },
          {
            label: 'Weekly',
            pct: 31,
            reset: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(weeklyReset),
            resetAt: weeklyReset.getTime(),
          },
        ],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps event-level Claude windows that unifiedWindows does not report', () => {
    const store = new ClaudePlanUsageStore();

    store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: '5:00 PM',
        unifiedWindows: {
          five_hour: { utilization: 0.09, resetsAt: '5:00 PM' },
        },
      },
    });
    store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'seven_day_opus',
        resetsAt: 'Mon',
        utilization: 71,
      },
    });

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'claude',
      settings: {},
    })).toEqual({
      plan: 'Claude Code',
      windows: [
        { label: '5-hr', pct: 9, reset: '5:00 PM' },
        { label: 'Weekly Opus', pct: 71, reset: 'Mon' },
      ],
    });
  });

  it('prefers the unifiedWindows percentage over the event-level one for the same key', () => {
    const store = new ClaudePlanUsageStore();

    store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: '5:00 PM',
        utilization: 0.12,
        unifiedWindows: {
          five_hour: { utilization: 0.63, resetsAt: '5:00 PM' },
        },
      },
    });

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'claude',
      settings: {},
    })).toEqual({
      plan: 'Claude Code',
      windows: [{ label: '5-hr', pct: 63, reset: '5:00 PM' }],
    });
  });

  it('falls back to the event window when unifiedWindows is unusable', () => {
    const store = new ClaudePlanUsageStore();

    const changed = store.recordSdkMessage({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: '5:50 PM',
        unifiedWindows: {
          five_hour: 'not-a-window',
          seven_day: { utilization: 0.5 },
        },
      },
    });

    expect(changed).toBe(true);
    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'claude',
      settings: {},
    })).toEqual({
      plan: 'Claude Code',
      windows: [
        { label: '5-hr', pct: 0, pctKnown: false, reset: '5:50 PM' },
      ],
    });
  });
});
