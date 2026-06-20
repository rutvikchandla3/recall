import { describe, expect, it } from 'vitest';
import { buildCurrentCliInvocation } from './current-cli.js';

describe('buildCurrentCliInvocation', () => {
  it('reuses the current entry point and preserves loader args', () => {
    expect(buildCurrentCliInvocation({
      execPath: '/usr/local/bin/node',
      execArgv: ['--import', 'tsx'],
      argv: ['/usr/local/bin/node', '/Users/rutvik/rcode/recall/src/cli.ts'],
    })).toEqual({
      command: '/usr/local/bin/node',
      args: ['--import', 'tsx', '/Users/rutvik/rcode/recall/src/cli.ts'],
    });
  });

  it('drops debug flags so background sync does not inherit inspector ports', () => {
    expect(buildCurrentCliInvocation({
      execPath: 'node',
      execArgv: ['--inspect=9229', '--import', 'tsx', '--inspect-brk'],
      argv: ['node', 'dist/cli.js'],
    })).toEqual({
      command: 'node',
      args: ['--import', 'tsx', 'dist/cli.js'],
    });
  });
});
