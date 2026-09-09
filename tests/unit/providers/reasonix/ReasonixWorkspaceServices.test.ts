import { createReasonixWorkspaceServices } from '@/providers/reasonix/app/ReasonixWorkspaceServices';

describe('createReasonixWorkspaceServices', () => {
  it('registers a usage provider for ACP cost updates', async () => {
    const services = await createReasonixWorkspaceServices({} as any, {} as any);

    expect(services.commandCatalog).toBeDefined();
    expect(services.usageProvider).toBeDefined();
  });
});
