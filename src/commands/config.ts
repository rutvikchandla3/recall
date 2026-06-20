import { spawn } from 'node:child_process';
import { ensureConfigFile, loadConfig } from '../core/config.js';
import { resolvePaths } from '../core/paths.js';

export interface ConfigCommandOptions {
  json?: boolean;
  edit?: boolean;
}

export async function runConfigCommand(options: ConfigCommandOptions = {}): Promise<void> {
  const { config, path } = await ensureConfigFile();

  if (options.edit) {
    const editor = process.env.EDITOR;
    if (!editor) {
      throw new Error(`$EDITOR is not set. Config file is available at ${path}`);
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [path], { stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`${editor} exited with code ${code}`));
        }
      });
    });
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ path, config }, null, 2));
    return;
  }

  const resolved = resolvePaths(config.paths);
  console.log(`Config: ${path}`);
  console.log(`DB: ${resolved.dbPath}`);
  console.log(JSON.stringify(config, null, 2));
}
