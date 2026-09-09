import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderModelCatalogRefreshCache } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import type {
  ProviderCliResolver,
  ProviderModelCatalog,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../providers/shared/providerHostContracts';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { ReasonixCommandCatalog } from '../commands/ReasonixCommandCatalog';
import {
  buildReasonixModelCatalogFingerprint,
  resolveReasonixModelCatalogFingerprint,
} from '../modelCatalogFingerprint';
import { reasonixCliResolver } from '../runtime/ReasonixCliResolver';
import { getReasonixProviderSettings } from '../settings';
import { reasonixSettingsTabRenderer } from '../ui/ReasonixSettingsTab';
import { reasonixPlanUsageStore } from './ReasonixPlanUsageStore';

export interface ReasonixWorkspaceServices extends ProviderWorkspaceServices {
  commandCatalog: ProviderCommandCatalog;
  cliResolver: ProviderCliResolver;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createReasonixModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  const initialSettings = getReasonixProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    // The resolved CLI path is part of the fingerprint but is not available
    // here: the workspace manager runs this before it publishes the services,
    // and until then getResolvedProviderCliPath returns null. Hold the seed
    // back until the path is known.
    const initialEnvironmentVariables = plugin.getActiveEnvironmentVariables?.('reasonix')
      ?? initialSettings.environmentVariables;
    if (plugin.getResolvedProviderCliPath?.('reasonix') == null) {
      refreshCache.seedOnFirstRefresh(() => buildReasonixModelCatalogFingerprint(
        initialSettings,
        plugin.getResolvedProviderCliPath?.('reasonix') ?? initialSettings.cliPath,
        initialEnvironmentVariables,
      ));
    } else {
      refreshCache.seed(
        resolveReasonixModelCatalogFingerprint(plugin, initialSettings),
        initialSettings.discoveredModelsFingerprint,
      );
    }
  }

  return {
    isAvailable(settings) {
      return getReasonixProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      // Discovery boots the real CLI over ACP and creates a session, so it must
      // not run again for every model dropdown that opens.
      const currentSettings = getReasonixProviderSettings(settings);
      const fingerprint = resolveReasonixModelCatalogFingerprint(plugin, currentSettings);
      const hasCachedModels = currentSettings.discoveredModels.length > 0;
      const appliedDeferredSeed = refreshCache.applyDeferredSeed(
        fingerprint,
        hasCachedModels,
        currentSettings.discoveredModelsFingerprint,
      );
      if (appliedDeferredSeed && !force) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'reasonix',
            reason: 'seeded_on_first_use',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.reasonix',
        });
        return 'skipped';
      }

      if (!force && refreshCache.isFresh(fingerprint, hasCachedModels)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'reasonix',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.reasonix',
        });
        return 'skipped';
      }

      return refreshCache.refresh({
        fingerprint,
        force,
        hasCachedModels,
        load: async () => {
          const loaded = await plugin.getReasonixExecution().metadata.discoverMetadata();
          return loaded ? 'refreshed' : 'failed';
        },
      });
    },
  };
}

export async function createReasonixWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<ReasonixWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'reasonix');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  return {
    commandCatalog: new ReasonixCommandCatalog(vaultAdapter),
    cliResolver: reasonixCliResolver(),
    modelCatalog: createReasonixModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: reasonixPlanUsageStore,
    settingsTabRenderer: reasonixSettingsTabRenderer,
  };
}

export const reasonixWorkspaceRegistration: ProviderWorkspaceRegistration<ReasonixWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createReasonixWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetReasonixWorkspaceServices(
  plugin: GrimoirePlugin,
): ReasonixWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('reasonix') as ReasonixWorkspaceServices | null ?? null;
}
