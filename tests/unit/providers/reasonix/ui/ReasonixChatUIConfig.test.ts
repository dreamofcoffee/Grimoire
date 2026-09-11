import { getReasonixProviderSettings, updateReasonixProviderSettings } from '@/providers/reasonix/settings';
import { reasonixChatUIConfig } from '@/providers/reasonix/ui/ReasonixChatUIConfig';

describe('reasonixChatUIConfig', () => {
  it('returns the synthetic Reasonix option before model discovery', () => {
    expect(reasonixChatUIConfig.getModelOptions({})).toEqual([
      {
        description: 'Reasonix CLI ACP runtime',
        label: 'Reasonix',
        value: 'reasonix',
      },
    ]);
  });

  it('shows all discovered models when the persisted visibility cache is stale', () => {
    const settings: Record<string, unknown> = {};
    updateReasonixProviderSettings(settings, {
      discoveredModels: [
        { label: 'SWE-1.6 Slow', rawId: 'swe-1-6-slow' },
        { label: 'Claude Opus 5 Medium', rawId: 'claude-opus-5-medium' },
      ],
      modelAliases: { 'swe-1-6-slow': 'Slow' },
      visibleModels: ['swe-1-6-slow'],
    });

    expect(reasonixChatUIConfig.getModelOptions(settings)).toEqual([
      { description: 'Reasonix CLI ACP model', label: 'Slow', value: 'reasonix:swe-1-6-slow' },
      { description: 'Reasonix CLI ACP model', label: 'Claude Opus 5 Medium', value: 'reasonix:claude-opus-5-medium' },
    ]);
  });

  it('owns Reasonix synthetic and encoded model ids', () => {
    expect(reasonixChatUIConfig.ownsModel('reasonix', {})).toBe(true);
    expect(reasonixChatUIConfig.ownsModel('reasonix:swe-1-6-slow', {})).toBe(true);
    expect(reasonixChatUIConfig.ownsModel('gpt-5', {})).toBe(false);
  });

  it('offers only Auto until a session has said which levels it takes', () => {
    // There is no static list to fall back on: which levels a model takes is
    // decided by the provider block serving it, and `auto` is the one value
    // that always works.
    expect(reasonixChatUIConfig.getReasoningOptions('reasonix', {}))
      .toEqual([{ label: 'Auto', value: 'auto' }]);
    expect(reasonixChatUIConfig.getDefaultReasoningValue('reasonix', {})).toBe('auto');
  });

  it('offers the levels the session reported, with Auto at their head', () => {
    const settings: Record<string, unknown> = {};
    updateReasonixProviderSettings(settings, {
      availableEfforts: [
        { id: 'low', name: 'Low' },
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ],
    });

    expect(reasonixChatUIConfig.getReasoningOptions('reasonix', settings)).toEqual([
      { label: 'Auto', value: 'auto' },
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ]);
  });

  it('refuses a level the open session never offered', () => {
    // Reasonix validates the value against the model and answers
    // `UNSUPPORTED_REASONING_EFFORT`, so storing one would fail every later
    // turn rather than think harder on this one.
    const settings: Record<string, unknown> = {};
    updateReasonixProviderSettings(settings, { availableEfforts: [{ id: 'low', name: 'Low' }] });

    reasonixChatUIConfig.applyReasoningSelection?.('reasonix', 'max', settings);
    expect(getReasonixProviderSettings(settings).effortLevel).toBe('auto');

    reasonixChatUIConfig.applyReasoningSelection?.('reasonix', 'low', settings);
    expect(getReasonixProviderSettings(settings).effortLevel).toBe('low');
    expect(reasonixChatUIConfig.getDefaultReasoningValue('reasonix', settings)).toBe('low');
  });

  it('reads the context window the recorded session reports by default', () => {
    expect(reasonixChatUIConfig.getContextWindowSize('reasonix:swe-1-6-slow')).toBe(200_000);
    expect(reasonixChatUIConfig.getContextWindowSize('reasonix:swe-1-6-slow', { 'reasonix:swe-1-6-slow': 50 })).toBe(50);
  });

  it('updates shared permission mode when applying a Reasonix permission selection', () => {
    const settings: Record<string, unknown> = { permissionMode: 'full_access' };

    reasonixChatUIConfig.applyPermissionMode?.('normal', settings);

    expect(settings.permissionMode).toBe('normal');
    expect(reasonixChatUIConfig.resolvePermissionMode?.(settings)).toBe('normal');
  });
});
