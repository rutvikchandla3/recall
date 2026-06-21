import { loadConfig } from '../core/config.js';
import { getEnvBoolean } from '../core/env.js';
import { createLogger } from '../core/logger.js';
import { checkEmbeddingReadiness, formatEmbeddingSetupHelp } from '../embeddings/client.js';
import { ollamaSetupCommands } from '../embeddings/ollama.js';
import { ensureLlamaModel } from '../embeddings/llamacpp-setup.js';

export interface SetupCommandOptions {
  yes?: boolean;
  refresh?: boolean;
  json?: boolean;
}

export async function runSetupCommand(options: SetupCommandOptions = {}): Promise<void> {
  const config = await loadConfig();
  const logger = createLogger({ quiet: false });
  const provider = config.embeddings.provider;

  if (provider === 'voyage') {
    console.log(`Embeddings provider: Voyage (model: ${config.embeddings.model}, dimensions: ${config.embeddings.dimensions})`);
    const hasKey = Boolean(config.embeddings.apiKey);
    console.log(`VOYAGE_API_KEY: ${hasKey ? 'present' : 'missing'}`);
    if (!hasKey) {
      const helpLines = formatEmbeddingSetupHelp(config);
      console.log('');
      console.log('Setup steps:');
      for (const line of helpLines) {
        console.log(`  - ${line}`);
      }
    } else {
      console.log('');
      console.log('Voyage is configured. Run `recall sync` to build semantic vectors.');
    }
    return;
  }

  if (provider === 'ollama') {
    console.log(`Embeddings provider: local Ollama (model: ${config.embeddings.model}, endpoint: ${config.embeddings.endpoint})`);
    const setupCommands = ollamaSetupCommands(config.embeddings.model);
    console.log('');
    console.log('Ollama setup steps:');
    for (const cmd of setupCommands) {
      console.log(`  - ${cmd}`);
    }
    console.log('');
    console.log('Next: run `recall doctor` to verify Ollama is ready, then `recall sync` to build semantic vectors.');
    const readiness = await checkEmbeddingReadiness(config);
    if (readiness.ok) {
      console.log('Status: Ollama is ready.');
    } else {
      console.log(`Status: ${readiness.message ?? 'not ready'}`);
    }
    return;
  }

  // provider === 'llama'
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const autoDownloadEnv = getEnvBoolean('RECALL_AUTO_DOWNLOAD') ?? false;
  const forceYes = options.yes ?? false;
  const refresh = options.refresh ?? false;

  console.log(`Embeddings provider: local (llama.cpp in-process)`);
  console.log(`Model: ${config.embeddings.model}`);
  console.log(`Cache dir: ${config.paths.modelCacheDir}`);
  console.log('');

  const result = await ensureLlamaModel({
    modelUri: config.embeddings.model,
    cacheDir: config.paths.modelCacheDir,
    dimensions: config.embeddings.dimensions,
    forceYes,
    refresh,
    isTTY,
    autoDownloadEnv,
    logger,
  });

  if (result.status === 'ready') {
    console.log(`Local embedding model ready at ${result.modelPath}.`);
    console.log('Run `recall sync` to build semantic vectors.');
  } else {
    // Fallback — FTS still works, this is not an error exit
    const { readiness } = result;
    if (readiness.setup && readiness.setup.length > 0) {
      for (const line of readiness.setup) {
        console.log(`  - ${line}`);
      }
    } else if (readiness.message) {
      console.log(readiness.message);
    }
    console.log('');
    console.log('Keyword (FTS) search is still fully functional without the embedding model.');
  }
}
