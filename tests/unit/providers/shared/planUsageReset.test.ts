import {
  formatPlanResetInstant,
  formatPlanResetLabel,
  resolvePlanResetDate,
} from '@/providers/shared/planUsageReset';

describe('planUsageReset', () => {
  describe('resolvePlanResetDate', () => {
    it('reads an epoch in seconds, which is what the provider CLIs report', () => {
      const date = new Date(2026, 8, 12, 2, 0);

      expect(resolvePlanResetDate(Math.floor(date.getTime() / 1000))?.getTime()).toBe(date.getTime());
    });

    it('reads an epoch already in milliseconds without multiplying it again', () => {
      const date = new Date(2026, 8, 12, 2, 0);

      expect(resolvePlanResetDate(date.getTime())?.getTime()).toBe(date.getTime());
    });

    it('reads an ISO timestamp without treating a preformatted label as a date', () => {
      const iso = '2026-09-12T02:00:00.000Z';

      expect(resolvePlanResetDate(iso)?.toISOString()).toBe(iso);
      expect(resolvePlanResetDate('Sat 12.09.2026 02:00')).toBeNull();
    });

    it('refuses values that are not a usable instant', () => {
      expect(resolvePlanResetDate('Mon')).toBeNull();
      expect(resolvePlanResetDate(0)).toBeNull();
      expect(resolvePlanResetDate(-1)).toBeNull();
      expect(resolvePlanResetDate(Number.NaN)).toBeNull();
      expect(resolvePlanResetDate(undefined)).toBeNull();
    });
  });

  describe('formatPlanResetLabel', () => {
    it('passes through a label the provider already formatted', () => {
      expect(formatPlanResetLabel('  5:50 PM  ')).toBe('5:50 PM');
      expect(formatPlanResetLabel('   ')).toBeNull();
    });

    it('keeps the compact label behavior for an ISO reset timestamp', () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 8, 9, 13, 9).getTime());
      try {
        const reset = new Date(2026, 8, 12, 2, 0);
        expect(formatPlanResetLabel(reset.toISOString())).toBe(
          new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(reset),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('shows the time when the window resets today', () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 8, 9, 13, 9).getTime());
      try {
        const reset = new Date(2026, 8, 9, 23, 30);

        expect(formatPlanResetLabel(Math.floor(reset.getTime() / 1000))).toBe(
          new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(reset),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('shows the weekday when the window resets on another day', () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 8, 9, 13, 9).getTime());
      try {
        const reset = new Date(2026, 8, 12, 2, 0);

        expect(formatPlanResetLabel(Math.floor(reset.getTime() / 1000))).toBe(
          new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(reset),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('formatPlanResetInstant', () => {
    it('spells the reset out as weekday, calendar date and time', () => {
      const reset = new Date(2026, 8, 12, 2, 0);
      const expected = [
        new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(reset),
        new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(reset),
        new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(reset),
      ].join(' ');

      expect(formatPlanResetInstant(Math.floor(reset.getTime() / 1000))).toBe(expected);
    });

    it('does not invent an instant from a label the provider pre-formatted', () => {
      expect(formatPlanResetInstant('Mon')).toBeNull();
      expect(formatPlanResetInstant(undefined)).toBeNull();
    });
  });
});
