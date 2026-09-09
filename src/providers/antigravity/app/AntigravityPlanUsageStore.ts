import type {
  ProviderPlanUsage,
  ProviderPlanUsageContext,
  ProviderPlanUsageProvider,
} from '../../../providers/shared/providerHostContracts';
import { getAntigravityProviderSettings } from '../settings';
import { fetchAntigravityPlanUsage } from './AntigravityUsageFetcher';

type AntigravityUsageReader = (context: ProviderPlanUsageContext) => Promise<ProviderPlanUsage | null>;

export class AntigravityPlanUsageStore implements ProviderPlanUsageProvider {
  private cachedUsage: ProviderPlanUsage | null = null;

  constructor(private readonly reader: AntigravityUsageReader = fetchAntigravityPlanUsage) {}

  isAvailable(settings: Record<string, unknown>): boolean {
    return getAntigravityProviderSettings(settings).enabled;
  }

  getCachedUsage(_context: ProviderPlanUsageContext): ProviderPlanUsage | null {
    return this.cachedUsage;
  }

  async refreshUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
    try {
      const usage = await this.reader(context);
      if (usage) this.cachedUsage = usage;
    } catch {
      // Background quota polling must not interrupt chat or discard the last
      // good snapshot when AGY is unavailable, logged out, or changes schema.
    }
    return this.cachedUsage;
  }
}

export const antigravityPlanUsageStore = new AntigravityPlanUsageStore();
