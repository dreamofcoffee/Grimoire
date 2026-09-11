import * as fs from 'fs';

import { ReasonixCliResolver } from '@/providers/reasonix/runtime/ReasonixCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;

describe('ReasonixCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the current host path instead of another synced host path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/current/reasonix');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ReasonixCliResolver();
    const resolved = resolver.resolve(
      {
        'current-host': '/current/reasonix',
        'other-host': '/other/reasonix',
      },
      '/legacy/reasonix',
      '',
    );

    expect(resolved).toBe('/current/reasonix');
  });

  it('falls back to the legacy path when the current host has no custom path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/legacy/reasonix');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ReasonixCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/reasonix',
      },
      '/legacy/reasonix',
      '',
    );

    expect(resolved).toBe('/legacy/reasonix');
  });

  it('returns null when neither the current host nor the legacy path resolve to a file', () => {
    mockedExists.mockReturnValue(false);

    const resolver = new ReasonixCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/reasonix',
      },
      '/legacy/reasonix',
      '',
    );

    expect(resolved).toBeNull();
  });
});
