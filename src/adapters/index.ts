import type { ProviderId } from '../domain/session.js';
import type { SessionAdapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { piAdapter } from './pi.js';

export { claudeAdapter } from './claude.js';
export { codexAdapter } from './codex.js';
export { piAdapter } from './pi.js';
export type { SessionAdapter } from './types.js';

export const defaultAdapters: SessionAdapter[] = [claudeAdapter, codexAdapter, piAdapter];

const adapterMap = new Map<ProviderId, SessionAdapter>(defaultAdapters.map((adapter) => [adapter.id, adapter]));

export function getAdapter(provider: ProviderId): SessionAdapter {
  const adapter = adapterMap.get(provider);
  if (!adapter) {
    throw new Error(`Unknown adapter: ${provider}`);
  }

  return adapter;
}
