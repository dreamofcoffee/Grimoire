import { ProviderSpendUsageStore } from '../../../providers/shared/ProviderSpendUsageStore';
import { getReasonixProviderSettings } from '../settings';

export const reasonixPlanUsageStore = new ProviderSpendUsageStore({
  plan: 'Reasonix',
  note: 'Credits reported by Reasonix CLI · account quota unavailable.',
  isAvailable: settings => getReasonixProviderSettings(settings).enabled,
});
