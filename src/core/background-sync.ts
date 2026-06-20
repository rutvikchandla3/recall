import { spawn } from 'node:child_process';
import { buildCurrentCliInvocation } from './current-cli.js';
import type { SyncSummary } from '../index/sync.js';

export interface BackgroundSyncHandle {
  result: Promise<SyncSummary>;
  cancel(): void;
}

export function spawnBackgroundSync(): BackgroundSyncHandle {
  const invocation = buildCurrentCliInvocation();
  const child = spawn(invocation.command, [...invocation.args, 'sync', '--quiet', '--json'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let cancelled = false;
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const result = new Promise<SyncSummary>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (cancelled) {
        reject(new Error('Background sync cancelled.'));
        return;
      }

      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`;
        reject(new Error(`Background sync failed: ${detail}`));
        return;
      }

      try {
        resolve(parseSyncSummary(stdout));
      } catch (error) {
        const detail = stdout.trim() || stderr.trim() || (error instanceof Error ? error.message : String(error));
        reject(new Error(`Background sync returned invalid output: ${detail}`));
      }
    });
  });

  return {
    result,
    cancel() {
      if (child.exitCode === null && child.signalCode === null) {
        cancelled = true;
        child.kill('SIGTERM');
      }
    },
  };
}

function parseSyncSummary(stdout: string): SyncSummary {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('empty output');
  }

  return JSON.parse(trimmed) as SyncSummary;
}
