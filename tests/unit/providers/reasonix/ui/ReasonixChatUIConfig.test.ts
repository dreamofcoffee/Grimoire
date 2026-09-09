import { updateReasonixProviderSettings } from '@/providers/reasonix/settings';
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

  it('offers no reasoning control', () => {
    expect(reasonixChatUIConfig.isAdaptiveReasoningModel('reasonix', {})).toBe(false);
    expect(reasonixChatUIConfig.getReasoningOptions('reasonix', {})).toEqual([{ label: 'Default', value: 'default' }]);
    expect(reasonixChatUIConfig.getDefaultReasoningValue('reasonix', {})).toBe('default');
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
