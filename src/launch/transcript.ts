import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export async function openTranscript(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) {
    throw new Error('No transcript paths available for this session.');
  }

  const target = paths.length === 1 ? paths[0]! : await createMergedTranscript(paths);
  const program = process.env.PAGER || process.env.EDITOR || 'less';

  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, [target], { stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`${program} exited with code ${code}`));
      }
    });
  });
}

async function createMergedTranscript(paths: readonly string[]): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'recall-transcript-'));
  const mergedPath = path.join(directory, 'merged.txt');

  const sections = await Promise.all(paths.map(async (sourcePath) => {
    const content = await readFile(sourcePath, 'utf8');
    return `===== ${sourcePath} =====\n${content.trim()}\n`;
  }));

  await writeFile(mergedPath, `${sections.join('\n')}\n`, 'utf8');
  return mergedPath;
}
