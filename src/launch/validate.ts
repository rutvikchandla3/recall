import { access } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import type { ProviderId } from '../domain/session.js';

export interface CommandValidation {
  cwdExists: boolean;
  cliOnPath: boolean;
  warnings: string[];
}

const providerCommand: Record<ProviderId, string> = {
  claude: 'claude',
  codex: 'codex',
  pi: 'pi',
};

export async function validateLaunchTarget(provider: ProviderId, cwd: string): Promise<CommandValidation> {
  const warnings: string[] = [];
  let cwdExists = true;

  try {
    await access(cwd, constants.F_OK);
  } catch {
    cwdExists = false;
    warnings.push('cwd missing');
  }

  const cliOnPath = isCommandOnPath(providerCommand[provider]);
  if (!cliOnPath) {
    warnings.push(`${providerCommand[provider]} missing from PATH`);
  }

  return { cwdExists, cliOnPath, warnings };
}

export function isCommandOnPath(command: string): boolean {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return false;
  }

  return pathValue
    .split(delimiter)
    .some((segment) => {
      if (!segment) {
        return false;
      }

      return existsSync(`${segment}/${command}`);
    });
}
