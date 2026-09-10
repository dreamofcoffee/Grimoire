import {
  parseGrokBillingResponse,
  parseGrokCreditsConfigMessage,
} from '@/providers/grok/app/GrokBillingFetcher';

const SAMPLE_MESSAGE = Uint8Array.from(Buffer.from(
  '0a380dae47b94012001a002206088097f3d0062a060880b191d2063a07080215ae47b940421208011206088097f3d0061a060880b191d2066200',
  'hex',
));

describe('GrokBillingFetcher', () => {
  it('parses the unified weekly usage returned by the current Grok billing API', () => {
    expect(parseGrokBillingResponse({
      config: {
        currentPeriod: {
          end: '2026-07-20T17:37:13.518496+00:00',
          start: '2026-07-13T17:37:13.518496+00:00',
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
        },
        isUnifiedBillingUser: true,
        prepaidBalance: { val: 0 },
      },
      subscription_tier: 'X Premium+',
    })).toEqual({
      plan: 'X Premium+',
      note: expect.stringContaining('Shared across Grok products'),
      windows: [{
        label: 'Weekly',
        pct: 0,
        pctKnown: true,
        reset: expect.stringMatching(/Jul/),
        resetAt: expect.any(Number),
      }],
    });
  });

  it('uses the reported unified usage percentage when it is non-zero', () => {
    expect(parseGrokBillingResponse({
      config: {
        creditUsagePercent: 42.6,
        currentPeriod: {
          end: '2026-07-20T17:37:13.518496+00:00',
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
        },
        isUnifiedBillingUser: true,
        prepaidBalance: { val: 5 },
      },
      subscription_tier: 'x_premium_plus',
    })).toEqual({
      plan: 'X Premium+',
      note: expect.stringContaining('Extra credits: $5.00'),
      windows: [{
        label: 'Weekly',
        pct: 43,
        pctKnown: true,
        reset: expect.any(String),
        resetAt: expect.any(Number),
      }],
    });
  });

  it('parses SuperGrok credit usage from billing protobuf payloads', () => {
    expect(parseGrokCreditsConfigMessage(SAMPLE_MESSAGE)).toEqual({
      plan: 'SuperGrok',
      note: expect.stringContaining('Free credits'),
      windows: [{
        label: 'Credits',
        pct: 6,
        pctKnown: true,
        reset: expect.stringMatching(/Jul/),
        resetAt: expect.any(Number),
      }],
    });
  });
});
